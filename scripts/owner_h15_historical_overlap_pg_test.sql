begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare p uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';d date:=(now() at time zone 'Asia/Kolkata')::date;req uuid:=gen_random_uuid();failed boolean;
begin
 insert into public.bite_owner_historical_entries(request_id,entry_kind,property_id,record_date,departure_date,customer_name,room_number,amount)
 values(req,'room',p,d-10,d-8,'Synthetic overlap original','QA-101',1000);
 failed:=false;begin insert into public.bite_owner_historical_entries(request_id,entry_kind,property_id,record_date,departure_date,customer_name,room_number,amount)
 values(gen_random_uuid(),'room',p,d-9,d-7,'Synthetic overlapping room',' qa-101 ',2000);exception when sqlstate 'P0001' then if sqlerrm like 'H15_ROOM_OVERLAP:%' then failed:=true;else raise;end if;end;
 if not failed then raise exception 'Overlapping room record was accepted';end if;
 insert into public.bite_owner_historical_entries(request_id,entry_kind,property_id,record_date,departure_date,customer_name,room_number,amount)
 values(gen_random_uuid(),'room',p,d-8,d-7,'Adjacent stay','QA-101',1000),(gen_random_uuid(),'room',p,d-9,d-7,'Different room','QA-102',1000);
 failed:=false;begin insert into public.bite_owner_historical_entries(request_id,entry_kind,property_id,record_date,departure_date,customer_name,room_number,amount)
 values(req,'room',p,d-10,d-8,'Exact retry','QA-101',1000);exception when unique_violation then failed:=true;end;
 if not failed then raise exception 'Duplicate request was accepted';end if;
 if (select count(*) from public.bite_owner_historical_entries where property_id=p and lower(btrim(room_number))='qa-101')<>2 then raise exception 'Existing history changed';end if;
 raise notice 'PASS H15 overlap review, adjacent room dates, separate rooms and retry';
end$$;
reset role;
rollback;
