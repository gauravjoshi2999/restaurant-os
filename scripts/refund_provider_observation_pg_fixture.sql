-- Isolated PostgreSQL 17 synthetic fixture; NEVER execute on production.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema if not exists auth;
create function auth.jwt() returns jsonb language sql stable as
$$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table public.orders(
 id uuid primary key,restaurant_id uuid not null,customer_id uuid not null,amount numeric not null,
 channel text not null,is_demo boolean not null default false
);
create table public.bite_live_checkout_intents(
 id uuid primary key, activated_order_id uuid not null unique,
 customer_id uuid not null,restaurant_id uuid not null,amount numeric not null,
 currency text not null,status text not null,provider_order_id text not null
);
create table public.order_financials(
 id uuid primary key,order_id uuid not null unique,restaurant_id uuid not null,
 currency text not null,customer_payable_amount numeric not null,
 payment_status text not null,refund_amount_actual numeric not null default 0
);
create table public.bite_refund_jobs(
 id uuid primary key,order_id uuid not null unique,customer_id uuid not null,restaurant_id uuid not null,
 amount numeric not null,status text not null,provider_refund_id text not null unique,
 provider_status text,provider_checked_at timestamptz,updated_at timestamptz default now(),
 last_error text
);
insert into public.orders values
 ('10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',174,'Own Platform',false),
 ('10000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',50,'Own Platform',false);
insert into public.bite_live_checkout_intents values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',174,'INR','activated',
  'bite_live_40000000000000000000000000000001'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',50,'INR','activated',
  'bite_live_40000000000000000000000000000002');
insert into public.order_financials values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','INR',174,'paid',0),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001','INR',50,'paid',0);
insert into public.bite_refund_jobs(id,order_id,customer_id,restaurant_id,amount,status,provider_refund_id)
values
 ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',174,'pending_approval','bite_rf_60000000000000000000000000000001'),
 ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',50,'approved','bite_rf_60000000000000000000000000000002');
