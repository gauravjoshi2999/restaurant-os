-- Verify customer ownership, immutable old unit price and current availability with real PostgreSQL 17.
select set_config('request.jwt.claim.sub','aaaaaaaa-1111-4111-8111-111111111111',false);
set role authenticated;
do $check$
declare
 data jsonb; rows jsonb; a jsonb; b jsonb; c jsonb; blocked boolean;
begin
 data:=public.bite_reorder_items('11111111-1111-4111-8111-111111111111');
 rows:=data->'items';
 if data->>'restaurant_id'<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 or jsonb_array_length(rows)<>3 then raise exception 'Returned mismatched restaurant/order';end if;
 a:=rows->0;b:=rows->1;c:=rows->2;
 if a->>'name'<>'Masala Dosa' or (a->>'previous_price')::numeric<>120
 or (a->>'price')::numeric<>130 or a->>'available'<>'true' then
   raise exception 'Past vs current source price incorrect';end if;
 if (b->>'previous_price')::numeric<>220 or b->>'available'<>'false' then
   raise exception 'Unavailable item unexpectedly reorderable';end if;
 if (c->>'previous_price')::numeric<>45 or c->'menu_item_id'<>'null'::jsonb then
   raise exception 'Discontinued menu item lost historical price';end if;
 blocked:=false;
 begin perform public.bite_reorder_items('22222222-2222-4222-8222-222222222222');
 exception when others then blocked:=true;end;
 if not blocked then raise exception 'Customer accessed another customer order';end if;
 blocked:=false;
 begin perform public.bite_reorder_items('33333333-3333-4333-8333-333333333333');
 exception when others then blocked:=true;end;
 if not blocked then raise exception 'Order from unavailable restaurant was reorderable';end if;
end $check$;
reset role;
select set_config('request.jwt.claim.sub','bbbbbbbb-2222-4222-8222-222222222222',false);
set role authenticated;
do $check$declare j jsonb;begin
 j:=public.bite_reorder_items('22222222-2222-4222-8222-222222222222');
 if jsonb_array_length(j->'items')<>1 then raise exception 'Other customer could not see own order';end if;
end $check$;
reset role;
do $check$begin
 if has_function_privilege('anon','public.bite_reorder_items(uuid)','EXECUTE') then
   raise exception 'Anonymous users can execute customer-only reorder RPC';end if;
 if not has_function_privilege('authenticated','public.bite_reorder_items(uuid)','EXECUTE') then
   raise exception 'Authenticated customers cannot reorder';end if;
 if (select count(*) from public.orders)<>3 or (select count(*) from public.order_items)<>4 then
   raise exception 'Reorder function mutated financial source data';end if;
end $check$;
select 'Customer reorder historical/current price, ownership and read-only RLS PASS' as result;
