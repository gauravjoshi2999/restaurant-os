-- Additive owner-managed Kids' Choice label. Existing dishes stay untagged.
-- Existing menu_items tenant RLS policies apply to edits. Public access is read-only.
alter table public.menu_items
  add column if not exists is_kids_choice boolean not null default false;

comment on column public.menu_items.is_kids_choice is
  'Optional owner-approved Kids Choice menu label; false until explicitly enabled by restaurant owner or manager.';
