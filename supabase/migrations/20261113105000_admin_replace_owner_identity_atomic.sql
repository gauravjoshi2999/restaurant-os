CREATE OR REPLACE FUNCTION public.admin_replace_owner_mapping(p_restaurant_id uuid, p_expected_owner_id uuid, p_new_owner_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_existing uuid[];
begin
 if (select auth.uid()) is null or not public.is_platform_admin() then
  raise exception 'Only the Platform Super Admin can replace a restaurant Owner.';
 end if;
 if p_restaurant_id is null or p_expected_owner_id is null or p_new_owner_id is null
    or p_expected_owner_id = p_new_owner_id then
  raise exception 'Valid previous and new Owner IDs are required.';
 end if;
 if not exists(select 1 from public.restaurants r where r.id=p_restaurant_id) then
  raise exception 'Restaurant not found. Refresh the mapping.';
 end if;
 if not exists(select 1 from auth.users u where u.id=p_new_owner_id) then
  raise exception 'New Owner account does not exist.';
 end if;
 if exists(select 1 from public.platform_admins pa where pa.user_id=p_new_owner_id) then
  raise exception 'Platform Admin account cannot become a Restaurant Owner.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('bite-owner-restaurant:'||p_restaurant_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('bite-owner-user:'||p_new_owner_id::text,0));
 select array_agg(m.user_id) into v_existing from public.restaurant_members m
 where m.restaurant_id=p_restaurant_id and m.role='owner';
 if coalesce(array_length(v_existing,1),0)<>1 or v_existing[1]<>p_expected_owner_id then
  raise exception 'Restaurant Owner changed. Refresh before replacing.';
 end if;
 if exists(select 1 from public.restaurant_members m where m.user_id=p_new_owner_id) then
  raise exception 'New Owner login is already assigned to a restaurant.';
 end if;
 delete from public.restaurant_members m
 where m.restaurant_id=p_restaurant_id and m.user_id=p_expected_owner_id and m.role='owner';
 insert into public.restaurant_members(restaurant_id,user_id,role)
 values(p_restaurant_id,p_new_owner_id,'owner');
 insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
 values(auth.uid(),'owner_login_replaced','restaurant',p_restaurant_id,
  jsonb_build_object('previous_owner_user_id',p_expected_owner_id,'new_owner_user_id',p_new_owner_id));
 return true;
end;
$function$


REVOKE ALL ON FUNCTION public.admin_replace_owner_mapping(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_replace_owner_mapping(uuid,uuid,uuid) TO authenticated;
