-- Remove anonymous execution from internal/helper RPCs that are not used by the public customer or delivery pages.
-- Public restaurant discovery remains available through list_public_restaurants().
-- Public delivery handoff remains available through get_delivery_handoff() and confirm_delivery_handoff().
REVOKE EXECUTE ON FUNCTION public.check_restaurant_delivery_area(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_restaurant_public(uuid) FROM anon;
