-- Historical room receipt date isolation; synthetic database only.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare p uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';d date:=(now() at time zone 'Asia/Kolkata')::date;v jsonb;failed boolean;
begin
 insert into public.bite_owner_historical_entries(request_id,entry_kind,property_id,record_date,departure_date,customer_name,room_number,amount,received_amount,payment_method,received_date)
 values(gen_random_uuid(),'room',p,d-10,d-9,'Synthetic receipt date QA','H15-101',3000,1000,'Cash',d-2),
 (gen_random_uuid(),'room',p,d-8,d-7,'Synthetic current receipt QA','H15-102',2500,700,'UPI',d);
 v:=public.bite_historical_room_period(p,d-10,d-7);
 if (v->>'billed')::numeric<>5500 or (v->>'dated_receipts')::numeric<>0 then raise exception 'Bill date and receipt date were mixed: %',v;end if;
 v:=public.bite_historical_room_period(p,d-2,d-2);
 if (v->>'billed')::numeric<>0 or (v->>'dated_receipts')::numeric<>1000 or v->'receipts'->0->>'method'<>'Cash' then raise exception 'Historical cash on wrong day: %',v;end if;
 v:=public.bite_historical_room_period(p,d,d);
 if (v->>'dated_receipts')::numeric<>700 or (v->>'billed')::numeric<>0 or v->'receipts'->0->>'method'<>'UPI' then raise exception 'Current-day recorded historic receipt incorrect: %',v;end if;
 v:=public.bite_historical_room_period(p,d-1,d-1);
 if (v->>'undated_received')::numeric<>500 or (v->>'dated_receipts')::numeric<>0 then raise exception 'Unknown legacy receipt date was guessed: %',v;end if;
 failed:=false;begin insert into public.bite_owner_historical_entries(request_id,entry_kind,property_id,record_date,departure_date,customer_name,room_number,amount,received_amount,payment_method,received_date) values(gen_random_uuid(),'room',p,d-1,d,'Future receipt','H15',100,100,'Cash',d+1);exception when check_violation then failed:=true;end;
 if not failed then raise exception 'Future receipt was accepted';end if;
 failed:=false;begin insert into public.bite_owner_historical_entries(request_id,entry_kind,property_id,record_date,departure_date,customer_name,room_number,amount) values(gen_random_uuid(),'room',p,d-1,d+1,'Future checkout','H15',100);exception when check_violation then failed:=true;end;
 if not failed then raise exception 'Future stay checkout accepted';end if;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 failed:=false;begin perform public.bite_historical_room_period(p,d-10,d);exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'Other property historical report exposed';end if;
 raise notice 'PASS H15 bill date, original receipt date, unknown legacy date, future date guard and tenant isolation';
end$$;
reset role;
rollback;
