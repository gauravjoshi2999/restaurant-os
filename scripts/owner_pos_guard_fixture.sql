-- Actual existing production trigger surface, on an isolated fixture only.
alter table public.orders add column created_by uuid default auth.uid();
alter table public.orders add column created_at timestamptz not null default now();
alter table public.orders add column customer_id uuid;
alter table public.orders add column status_note text;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('sub',auth.uid(),'role','authenticated')$$;
create trigger guard_owner_order_mutable_fields_trigger before update on public.orders for each row execute function public.guard_owner_order_mutable_fields();
grant update on public.orders to authenticated;
