-- Bite owner discovery survey. Separate from order/customer/tenant data.
-- Only privileged Edge Function submits. Public roles have no Data API access.
create table if not exists public.bite_owner_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  survey_version integer not null default 1,
  restaurant_name text,
  city text not null,
  restaurant_kind text,
  team_size text,
  owner_name text,
  owner_phone text,
  existing_method text,
  biggest_problems text[] not null default '{}',
  real_story text not null,
  wish_list text[] not null default '{}',
  one_change text not null,
  other_ideas text,
  pilot_interest boolean not null default false,
  contact_consent boolean not null default false,
  privacy_agreed boolean not null default true,
  request_fingerprint text
);
comment on table public.bite_owner_feedback is 'Pre-launch restaurant owner discovery responses; private survey data, no tenant mapping.';
alter table public.bite_owner_feedback enable row level security;
revoke all on table public.bite_owner_feedback from public, anon, authenticated;
grant all on table public.bite_owner_feedback to service_role;
create index if not exists bite_owner_feedback_created_idx on public.bite_owner_feedback (created_at desc);
create index if not exists bite_owner_feedback_fingerprint_idx on public.bite_owner_feedback (request_fingerprint, created_at desc);
