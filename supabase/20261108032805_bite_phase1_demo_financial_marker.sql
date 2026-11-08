-- Financial demo rows are visibly separate and never indicate paid money.
alter table public.order_financials add column if not exists is_demo boolean not null default false;
create index if not exists order_financials_restaurant_demo_idx
  on public.order_financials (restaurant_id, is_demo, created_at desc);
comment on column public.order_financials.is_demo is 'True only for simulated Bite demo/test financial records; never indicates real payment or settlement.';