-- Rehearsal candidate. Attach option metadata to the public catalog boundary.
-- This predicate reads the link directly to avoid policy recursion.
create schema if not exists private;
create function private.bite_menu_option_is_public(p_restaurant_id uuid,p_group_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.is_restaurant_public(p_restaurant_id) and exists (
  select 1
  from public.menu_item_option_groups link
  join public.menu_items item
   on item.restaurant_id=link.restaurant_id and item.id=link.menu_item_id
  where link.restaurant_id=p_restaurant_id and link.option_group_id=p_group_id
   and link.is_available and item.is_available and (item.available_online or item.available_qr)
 );
$$;
revoke all on function private.bite_menu_option_is_public(uuid,uuid) from public,anon,authenticated;
grant execute on function private.bite_menu_option_is_public(uuid,uuid) to anon,authenticated;

create policy bite_menu_public_option_groups_anon on public.menu_option_groups
as restrictive for select to anon
using(private.bite_menu_option_is_public(restaurant_id,id));
create policy bite_menu_public_option_groups_authenticated on public.menu_option_groups
as restrictive for select to authenticated
using(private.bite_menu_option_is_public(restaurant_id,id) or public.is_restaurant_member(restaurant_id) or public.is_platform_admin());

create policy bite_menu_public_option_choices_anon on public.menu_option_choices
as restrictive for select to anon
using(private.bite_menu_option_is_public(restaurant_id,option_group_id));
create policy bite_menu_public_option_choices_authenticated on public.menu_option_choices
as restrictive for select to authenticated
using(private.bite_menu_option_is_public(restaurant_id,option_group_id) or public.is_restaurant_member(restaurant_id) or public.is_platform_admin());
