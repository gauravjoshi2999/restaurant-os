-- Platform Admin-only Owner mapping audit and resolution.
CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Platform admins read audit logs" ON public.platform_audit_logs;
CREATE POLICY "Platform admins read audit logs" ON public.platform_audit_logs
  FOR SELECT TO authenticated USING (public.is_platform_admin());
REVOKE ALL ON public.platform_audit_logs FROM anon, authenticated;
GRANT SELECT ON public.platform_audit_logs TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_owner_assignments()
RETURNS TABLE(restaurant_id uuid, restaurant_name text, owner_user_id uuid, owner_name text,
  owner_email text, owner_phone text, restaurant_owner_count bigint, user_restaurant_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform Admin access required.'; END IF;
  RETURN QUERY
  SELECT r.id,r.name,rm.user_id,coalesce(p.full_name,''),coalesce(u.email,''),coalesce(u.phone,''),
    count(rm.user_id) OVER (PARTITION BY r.id),count(rm.restaurant_id) OVER (PARTITION BY rm.user_id)
  FROM public.restaurants r
  LEFT JOIN public.restaurant_members rm ON rm.restaurant_id=r.id AND rm.role='owner'
  LEFT JOIN public.profiles p ON p.id=rm.user_id
  LEFT JOIN auth.users u ON u.id=rm.user_id
  ORDER BY r.name,rm.user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolve_owner_mapping(p_user_id uuid,p_restaurant_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_before jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform Admin access required.'; END IF;
  IF p_user_id IS NULL OR p_restaurant_id IS NULL THEN RAISE EXCEPTION 'Choose an Owner account and restaurant.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user_id) THEN RAISE EXCEPTION 'Owner account was not found.'; END IF;
  IF EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_user_id) THEN RAISE EXCEPTION 'A Platform Admin cannot be assigned as a Restaurant Owner.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.restaurants r WHERE r.id=p_restaurant_id) THEN RAISE EXCEPTION 'Restaurant was not found.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bite-owner-user:'||p_user_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('bite-owner-restaurant:'||p_restaurant_id::text,0));
  SELECT coalesce(jsonb_agg(jsonb_build_object('restaurant_id',restaurant_id,'user_id',user_id,'role',role)),'[]'::jsonb)
    INTO v_before FROM public.restaurant_members
    WHERE role='owner' AND (user_id=p_user_id OR restaurant_id=p_restaurant_id);
  DELETE FROM public.restaurant_members WHERE user_id=p_user_id AND restaurant_id<>p_restaurant_id;
  DELETE FROM public.restaurant_members WHERE restaurant_id=p_restaurant_id AND role='owner' AND user_id<>p_user_id;
  UPDATE public.restaurant_members SET role='owner' WHERE restaurant_id=p_restaurant_id AND user_id=p_user_id AND role<>'owner';
  INSERT INTO public.restaurant_members(restaurant_id,user_id,role)
    SELECT p_restaurant_id,p_user_id,'owner'
    WHERE NOT EXISTS(SELECT 1 FROM public.restaurant_members WHERE restaurant_id=p_restaurant_id AND user_id=p_user_id AND role='owner');
  INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
    VALUES(auth.uid(),'owner_mapping_resolved','restaurant',p_restaurant_id,
      jsonb_build_object('selected_owner_user_id',p_user_id,'previous_owner_memberships',v_before));
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_owner_assignments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_owner_assignments() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_resolve_owner_mapping(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_owner_mapping(uuid,uuid) TO authenticated;
