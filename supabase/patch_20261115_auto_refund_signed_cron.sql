-- Cron-signed, database-vault protected automatic refund worker.
-- No Cashfree refunds are sent by this migration. The existing config stays OFF.
do $$
begin
 if not exists (select 1 from vault.secrets where name='bite_auto_refund_dispatch_key') then
  perform vault.create_secret(
    encode(extensions.gen_random_bytes(32),'hex'),
    'bite_auto_refund_dispatch_key',
    'Bite auto refund scheduler signature key; never exposed to browser or GitHub');
 end if;
end $$;

create or replace function public.bite_verify_auto_refund_dispatch(
 p_timestamp bigint,p_signature text)
returns boolean language plpgsql security definer set search_path='' as $$
declare secret_value text;expected text;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then
  raise exception 'Service only' using errcode='42501';
 end if;
 if p_timestamp is null or p_signature is null or
    p_signature !~ '^[a-f0-9]{64}$' or
    abs(extract(epoch from clock_timestamp())::bigint-p_timestamp)>90 then
  return false;
 end if;
 select decrypted_secret into secret_value
  from vault.decrypted_secrets where name='bite_auto_refund_dispatch_key';
 if secret_value is null or length(secret_value)<>64 then return false;end if;
 expected:=encode(extensions.hmac(p_timestamp::text||':drain',secret_value,'sha256'),'hex');
 return expected=p_signature;
end $$;
revoke all on function public.bite_verify_auto_refund_dispatch(bigint,text)
 from public,anon,authenticated;
grant execute on function public.bite_verify_auto_refund_dispatch(bigint,text) to service_role;

create schema if not exists bite_private;
create or replace function bite_private.dispatch_auto_refund_queue()
returns void language plpgsql security definer set search_path='' as $$
declare secret_value text;ts bigint;sig text;
begin
 -- Do nothing unless a trusted rollout explicitly enables auto-refunds.
 if not exists(select 1 from public.bite_operations_config
               where id=true and auto_refunds_enabled=true) then return;end if;
 if not exists(select 1 from public.bite_refund_jobs
               where auto_authorized_at is not null
                 and status in ('approved','processing','submitted')) then return;end if;
 select decrypted_secret into secret_value
  from vault.decrypted_secrets where name='bite_auto_refund_dispatch_key';
 if secret_value is null or length(secret_value)<>64 then
   raise warning 'Bite auto refund dispatch skipped: vault key missing';
   return;
 end if;
 ts:=extract(epoch from clock_timestamp())::bigint;
 sig:=encode(extensions.hmac(ts::text||':drain',secret_value,'sha256'),'hex');
 perform net.http_post(
  url:='https://wedbgpybbgsszcmffoha.supabase.co/functions/v1/bite-auto-refund',
  headers:=jsonb_build_object(
   'Content-Type','application/json',
   'x-bite-auto-refund-ts',ts::text,
   'x-bite-auto-refund-signature',sig),
  body:='{"action":"drain"}'::jsonb,
  timeout_milliseconds:=90000);
exception when others then
 -- A scheduler issue must not affect paid-order creation/fulfilment.
 raise warning 'Bite auto refund dispatch unavailable: %',SQLSTATE;
end $$;
revoke all on function bite_private.dispatch_auto_refund_queue()
 from public,anon,authenticated;

-- The cron command contains NO secrets. Vault signs each request per invocation.
select cron.schedule(
 'bite-auto-refund-vault-dispatch',
 '*/5 * * * *',
 'select bite_private.dispatch_auto_refund_queue();');
