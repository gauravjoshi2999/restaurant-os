-- Owner V3 A10 — immutable, owner-approved monthly salary closing.
-- A closing is NOT a disbursement, Cashbook entry, statutory payroll or payslip.
-- Run after isolated PostgreSQL QA, before deploying the A10 browser feature.
create table if not exists public.restaurant_employee_salary_closings (
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 employee_id uuid not null references public.restaurant_employees(id) on delete restrict,
 period_month date not null check (period_month=date_trunc('month',period_month)::date),
 approved_gross numeric(14,2) not null check (approved_gross>=0),
 approved_bonus numeric(14,2) not null default 0 check (approved_bonus>=0),
 approved_deduction numeric(14,2) not null default 0 check (approved_deduction>=0),
 advance_applied numeric(14,2) not null default 0 check (advance_applied>=0),
 salary_bonus_paid_at_close numeric(14,2) not null default 0 check (salary_bonus_paid_at_close>=0),
 due_at_close numeric(14,2) not null check (due_at_close>=0),
 note text not null default '' check (length(note)<=500),
 request_id uuid not null unique,
 approved_by uuid not null references auth.users(id),
 approved_at timestamptz not null default now(),
 unique (restaurant_id,employee_id,period_month),
 constraint salary_close_entitlement_check check (
  approved_deduction+advance_applied+salary_bonus_paid_at_close<=approved_gross+approved_bonus
 )
);
create index if not exists salary_closings_employee_month
 on public.restaurant_employee_salary_closings(restaurant_id,employee_id,period_month desc);
alter table public.restaurant_employee_salary_closings enable row level security;
revoke all on public.restaurant_employee_salary_closings from public,anon,authenticated;
grant select on public.restaurant_employee_salary_closings to authenticated;
drop policy if exists salary_closings_owner_read on public.restaurant_employee_salary_closings;
create policy salary_closings_owner_read on public.restaurant_employee_salary_closings
 for select to authenticated
 using (public.has_restaurant_role(restaurant_id,array['owner']));

-- SECURITY DEFINER is limited to this narrow, explicitly authorized source-derived operation.
-- No INSERT, UPDATE, DELETE privileges on closing rows are exposed to the browser.
create or replace function public.owner_close_employee_salary_month(
 p_restaurant_id uuid,p_employee_id uuid,p_period_month date,
 p_approved_gross numeric,p_approved_bonus numeric,p_approved_deduction numeric,
 p_advance_applied numeric,p_expected_paid numeric,p_expected_available numeric,
 p_request_id uuid,p_note text default ''
) returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
 v_employee public.restaurant_employees%rowtype;
 v_prior public.restaurant_employee_salary_closings%rowtype;
 v_payments numeric(14,2) := 0;
 v_advances numeric(14,2) := 0;
 v_used numeric(14,2) := 0;
 v_month_end date;
 v_today date := (now() at time zone 'Asia/Kolkata')::date;
 v_id uuid;
 v_note text := btrim(coalesce(p_note,''));
begin
 if auth.uid() is null or p_restaurant_id is null or p_employee_id is null or
   p_period_month is null or p_request_id is null then
   raise exception 'Authenticated Owner, employee, salary month and request required' using errcode='42501';
 end if;
 if not public.has_restaurant_role(p_restaurant_id,array['owner']) then
   raise exception 'Only this restaurant Owner can approve salary closing' using errcode='42501';
 end if;
 if p_period_month<>date_trunc('month',p_period_month)::date or
    p_period_month>=date_trunc('month',v_today)::date then
   raise exception 'Only completed salary months may be closed';
 end if;
 if p_expected_paid is null or p_expected_available is null or
    p_expected_paid<0 or p_expected_available<0 or
    p_expected_paid<>round(p_expected_paid,2) or p_expected_available<>round(p_expected_available,2) or
    p_approved_gross is null or p_approved_bonus is null or
    p_approved_deduction is null or p_advance_applied is null or
    p_approved_gross<0 or p_approved_bonus<0 or
    p_approved_deduction<0 or p_advance_applied<0 or
    p_approved_gross>99999999.99 or p_approved_bonus>99999999.99 or
    p_approved_deduction>99999999.99 or p_advance_applied>99999999.99 or
    p_approved_gross<>round(p_approved_gross,2) or p_approved_bonus<>round(p_approved_bonus,2) or
    p_approved_deduction<>round(p_approved_deduction,2) or p_advance_applied<>round(p_advance_applied,2) then
   raise exception 'Enter nonnegative currency values using at most 2 decimal places';
 end if;
 if p_approved_deduction>p_approved_gross+p_approved_bonus then
   raise exception 'Deductions exceed approved monthly earnings';
 end if;
 if length(v_note)>500 or (p_approved_deduction>0 and length(v_note)<8) then
   raise exception 'Provide a clear deduction reason (at least 8 characters) and limit notes to 500';
 end if;
 -- Serializes closing attempts for the same employee (including different months).
 select * into v_employee from public.restaurant_employees
 where id=p_employee_id and restaurant_id=p_restaurant_id for update;
 if not found then
   raise exception 'Employee does not belong to this restaurant' using errcode='42501';
 end if;
 if p_period_month<date_trunc('month',v_employee.joining_date)::date then
   raise exception 'Salary month predates employee joining date';
 end if;
 select * into v_prior from public.restaurant_employee_salary_closings
 where request_id=p_request_id;
 if found then
   if v_prior.restaurant_id<>p_restaurant_id or v_prior.employee_id<>p_employee_id or
      v_prior.period_month<>p_period_month or v_prior.approved_gross<>p_approved_gross or
      v_prior.approved_bonus<>p_approved_bonus or v_prior.approved_deduction<>p_approved_deduction or
      v_prior.advance_applied<>p_advance_applied or v_prior.note<>v_note or
      v_prior.approved_by<>auth.uid() then
     raise exception 'This request ID was already used for different closing details';
   end if;
   return v_prior.id;
 end if;
 if exists(select 1 from public.restaurant_employee_salary_closings
    where restaurant_id=p_restaurant_id and employee_id=p_employee_id and period_month=p_period_month) then
   raise exception 'This employee and salary month are already approved';
 end if;
 v_month_end=(p_period_month+interval '1 month')::date;
 -- Missing salary-month assignments cannot be silently assumed to belong to a month.
 if exists(select 1 from public.restaurant_employee_payments pay
  where pay.restaurant_id=p_restaurant_id and pay.employee_id=p_employee_id and
    pay.payment_type in ('Salary','Bonus') and pay.period_month is null and
    pay.payment_date>=p_period_month and pay.payment_date<v_month_end) then
   raise exception 'Review salary/bonus payments without salary month assignment before closing';
 end if;
 select coalesce(sum(amount),0) into v_payments
 from public.restaurant_employee_payments
 where restaurant_id=p_restaurant_id and employee_id=p_employee_id
   and payment_type in ('Salary','Bonus') and period_month=p_period_month
   and payment_date<=v_today;
 select coalesce(sum(amount),0) into v_advances
 from public.restaurant_employee_payments
 where restaurant_id=p_restaurant_id and employee_id=p_employee_id
   and payment_type='Advance' and payment_date<v_month_end and payment_date<=v_today;
 select coalesce(sum(advance_applied),0) into v_used
 from public.restaurant_employee_salary_closings
 where restaurant_id=p_restaurant_id and employee_id=p_employee_id;
 if p_expected_paid<>v_payments or p_expected_available<>greatest(v_advances-v_used,0) then
   raise exception 'Recorded payments or advances changed. Reload the salary closing preview.';
 end if;
 if p_advance_applied>greatest(v_advances-v_used,0) then
   raise exception 'Advance adjustment exceeds verified unused advances';
 end if;
 if p_approved_gross+p_approved_bonus <
   p_approved_deduction+p_advance_applied+v_payments then
   raise exception 'Adjusted earnings are below already recorded salary/bonus payments';
 end if;
 insert into public.restaurant_employee_salary_closings(
  restaurant_id,employee_id,period_month,approved_gross,approved_bonus,approved_deduction,
  advance_applied,salary_bonus_paid_at_close,due_at_close,note,request_id,approved_by)
 values(
  p_restaurant_id,p_employee_id,p_period_month,p_approved_gross,p_approved_bonus,
  p_approved_deduction,p_advance_applied,v_payments,
  p_approved_gross+p_approved_bonus-p_approved_deduction-p_advance_applied-v_payments,
  v_note,p_request_id,auth.uid())
 returning id into v_id;
 return v_id;
end;
$function$;
revoke all on function public.owner_close_employee_salary_month(uuid,uuid,date,numeric,numeric,numeric,numeric,numeric,numeric,uuid,text) from public,anon,authenticated;
grant execute on function public.owner_close_employee_salary_month(uuid,uuid,date,numeric,numeric,numeric,numeric,numeric,numeric,uuid,text) to authenticated;
