-- Ephemeral PostgreSQL CI fixture ONLY. Not Supabase production data.
do $role$
begin
 if not exists(select 1 from pg_catalog.pg_roles where rolname='service_role') then
  create role service_role nologin bypassrls;
 end if;
end
$role$;

create table public.restaurants(id uuid primary key);
create table public.orders(
 id uuid primary key, restaurant_id uuid not null,
 amount numeric(14,2) not null, channel text not null,is_demo boolean not null
);
create table public.bite_live_checkout_intents(
 id uuid primary key, restaurant_id uuid not null, activated_order_id uuid,
 amount numeric(14,2) not null,currency text not null,
 status text not null,provider_order_id text
);
insert into public.restaurants values
 ('22222222-2222-4222-8222-222222222222'),
 ('99999999-9999-4999-8999-999999999999');
insert into public.orders values
 ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',174,'Own Platform',false),
 ('55555555-5555-4555-8555-555555555555','99999999-9999-4999-8999-999999999999',100,'Own Platform',false),
 ('77777777-7777-4777-8777-777777777777','22222222-2222-4222-8222-222222222222',60,'Own Platform',true),
 ('88888888-8888-4888-8888-888888888888','22222222-2222-4222-8222-222222222222',45,'POS - Counter',false);
insert into public.bite_live_checkout_intents values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444',174,'INR','activated','bite_live_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','99999999-9999-4999-8999-999999999999','55555555-5555-4555-8555-555555555555',100,'INR','activated','bite_live_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','77777777-7777-4777-8777-777777777777',60,'INR','activated','bite_live_cccccccccccc4ccc8cccccccccccc'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222','88888888-8888-4888-8888-888888888888',45,'INR','activated','bite_live_dddddddddddd4ddd8ddddddddddddddd');
