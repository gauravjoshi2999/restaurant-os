-- Execute after fixture + migration. Every test uses a fake owner.
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $test$
declare
 rid uuid := '11111111-1111-4111-8111-111111111111';
 eid uuid := '33333333-3333-4333-8333-333333333333';
 req uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 close_id uuid; retry_id uuid; bad boolean; r public.restaurant_employee_salary_closings%rowtype;
begin
 select public.owner_close_employee_salary_month(rid,eid,'2026-10-01',10000,500,100,600,
  3250,900,req,'Approved deduction after agreement') into close_id;
 if close_id is null then raise exception 'No closing ID was returned'; end if;
 select * into r from public.restaurant_employee_salary_closings where id=close_id;
 if r.due_at_close<>6550 or r.advance_applied<>600 or r.salary_bonus_paid_at_close<>3250
   then raise exception 'Closing math did not match original payments'; end if;
 select public.owner_close_employee_salary_month(rid,eid,'2026-10-01',10000,500,100,600,
  3250,900,req,'Approved deduction after agreement') into retry_id;
 if retry_id<>close_id then raise exception 'Retry produced a different closing'; end if;
 if (select count(*) from public.restaurant_employee_salary_closings where employee_id=eid)<>1
   then raise exception 'Closing was inserted more than once'; end if;
 bad:=false;
 begin
  perform public.owner_close_employee_salary_month(rid,eid,'2026-10-01',10001,500,100,600,
    3250,900,req,'Approved deduction after agreement');
 exception when others then bad:=true; end;
 if not bad then raise exception 'Changed retry parameters were accepted'; end if;
 bad:=false;
 begin
  perform public.owner_close_employee_salary_month(rid,eid,'2026-10-01',10000,500,100,600,
    3250,900,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Approved deduction after agreement');
 exception when others then bad:=true; end;
 if not bad then raise exception 'Second closing for same salary month was accepted'; end if;
 bad:=false;
 begin
  perform public.owner_close_employee_salary_month(rid,'44444444-4444-4444-8444-444444444444','2026-10-01',
   10000,0,0,100,0,0,'ffffffff-ffff-4fff-8fff-ffffffffffff','');
 exception when others then bad:=true; end;
 if not bad then raise exception 'Advance adjustment without any recorded advance was accepted'; end if;
 bad:=false;
 begin
  perform public.owner_close_employee_salary_month(rid,'44444444-4444-4444-8444-444444444444','2026-10-01',
   10000,0,0,0,100,0,'eeeeeeee-eeee-4eee-8eee-111111111111','');
 exception when others then bad:=true; end;
 if not bad then raise exception 'Stale preview payment value was accepted'; end if;
 bad:=false;
 begin
  perform public.owner_close_employee_salary_month(rid,'44444444-4444-4444-8444-444444444444','2099-01-01',
   10000,0,0,0,0,0,'eeeeeeee-eeee-4eee-8eee-222222222222','');
 exception when others then bad:=true; end;
 if not bad then raise exception 'Future salary month was approved'; end if;
 if (select count(*) from public.restaurant_employee_payments)<>4
   then raise exception 'Salary closing created or changed employee payments'; end if;
end$test$;
-- Direct mutation is forbidden even for owners.
do $test$ declare blocked boolean:=false;begin
 begin
   delete from public.restaurant_employee_salary_closings where period_month='2026-10-01';
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'Direct closing deletion not blocked'; end if;
end$test$;
-- Owner can view only their tenant.
do $test$ begin
 if (select count(*) from public.restaurant_employee_salary_closings)<>1 then
  raise exception 'Owner cannot read own closing'; end if;
end$test$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
do $test$ declare blocked boolean:=false;begin
 if (select count(*) from public.restaurant_employee_salary_closings)<>0 then
  raise exception 'Manager saw owner-only closing'; end if;
 begin
  perform public.owner_close_employee_salary_month('11111111-1111-4111-8111-111111111111',
   '44444444-4444-4444-8444-444444444444','2026-10-01',
   10000,0,0,0,0,0,'aaaaaaaa-aaaa-4aaa-8aaa-111111111111','');
 exception when others then blocked:=true; end;
 if not blocked then raise exception 'Manager approved a salary closing'; end if;
end$test$;
select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
do $test$ declare blocked boolean:=false;begin
 if (select count(*) from public.restaurant_employee_salary_closings)<>0 then
  raise exception 'Cross-tenant owner saw unrelated payroll'; end if;
 begin
  perform public.owner_close_employee_salary_month('11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333','2026-09-01',
     2000,0,0,0,0,500,'aaaaaaaa-aaaa-4aaa-8aaa-222222222222','');
 exception when others then blocked:=true; end;
 if not blocked then raise exception 'Cross-tenant owner approved another restaurant payroll'; end if;
end$test$;
reset role;
select 'A10 salary closing: math, unique approval, owner-only RLS, replay safety, preview guards PASS' as result;
