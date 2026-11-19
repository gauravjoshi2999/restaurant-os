-- Tests for the real migration, executed on a disposable PostgreSQL 17 service.
do $test$
declare
 r jsonb;
 arr jsonb;
 forbidden boolean;
begin
 if has_function_privilege('anon','public.bite_reorder_items(uuid)','EXECUTE') then
  raise exception 'anon must not execute customer reorder RPC';
 end if;
 if not has_function_privilege('authenticated','public.bite_reorder_items(uuid)','EXECUTE') then
  raise exception 'authenticated must be granted reorder RPC';
 end if;
 perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
 r:=public.bite_reorder_items('22222222-2222-4222-8222-222222222222'::uuid);
 if r->>'restaurant_id'<>'11111111-1111-4111-8111-111111111111' then
  raise exception 'restaurant scope mismatch';
 end if;
 arr:=r->'items';
 if jsonb_array_length(arr)<>5 then raise exception 'expected five original order lines'; end if;
 if (arr->0->>'previous_price')::numeric<>120 or (arr->0->>'price')::numeric<>135
    or (arr->0->>'quantity')::numeric<>2 or (arr->0->>'available')::boolean<>true then
  raise exception 'old/current price or quantity snapshot incorrect';
 end if;
 if (arr->1->>'previous_price')::numeric<>220 or (arr->1->>'available')::boolean<>false then
  raise exception 'unavailable dish must retain old amount without being available';
 end if;
 if arr->2->>'menu_item_id'<>'66666666-6666-4666-8666-666666666666'
    or (arr->2->>'previous_price')::numeric<>55
    or (arr->2->>'price')::numeric<>60 then
  raise exception 'unique legacy name fallback incorrect';
 end if;
 if arr->3->'menu_item_id'<>'null'::jsonb or (arr->3->>'available')::boolean<>false then
  raise exception 'ambiguous legacy menu match must fail closed';
 end if;
 if arr->4->'menu_item_id'<>'null'::jsonb or (arr->4->>'available')::boolean<>false then
  raise exception 'cross-restaurant menu item must not be reused';
 end if;
 begin
  perform public.bite_reorder_items('33333333-3333-4333-8333-333333333333'::uuid);
  raise exception 'cross-customer order leaked';
 exception when sqlstate '42501' then null;
 end;
 perform set_config('request.jwt.claim.sub','',false);
 begin
  perform public.bite_reorder_items('22222222-2222-4222-8222-222222222222'::uuid);
  raise exception 'anonymous session bypassed auth.uid';
 exception when sqlstate '42501' then null;
 end;
 perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
 update public.restaurant_qa_availability set active=false
  where id='11111111-1111-4111-8111-111111111111'::uuid;
 begin
  perform public.bite_reorder_items('22222222-2222-4222-8222-222222222222'::uuid);
  raise exception 'unpublished restaurant was allowed';
 exception when raise_exception then
  if sqlerrm not like '%currently unavailable%' then raise; end if;
 end;
end
$test$;
select 'REORDER_PG_QA_OK' as result;
