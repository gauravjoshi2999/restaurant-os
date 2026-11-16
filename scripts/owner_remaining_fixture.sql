-- Synthetic completion of production table/trigger surfaces on a disposable DB.
alter table public.restaurants add column city text not null default 'Rajsamand';
alter table public.restaurants add column status text not null default 'Lead added';
alter table public.restaurants add column onboarding_status text not null default 'pending';
alter table public.restaurants add column onboarding_submitted_at timestamptz;
alter table public.restaurants add column onboarding_reviewed_at timestamptz;
alter table public.restaurants add column onboarding_reviewed_by uuid;
alter table public.restaurants add column onboarding_rejection_reason text;
alter table public.restaurants add column is_published boolean not null default false;
alter table public.restaurants add column created_by uuid;
alter table public.restaurants add column contact_person text;
alter table public.restaurants add column email text;
update public.restaurants set status='Active',onboarding_status='approved';
create table public.bite_operation_audit(id uuid primary key default gen_random_uuid(),actor_id uuid,action text,entity_id uuid,detail jsonb default '{}',created_at timestamptz default now());
create table public.platform_audit_logs(id uuid primary key default gen_random_uuid(),actor_id uuid,action text,entity_type text,entity_id uuid,details jsonb default '{}',created_at timestamptz default now());
create table public.restaurant_change_requests(id uuid primary key default gen_random_uuid(),restaurant_id uuid,requested_by uuid,request_type text,proposed_values jsonb,status text default 'Pending');
create function public.bite_audit_control_change() returns trigger language plpgsql security definer set search_path='' as $$declare r jsonb;begin
 r:=case when TG_OP='DELETE' then to_jsonb(old)else to_jsonb(new)end;
 insert into public.bite_operation_audit(actor_id,action,entity_id,detail)values(auth.uid(),TG_TABLE_NAME||':'||TG_OP,coalesce((r->>'id')::uuid,(r->>'restaurant_id')::uuid),jsonb_build_object('table',TG_TABLE_NAME,'before',case when TG_OP='INSERT' then null else to_jsonb(old)end,'after',case when TG_OP='DELETE' then null else to_jsonb(new)end));
 if TG_OP='DELETE' then return old;end if;return new;end $$;
create function public.add_creator_as_restaurant_owner() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.platform_admins where user_id=new.created_by)then insert into public.restaurant_members values(new.id,new.created_by,'owner')on conflict do nothing;end if;return new;end $$;
create trigger restaurant_creator_membership after insert on public.restaurants for each row execute function public.add_creator_as_restaurant_owner();
create function public.guard_restaurant_approval_fields() returns trigger language plpgsql set search_path='' as $$begin
 if auth.uid() is not null and not public.is_platform_admin() and (new.onboarding_status is distinct from old.onboarding_status or new.status is distinct from old.status or new.is_published is distinct from old.is_published)then raise exception 'Only Bite platform administrators can change approval' using errcode='42501';end if;return new;end $$;
create trigger restaurants_guard_approval_fields before update on public.restaurants for each row execute function public.guard_restaurant_approval_fields();
create table public.restaurant_expenses(id uuid primary key default gen_random_uuid(),restaurant_id uuid,expense_date date,category text,title text,amount numeric,payment_method text,created_at timestamptz default now());
create table public.restaurant_purchases(id uuid primary key default gen_random_uuid(),restaurant_id uuid,purchase_date date,paid_amount numeric,payment_method text,created_at timestamptz default now());
create table public.restaurant_cashbook_manual_entries(id uuid primary key default gen_random_uuid(),restaurant_id uuid,entry_date date,direction text,amount numeric,payment_method text,created_at timestamptz default now());
create table public.restaurant_employee_payments(id uuid primary key default gen_random_uuid(),restaurant_id uuid,payment_date date,amount numeric,payment_method text,created_at timestamptz default now());
create table public.restaurant_customer_ledger_entries(id uuid primary key default gen_random_uuid(),restaurant_id uuid,entry_date date,entry_type text,amount numeric,payment_method text,created_at timestamptz default now());
alter table public.restaurant_order_refunds add column restaurant_id uuid;
alter table public.restaurant_order_refunds add column refund_date date;
alter table public.restaurant_order_refunds add column refund_amount numeric;
alter table public.restaurant_order_refunds add column payment_method text;
-- The original parity suite independently verifies the real seven-source view.
create or replace view public.restaurant_cashbook_entries as
select id entry_id,restaurant_id,payment_date entry_date,'in'::text direction,amount::numeric(14,2) amount,payment_method from public.restaurant_order_payments
union all select id,restaurant_id,expense_date,'out',amount::numeric(14,2),payment_method from public.restaurant_expenses
union all select id,restaurant_id,purchase_date,'out',paid_amount::numeric(14,2),payment_method from public.restaurant_purchases where paid_amount>0
union all select id,restaurant_id,entry_date,direction,amount::numeric(14,2),payment_method from public.restaurant_cashbook_manual_entries
union all select id,restaurant_id,payment_date,'out',amount::numeric(14,2),payment_method from public.restaurant_employee_payments
union all select id,restaurant_id,entry_date,'in',amount::numeric(14,2),payment_method from public.restaurant_customer_ledger_entries where entry_type='credit'
union all select id,restaurant_id,refund_date,'out',refund_amount::numeric(14,2),payment_method from public.restaurant_order_refunds where refund_amount>0;

grant select on public.restaurant_order_payments to authenticated;
