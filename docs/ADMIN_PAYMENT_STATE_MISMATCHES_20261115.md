# Bite Super Admin — Order / Payment Mismatch Review (15 Nov 2026)

## Why this matters
Production **read-only** grouped counts identified non-demo Own Platform orders that were marked `Completed` while their `order_financials.payment_status` was `pending`, `unpaid`, or absent. There is also a `Handed Over` order with pending payment and a `Cancelled` order recorded paid. These records may be historical data or require real payment reconciliation; they do **not** prove the customer was charged or that an unauthorized transfer occurred.

The current Cashfree collection audit intentionally lists only recorded `paid` financials. It does not list many of these mismatches, leaving a potentially confusing gap in Super Admin's financial review.

## What is implemented
Super Admin → Financials & Settlements now has a **read-only Order / Payment mismatches** table showing:
- Completed order with payment recorded `unpaid`, `pending` or missing.
- Handed Over order with payment recorded `unpaid`, `pending` or missing.
- Cancelled/Rejected order recorded `paid`, requiring refund/settlement status review.

The table shows only an order code, mismatch type, internal payment status, and `Needs independent reconciliation`. It uses already-loaded `orders` and `order_financials` data; no new Supabase query, privileged function or payment provider call is made. It is accessible only through the existing Super Admin authorization guard. No customer address, phone, bank details or PAN appear.

The display is explicitly labeled **internal records, not verified Cashfree or bank statements**. It does not trigger refunds, payments, commission distributions, transfer instructions, order updates or financial writes. Demo and POS orders are excluded, and output is bounded to the first 100 conflicts in currently loaded records.

## QA and acceptance
Four new tests cover all three conflicting statuses, excluding normal/paid/demo/POS orders, proper Super Admin display, no provider calls, session clearing and Owner/signed-out denial. Existing Bite Node, Chromium and Postgres jobs must pass.

Do not mark any of these historical records paid or refunded just to make the mismatch count zero. For each genuinely recent issue, use the existing admin-only Cashfree verification flow, trusted checkout intent, provider evidence and real bank records before any specific financial action. A successful GitHub merge does not establish public Pages deployment; confirm the existing live-release attestation.

This change is an **operational exception queue** rather than a claim of having reconciled or corrected the underlying transactions.
