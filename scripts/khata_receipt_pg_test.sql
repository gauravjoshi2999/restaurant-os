\set ON_ERROR_STOP on
begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $test$
declare
 rid uuid:='22222222-2222-4222-8222-222222222222';
 cid uuid:='33333333-3333-4333-8333-333333333333';
 other uuid:='99999999-9999-4999-8999-999999999999';
 token uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 token2 uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 day1 date:=(now() at time zone 'Asia/Kolkata')::date-1;
 saved uuid; retry uuid; bal numeric;
begin
 saved:=public.record_restaurant_khata_receipt(rid,cid,40,day1,'Cash',token,'RC-078','Partial collection',false);
 retry:=public.record_restaurant_khata_receipt(rid,cid,40,day1,'Cash',token,'RC-078','Partial collection',false);
 if retry<>saved then raise exception 'Idempotent receipt replay mismatch';end if;
 if (select count(*) from public.restaurant_customer_ledger_entries where receipt_request_id=token)<>1
 then raise exception 'Duplicate receipt after retry';end if;
 select balance into bal from public.restaurant_customer_balances where restaurant_id=rid and customer_id=cid;
 if bal<>60 then raise exception 'Opening 100 less receipt 40 should leave 60, found %',bal;end if;
 if (select sum(amount) from public.restaurant_cashbook_entries where restaurant_id=rid and source_type='customer_ledger_payment')<>40
 then raise exception 'Cashbook receipt is not exactly 40';end if;
 if (select count(*) from public.restaurant_customer_ledger_entries where entry_type='debit' and restaurant_id=rid)<>1
 then raise exception 'Receipt changed original due/sale';end if;
 begin
  perform public.record_restaurant_khata_receipt(rid,cid,61,day1,'Cash',gen_random_uuid(),'','',false);
  raise exception 'FAIL overcollection';
 exception when others then if sqlerrm not like '%exceeds current customer due%' then raise;end if;end;
 begin
  perform public.record_restaurant_khata_receipt(rid,cid,50,day1,'Cash',token,'RC-078','Partial collection',false);
  raise exception 'FAIL changed same request';
 exception when others then if sqlerrm not like '%already used%' then raise;end if;end;
 begin
  perform public.record_restaurant_khata_receipt(other,'55555555-5555-4555-8555-555555555555',1,day1,'UPI',gen_random_uuid(),'','',false);
  raise exception 'FAIL cross tenant';
 exception when others then if sqlerrm not like '%permission required%' then raise;end if;end;
 begin
  perform public.record_restaurant_khata_receipt(rid,cid,1,day1+2,'Cash',gen_random_uuid(),'','',false);
  raise exception 'FAIL future date';
 exception when others then if sqlerrm not like '%current date%' then raise;end if;end;
 begin
  perform public.record_restaurant_khata_receipt(rid,cid,1.001,day1,'Cash',gen_random_uuid(),'','',false);
  raise exception 'FAIL 3 decimal amount';
 exception when others then if sqlerrm not like '%decimal places%' then raise;end if;end;

 -- Advance receipt is deliberate; original manual advance use-case preserved.
 perform public.record_restaurant_khata_receipt(rid,cid,80,day1,'UPI',token2,'','Customer advance',true);
 select balance into bal from public.restaurant_customer_balances where restaurant_id=rid and customer_id=cid;
 if bal<>-20 then raise exception 'Explicit 80 receipt should yield 20 advance, got %',bal;end if;
 if (select count(*) from public.restaurant_cashbook_entries where restaurant_id=rid)<>2
 then raise exception 'Cashbook has duplicate or missing receipt rows';end if;
 raise notice 'PASS A05: one Khata ledger, ₹60 due, idempotent 40 receipt, advance, owner permission and source balance';
end $test$;
rollback;

begin;
insert into public.restaurant_cashbook_closings(restaurant_id,close_date)
 values('22222222-2222-4222-8222-222222222222',(now() at time zone 'Asia/Kolkata')::date-2);
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $closed$
begin
 begin
  perform public.record_restaurant_khata_receipt(
   '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-333333333333',10,
   (now() at time zone 'Asia/Kolkata')::date-2,'Cash',gen_random_uuid(),'','',false);
  raise exception 'FAIL closed day';
 exception when others then if sqlerrm not like '%closed%' then raise; end if;end;
 raise notice 'PASS A05: closed-day receipts blocked';
end $closed$;
rollback;
