-- Owner-controlled display preference, separate from the required hotel room-status capability.
-- Defaults OFF for existing and new properties; never deletes or rewrites room data.
create table if not exists public.bite_property_ui_preferences (
  property_id uuid primary key references public.bite_properties(id) on delete cascade,
  show_housekeeping boolean not null default false
);
alter table public.bite_property_ui_preferences enable row level security;
revoke all on public.bite_property_ui_preferences from public, anon;
grant select, insert, update on public.bite_property_ui_preferences to authenticated;

create policy property_ui_preferences_read on public.bite_property_ui_preferences
 for select to authenticated
 using (private.bite_can(property_id,'membership'));
create policy property_ui_preferences_insert_owner on public.bite_property_ui_preferences
 for insert to authenticated
 with check (private.bite_can(property_id,'manage_modules'));
create policy property_ui_preferences_update_owner on public.bite_property_ui_preferences
 for update to authenticated
 using (private.bite_can(property_id,'manage_modules'))
 with check (private.bite_can(property_id,'manage_modules'));

comment on table public.bite_property_ui_preferences is
 'Owner-controlled per-property display choices. Housekeeping workflow and room records remain enabled even while its UI is hidden.';
