# Customer food customization — incremental rollout

## Step 1: Dish cooking requests (implemented)

The customer cart can capture a **free-text cooking request per dish**, e.g. "less spicy" or "no onion". The request applies to every unit of that dish in the cart, not to a separately priced variant. A general order/delivery note is still supported.

- Each dish request is limited to 100 characters. The complete general + dish request text is limited to 500 characters and checked **before any checkout write**.
- The existing `p_customer_note` argument of `bite_prepare_checkout_v2` / sandbox draft receives the combined text. The existing `p_items` contract remains unchanged: only `menu_item_id` and `quantity`.
- The note is visible to the restaurant owner in the new-order inbox and full order board. Text is HTML-escaped.
- Dish requests and the general note are persisted with the restaurant-scoped legacy cart, restored on reload, and included in Clear cart / Remove one item Undo. Notes are removed if the associated dish becomes unavailable or the cart is cleared after verified payment.
- A request is **not a guarantee** the kitchen can fulfill it. The note does not alter menu prices, coupons, payment totals or restaurant inventory.
- No database migration or Supabase production configuration change is required for this step.

## Step 2: Real priced variants and add-ons (not yet enabled)

Do not let the customer pick paid extras or sizes using a client-calculated price. The current server checkout pricing snapshots are derived from `menu_items.price` and `quantity`. A client-side "extra cheese +₹20" selector would be misleading and financially unsafe without server changes.

Before enabling paid options:
1. Define tenant-scoped option groups, choices, per-item min/max selections, availability, price deltas, and owner permissions in the database, with RLS and indexes.
2. Introduce a canonical cart line key based on `menu_item_id` plus sorted option IDs and quantities, preserving distinct variants of the same dish.
3. Add a server-side quote and validation path to both live and sandbox checkout. Reprice every selected option from trusted database records, check option/restaurant ownership and availability, and persist immutable priced snapshots.
4. Update order item snapshots, owner kitchen tickets, refunds and reporting so each selected option and its charged amount are visible.
5. Add tests for wrong-restaurant options, stale prices, duplicate options, min/max, discounts, idempotency, cart restoration, mixed variants and post-payment edits.
6. Deploy database and backend changes before enabling the variant UI. Roll out behind a capability flag per restaurant.

## Verification

`node --test scripts/customer_dish_instructions.test.cjs` and the existing QA workflow cover the new behavior. The full GitHub Actions pipeline runs frontend guards, Node tests and Chromium smoke tests. Mobile-device manual verification is still recommended for keyboard focus and textarea ergonomics.
