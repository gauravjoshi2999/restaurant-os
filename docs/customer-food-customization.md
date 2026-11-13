# Customer food customization — incremental rollout

## Step 1: Dish cooking requests (implemented)

The customer cart can capture a **free-text cooking request per dish**, e.g. "less spicy" or "no onion". The request applies to every unit of that dish in the cart, not to a separately priced variant. A general order/delivery note is still supported.

- Each dish request is limited to 100 characters. The complete general + dish request text is limited to 500 characters and checked **before any checkout write**.
- The existing `p_customer_note` argument of `bite_prepare_checkout_v2` / sandbox draft receives the combined text. The existing `p_items` contract remains unchanged: only `menu_item_id` and `quantity`.
- The note is visible to the restaurant owner in the new-order inbox and full order board. Text is HTML-escaped.
- Dish requests and the general note are persisted with the restaurant-scoped legacy cart, restored on reload, and included in Clear cart / Remove one item Undo. Notes are removed if the associated dish becomes unavailable or the cart is cleared after verified payment.
- A request is **not a guarantee** the kitchen can fulfill it. The note does not alter menu prices, coupons, payment totals or restaurant inventory.
- No database migration or Supabase production configuration change is required for this step.

## Step 1b: One-tap cooking request suggestions (implemented)

The customer can toggle **Less spicy, No onion, No garlic, Extra spicy** in the per-dish editor, or write custom text. Suggestions are plain cooking requests, not menu options. The UI keeps pressed states in sync with manual edits, prevents contradictory spicy presets and refuses additions beyond the existing 100-character cap without truncating the user's note. Suggestions never change the price or server order-item contract.

## Step 2A — Live backend foundation and read-only quote (implemented)

Supabase project `wedbgpybbgsszcmffoha` has the following additive migrations, tracked with the exact deployed versions:

- `20261113135056_bite_priced_options_foundation_guarded.sql`: creates tenant-scoped `menu_option_groups`, `menu_option_choices`, `menu_item_option_groups`; checks `min_select/max_select`, nonnegative option deltas, explicit RLS/grants, and composite foreign keys that prevent cross-restaurant option assignments.
- `20261113135449_bite_priced_options_read_only_quote.sql`: `bite_quote_menu_options_v1(restaurant_id, lines)` recomputes preview price using trusted menu/choice records, rejects unavailable or mismatched choices, missing mandatory groups, duplicates and client prices. It returns `quote_only: true` and `authorizes_payment: false` and does not create orders.
- `20261113135618_bite_quote_anon_role_guard.sql`: ensures anonymous users never invoke authenticated-only tenant membership helpers. Public quoting is available only for approved, active, published restaurants and visible menu records.

**Verification on the live database:** anonymous Butter Roti quantity 2 returned INR 40. Client-supplied price and unlinked choices were rejected. Transactional QA with an isolated mandatory Size group verified a ₹10 price delta (2 units = ₹60), missing size, repeated choices, over-max selections and cross-restaurant composite foreign key rejection. All test rows were rolled back; zero option groups, choices and mappings remain.

This foundation is not a production paid-checkout launch. The existing `bite_prepare_checkout_v2` and Cashfree payment path remain unchanged, and no restaurant can charge an add-on through this read-only quote. The canonical v2 cart-line helpers are packaged for future use, **not loaded into the current checkout**.

### Remaining gates before showing paid options

1. Add immutable selection/amount snapshots to order lines and checkout intents.
2. Introduce versioned `bite_prepare_checkout_v3` with the same trusted option validator for live and sandbox; keep v2 compatibility.
3. Connect option-aware cart lines and owner order details; store distinct notes per canonical line.
4. Test provider amount, coupon, zone minimum, replay/idempotency, refunds, and versioned cart recovery.
5. Only then expose the option picker behind an off-by-default restaurant capability flag, pilot on one restaurant and verify real payment and settlement accounting.

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
