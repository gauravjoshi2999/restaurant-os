-- Additive optional owner-declared classification. Existing rows stay NULL;
-- their explicit legacy vegetarian boolean is preserved, never guessed from
-- dish names/images. No rows, prices, publication flags or permissions change.
set lock_timeout='3s';
alter table public.menu_items add column if not exists dietary_type text;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.menu_items'::regclass
   and conname='bite_menu_dietary_consistency') then
  alter table public.menu_items add constraint bite_menu_dietary_consistency check (
   dietary_type is null or
   (dietary_type='veg' and is_vegetarian=true) or
   (dietary_type in ('egg','nonveg') and is_vegetarian=false)
  );
 end if;
end $$;
comment on column public.menu_items.dietary_type is
 'Optional restaurant-declared veg/egg/nonveg classification, consistent with legacy is_vegetarian. NULL retains legacy classification; not an allergen or kitchen-contamination certification.';
reset lock_timeout;
notify pgrst,'reload schema';
