-- Isolated selected-room checkout regression. All synthetic fixtures roll back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare p uuid;g uuid;r uuid;first_stay uuid;gid uuid;v jsonb;payload jsonb;ids jsonb;f uuid[]:='{}';s uuid[]:='{}';i integer;d date:=(now()at time zone 'Asia/Kolkata')::date;req uuid:=gen_random_uuid();failed boolean;pending uuid;
begin
 p:=public.bite_create_property('Synthetic H13 split checkout','hotel',gen_random_uuid());
 g:=(public.bite_property_command(p,'guest_save','{"full_name":"Synthetic split checkout","phone":"9999999996","address":"Synthetic address"}',gen_random_uuid())->>'id')::uuid;
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
 payload:=payload||jsonb_build_object('method','Split','cash_amount',1500,'upi_amount',2500,'verified',true,'reference','H13-SPLIT-SYNTHETIC','account_note','Synthetic UPI account');
 failed:=false;begin perform public.bite_property_command(p,'booking_checkout_collect',payload||jsonb_build_object('upi_amount',2499),gen_random_uuid());exception when others then failed:=true;end;
 if not failed then raise exception 'Incorrect tender sum accepted';end if;
 failed:=false;begin perform public.bite_property_command(p,'booking_checkout_collect',payload||jsonb_build_object('verified',false),gen_random_uuid());exception when others then failed:=true;end;
 if not failed then raise exception 'Unverified UPI accepted';end if;
 failed:=false;begin perform public.bite_property_command(p,'booking_checkout_collect',payload||jsonb_build_object('reference',''),gen_random_uuid());exception when others then failed:=true;end;
 if not failed then raise exception 'Missing UPI reference accepted';end if;
 if exists(select 1 from public.bite_folio_entries where property_id=p and kind='payment') then raise exception 'Invalid split created receipts';end if;
 v:=public.bite_property_command(p,'booking_checkout_collect',payload,req);
 if jsonb_array_length(v->'invoices')<>2 or public.bite_property_command(p,'booking_checkout_collect',payload,req)<>v then raise exception 'Split group invoice or retry failed';end if;
 if (select coalesce(sum(amount),0) from public.bite_folio_entries where property_id=p and kind='payment' and status='confirmed' and method='Cash')<>1500 then raise exception 'Cash allocation incorrect';end if;
 if (select coalesce(sum(amount),0) from public.bite_folio_entries where property_id=p and kind='payment' and status='confirmed' and method='UPI')<>2500 then raise exception 'UPI allocation incorrect';end if;
 if not exists(select 1 from public.bite_stays where id=s[2] and status='in_house') or exists(select 1 from public.bite_folio_entries where folio_id=f[2] and kind='payment') then raise exception 'Unselected room affected';end if;
 payload:=jsonb_build_object('folio_id',f[2],'amount',2000,'method','Split','cash_amount',600,'upi_amount',1400,'verified',true,'reference','H13-SINGLE-SYNTHETIC','account_note','Synthetic UPI account');
 req:=gen_random_uuid();
 v:=public.bite_property_command(p,'checkout_collect',payload,req);
 if public.bite_property_command(p,'checkout_collect',payload,req)<>v then raise exception 'Single split retry failed';end if;
 if (select coalesce(sum(amount),0) from public.bite_folio_entries where property_id=p and kind='payment' and status='confirmed' and method='Cash')<>2100 or (select coalesce(sum(amount),0) from public.bite_folio_entries where property_id=p and kind='payment' and status='confirmed' and method='UPI')<>3900 then raise exception 'Single split receipts incorrect';end if;
 if (select count(*) from public.bite_stays where property_id=p and status='checked_out')<>3 then raise exception 'Checkout status incorrect';end if;
 raise notice 'PASS split cash/UPI checkout per room and group, exact amounts, verified reference and retry';
end$$;
rollback;
