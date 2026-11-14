# Bite Customer UX — Compact My Orders Cards (2026-11-14)

## Why this phase
The user's authenticated mobile screenshot showed a single completed order occupying most of the screen, with **Order again**, **Download bill**, **View details**, **Rate restaurant**, and **Report issue** forming several uneven rows. The earlier release correctly relocated the stray "Delivery" text into the status badge row. This phase improves the remaining card's action hierarchy without changing order permissions or payment logic.

## Implementation
- Each order shows **two primary actions**; a native keyboard-accessible, collapsible **More options** section contains the less-frequent actions.
- **Completed**: primary Order again / View details; secondary Download bill, Rate restaurant (only if not already reviewed), Report issue.
- **Received**: primary View details / Cancel order; secondary Download bill / Order again. The cancel action remains available immediately.
- **Accepted, Preparing, Ready**: primary View details / Request cancellation; secondary Download bill / Order again.
- **Other statuses**, including cancelled/rejected/handed-over: primary View details / Order again; secondary Download bill.
- The real **status and fulfilment badges** remain visible above the actions.
- Compact responsive card layout, readable amounts, touch areas of at least 44px, keyboard focus indicators, reduced-motion support and no new asset or data dependencies.
- Existing event hooks `data-reorder`, `data-invoice`, `data-order-detail`, and `data-customer-order-action` are preserved verbatim. The existing authenticated order RPC, review and cancellation RPCs are untouched.

## Verification
- Added `scripts/customer_order_cards_compact.test.cjs`, executing the actual action renderer with representative status and review cases.
- Updated the previous customer cleanup test to assert the extracted action helper, rather than expecting every action to be inline in the original order-list renderer.
- Extended `scripts/browser_completion.py` to assert compact cards, hidden secondary actions, accessible disclosure opening and a real PDF download from its revealed button. The browser fixture is **explicitly synthetic** and never makes live payments.
- Screenshot artifact: `dist/launch-qa/ui-orders-compact.png` from the Chromium QA run.
- Still needed before declaring complete: a manual logged-in mobile device check on a real customer order.

## Release safety
The change is customer-only markup + CSS + test updates. No Supabase schema, Auth/RLS, payment, cashbook, owner/admin, delivery handoff, OTP, or price computation changes. PR should only be merged on green GitHub QA and the resulting main SHA should have a successful GitHub Pages deployment.
