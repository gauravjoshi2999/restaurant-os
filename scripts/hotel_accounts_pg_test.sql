-- Synthetic account/register integration; every write rolls back.
begin;
do $$declare g jsonb;begin
 g:=private.bite_invoice_gst('{"entries":[{"kind":"charge","status":"confirmed","category":"food","amount":333.33,"tax_amount":16.67,"tax_rate":5}]}');
 if (g->0->>'rate')::numeric<>5 then raise exception 'Rounded tax amounts must not change the stated GST rate';end if;
end$$;
create temp table hotel_account_state(key text primary key,value text);
grant all on hotel_account_state to authenticated;
create function pg_temp.accounts_denied(statement text)returns void language plpgsql as $$begin
 begin execute statement;raise exception 'EXPECTED_DENIAL';exception when others then if sqlerrm='EXPECTED_DENIAL'then raise;end if;end;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare p uuid;r uuid;g uuid;v jsonb;begin
 select id into p from public.bite_properties where origin_restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 perform public.bite_property_command(p,'config',jsonb_build_object('name','Synthetic accounts hotel','business_type','hybrid','capabilities','["hotel_rooms","guest_register","reservations","folios","housekeeping","hotel_incidentals","restaurant_pos","restaurant_menu","dine_in","takeaway","online_food_orders","room_service","charge_to_room","expenses","staff_management","reporting"]'::jsonb,'tax_profile','{"reviewed":true,"gstin":"08ABCDE1234F1Z5","room_rate":5,"incidental_rate":5}'::jsonb),gen_random_uuid());
 perform public.bite_property_command(p,'billing_settings','{"prefix":"H","next_number":42,"primary_account":"Owner A","tax_profile":{"reviewed":true,"gstin":"08ABCDE1234F1Z5","room_rate":5,"food_rate":5,"incidental_rate":5}}',gen_random_uuid());
 v:=public.bite_property_command(p,'room_save','{"number":"104","room_type":"Deluxe","nightly_rate":1500,"adults":3,"children":2}',gen_random_uuid());r:=(v->>'id')::uuid;
 v:=public.bite_property_command(p,'guest_save','{"full_name":"Synthetic Accounts Guest","phone":"9999999999","country":"India","address":"Synthetic permanent address"}',gen_random_uuid());g:=(v->>'id')::uuid;
 insert into hotel_account_state values('p',p),('r',r),('g',g),('doc',gen_random_uuid()),('baseline',(public.bite_daily_book(p,(now()at time zone 'Asia/Kolkata')::date,(now()at time zone 'Asia/Kolkata')::date)->'days'->0)::text),('baseline_invoices',jsonb_array_length(public.bite_daily_book(p,(now()at time zone 'Asia/Kolkata')::date,(now()at time zone 'Asia/Kolkata')::date)->'gst_invoices')::text);
end$$;
reset role;
-- A synthetic ready file record stands in for the separately tested private upload API.
insert into public.bite_guest_documents(id,property_id,guest_id,kind,mime_type,byte_size,object_path,status,created_by,completed_at)
select (select value::uuid from hotel_account_state where key='doc'),(select value::uuid from hotel_account_state where key='p'),(select value::uuid from hotel_account_state where key='g'),'masked_id','image/png',8,
 (select value from hotel_account_state where key='p')||'/'||(select value from hotel_account_state where key='g')||'/'||(select value from hotel_account_state where key='doc')||'.png','ready','11111111-1111-4111-8111-111111111111',now();
set local role authenticated;
do $$
declare p uuid;r uuid;g uuid;doc uuid;s uuid;f uuid;e uuid;k uuid;v jsonb;q jsonb;args jsonb;t jsonb;rep jsonb;day jsonb;base_day jsonb;inv jsonb;d date:=(now()at time zone 'Asia/Kolkata')::date;bill text;begin
 select value::uuid into p from hotel_account_state where key='p';select value::uuid into r from hotel_account_state where key='r';select value::uuid into g from hotel_account_state where key='g';select value::uuid into doc from hotel_account_state where key='doc';select value::jsonb into base_day from hotel_account_state where key='baseline';
 args:=jsonb_build_object('room_id',r,'arrival',d,'departure',d+1,'adults',2,'children',1,'mode','checkin','nightly_rate',1200);
 q:=public.bite_reservation_quote(p,args);if(q->>'total')::numeric<>1260 then raise exception 'Agreed rent quote failed: %',q;end if;
 args:=args||jsonb_build_object('guest_id',g,'booking_mode','checkin','quote_hash',q->>'quote_hash','advance_amount',300,'advance_method','Cash','registration',jsonb_build_object('male',1,'female',1,'children',1,'arrived_from','Udaipur','next_destination','Jaipur','transport','Car','vehicle_number','RJ01AB1234','id_front',doc));
 perform pg_temp.accounts_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,(args||jsonb_build_object('registration',(args->'registration')-'id_front'))::text));
 k:=gen_random_uuid();v:=public.bite_property_command(p,'reserve',args,k);s:=(v->>'id')::uuid;f:=(v->>'folio_id')::uuid;
 if(v->>'register_number')::int<>1 then raise exception 'Serial must start at 1';end if;
 if public.bite_property_command(p,'reserve',args,k)<>v then raise exception 'Register retry not idempotent';end if;
 perform public.bite_property_command(p,'checkin',jsonb_build_object('id',s),gen_random_uuid());
 v:=public.bite_property_command(p,'room_pos',jsonb_build_object('folio_id',f,'restaurant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','items','[{"name":"Thali","quantity":1,"unit_price":300}]'::jsonb,'fulfilment','served','channel','POS - Dine-in','discount',0),gen_random_uuid());
 t:=(select x->'totals'from jsonb_array_elements(public.bite_hotel_workspace(p)->'folios')x where x->>'id'=f::text);if(t->>'charges')::numeric<>1575 then raise exception 'Room 1200 + food 300 + GST 75 failed: %',t;end if;
 v:=public.bite_property_command(p,'payment',jsonb_build_object('folio_id',f,'amount',300,'method','UPI','description','Part food payment','account_note','Owner B'),gen_random_uuid());e:=(v->>'id')::uuid;
 perform pg_temp.accounts_denied(format('select public.bite_property_command(%L,''checkout_collect'',%L,gen_random_uuid())',p,jsonb_build_object('folio_id',f,'amount',1275,'method','Cash')::text));
 perform public.bite_property_command(p,'payment_confirm',jsonb_build_object('folio_id',f,'id',e,'reference','SYNTHETIC-UPI-REF','account_note','Owner B'),gen_random_uuid());
 t:=(select x->'totals'from jsonb_array_elements(public.bite_hotel_workspace(p)->'folios')x where x->>'id'=f::text);if(t->>'balance')::numeric<>975 then raise exception 'Partial payment balance incorrect: %',t;end if;
 k:=gen_random_uuid();args:=jsonb_build_object('folio_id',f,'amount',975,'method','Cash');v:=public.bite_property_command(p,'checkout_collect',args,k);inv:=v->'invoice';bill:=inv->>'number';
 if bill!~'^H/[0-9]{2}-[0-9]{2}/000042$'or length(bill)>16 then raise exception 'Invoice sequence invalid: %',bill;end if;
 if public.bite_property_command(p,'checkout_collect',args,k)<>v then raise exception 'Checkout retry changed the bill';end if;
 if (select sum((x->>'cgst')::numeric+(x->>'sgst')::numeric)from jsonb_array_elements(inv->'gst')x)<>75 then raise exception 'GST split failed';end if;
 perform public.bite_property_command(p,'daybook_entry',jsonb_build_object('entry_date',d,'kind','opening','category','Opening','description','Synthetic opening','amount',1000,'method','Cash'),gen_random_uuid());
 perform public.bite_property_command(p,'daybook_entry',jsonb_build_object('entry_date',d,'kind','expense','category','Vegetables','description','Vegetables','amount',100,'method','Cash'),gen_random_uuid());
 perform public.bite_property_command(p,'daybook_entry',jsonb_build_object('entry_date',d,'kind','staff_advance','category','Advance','description','Staff advance','staff_name','Synthetic Worker','amount',200,'method','Cash'),gen_random_uuid());
 perform pg_temp.accounts_denied(format('select public.bite_property_command(%L,''daybook_entry'',%L,gen_random_uuid())',p,jsonb_build_object('entry_date',d,'kind','salary_payment','category','Salary','description','Salary payout','staff_name','Synthetic Worker','amount',300,'method','Cash')::text));
 perform public.bite_property_command(p,'daybook_entry',jsonb_build_object('entry_date',d,'kind','salary_expense','category','Salary','description','Earned salary','staff_name','Synthetic Worker','amount',500,'method','Non-cash'),gen_random_uuid());
 perform public.bite_property_command(p,'daybook_entry',jsonb_build_object('entry_date',d,'kind','salary_payment','category','Salary','description','Salary balance','staff_name','Synthetic Worker','amount',300,'method','Cash'),gen_random_uuid());
 rep:=public.bite_daily_book(p,d,d);day:=rep->'days'->0;
 if(day->>'gross_sales')::numeric-(base_day->>'gross_sales')::numeric<>1575 or(day->>'expenses')::numeric-(base_day->>'expenses')::numeric<>600 or(day->>'staff_advance')::numeric-(base_day->>'staff_advance')::numeric<>200 or(day->>'profit')::numeric-(base_day->>'profit')::numeric<>900 then raise exception 'Sale/expense/advance/profit double count: %',day;end if;
 if(day->>'cash_balance')::numeric-(base_day->>'cash_balance')::numeric<>1675 or(day->>'online_balance')::numeric-(base_day->>'online_balance')::numeric<>300 then raise exception 'Cash/online mismatch: %',day;end if;
 if jsonb_array_length(rep->'gst_invoices')-(select value::int from hotel_account_state where key='baseline_invoices')<>1 then raise exception 'Invoice report duplicate/missing';end if;
 if not exists(select 1 from jsonb_array_elements(rep->'accounts')x where x->>'account'='Owner B'and(x->>'balance')::numeric=300)then raise exception 'Second-account note lost';end if;
 perform pg_temp.accounts_denied(format('select public.bite_property_command(%L,''billing_settings'',''{"prefix":"H","next_number":42,"tax_profile":{"reviewed":true,"gstin":"08ABCDE1234F1Z5","room_rate":5,"food_rate":5,"incidental_rate":5}}'',gen_random_uuid())',p));
 insert into hotel_account_state values('bill',bill);
end$$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.accounts_denied(format('select public.bite_daily_book(%L,current_date,current_date)',value))from hotel_account_state where key='p';
select pg_temp.accounts_denied(format('select public.bite_property_command(%L,''daybook_entry'',''{}'',gen_random_uuid())',value))from hotel_account_state where key='p';
rollback;
select 'Hotel register, ID requirement, agreed rent, partial payment, atomic checkout, invoice series, GST, daily balances, staff cost and tenant tests passed.' as result;
