-- Keep Platform Admin and Restaurant Owner responsibilities separate at the database layer.
-- Legacy Admin memberships (e.g. a real hotel Owner account also used for platform administration)
-- must not grant restaurant-operator privileges while the account is acting as Platform Admin.
CREATE OR REPLACE FUNCTION public.has_restaurant_role(target_restaurant uuid, allowed_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT NOT public.is_platform_admin()
     AND EXISTS (
       SELECT 1
       FROM public.restaurant_members rm
       WHERE rm.restaurant_id = target_restaurant
         AND rm.user_id = (SELECT auth.uid())
         AND rm.role = ANY(allowed_roles)
     );
$function$;

-- Super Admin may inspect all marketplace orders, but may not operate restaurant orders.
DROP POLICY IF EXISTS "platform admins can manage all orders" ON public.orders;
CREATE POLICY "platform admins read all orders"
ON public.orders FOR SELECT TO authenticated
USING (public.is_platform_admin());

-- Remove Platform Admin as an alternate path through tenant operational write policies.
-- Preserve platform-control tables (partner onboarding, platform settings/expenses,
-- support, review moderation, and Owner account mapping).
DO $migration$
DECLARE
  v_policy record;
  v_roles text;
  v_using text;
  v_check text;
  v_sql text;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename NOT IN (
        'platform_admins',
        'platform_expenses',
        'platform_settings',
        'restaurants',
        'restaurant_members',
        'customer_support_tickets',
        'restaurant_review_reports',
        'orders'
      )
      AND cmd IN ('ALL','INSERT','UPDATE','DELETE')
      AND (
        coalesce(qual,'') ILIKE '%is_platform_admin()%'
        OR coalesce(with_check,'') ILIKE '%is_platform_admin()%'
      )
  LOOP
    SELECT string_agg(quote_ident(role_name), ', ')
      INTO v_roles
    FROM unnest(v_policy.roles) AS role_name;
    v_using := CASE WHEN v_policy.qual IS NULL THEN NULL
      ELSE replace(v_policy.qual, 'is_platform_admin()', 'false') END;
    v_check := CASE WHEN v_policy.with_check IS NULL THEN NULL
      ELSE replace(v_policy.with_check, 'is_platform_admin()', 'false') END;

    EXECUTE format('DROP POLICY %I ON %I.%I',
      v_policy.policyname, v_policy.schemaname, v_policy.tablename);

    v_sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      v_policy.policyname, v_policy.schemaname, v_policy.tablename,
      v_policy.permissive, v_policy.cmd, v_roles);
    IF v_using IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', v_using);
    END IF;
    IF v_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_check);
    END IF;
    EXECUTE v_sql;
  END LOOP;
END
$migration$;
