-- Owner accounts cannot create additional staff/manager/owner memberships in Phase 1.
-- Platform Admin and trusted Edge Functions remain the only membership writers.
DROP POLICY IF EXISTS "owners can manage memberships" ON public.restaurant_members;
DROP POLICY IF EXISTS "platform admins can manage all memberships" ON public.restaurant_members;
DROP POLICY IF EXISTS "platform admins can read all memberships" ON public.restaurant_members;
DROP POLICY IF EXISTS "members can read memberships" ON public.restaurant_members;
CREATE POLICY "members and platform admins read memberships" ON public.restaurant_members
  FOR SELECT TO authenticated USING (public.is_platform_admin() OR public.is_restaurant_member(restaurant_id));
CREATE POLICY "platform admins insert memberships" ON public.restaurant_members
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "platform admins update memberships" ON public.restaurant_members
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY "platform admins delete memberships" ON public.restaurant_members
  FOR DELETE TO authenticated USING (public.is_platform_admin());
