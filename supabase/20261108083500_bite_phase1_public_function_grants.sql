revoke all on function public.is_restaurant_public(uuid) from public;
grant execute on function public.is_restaurant_public(uuid) to anon, authenticated, service_role;
