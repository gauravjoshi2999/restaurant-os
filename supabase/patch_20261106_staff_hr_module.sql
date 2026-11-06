-- Staff & HR: employee master, attendance, leave and payment records.
-- Applied to live Supabase with execute_sql on 2026-11-06.
-- Reference patch; the live schema is authoritative.

create table if not exists public.restaurant_employees (
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 employee_code text,full_name text not null check(length(btrim(full_name)) between 2 and 120),
 phone text,position text,joining_date date not null default current_date,
 salary_amount numeric(14,2) not null default 0 check(salary_amount>=0),
 salary_period text not null default 'Monthly' check(salary_period in ('Monthly','Daily','Hourly')),
 status text not null default 'Active' check(status in ('Active','Inactive')),notes text,
 created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists restaurant_employees_code_unique on public.restaurant_employees(restaurant_id,lower(employee_code))
 where employee_code is not null and length(btrim(employee_code))>0;
create index if not exists restaurant_employees_rest_status_idx on public.restaurant_employees(restaurant_id,status,full_name);
create index if not exists restaurant_employees_created_by_idx on public.restaurant_employees(created_by);
alter table public.restaurant_employees enable row level security;
drop policy if exists "Employees members read" on public.restaurant_employees;
create policy "Employees members read" on public.restaurant_employees for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
drop policy if exists "Employees managers insert" on public.restaurant_employees;
create policy "Employees managers insert" on public.restaurant_employees for insert to authenticated with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) and created_by=(select auth.uid()));
drop policy if exists "Employees managers update" on public.restaurant_employees;
create policy "Employees managers update" on public.restaurant_employees for update to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin()) with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
drop policy if exists "Employees owners delete" on public.restaurant_employees;
create policy "Employees owners delete" on public.restaurant_employees for delete to authenticated using(public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin());

create table if not exists public.restaurant_employee_attendance (
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 employee_id uuid not null references public.restaurant_employees(id) on delete restrict,attendance_date date not null,
 status text not null check(status in ('Present','Absent','Half Day','Leave','Holiday')),
 check_in time,check_out time,notes text,recorded_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(employee_id,attendance_date),check(check_in is null or check_out is null or check_out>=check_in)
);
create index if not exists restaurant_employee_attendance_rest_date_idx on public.restaurant_employee_attendance(restaurant_id,attendance_date desc);
create index if not exists restaurant_employee_attendance_employee_date_idx on public.restaurant_employee_attendance(employee_id,attendance_date desc);
create index if not exists restaurant_employee_attendance_recorded_by_idx on public.restaurant_employee_attendance(recorded_by);
alter table public.restaurant_employee_attendance enable row level security;
drop policy if exists "Attendance members read" on public.restaurant_employee_attendance;
create policy "Attendance members read" on public.restaurant_employee_attendance for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
drop policy if exists "Attendance managers insert" on public.restaurant_employee_attendance;
create policy "Attendance managers insert" on public.restaurant_employee_attendance for insert to authenticated
with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) and recorded_by=(select auth.uid())
 and exists(select 1 from public.restaurant_employees e where e.id=restaurant_employee_attendance.employee_id and e.restaurant_id=restaurant_employee_attendance.restaurant_id));
drop policy if exists "Attendance managers update" on public.restaurant_employee_attendance;
create policy "Attendance managers update" on public.restaurant_employee_attendance for update to authenticated
using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin())
with check((public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin())
 and exists(select 1 from public.restaurant_employees e where e.id=restaurant_employee_attendance.employee_id and e.restaurant_id=restaurant_employee_attendance.restaurant_id));
drop policy if exists "Attendance owners delete" on public.restaurant_employee_attendance;
create policy "Attendance owners delete" on public.restaurant_employee_attendance for delete to authenticated using(public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin());

create table if not exists public.restaurant_employee_leaves (
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 employee_id uuid not null references public.restaurant_employees(id) on delete restrict,
 leave_type text not null check(leave_type in ('Casual','Sick','Unpaid','Other')),
 start_date date not null,end_date date not null,reason text,
 status text not null default 'Pending' check(status in ('Pending','Approved','Rejected')),
 created_by uuid not null default auth.uid() references auth.users(id),approved_by uuid references auth.users(id),approved_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(end_date>=start_date)
);
create index if not exists restaurant_employee_leaves_rest_date_idx on public.restaurant_employee_leaves(restaurant_id,start_date desc);
create index if not exists restaurant_employee_leaves_employee_idx on public.restaurant_employee_leaves(employee_id);
create index if not exists restaurant_employee_leaves_created_by_idx on public.restaurant_employee_leaves(created_by);
create index if not exists restaurant_employee_leaves_approved_by_idx on public.restaurant_employee_leaves(approved_by);
alter table public.restaurant_employee_leaves enable row level security;
drop policy if exists "Leaves members read" on public.restaurant_employee_leaves;
create policy "Leaves members read" on public.restaurant_employee_leaves for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
drop policy if exists "Leaves managers insert" on public.restaurant_employee_leaves;
create policy "Leaves managers insert" on public.restaurant_employee_leaves for insert to authenticated
with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) and created_by=(select auth.uid())
 and exists(select 1 from public.restaurant_employees e where e.id=restaurant_employee_leaves.employee_id and e.restaurant_id=restaurant_employee_leaves.restaurant_id));
drop policy if exists "Leaves managers update" on public.restaurant_employee_leaves;
create policy "Leaves managers update" on public.restaurant_employee_leaves for update to authenticated
using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin())
with check((public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin())
 and exists(select 1 from public.restaurant_employees e where e.id=restaurant_employee_leaves.employee_id and e.restaurant_id=restaurant_employee_leaves.restaurant_id));
drop policy if exists "Leaves owners delete" on public.restaurant_employee_leaves;
create policy "Leaves owners delete" on public.restaurant_employee_leaves for delete to authenticated using(public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin());

create table if not exists public.restaurant_employee_payments (
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 employee_id uuid not null references public.restaurant_employees(id) on delete restrict,
 payment_date date not null default current_date,period_month date,
 payment_type text not null check(payment_type in ('Salary','Advance','Bonus','Deduction')),
 amount numeric(14,2) not null check(amount>0),
 payment_method text not null check(payment_method in ('Cash','UPI','Card','Bank Transfer','Other')),
 reference text,notes text,created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now()
);
create index if not exists restaurant_employee_payments_rest_date_idx on public.restaurant_employee_payments(restaurant_id,payment_date desc);
create index if not exists restaurant_employee_payments_employee_period_idx on public.restaurant_employee_payments(employee_id,period_month desc);
create index if not exists restaurant_employee_payments_created_by_idx on public.restaurant_employee_payments(created_by);
alter table public.restaurant_employee_payments enable row level security;
drop policy if exists "Employee payments members read" on public.restaurant_employee_payments;
create policy "Employee payments members read" on public.restaurant_employee_payments for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
drop policy if exists "Employee payments owners insert" on public.restaurant_employee_payments;
create policy "Employee payments owners insert" on public.restaurant_employee_payments for insert to authenticated
with check(public.has_restaurant_role(restaurant_id,array['owner']) and created_by=(select auth.uid())
 and exists(select 1 from public.restaurant_employees e where e.id=restaurant_employee_payments.employee_id and e.restaurant_id=restaurant_employee_payments.restaurant_id));
grant select,insert,update,delete on public.restaurant_employees to authenticated;
grant select,insert,update,delete on public.restaurant_employee_attendance to authenticated;
grant select,insert,update,delete on public.restaurant_employee_leaves to authenticated;
grant select,insert on public.restaurant_employee_payments to authenticated;
revoke update,delete on public.restaurant_employee_payments from authenticated,anon;

create or replace function public.set_employee_record_updated_at()
returns trigger language plpgsql set search_path='' as $$ begin new.updated_at:=now();return new;end;$$;
drop trigger if exists restaurant_employees_updated_at on public.restaurant_employees;
create trigger restaurant_employees_updated_at before update on public.restaurant_employees for each row execute function public.set_employee_record_updated_at();
drop trigger if exists restaurant_employee_attendance_updated_at on public.restaurant_employee_attendance;
create trigger restaurant_employee_attendance_updated_at before update on public.restaurant_employee_attendance for each row execute function public.set_employee_record_updated_at();
drop trigger if exists restaurant_employee_leaves_updated_at on public.restaurant_employee_leaves;
create trigger restaurant_employee_leaves_updated_at before update on public.restaurant_employee_leaves for each row execute function public.set_employee_record_updated_at();

create or replace function public.guard_employee_record_tenant()
returns trigger language plpgsql set search_path='' as $$
declare emp_restaurant uuid;
begin
 if tg_op='UPDATE' then
  if new.restaurant_id is distinct from old.restaurant_id then raise exception 'Employee record restaurant ownership is immutable'; end if;
  if tg_table_name='restaurant_employees' then
   if new.created_by is distinct from old.created_by then raise exception 'Employee creator is immutable'; end if;
  elsif tg_table_name='restaurant_employee_attendance' then
   if new.recorded_by is distinct from old.recorded_by then raise exception 'Attendance recorder is immutable'; end if;
  elsif tg_table_name='restaurant_employee_leaves' then
   if new.created_by is distinct from old.created_by then raise exception 'Leave creator is immutable'; end if;
  end if;
 end if;
 if tg_table_name='restaurant_employees' then return new; end if;
 select e.restaurant_id into emp_restaurant from public.restaurant_employees e where e.id=new.employee_id;
 if emp_restaurant is null or emp_restaurant<>new.restaurant_id then raise exception 'Employee must belong to the same restaurant'; end if;
 if tg_table_name='restaurant_employee_leaves' then
  if tg_op='INSERT' then new.status:='Pending';new.approved_by:=null;new.approved_at:=null;
  elsif tg_op='UPDATE' then
   if new.status is distinct from old.status then
    if new.status in ('Approved','Rejected') then new.approved_by:=auth.uid();new.approved_at:=now();
    else new.approved_by:=null;new.approved_at:=null; end if;
   else new.approved_by:=old.approved_by;new.approved_at:=old.approved_at; end if;
  end if;
 end if;
 return new;
end;
$$;
drop trigger if exists restaurant_employees_identity_guard on public.restaurant_employees;
create trigger restaurant_employees_identity_guard before update on public.restaurant_employees for each row execute function public.guard_employee_record_tenant();
drop trigger if exists restaurant_employee_attendance_tenant_guard on public.restaurant_employee_attendance;
create trigger restaurant_employee_attendance_tenant_guard before insert or update on public.restaurant_employee_attendance for each row execute function public.guard_employee_record_tenant();
drop trigger if exists restaurant_employee_leaves_tenant_guard on public.restaurant_employee_leaves;
create trigger restaurant_employee_leaves_tenant_guard before insert or update on public.restaurant_employee_leaves for each row execute function public.guard_employee_record_tenant();

create or replace function public.guard_employee_payment()
returns trigger language plpgsql set search_path='' as $$
declare emp_restaurant uuid;
begin
 if not public.has_restaurant_role(new.restaurant_id,array['owner']) then raise exception 'Only Owner can record employee payments'; end if;
 select e.restaurant_id into emp_restaurant from public.restaurant_employees e where e.id=new.employee_id for update;
 if emp_restaurant is null or emp_restaurant<>new.restaurant_id then raise exception 'Employee must belong to the same restaurant'; end if;
 if exists(select 1 from public.restaurant_cashbook_closings c where c.restaurant_id=new.restaurant_id and c.close_date=new.payment_date) then raise exception 'This cashbook day is already closed'; end if;
 return new;
end;
$$;
drop trigger if exists restaurant_employee_payments_guard on public.restaurant_employee_payments;
create trigger restaurant_employee_payments_guard before insert on public.restaurant_employee_payments for each row execute function public.guard_employee_payment();

create or replace view public.restaurant_cashbook_entries with (security_invoker=true) as
select e.id as entry_id,e.restaurant_id,e.expense_date as entry_date,'out'::text as direction,e.category,e.amount,e.payment_method,e.title as description,'expense'::text as source_type,e.id as source_id,e.created_at from public.restaurant_expenses e
union all
select p.id,p.restaurant_id,p.purchase_date,'out'::text,'Purchase payment'::text,p.paid_amount,p.payment_method,coalesce(s.name,p.supplier_name_snapshot,'Purchase payment')::text,'purchase'::text,p.id,p.created_at from public.restaurant_purchases p left join public.restaurant_suppliers s on s.id=p.supplier_id where p.paid_amount>0
union all
select m.id,m.restaurant_id,m.entry_date,m.direction,m.category,m.amount,m.payment_method,coalesce(m.description,m.category),'manual'::text,m.id,m.created_at from public.restaurant_cashbook_manual_entries m
union all
select p.id,p.restaurant_id,p.payment_date,'in'::text,'Order payment'::text,p.amount,p.payment_method,coalesce(o.order_code,'Order')||case when nullif(o.customer_name,'') is null then '' else ' · '||o.customer_name end,'order_payment'::text,p.id,p.created_at from public.restaurant_order_payments p join public.orders o on o.id=p.order_id and o.restaurant_id=p.restaurant_id
union all
select ep.id,ep.restaurant_id,ep.payment_date,'out'::text,'Employee '||ep.payment_type,ep.amount,ep.payment_method,coalesce(e.full_name,'Employee')||' · '||ep.payment_type,'employee_payment'::text,ep.id,ep.created_at
from public.restaurant_employee_payments ep join public.restaurant_employees e on e.id=ep.employee_id and e.restaurant_id=ep.restaurant_id
where ep.payment_type in ('Salary','Advance','Bonus');
grant select on public.restaurant_cashbook_entries to authenticated;
