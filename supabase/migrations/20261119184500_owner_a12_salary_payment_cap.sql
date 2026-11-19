-- Owner V3 A12: cap employee salary/bonus payments after an approved closing.
-- Uses existing HR payment ledger and audit/day-closing triggers. No new ledger entry.
-- SECURITY INVOKER trigger function runs with the actual caller's privileges.
create or replace function public.guard_closed_employee_salary_payment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_closing public.restaurant_employee_salary_closings%rowtype;
  v_paid numeric(14,2) := 0;
  v_available numeric(14,2) := 0;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;
  if new.payment_type not in ('Salary','Bonus') then
    return new;
  end if;
  -- Once an employee has any approved closing, an unassigned salary/bonus
  -- would bypass due reconciliation. Require explicit salary month instead.
  if new.period_month is null then
    if exists(
      select 1 from public.restaurant_employee_salary_closings c
      where c.restaurant_id=new.restaurant_id and c.employee_id=new.employee_id
    ) then
      raise exception 'Select the salary month for this salary or bonus payment; employee has an approved closing';
    end if;
    return new;
  end if;
  if new.period_month<>date_trunc('month',new.period_month)::date then
    raise exception 'Salary month must be the first calendar day of the month';
  end if;
  -- The existing payment guard also locks the employee. This explicit lock
  -- protects cap calculations even if the order of unrelated triggers changes.
  perform 1 from public.restaurant_employees e
  where e.restaurant_id=new.restaurant_id and e.id=new.employee_id for update;
  if not found then
    raise exception 'Employee is not part of the selected restaurant';
  end if;
  select * into v_closing from public.restaurant_employee_salary_closings c
  where c.restaurant_id=new.restaurant_id and c.employee_id=new.employee_id
    and c.period_month=new.period_month;
  if not found then
    return new; -- Preserve ordinary salary records before month approval.
  end if;
  if new.payment_date>v_today then
    raise exception 'Cannot record future-dated paid salary against an approved closing';
  end if;
  if new.amount is null or new.amount<=0 or new.amount<>round(new.amount,2) then
    raise exception 'Enter an actual positive salary amount with at most two decimal places';
  end if;
  select coalesce(sum(p.amount),0) into v_paid
  from public.restaurant_employee_payments p
  where p.restaurant_id=new.restaurant_id and p.employee_id=new.employee_id
    and p.period_month=new.period_month and p.payment_type in ('Salary','Bonus');
  v_available:=v_closing.approved_gross+v_closing.approved_bonus
    -v_closing.approved_deduction-v_closing.advance_applied-v_paid;
  if new.amount>v_available then
    raise exception 'Payment exceeds approved salary balance. Remaining amount: %',greatest(v_available,0)
      using errcode='23514';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_closed_employee_salary_payment() from public,anon,authenticated;
drop trigger if exists zz_owner_a12_salary_payment_cap on public.restaurant_employee_payments;
create trigger zz_owner_a12_salary_payment_cap
  before insert on public.restaurant_employee_payments
  for each row execute function public.guard_closed_employee_salary_payment();
