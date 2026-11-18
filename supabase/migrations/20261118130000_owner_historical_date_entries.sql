-- Historical Owner entries; intentionally separated from active stays, POS orders,
-- settlement, stock, occupancy and tax invoices.
-- Existing live workflows are not altered by this migration.
create table if not exists public.bite_owner_historical_entries (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 entry_kind text not null check (entry_kind in ('room','pos')),
 property_id uuid references public.bite_properties(id) on delete restrict,
 restaurant_id uuid references public.restaurants(id) on delete restrict,
 record_date date not null,
 departure_date date,
 customer_name text not null check (length(btrim(customer_name)) between 1 and 120),
 customer_phone text not null default '' check (length(customer_phone) <= 24),
 room_number text not null default '' check (length(room_number) <= 60),
 guest_count integer check (guest_count between 1 and 200),
 visit_type text check (visit_type in ('dine_in','takeaway')),
 amount numeric(12,2) not null check (amount >= 0),
 received_amount numeric(12,2) not null default 0 check (received_amount >= 0 and received_amount <= amount),
 payment_method text check (payment_method in ('Cash','UPI','Card','Bank Transfer','Other')),
 items jsonb not null default '[]'::jsonb,
 notes text not null default '' check (length(notes) <= 500),
 created_by uuid not null default auth.uid(),
 recorded_at timestamptz not null default now(),
 constraint bite_historical_scope check (
   (entry_kind='room' and property_id is not null and restaurant_id is null and departure_date > record_date)
   or (entry_kind='pos' and restaurant_id is not null and property_id is null and departure_date is null)
 ),
 constraint bite_historical_items check (
   jsonb_typeof(items)='array' and jsonb_array_length(items) <= 150
   and (entry_kind='room' or jsonb_array_length(items)>0)
   and octet_length(items::text)<=25000
 ),
 constraint bite_historical_past_only check (
   record_date >= date '2000-01-01'
   and record_date < (now() at time zone 'Asia/Kolkata')::date
 ),
 constraint bite_historical_pos_visit check (
   entry_kind='room' or (visit_type in ('dine_in','takeaway') and
     (visit_type='takeaway' or guest_count is not null))
 )
);
create index if not exists bite_owner_historical_room_day_idx
 on public.bite_owner_historical_entries(property_id,record_date desc) where entry_kind='room';
create index if not exists bite_owner_historical_pos_day_idx
 on public.bite_owner_historical_entries(restaurant_id,record_date desc) where entry_kind='pos';
alter table public.bite_owner_historical_entries enable row level security;
revoke all on table public.bite_owner_historical_entries from public,anon,authenticated;
grant select,insert on table public.bite_owner_historical_entries to authenticated;

create policy bite_historical_read_owner on public.bite_owner_historical_entries
 for select to authenticated using (
  (entry_kind='room' and exists (
    select 1 from public.bite_property_members m
    where m.property_id=bite_owner_historical_entries.property_id
      and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','manager')
  ))
  or
  (entry_kind='pos' and (
    exists (select 1 from public.restaurant_members m
       where m.restaurant_id=bite_owner_historical_entries.restaurant_id
       and m.user_id=(select auth.uid()) and m.role in ('owner','manager'))
    or exists (select 1 from public.bite_properties p
       join public.bite_property_members m on m.property_id=p.id
       where p.origin_restaurant_id=bite_owner_historical_entries.restaurant_id
         and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','manager'))
  ))
 );
create policy bite_historical_insert_owner on public.bite_owner_historical_entries
 for insert to authenticated with check (
  created_by=(select auth.uid()) and
  (
   (entry_kind='room' and exists (
      select 1 from public.bite_property_members m
      where m.property_id=bite_owner_historical_entries.property_id
        and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','manager')
   ))
   or
   (entry_kind='pos' and (
      exists (select 1 from public.restaurant_members m
        where m.restaurant_id=bite_owner_historical_entries.restaurant_id
          and m.user_id=(select auth.uid()) and m.role in ('owner','manager'))
      or exists (select 1 from public.bite_properties p
         join public.bite_property_members m on m.property_id=p.id
         where p.origin_restaurant_id=bite_owner_historical_entries.restaurant_id
           and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','manager'))
   ))
  )
 );
comment on table public.bite_owner_historical_entries is
 'Owner-entered past room/POS register snapshots only. Not live stays, orders, payments, receipts, stock or statutory invoices. No authenticated UPDATE or DELETE privileges.';
