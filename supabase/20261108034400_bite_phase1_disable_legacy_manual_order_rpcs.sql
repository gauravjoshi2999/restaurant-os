-- Bite Phase 1: disable legacy counter/POS order creation for browser-authenticated users.
-- The current marketplace release accepts customer orders only through the guarded
-- place_customer_order workflow after payment-provider readiness checks.
-- Keep service_role execution for controlled maintenance/migration workflows only.

revoke all on function public.create_order_with_items(uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_order_with_items(uuid, text, text, text, text, jsonb)
  to service_role;

revoke all on function public.create_pos_order_with_balance_action(
  uuid, text, text, text, jsonb, numeric, text, date, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_pos_order_with_balance_action(
  uuid, text, text, text, jsonb, numeric, text, date, text, text, text
) to service_role;

revoke all on function public.create_pos_order_with_payment(
  uuid, text, text, text, text, jsonb, numeric, text, date, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_pos_order_with_payment(
  uuid, text, text, text, text, jsonb, numeric, text, date, text, uuid
) to service_role;
