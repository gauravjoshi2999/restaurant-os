\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
insert into public.bite_owner_historical_entries(request_id,entry_kind,property_id,record_date,departure_date,
 customer_name,room_number,amount,received_amount,guest_count)
values('11111111-1111-4111-8111-000000000001','room','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 (now() at time zone 'Asia/Kolkata')::date-1,(now() at time zone 'Asia/Kolkata')::date,
 'Synthetic historical guest','101',1500,500,2);
insert into public.bite_owner_historical_entries(request_id,entry_kind,restaurant_id,record_date,
 customer_name,amount,received_amount,guest_count,visit_type,items)
values('11111111-1111-4111-8111-000000000002','pos','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 (now() at time zone 'Asia/Kolkata')::date-1,'Synthetic walk-in',600,600,3,'dine_in',
 '[{"name":"Dal","quantity":3,"unit_price":200}]'::jsonb);
do $$
declare rows integer;
begin
 select count(*) into rows from public.bite_owner_historical_entries;
 if rows<>2 then raise exception 'Owner A expected exactly 2 own historical rows, got %',rows;end if;
 begin
  insert into public.bite_owner_historical_entries(request_id,entry_kind,property_id,record_date,departure_date,customer_name,room_number,amount)
  values(gen_random_uuid(),'room','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    current_date-1,current_date,'Cross tenant', '102', 1);
  raise exception 'Cross-tenant room write succeeded';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into public.bite_owner_historical_entries(request_id,entry_kind,restaurant_id,record_date,customer_name,amount,visit_type,items)
  values(gen_random_uuid(),'pos','dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    current_date-1,'Cross tenant',10,'takeaway','[{"name":"Tea","quantity":1,"unit_price":10}]'::jsonb);
  raise exception 'Cross-tenant POS write succeeded';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into public.bite_owner_historical_entries(request_id,entry_kind,property_id,record_date,departure_date,customer_name,room_number,amount)
  values(gen_random_uuid(),'room','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (now() at time zone 'Asia/Kolkata')::date,(now() at time zone 'Asia/Kolkata')::date+1,'Today is live', '101', 1);
  raise exception 'Today was accepted as history';
 exception when check_violation then null;
 end;
 begin
  update public.bite_owner_historical_entries set amount=0 where customer_name='Synthetic historical guest';
  raise exception 'Historical entry was mutable';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into public.bite_owner_historical_entries(request_id,entry_kind,property_id,record_date,departure_date,customer_name,room_number,amount)
  values('11111111-1111-4111-8111-000000000001','room','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    current_date-1,current_date,'Duplicate', '101', 10);
  raise exception 'Duplicate request was accepted';
 exception when unique_violation then null;
 end;
end $$;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$
declare rows integer;
begin
 select count(*) into rows from public.bite_owner_historical_entries;
 if rows<>0 then raise exception 'Owner B can read owner A records';end if;
end $$;
reset role;
select 'Historical room/POS RLS and immutability QA passed' as result;
