-- Candidate DDL for isolated PostgreSQL rehearsal; NOT a production migration.
ALTER TABLE public.menu_items
 ADD COLUMN available_online boolean NOT NULL DEFAULT true,
 ADD COLUMN available_pos boolean NOT NULL DEFAULT true,
 ADD COLUMN available_room boolean NOT NULL DEFAULT true,
 ADD COLUMN available_qr boolean NOT NULL DEFAULT true;
-- Separate anon policy: anon lacks EXECUTE on is_platform_admin / is_restaurant_member.
-- Existing permissive module-read policy must not expose unpublished or paused public items.
CREATE POLICY bite_menu_channel_anon ON public.menu_items AS RESTRICTIVE
 FOR SELECT TO anon
 USING (is_available AND (available_online OR available_qr) AND public.is_restaurant_public(restaurant_id));
CREATE POLICY bite_menu_channel_authenticated ON public.menu_items AS RESTRICTIVE
 FOR SELECT TO authenticated
 USING ((is_available AND (available_online OR available_qr) AND public.is_restaurant_public(restaurant_id))
        OR public.is_platform_admin() OR public.is_restaurant_member(restaurant_id));
