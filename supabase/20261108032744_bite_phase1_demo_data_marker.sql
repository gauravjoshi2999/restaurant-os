-- Add explicit markers so synthetic test activity cannot be mistaken for real commerce.
alter table public.orders add column if not exists is_demo boolean not null default false;
alter table public.restaurant_expenses add column if not exists is_demo boolean not null default false;
create index if not exists orders_restaurant_demo_date_idx
  on public.orders (restaurant_id, is_demo, order_date desc);
create index if not exists restaurant_expenses_restaurant_demo_date_idx
  on public.restaurant_expenses (restaurant_id, is_demo, expense_date desc);
comment on column public.orders.is_demo is 'True only for explicitly simulated Bite demo/test records; never represents a customer payment.';
comment on column public.restaurant_expenses.is_demo is 'True only for simulated Bite demo/test expense records.';