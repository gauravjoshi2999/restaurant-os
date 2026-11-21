-- Isolated selected-room checkout regression. All synthetic fixtures roll back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare p uuid;g uuid;r uuid;first_stay uuid;gid uuid;v jsonb;payload jsonb;ids jsonb;f uuid[]:='{}';s uuid[]:='{}';i integer;d date:=(now()at time zone 'Asia/Kolkata')::date;req uuid:=gen_random_uuid();failed boolean;pending uuid;
begin
 p:=public.bite_create_property('Synthetic H13 selected rooms','hotel',gen_random_uuid());
 g:=(public.bite_property_command(p,'guest_save','{"full_name":"Synthetic selected rooms","phone":"9999999997","address":"Synthetic address"}',gen_random_uuid())->>'id')::uuid;
 for i in 1..3 loop
  r:=(public.bite_property_command(p,'room_save',jsonb_build_object('number','H13-'||i,'room_type','Deluxe'),gen_random_uuid())->>'id')::uuid;
  v:=public.bite_property_command(p,'reserve',jsonb_build_object('guest_id',g,'room_id',r,'arrival',d,'departure',d+1,'adults',1,'children',0,'nightly_rate',i*1000,'terms_at_checkin',true,'booking_mode','checkin')||case when i>1 then jsonb_build_object('booking_stay_id',first_stay)else '{}'::jsonb end,gen_random_uuid());
  if i=1 then first_stay:=(v->>'id')::uuid;end if;
  s:=array_append(s,(v->>'id')::uuid);f:=array_append(f,(v->>'folio_id')::uuid);
  perform public.bite_property_command(p,'checkin',jsonb_build_object('id',v->>'id'),gen_random_uuid());
 end loop;
 select group_id into strict gid from public.bite_stays where id=s[1];
 select jsonb_agg(x order by x) into ids from (select f[1]::text x union all select f[3]::text)x;
 payload:=jsonb_build_object('group_id',gid,'folio_ids',ids,'amount',4000,'method','Cash','selected_only',true);
 -- Legacy callers cannot send a partial list by accident.
 failed:=false;begin perform public.bite_property_command(p,'booking_checkout_collect',payload-'selected_only',gen_random_uuid());exception when others then failed:=true;end;
 if not failed then raise exception 'Legacy all-room checkout accepted a subset';end if;
 failed:=false;begin perform public.bite_property_command(p,'booking_checkout_collect',payload||jsonb_build_object('amount',3999),gen_random_uuid());exception when others then failed:=true;end;
 if not failed then raise exception 'Stale balance accepted';end if;
 failed:=false;begin perform public.bite_property_command(p,'booking_checkout_collect',payload||jsonb_build_object('folio_ids',ids||jsonb_build_array(gen_random_uuid()::text)),gen_random_uuid());exception when others then failed:=true;end;
 if not failed then raise exception 'Foreign folio accepted';end if;
 failed:=false;begin perform public.bite_property_command(p,'booking_checkout_collect',payload||jsonb_build_object('folio_ids',ids||jsonb_build_array(f[1]::text)),gen_random_uuid());exception when others then failed:=true;end;
 if not failed then raise exception 'Duplicate folio accepted';end if;
 pending:=(public.bite_property_command(p,'payment',jsonb_build_object('folio_id',f[3],'amount',50,'method','UPI','description','Synthetic pending selected room','reference','H13-PENDING'),gen_random_uuid())->>'id')::uuid;
 failed:=false;begin perform public.bite_property_command(p,'booking_checkout_collect',payload,gen_random_uuid());exception when others then failed:=true;end;
 if not failed or (select count(*) from public.bite_stays where property_id=p and status='in_house')<>3 then raise exception 'Selected checkout failed to roll back all rooms';end if;
 perform public.bite_property_command(p,'payment_void',jsonb_build_object('id',pending,'folio_id',f[3],'description','Synthetic receipt not received'),gen_random_uuid());
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 failed:=false;begin perform public.bite_property_command(p,'booking_checkout_collect',payload,gen_random_uuid());exception when others then failed:=true;end;
 if not failed then raise exception 'Other owner accepted';end if;
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 v:=public.bite_property_command(p,'booking_checkout_collect',payload,req);
 if jsonb_array_length(v->'invoices')<>2 then raise exception 'Expected two room invoices';end if;
 if public.bite_property_command(p,'booking_checkout_collect',payload,req)<>v then raise exception 'Idempotency failed';end if;
 if (select count(*) from public.bite_stays where id=any(array[s[1],s[3]]) and status='checked_out')<>2 or not exists(select 1 from public.bite_stays where id=s[2] and status='in_house') then raise exception 'Unexpected room checked out';end if;
 if (select coalesce(sum(amount),0) from public.bite_folio_entries where property_id=p and kind='payment' and status='confirmed')<>4000 then raise exception 'Incorrect or repeated receipt';end if;
 if exists(select 1 from public.bite_folio_entries where folio_id=f[2] and kind='payment') then raise exception 'Unselected room collected';end if;
 raise notice 'PASS selected family checkout, scope, stale balance, rollback and stable retry';
end$$;
rollback;
