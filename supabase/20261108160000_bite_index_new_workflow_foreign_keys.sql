-- Cover newly added foreign-key columns to avoid avoidable FK lookup scans.
CREATE INDEX IF NOT EXISTS platform_audit_logs_actor_id_idx ON public.platform_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS customer_support_tickets_order_id_idx ON public.customer_support_tickets(order_id);
CREATE INDEX IF NOT EXISTS restaurant_change_requests_requested_by_idx ON public.restaurant_change_requests(requested_by);
CREATE INDEX IF NOT EXISTS restaurant_change_requests_reviewed_by_idx ON public.restaurant_change_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS restaurant_payout_profiles_updated_by_idx ON public.restaurant_payout_profiles(updated_by);
