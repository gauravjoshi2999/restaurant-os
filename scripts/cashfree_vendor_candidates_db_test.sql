-- Rollback-only candidate mapping model test on ephemeral CI Postgres ONLY.
\set ON_ERROR_STOP on
do $ci$
begin
 if pg_catalog.current_database()<>'bite_cashbook_ci' then
  raise exception 'REFUSED: cashfree candidate tests are CI-only';
 end if;
end
$ci$;

begin;
set local role service_role;
do $test$
declare
 a uuid='22222222-2222-4222-8222-222222222222';
 b uuid='99999999-9999-4999-8999-999999999999';
 n integer;
begin
 insert into public.bite_cashfree_vendor_candidates
 (restaurant_id,vendor_id,evidence_order_id,evidence_intent_id,observed_split_amount,observed_by)
 values(a,'vendor_restaurant_a','44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',150,'11111111-1111-4111-8111-111111111111');
 select count(*) into n from public.bite_cashfree_vendor_candidates where restaurant_id=a and mapping_state='CANDIDATE_ONLY';
 if n<>1 then raise exception 'FAIL: correct candidate not saved as unverified';end if;

 -- A provider vendor ID cannot be linked to a second restaurant.
 begin
  insert into public.bite_cashfree_vendor_candidates
  (restaurant_id,vendor_id,evidence_order_id,evidence_intent_id,observed_split_amount,observed_by)
  values(b,'vendor_restaurant_a','55555555-5555-4555-8555-555555555555','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',90,'11111111-1111-4111-8111-111111111111');
  raise exception 'FAIL: same Cashfree vendor linked to another restaurant';
 exception when unique_violation then null;
 end;

 -- Source checkout order must match restaurant AND intent.
 begin
  insert into public.bite_cashfree_vendor_candidates
  (restaurant_id,vendor_id,evidence_order_id,evidence_intent_id,observed_split_amount,observed_by)
  values(b,'foreign_order','44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',10,'11111111-1111-4111-8111-111111111111');
  raise exception 'FAIL: cross-tenant order accepted';
 exception when others then
  if sqlerrm not like '%Candidate evidence must belong%' then raise;end if;
 end;

 -- No candidate may claim vendor amount exceeding the trusted payable.
 begin
  insert into public.bite_cashfree_vendor_candidates
  (restaurant_id,vendor_id,evidence_order_id,evidence_intent_id,observed_split_amount,observed_by)
  values(b,'over_amount','55555555-5555-4555-8555-555555555555','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',101,'11111111-1111-4111-8111-111111111111');
  raise exception 'FAIL: over-sized vendor split accepted';
 exception when others then
  if sqlerrm not like '%exceeds the trusted order%' then raise;end if;
 end;

 -- Fake/demo orders cannot create provider vendor mappings.
 begin
  insert into public.bite_cashfree_vendor_candidates
  (restaurant_id,vendor_id,evidence_order_id,evidence_intent_id,observed_split_amount,observed_by)
  values(a,'demo_order','77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc',10,'11111111-1111-4111-8111-111111111111');
  raise exception 'FAIL: demo order accepted';
 exception when others then
  if sqlerrm not like '%Candidate evidence must belong%' then raise;end if;
 end;

 -- POS orders are not eligible for marketplace vendor split mapping.
 begin
  insert into public.bite_cashfree_vendor_candidates
  (restaurant_id,vendor_id,evidence_order_id,evidence_intent_id,observed_split_amount,observed_by)
  values(a,'pos_order','88888888-8888-4888-8888-888888888888','dddddddd-dddd-4ddd-8ddd-dddddddddddd',10,'11111111-1111-4111-8111-111111111111');
  raise exception 'FAIL: POS order candidate accepted';
 exception when others then
  if sqlerrm not like '%Candidate evidence must belong%' then raise;end if;
 end;

 -- No client or background process can turn a candidate into PAID or VERIFIED.
 begin
  update public.bite_cashfree_vendor_candidates set mapping_state='PAID'
  where vendor_id='vendor_restaurant_a';
  raise exception 'FAIL: candidate marked PAID by update';
 exception when others then
  if sqlerrm not like '%permission denied%'
     and sqlerrm not like '%immutable%' then raise;end if;
 end;
 begin
  delete from public.bite_cashfree_vendor_candidates where vendor_id='vendor_restaurant_a';
  raise exception 'FAIL: candidate deleted without reconciliation';
 exception when others then
  if sqlerrm not like '%permission denied%'
     and sqlerrm not like '%immutable%' then raise;end if;
 end;

 if pg_catalog.has_table_privilege('authenticated','public.bite_cashfree_vendor_candidates','SELECT')
    or pg_catalog.has_table_privilege('authenticated','public.bite_cashfree_vendor_candidates','INSERT')
    or pg_catalog.has_table_privilege('anon','public.bite_cashfree_vendor_candidates','SELECT') then
  raise exception 'FAIL: table exposed to client roles';
 end if;
 raise notice 'PASS: candidate-only, trusted order, no duplicate vendor, no cross tenant, no direct access';
end
$test$;
rollback;
