-- Rollback-only behavior test. Run against the synthetic fixture + migration
-- in an ephemeral PostgreSQL 17 CI database. Never point at production.
\set ON_ERROR_STOP on
begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);

do $$
declare
 v_rest uuid := '22222222-2222-4222-8222-222222222222';
 v_id uuid;
 v_retry uuid;
 v_entry uuid;
 v_count integer;
 v_trigger_count integer;
 v_definer boolean;
begin
 select count(*) into v_trigger_count
 from pg_catalog.pg_trigger t
 join pg_catalog.pg_class c on c.oid=t.tgrelid
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and t.tgname='cashbook_day_serialization_guard'
   and not t.tgisinternal;
 if v_trigger_count<>7 then
  raise exception 'Expected 7 source guards, got %',v_trigger_count;
 end if;
 select p.prosecdef into v_definer
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='cashbook_guard_source_day';
 if not v_definer then raise exception 'Source guard must bypass closing SELECT RLS'; end if;

 -- Cash receipt 50, UPI 200: physical drawer cash must be 150, not 350.
 insert into public.restaurant_order_payments(restaurant_id,payment_date,amount,payment_method)
 values(v_rest,'2099-12-31',50,'Cash'),(v_rest,'2099-12-31',200,'UPI');
 v_id := public.close_restaurant_cashbook_day(v_rest,'2099-12-31',100,150,null);
 select count(*) into v_count from public.restaurant_cashbook_closings
 where restaurant_id=v_rest and close_date='2099-12-31'
   and cash_in=50 and cash_out=0 and expected_cash=150 and difference=0;
 if v_count<>1 then raise exception 'Cash-only closing calculation incorrect'; end if;
 v_retry := public.close_restaurant_cashbook_day(v_rest,'2099-12-31',100,150,'');
 if v_retry is distinct from v_id then raise exception 'Identical retry changed closing ID'; end if;
 select count(*) into v_count from public.restaurant_cashbook_closings
 where restaurant_id=v_rest and close_date='2099-12-31';
 if v_count<>1 then raise exception 'Duplicate closing row'; end if;

 begin
  perform public.close_restaurant_cashbook_day(v_rest,'2099-12-31',101,150,null);
  raise exception 'FAIL: conflicting retry accepted';
 exception when others then
  if sqlerrm not like '%already closed with different values%' then raise; end if;
 end;

 begin
  insert into public.restaurant_cashbook_manual_entries(restaurant_id,entry_date,direction,category,amount,payment_method)
  values(v_rest,'2099-12-31','in','Cash correction',1,'Cash');
  raise exception 'FAIL: manual INSERT on closed day accepted';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;

 -- A staff user cannot SELECT closings under RLS, but the SECURITY DEFINER
 -- source trigger must still prevent writing to the already-closed day.
 perform pg_catalog.set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
 select count(*) into v_count from public.restaurant_cashbook_closings
 where restaurant_id=v_rest and close_date='2099-12-31';
 if v_count<>0 then raise exception 'Fixture RLS must hide closings from staff'; end if;
 begin
  insert into public.restaurant_order_payments(restaurant_id,payment_date,amount,payment_method)
  values(v_rest,'2099-12-31',1,'Cash');
  raise exception 'FAIL: staff bypassed closed day';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;
 perform pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);

 -- Create an open-day row, then close its day and block UPDATE/DELETE and
 -- moves in both directions across a closed-day boundary.
 insert into public.restaurant_cashbook_manual_entries(restaurant_id,entry_date,direction,category,amount,payment_method)
 values(v_rest,'2099-12-30','in','Opening receipt',10,'Cash') returning id into v_entry;
 perform public.close_restaurant_cashbook_day(v_rest,'2099-12-30',0,10,null);
 begin
  update public.restaurant_cashbook_manual_entries set amount=11 where id=v_entry;
  raise exception 'FAIL: UPDATE on closed day accepted';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;
 begin
  update public.restaurant_cashbook_manual_entries set entry_date='2099-12-27' where id=v_entry;
  raise exception 'FAIL: move FROM closed day accepted';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;
 begin
  delete from public.restaurant_cashbook_manual_entries where id=v_entry;
  raise exception 'FAIL: DELETE on closed day accepted';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;
 insert into public.restaurant_cashbook_manual_entries(restaurant_id,entry_date,direction,category,amount,payment_method)
 values(v_rest,'2099-12-27','in','Open day',5,'Cash') returning id into v_entry;
 begin
  update public.restaurant_cashbook_manual_entries set entry_date='2099-12-30' where id=v_entry;
  raise exception 'FAIL: move INTO closed day accepted';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;

 begin
  perform public.close_restaurant_cashbook_day(v_rest,'2099-12-28',0,1,null);
  raise exception 'FAIL: missing discrepancy reason accepted';
 exception when others then
  if sqlerrm not like '%requires a reason%' then raise; end if;
 end;
 perform public.close_restaurant_cashbook_day(v_rest,'2099-12-28',0,1,'One rupee extra');
 begin
  perform public.close_restaurant_cashbook_day(v_rest,'2099-12-26','NaN'::numeric,0,null);
  raise exception 'FAIL: NaN cash accepted';
 exception when others then
  if sqlerrm not like '%finite non-negative%' then raise; end if;
 end;
 begin
  perform public.close_restaurant_cashbook_day(v_rest,'2099-12-26',0.001,0,null);
  raise exception 'FAIL: fractional paise accepted';
 exception when others then
  if sqlerrm not like '%finite non-negative%' then raise; end if;
 end;
 perform pg_catalog.set_config('request.jwt.claim.sub','',true);
 begin
  perform public.close_restaurant_cashbook_day(v_rest,'2099-12-25',0,0,null);
  raise exception 'FAIL: anonymous closing accepted';
 exception when others then
  if sqlerrm not like '%Login required%' then raise; end if;
 end;
 raise notice 'PASS: seven guards, cash-only totals, idempotency, RLS-hidden staff, immutable dates, reason, validation';
end;
$$;
rollback;
