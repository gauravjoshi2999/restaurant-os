# RestaurantOS — Financial, Commission and Settlement Design

## Purpose

Define the financial records needed before implementing the Profit & Loss dashboard or collecting customer payments. This document does not change the database, application behavior, commission collection, or restaurant payouts.

## Commercial policy currently proposed

- RestaurantOS own-website orders: proposed standard commission is **18%**.
- Zomato and Swiggy orders: RestaurantOS commission is **0%** under the current proposal; their existing platform agreements and payouts remain directly between those platforms and the restaurant.
- Zomato/Swiggy order management is intended to remain free initially.
- RestaurantOS does not operate its own delivery fleet in the initial model; the restaurant manages delivery or pickup.
- The 18% policy is a business planning decision, not an active charge in the application. It must be included in signed restaurant terms and implemented only after payment-provider/legal review.

## Commission base — must be explicit

Do not calculate commission blindly from the existing `orders.amount` field. Before launch, the restaurant agreement and checkout must define the commissionable food value and how discounts are funded.

The financial record should separately preserve:
- Food subtotal before discounts
- Restaurant-funded discount
- RestaurantOS/platform-funded discount
- Tax amount
- Delivery fee
- Tip, if supported
- Commissionable food value (an explicit server-validated snapshot)
- Commission rate and commission amount snapshot

A possible starting proposal is to charge 18% on food value after restaurant-funded discounts, excluding taxes, delivery fees and tips. Platform-funded discounts should not reduce the restaurant's agreed commission base unless the contract explicitly says otherwise. This is a proposal requiring confirmation, not a finalized rule.

## Per-order financial snapshot

Create a one-to-one financial record for each order, rather than rewriting historical orders when pricing changes. It should preserve:
- Order and restaurant identifiers
- Sales channel
- Food subtotal and discount/tax/delivery/tip breakdown
- Commissionable amount, commission rate and commission amount
- Customer payment amount and payment status
- Actual payment-provider fee (recorded from provider data; never guessed)
- Refund amount and refund status
- Amount due to restaurant
- Settlement status and timestamps

Rules:
- Own-website orders use the agreed commission rate snapshot (currently proposed 18%).
- Zomato/Swiggy orders have zero RestaurantOS commission unless a later, separately agreed service fee is introduced.
- Historical orders retain their original rate and amounts if the rate changes later.
- Never infer a gateway fee from an estimate when an actual provider transaction fee is available.
- Do not mark an order as paid or settled merely because an order was created or marked completed.

## Settlement records

Use separate settlement records so that one restaurant payout can cover multiple orders and can be reconciled against the payment provider/bank reference. Record:
- Restaurant
- Settlement period
- Gross eligible order value
- Commission total
- Actual gateway fees and other agreed deductions
- Refunds/adjustments
- Net amount payable
- Amount actually paid
- Provider/bank reference
- Status: draft, pending, processing, paid, failed, or on-hold
- Created/approved/paid timestamps and responsible actor

A settlement must be auditable. Do not overwrite a paid settlement; use a separately recorded adjustment/reversal with a reason.

## Platform expenses and Profit & Loss

Record platform operating expenses separately from restaurant order settlements. Suggested categories:
- Hosting and infrastructure
- Software/tools
- Staff and contractor payments
- Marketing and restaurant onboarding
- Customer support
- Professional/legal/accounting fees
- Other operating expenses

Dashboard calculations should distinguish:
1. Gross order value (GMV)
2. RestaurantOS commission revenue
3. Actual payment processing costs
4. Refunds and platform-funded promotions
5. Contribution after variable costs
6. Operating expenses
7. Net operating profit/loss

Do not count Zomato/Swiggy gross order value as RestaurantOS revenue. Do not count money held for restaurants as platform income.

## Security and compliance requirements

- Financial calculations must be performed or validated server-side, not trusted from browser-submitted values.
- Apply tenant isolation so a restaurant can see only its own orders, financial records and settlements; platform administrators get authorized platform-wide access.
- Keep service-role and payment-provider secret keys out of browser code.
- Before accepting live payments or paying restaurants, obtain payment-provider approval for the marketplace/settlement structure, finalize restaurant contracts, and review applicable RBI/payment-aggregator, GST, consumer, FSSAI e-commerce and privacy requirements with qualified professionals.
- Zomato/Swiggy integrations remain subject to their authorized API/partner access.

## Implementation sequence

1. Confirm the commission base, discount allocation, gateway-fee allocation, refund rules and settlement timing.
2. Add database tables and server-side functions for per-order financial snapshots, settlements, adjustments and platform expenses.
3. Add role-protected financial and settlement views.
4. Add P&L dashboard with date filters and channel/restaurant breakdown.
5. Test with demo orders and simulated settlements; do not move real money during testing.
6. Enable live payment and settlement only after provider approval and end-to-end compliance review.

## Current status

This is a design specification only. No database migration or payment behavior is included in this commit.
