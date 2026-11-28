-- Run only on a disposable Supabase stack. Auth and API roles are real local services.
\set ON_ERROR_STOP on
begin;
create schema if not exists private;
create table public.bite_properties(id uuid primary key);
create table public.bite_property_members(
 property_id uuid references public.bite_properties,
 user_id uuid references auth.users,
 role text not null,
 active boolean not null default true,
 primary key(property_id,user_id)
);
create table public.platform_admins(user_id uuid primary key references auth.users);
alter table public.bite_properties enable row level security;
alter table public.bite_property_members enable row level security;
alter table public.platform_admins enable row level security;
grant select,insert,update on public.bite_property_members to service_role;
insert into public.bite_properties values
 ('f7130000-0000-4000-8000-000000000001'),('f7130000-0000-4000-8000-000000000002');
\ir ../supabase/migrations/20261128154000_paid_subscription_offers.sql
\ir ../supabase/migrations/20261128160000_subscription_sandbox_attempts.sql
\ir ../supabase/migrations/20261128162500_subscription_sandbox_receipts.sql
\ir ../supabase/migrations/20261128170000_subscription_sandbox_lifecycle.sql
notify pgrst, 'reload schema';
commit;
