# Bite Checkout V3 — Priced Options and Verified Order Snapshots

## Rollout state (13 November 2026)

**Backend staged, customer-paid options OFF.** The existing live V2 checkout, POS billing, and Cashfree payment provider configuration are unchanged. The separately deployed `bite_prepare_checkout_v3` remains a *legacy-safe gate* and rejects selected paid options. Do not advertise priced choices or route customer traffic into a V3 session until all final gates pass.

The new production database migrations were applied before being committed to this repository. Their exact Supabase migration versions are preserved in `supabase/migrations`:

| Version | Change |
| --- | --- |
| `20261113142155` | Add V3 pricing-version and order-item snapshot columns without changing legacy defaults |
| `20261113142352` | Trusted read-only `bite_quote_menu_options_v2` with note-separated cart lines and `unit_price` |
| `20261113142750` | Service-role-only `bite_prepare_checkout_v3_priced_candidate` to prepare complete server-priced intents |
| `20261113143141` | Make existing verified-payment finalization copy V3 options, base/extra unit amounts, line identity and cooking request into `order_items` |
| `20261113143220` | Fail closed on a cart-line identity longer than storage limits, *before* payment |
| `20261113143503` | Block mutation/deletion of V3 priced snapshots while leaving legacy V2/POS order lines alone |

### Existing parallel V3 foundation

Other already-applied migrations also created `pricing_version`, `variant_priced_items`, `option_choices_snapshot`, `base_unit_price_snapshot`, `option_unit_total_snapshot`, `cart_line_key_snapshot` and `cooking_request_snapshot`. The new candidate and verified finalizer deliberately use those canonical names. Additional compatibility fields (`pricing_schema_version`, `selected_options_snapshot`, `base_unit_price`, `option_unit_total`, `variant_line_key`, `cooking_request`) are populated consistently for future migration compatibility. Avoid adding *another* set of snapshot columns.

## Safety conditions

- Every option ID is checked against the published restaurant, its item, active option group and availability. Price is recomputed in PostgreSQL, not accepted from the browser.
- V3 checkout preparation checks customer identity/profile, opening times, delivery PIN and zone fee, minimum order **using the complete priced food subtotal**, coupon amount, commission rate, server-verified cart contents and replay/idempotency key. It stores an immutable `priced_items` / `variant_priced_items` pair.
- Verified-payment finalization requires the existing service-role and payment-verification guards, identical snapshots and mathematically consistent per-line base and option totals. The Cashfree provider amount remains sourced from `bite_live_checkout_intents.amount`.
- The `bite_prepare_checkout_v3_priced_candidate` function has **no EXECUTE privilege for anon or authenticated**. Customer website still uses V2 and cannot call it.
- An order that contains a V3 snapshot cannot silently change options, quantities, charged amounts, note, or line identity, and its priced line cannot be deleted in place. Refunds belong in financial/refund records.
- Menus currently contain **zero live configured option groups/choices/mappings**. Do not populate them for customers until the pilot is approved.

## Checks actually run against Supabase

- Anonymous read-only quote on an available dish: quantity 2 produced ₹40; client-submitted unit price and an unlinked option choice were rejected.
- Two different cooking instructions on the same dish were retained as two distinct quoted cart lines; a 101-character cooking request was rejected.
- Transaction-only checkout tests verified two separate note lines, version-3 snapshot parity, correct subtotal, no provider-order creation, repeat-key idempotency, and changed-cart replay rejection.
- A separate **ROLLBACK-only** test created a temporary mandatory Size option (+₹15), verified that two units added ₹30 to the trusted food total, copied the priced option name/amount to the checkout-intent snapshot, and returned the same intent on an identical retry. All test rows and intents were rolled back.
- Security metadata confirmed anonymous and normal authenticated users cannot execute the candidate, while service_role can. No actual customer charge or real order was generated during these tests.
- GitHub's `node --test scripts/*.test.cjs` / Chromium CI should pass on the committed migrations.

## Remaining production gates

1. Agree on canonical option-aware cart identity between the existing `assets/customer-option-cart.js` and server line keys; migrate saved carts without losing cooking requests.
2. Add a restaurant-owner option-group/choice editor with restaurant RLS, min/max, availability and input guards.
3. Implement customer-facing size/add-on selector, final server quote display and change-of-price recovery behind a per-restaurant flag (default OFF).
4. Align Cashfree live **and sandbox** checkout/verification, including totals, coupons, retries, expiry, refunds, settlement/commission and item-level owner kitchen display. A database-only rollback test is *not* proof that a real provider payment or refund works.
5. Complete an isolated pilot order using the production-like payment path without bypassing verified callbacks. Only after amount/snapshot reconciliation passes should `bite_prepare_checkout_v3` be switched to the verified-priced implementation and granted authenticated access as appropriate.
6. Add monitoring and an instant rollback toggle; preserve legacy V2 as a fallback.

**Avoid manual alterations to paid order line snapshots.** If a paid order needs correcting, use a refund/adjustment audit workflow rather than editing the historical charge.
