-- Historical receipts are imported record metadata, never posted money movements.
-- Legacy rows remain unchanged and their receipt dates remain unknown.
alter table public.bite_owner_historical_entries add column if not exists received_date date;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.bite_owner_historical_entries'::regclass and conname='bite_historical_received_date_valid') then
  alter table public.bite_owner_historical_entries add constraint bite_historical_received_date_valid check(received_date is null or (received_amount>0 and received_date>='2000-01-01'::date and received_date<=(now() at time zone 'Asia/Kolkata')::date and payment_method is not null)) not valid;
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.bite_owner_historical_entries'::regclass and conname='bite_historical_completed_room') then
  alter table public.bite_owner_historical_entries add constraint bite_historical_completed_room check(entry_kind<>'room' or departure_date<=(now() at time zone 'Asia/Kolkata')::date) not valid;
 end if;
end $$;
create index if not exists bite_historical_room_receipt_date_idx on public.bite_owner_historical_entries(property_id,received_date) where entry_kind='room' and received_date is not null;
create index if not exists bite_historical_pos_receipt_date_idx on public.bite_owner_historical_entries(restaurant_id,received_date) where entry_kind='pos' and received_date is not null;

-- Invoker uses the existing table RLS; no privileged endpoint and no live journal changes.
create or replace function public.bite_historical_room_period(p_property uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security invoker set search_path='' as $fn$
declare v jsonb;
begin
 if auth.uid() is null or p_property is null or not exists(select 1 from public.bite_property_members m where m.property_id=p_property and m.user_id=auth.uid() and m.active and m.role in('owner','manager')) then
  raise exception 'Historical register access denied' using errcode='42501';end if;
 if p_from is null or p_to is null or p_from<'2000-01-01'::date or p_to<p_from or p_to-p_from>366 then raise exception 'Choose a valid period up to 367 days' using errcode='22023';end if;
 with bills as(
  select count(*) as count,coalesce(sum(amount),0) as billed,coalesce(sum(received_amount) filter(where received_date is null),0) as undated
  from public.bite_owner_historical_entries where entry_kind='room' and property_id=p_property and record_date between p_from and p_to
 ), receipts as(
  select received_date as day,payment_method as method,count(*) as count,sum(received_amount) as amount
  from public.bite_owner_historical_entries where entry_kind='room' and property_id=p_property and received_date between p_from and p_to and received_amount>0
  group by received_date,payment_method
 )
 select jsonb_build_object('from',p_from,'to',p_to,'record_type','historical_register_only','bill_count',b.count,'billed',b.billed,'undated_received',b.undated,
 'dated_receipts',coalesce((select sum(amount) from receipts),0),'receipts',coalesce((select jsonb_agg(to_jsonb(r) order by r.day,r.method) from receipts r),'[]'::jsonb)) into v from bills b;
 return v;
end
$fn$;
revoke all on function public.bite_historical_room_period(uuid,date,date) from public,anon,authenticated;
grant execute on function public.bite_historical_room_period(uuid,date,date) to authenticated;
