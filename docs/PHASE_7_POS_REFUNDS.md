# Phase 7 — POS Refunds

**Date:** 2026-11-06  
**Status:** Database and UI code committed; deployment pending the latest Pages workflow.

## Delivered

- New immutable `restaurant_order_refunds` ledger. It stores **sale amount cancelled** separately from **money actually returned**. This distinction keeps Khata correct when an unpaid portion is cancelled or only part of collected money is returned.
- Refund history, order eligibility and totals in a new Refunds workspace. Owner can record refunds; Manager can view; Staff cannot open the Refunds workspace.
- Supports POS Counter, Takeaway and Dine-in orders in Completed, Rejected or Cancelled status. External marketplace/own-platform refunds are not supported in this phase.
- The screen explicitly says the record does not initiate a bank/UPI/card transfer. Owner must first return the money through the actual payment channel, then record it.
- Customer Khata now reverses the cancelled part of a completed POS sale and records actual returned money as a debit. Rejected/Cancelled orders already have their sale reversed, so only actual money returned is recorded.
- Cashbook now records actual refund money as an outflow on the refund date. Sale cancellation without money returned does not create a cash outflow.
- POS payment summary now reports net collected, net balance, net sale, amount refunded and amount cancelled. Additional payments use the remaining net balance.
- Refund rows are append-only. Owner-only insert; Owner/Manager/Staff read. Anonymous access and authenticated update/delete privileges are revoked.
- Server checks lock the order row, ensure refund does not exceed collected money, ensure returned money is covered by cancelled sale amount for completed orders, reject duplicate/over refunds, and prevent edits on a closed Cashbook date.

## Verification

- Completed ₹100 POS order, ₹100 collected, ₹30 sale cancellation and ₹30 returned: net sale ₹70, net paid ₹70, due ₹0, Khata ₹0, Cashbook refund outflow ₹30.
- Partial unpaid cancellation: ₹100 sale, ₹30 collected, ₹50 sale cancelled and ₹30 returned: remaining due ₹50; subsequent ₹50 payment accepted; final Khata balance ₹0.
- Rejected order with ₹30 collected and ₹30 returned: Khata balance ₹0.
- Over-refund was rejected.
- Refund on a Cashbook-closed date was rejected.
- Cross-tenant Owner could not read or insert another restaurant's refunds.
- All test transactions rolled back; live refund rows remain 0.
- RLS enabled; no anon grants; authenticated UPDATE/DELETE grants are 0.
- Security Advisor remains at the previous baseline: 10 authenticated SECURITY DEFINER warnings, 1 public `list_public_restaurants()` warning, and leaked-password protection disabled. New refund functions are SECURITY INVOKER.
- Health Advisor returned no findings. Performance Advisor shows existing unused-index and multiple-permissive-policy notices; no unindexed foreign-key warning for this module.
- JavaScript syntax validation passed and HTML IDs are unique. No real Android/browser smoke test has been performed.

## Applied Supabase migrations

- `pos_refunds_khata_cashbook`
- `allow_refunds_on_rejected_pos_orders`
- `clarify_refund_payment_status`
- `index_pos_refund_foreign_keys`

## Important limitation

This is a **refund recording and accounting module**, not a payment gateway. It does not send money to customers, initiate refunds with Zomato/Swiggy, or alter marketplace settlements. Those integrations require approved provider access.
