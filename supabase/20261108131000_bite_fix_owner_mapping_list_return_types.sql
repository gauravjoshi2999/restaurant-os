-- Fix the declared text return types for auth.users email and phone fields.
CREATE OR REPLACE FUNCTION public.admin_list_owner_assignments()
RETURNS TABLE(
  restaurant_id uuid, restaurant_name text, owner_user_id uuid, owner_name text,
  owner_email text, owner_phone text, restaurant_owner_count bigint, user_restaurant_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform Admin access required.';
  END IF;
  RETURN QUERY
  SELECT r.id,r.name,rm.user_id,coalesce(p.full_name,''),coalesce(u.email::text,''),coalesce(u.phone::text,''),
    count(rm.user_id) OVER (PARTITION BY r.id),count(rm.restaurant_id) OVER (PARTITION BY rm.user_id)
  FROM public.restaurants r
  LEFT JOIN public.restaurant_members rm ON rm.restaurant_id=r.id AND rm.role='owner'
  LEFT JOIN public.profiles p ON p.id=rm.user_id
  LEFT JOIN auth.users u ON u.id=rm.user_id
  ORDER BY r.name,rm.user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_owner_assignments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_owner_assignments() TO authenticated;
