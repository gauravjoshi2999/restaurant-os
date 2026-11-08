-- Cover all remaining unindexed foreign-key columns reported by Supabase Performance Advisor.
CREATE INDEX IF NOT EXISTS platform_settings_updated_by_idx ON public.platform_settings(updated_by);
CREATE INDEX IF NOT EXISTS restaurant_customer_order_requests_responded_by_idx ON public.restaurant_customer_order_requests(responded_by);
CREATE INDEX IF NOT EXISTS restaurant_delivery_handoffs_created_by_idx ON public.restaurant_delivery_handoffs(created_by);
CREATE INDEX IF NOT EXISTS restaurant_delivery_zone_pincodes_zone_restaurant_idx ON public.restaurant_delivery_zone_pincodes(zone_id,restaurant_id);
CREATE INDEX IF NOT EXISTS restaurant_delivery_zones_created_by_idx ON public.restaurant_delivery_zones(created_by);
CREATE INDEX IF NOT EXISTS restaurant_reviews_responded_by_idx ON public.restaurant_reviews(responded_by);
CREATE INDEX IF NOT EXISTS restaurants_onboarding_reviewed_by_idx ON public.restaurants(onboarding_reviewed_by);
