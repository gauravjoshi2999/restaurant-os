\set ON_ERROR_STOP on
begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub',
 '11111111-1111-4111-8111-111111111111',true);
do $test$
declare
 rid uuid:='22222222-2222-4222-8222-222222222222';
 other uuid:='99999999-9999-4999-8999-999999999999';
 legacy uuid:='33333333-3333-4333-8333-333333333333';
 credit uuid:='44444444-4444-4444-8444-444444444444';
 day1 date:=(now() at time zone 'Asia/Kolkata')::date-3;
 day2 date:=(now() at time zone 'Asia/Kolkata')::date-1;
 token uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 token2 uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 row_id uuid;again uuid; n integer; remaining_due numeric;
begin
 -- The original seven-source view stays present; here the fixture has 2 sources.
 if not exists(select 1 from pg_class where oid='public.restaurant_cashbook_entries'::regclass
     and reloptions @> array['security_invoker=true']) then
    raise exception 'Cashbook view not security-invoker';
 end if;
 if (select sum(amount) from public.restaurant_cashbook_entries
     where restaurant_id=rid and source_type in ('purchase','expense'))<>150 then
    raise exception 'Legacy expense / initial payment source changed';
 end if;
 if exists(select 1 from public.restaurant_cashbook_entries
     where restaurant_id=rid and source_type='supplier_payment') then
    raise exception 'Supplier payment created without posting cash';
 end if;

 row_id:=public.record_restaurant_supplier_payment(rid,credit,200,day1,'UPI',token,'UTR-42');
 again:=public.record_restaurant_supplier_payment(rid,credit,200,day1,'UPI',token,'UTR-42');
 if again<>row_id or (select count(*) from public.restaurant_supplier_payments
    where purchase_id=credit)<>1 then raise exception 'Retry duplicated payment'; end if;
 if (select sum(amount) from public.restaurant_cashbook_entries
     where restaurant_id=rid and source_type='supplier_payment' and entry_date=day1)<>200 then
    raise exception 'Cashbook missing the actual payment date'; end if;
 if exists(select 1 from public.restaurant_cashbook_entries
     where source_type='supplier_payment' and entry_date=(now() at time zone 'Asia/Kolkata')::date-12) then
    raise exception 'Supplier payment was attributed to purchase date';
 end if;

 perform public.record_restaurant_supplier_payment(rid,credit,100,day2,'Cash',token2,'');
 if (select count(*) from public.restaurant_cashbook_entries
     where restaurant_id=rid and source_type='supplier_payment')<>2 then
   raise exception 'Partial supplier payments not separately tracked'; end if;
 select (p.total_amount-p.paid_amount-coalesce(sum(sp.amount),0)) into remaining_due
 from public.restaurant_purchases p left join public.restaurant_supplier_payments sp on sp.purchase_id=p.id
 where p.id=credit group by p.total_amount,p.paid_amount;
 if remaining_due<>500 then raise exception 'Incorrect supplier due after 2 partial payments: %',remaining_due;end if;

 -- Payment cannot be posted by a different restaurant or without owner role.
 begin
  perform public.record_restaurant_supplier_payment(other,'55555555-5555-4555-8555-555555555555',1,day2,'Cash',gen_random_uuid(),'');
  raise exception 'FAIL cross-tenant';
 exception when others then if sqlerrm not like '%permission required%' then raise; end if;
 end;
 begin
  perform public.record_restaurant_supplier_payment(rid,credit,501,day2,'Cash',gen_random_uuid(),'');
  raise exception 'FAIL overpay';
 exception when others then if sqlerrm not like '%exceeds%' then raise;end if;
 end;
 begin
  perform public.record_restaurant_supplier_payment(rid,credit,201,day1,'UPI',token,'UTR-42');
  raise exception 'FAIL reused request';
 exception when others then if sqlerrm not like '%already used%' then raise; end if;
 end;
 begin
  perform public.record_restaurant_supplier_payment(rid,credit,1,day2+3,'Cash',gen_random_uuid(),'');
  raise exception 'FAIL future date';
 exception when others then if sqlerrm not like '%future%' then raise; end if;
 end;
 begin
  perform public.record_restaurant_supplier_payment(rid,credit,1,day1-15,'Cash',gen_random_uuid(),'');
  raise exception 'FAIL before purchase date';
 exception when others then if sqlerrm not like '%earlier%' then raise; end if;
 end;
 begin
  insert into public.restaurant_supplier_payments(
   restaurant_id,purchase_id,payment_date,amount,method,request_id)
  values(rid,credit,day2,1,'Cash',gen_random_uuid());
  raise exception 'FAIL direct INSERT';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.restaurant_purchases set paid_amount=200 where id=credit;
  raise exception 'FAIL paid_amount rewrite';
 exception when others then if sqlerrm not like '%supplier payments%' then raise; end if;
 end;
 begin
  update public.restaurant_purchases set total_amount=250 where id=credit;
  raise exception 'FAIL paid amount over total';
 exception when others then if sqlerrm not like '%supplier payments%' then raise; end if;
 end;
 if exists(select 1 from public.restaurant_supplier_payments where restaurant_id=other) then
  raise exception 'Cross-tenant supplier payment visible';
 end if;
 raise notice 'PASS: A04 idempotency, separate dates, supplier dues, Cashbook, RLS, edit safety';
end $test$;
rollback;

-- Second isolated transaction tests a closed day (no refund or alteration).
begin;
insert into public.restaurant_cashbook_closings(restaurant_id,close_date)
values('22222222-2222-4222-8222-222222222222',(now() at time zone 'Asia/Kolkata')::date-2);
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub',
 '11111111-1111-4111-8111-111111111111',true);
do $closed$
begin
 begin
  perform public.record_restaurant_supplier_payment(
   '22222222-2222-4222-8222-222222222222'::uuid,
   '44444444-4444-4444-8444-444444444444'::uuid,50,
   (now() at time zone 'Asia/Kolkata')::date-2,'Cash',gen_random_uuid(),'');
  raise exception 'FAIL closed day';
 exception when others then if sqlerrm not like '%closed%' then raise;end if;
 end;
 raise notice 'PASS: supplier payment cannot edit a closed Cashbook day';
end $closed$;
rollback;
