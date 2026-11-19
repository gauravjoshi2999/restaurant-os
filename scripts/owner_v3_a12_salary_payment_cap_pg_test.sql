-- A12: isolated Postgres guard checks, executed after the A10 fixture and closing tests.
-- Existing A10 fixture has employee A's October closing with ₹6,550 outstanding.
do $check$
declare
 rid uuid:='11111111-1111-4111-8111-111111111111';
 emp uuid:='33333333-3333-4333-8333-333333333333';
 other_emp uuid:='44444444-4444-4444-8444-444444444444';
 blocked boolean;
begin
 -- Old salary months without a closing preserve the existing workflow.
 insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,period_month,payment_type,amount)
 values(rid,other_emp,'2026-11-19','2026-10-01','Salary',1100);
 blocked:=false;
 begin
  insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,period_month,payment_type,amount)
  values(rid,emp,'2026-11-19',null,'Salary',100);
 exception when others then blocked:=true;end;
 if not blocked then raise exception 'Unassigned salary bypassed an existing closing';end if;
 blocked:=false;
 begin
  insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,period_month,payment_type,amount)
  values(rid,emp,'2099-01-01','2026-10-01','Salary',100);
 exception when others then blocked:=true;end;
 if not blocked then raise exception 'Future-dated payment accepted';end if;
 blocked:=false;
 begin
  insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,period_month,payment_type,amount)
  values(rid,emp,'2026-11-19','2026-10-01','Salary',6550.01);
 exception when others then blocked:=true;end;
 if not blocked then raise exception 'Overpayment passed the approved closing cap';end if;
 insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,period_month,payment_type,amount)
 values(rid,emp,'2026-11-19','2026-10-01','Salary',1000);
 blocked:=false;
 begin
  insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,period_month,payment_type,amount)
  values(rid,emp,'2026-11-19','2026-10-01','Bonus',5550.01);
 exception when others then blocked:=true;end;
 if not blocked then raise exception 'Bonus overpayment bypassed the salary cap';end if;
 insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,period_month,payment_type,amount)
 values(rid,emp,'2026-11-19','2026-10-01','Salary',5550);
 blocked:=false;
 begin
  insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,period_month,payment_type,amount)
  values(rid,emp,'2026-11-19','2026-10-01','Salary',1);
 exception when others then blocked:=true;end;
 if not blocked then raise exception 'Extra payment after settlement was accepted';end if;
 if (select count(*) from public.restaurant_employee_salary_closings where employee_id=emp)<>1
 then raise exception 'A12 changed historical salary approvals';end if;
 if (select count(*) from public.restaurant_employee_payments where employee_id=emp and payment_type='Salary' and period_month='2026-10-01')<>3
 then raise exception 'A12 inserted an incorrect number of salary rows';end if;
end$check$;
select 'A12 approved salary cap, bonus cap, unassigned and future-date guards PASS' as result;
