-- Hybrid financial integrity against disposable PostgreSQL, no provider calls.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$ declare p uuid;r uuid;g uuid;s uuid;f uuid;e uuid;o uuid;k uuid;args jsonb;out jsonb;caps jsonb;begin
 select id into p from public.bite_properties where origin_restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 caps:=to_jsonb(array['hotel_rooms','guest_register','reservations','folios','housekeeping','hotel_incidentals','restaurant_pos','restaurant_menu','dine_in','takeaway','online_food_orders','room_service','charge_to_room','expenses','staff_management','reporting']);
 perform public.bite_property_command(p,'config',jsonb_build_object('name','Synthetic Hybrid','business_type','hybrid','capabilities',caps),gen_random_uuid());
 out:=public.bite_property_command(p,'room_save','{"number":"201","room_type":"Deluxe","nightly_rate":500,"adults":2,"children":1}',gen_random_uuid());r:=(out->>'id')::uuid;
 out:=public.bite_property_command(p,'guest_save','{"full_name":"Hybrid Test Guest","phone":"8888888888"}',gen_random_uuid());g:=(out->>'id')::uuid;
 out:=public.bite_property_command(p,'reserve',jsonb_build_object('guest_id',g,'room_id',r,'arrival',current_date,'departure',current_date+1,'adults',1,'children',0),gen_random_uuid());s:=(out->>'id')::uuid;f:=(out->>'folio_id')::uuid;
 perform public.bite_property_command(p,'checkin',jsonb_build_object('id',s),gen_random_uuid());
 k:=gen_random_uuid();args:=jsonb_build_object('folio_id',f,'restaurant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','items','[{"name":"Tea","quantity":2,"unit_price":25}]'::jsonb);
 out:=public.bite_property_command(p,'room_pos',args,k);o:=(out->>'order_id')::uuid;e:=(out->>'entry_id')::uuid;
 assert public.bite_property_command(p,'room_pos',args,k)=out;
 assert (select count(*) from public.bite_folio_entries where source_order_id=o)=1;
 assert (select amount from public.bite_folio_entries where id=e)=50;
 assert ((public.bite_hotel_workspace(p)->'folios'->0->'totals')->>'balance')::numeric=550;
 begin perform public.bite_property_command(p,'room_pos',args||jsonb_build_object('restaurant_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),gen_random_uuid());raise exception 'Expected tenant denial';exception when insufficient_privilege then null;end;
 begin perform public.bite_property_command(p,'config',jsonb_build_object('name','Synthetic Hybrid','business_type','restaurant','capabilities','["restaurant_pos","restaurant_menu"]'::jsonb),gen_random_uuid());raise exception 'Expected active stay block';exception when raise_exception then if sqlerrm='Expected active stay block' then raise;end if;end;
 perform public.bite_property_command(p,'reverse',jsonb_build_object('id',e,'folio_id',f,'description','Returned tea — coordinated POS reversal'),gen_random_uuid());
 assert ((public.bite_hotel_workspace(p)->'folios'->0->'totals')->>'balance')::numeric=500;
 begin perform public.bite_property_command(p,'charge',jsonb_build_object('folio_id',f,'amount','NaN','description','Invalid amount'),gen_random_uuid());raise exception 'Expected NaN block';exception when check_violation then null;end;
 perform public.bite_property_command(p,'expense','{"description":"Synthetic cleaning supplies","amount":50,"expense_date":"2026-11-16","method":"Cash"}',gen_random_uuid());
 assert jsonb_array_length(public.bite_hotel_workspace(p)->'expenses')=1;
 perform public.bite_property_command(p,'member','{"id":"33333333-3333-4333-8333-333333333333","role":"receptionist","active":true}',gen_random_uuid());
 perform public.bite_property_command(p,'member','{"id":"33333333-3333-4333-8333-333333333333","role":"receptionist","active":false}',gen_random_uuid());
 insert into qa_results values('A081 A082 A083 A086 A089 A096 A099: atomic POS/folio, source reversal, role/module guards');
end $$;
reset role;
do $$ declare o uuid;begin
 select id into o from public.orders where order_code like 'POS-ROOM-%' limit 1;
 assert (select count(*) from public.orders where order_code like 'POS-ROOM-%')=1;
 assert (select status from public.orders where id=o)='Cancelled';
 assert not exists(select 1 from public.restaurant_order_payments where order_id=o);
 begin insert into public.restaurant_order_payments(order_id,amount)values(o,50);raise exception 'Expected payment guard';exception when raise_exception then if sqlerrm='Expected payment guard' then raise;end if;end;
 begin update public.orders set amount=60 where id=o;raise exception 'Expected amount guard';exception when raise_exception then if sqlerrm='Expected amount guard' then raise;end if;end;
 begin insert into public.order_items(order_id,item_name,quantity,unit_price)values(o,'Late edit',1,60);raise exception 'Expected item guard';exception when raise_exception then if sqlerrm='Expected item guard' then raise;end if;end;
 assert has_function_privilege('anon','public.bite_property_command(uuid,text,jsonb,uuid)','execute')=false;
 assert has_function_privilege('anon','public.bite_hotel_workspace(uuid)','execute')=false;
 insert into qa_results values('A037 A080 A084 A118 A119: no second POS collection, no marketplace posting, no double food sale');
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
do $$begin
 assert not exists(select 1 from public.bite_properties where name='Synthetic Hybrid');
 assert not exists(select 1 from public.bite_guests g join public.bite_properties p on p.id=g.property_id where p.name='Synthetic Hybrid');
 insert into qa_results values('A110: membership revocation removes property access immediately');end $$;
reset role;
select * from qa_results;
