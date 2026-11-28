-- Rehearsal candidate. Keep one pricing calculation for checkout and Owner preview.
do $patch$
declare
 definition text:=pg_get_functiondef('public.bite_quote_menu_options_v2(uuid,jsonb)'::regprocedure);
 signature text:='public.bite_quote_menu_options_v2(p_restaurant_id uuid, p_lines jsonb)';
 availability text:='m.is_available and m.available_online;';
 anchor text:=' if p_restaurant_id is null then';
 owner_check text:=$guard$
 if p_owner_preview is true then
   if auth.uid() is null then
     raise exception 'Owner menu preview access denied' using errcode='42501';
   end if;
   if not (coalesce(public.has_restaurant_role(p_restaurant_id,array['owner','manager']),false)
      or coalesce(public.is_platform_admin(),false)) then
     raise exception 'Owner menu preview access denied' using errcode='42501';
   end if;
 end if;
$guard$;
begin
 if definition is null
    or (length(definition)-length(replace(definition,signature,'')))/length(signature)<>1
    or (length(definition)-length(replace(definition,availability,'')))/length(availability)<>1
    or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'V2 quote changed. Review Owner preview integration before migration.';
 end if;
 definition:=replace(definition,signature,
  'public.bite_quote_menu_options_v2_for_channel(p_restaurant_id uuid, p_lines jsonb, p_owner_preview boolean)');
 definition:=replace(definition,availability,'m.is_available and (p_owner_preview is true or m.available_online);');
 execute replace(definition,anchor,owner_check||anchor);
end $patch$;

revoke all on function public.bite_quote_menu_options_v2_for_channel(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.bite_quote_menu_options_v2_for_channel(uuid,jsonb,boolean) to anon,authenticated;
do $$begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  grant execute on function public.bite_quote_menu_options_v2_for_channel(uuid,jsonb,boolean) to service_role;
 end if;
end $$;

create or replace function public.bite_quote_menu_options_v2(p_restaurant_id uuid,p_lines jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
 select public.bite_quote_menu_options_v2_for_channel(p_restaurant_id,p_lines,false);
$$;
