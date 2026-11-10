# Rajsamand operating playbooks

Internal operating proposals for owner approval/training; these are not newly published customer SLAs. Assign one named Bite duty operator and backup before a pilot. The restaurant Owner remains accountable for cooking and restaurant-managed delivery. There is no platform driver fleet/KDS in this release.

## Restaurant onboarding and training

1. Bite operator records the real proprietor/contact, restaurant address, operating hours, delivery responsibility, service PINs, minimum food amount, zone fees and support escalation contact.
2. Obtain and review applicable business/FSSAI documents and display requirements; validate expiry/identity through the responsible official process. A document upload or listing approval is not a regulatory verification certificate.
3. Confirm menu prices/photos/availability, vegetarian classification and any required allergen/claim accuracy. Ask Owner to edit an item and verify Customer view using the approved test environment.
4. Separately confirm approved provider marketplace model, restaurant KYC/vendor/bank mapping, commission/fee terms and payout eligibility. A published listing is not automatically payment-ready.
5. Train Owner: receive → accept/reject → preparing → ready → secure handoff → physical handover → Customer OTP completion. Never share the Customer OTP in a link/message. Delivery address is shared only for fulfillment.
6. Train ordinary business records: expense with date/method, bill attachment, cashbook reconciliation, Khata receipt, purchase/stock and staff entries as applicable. Demo records are excluded from real sales.
7. Test opening hours, overnight hours, pause delivery while pickup remains available, out-of-zone PIN, closed restaurant and a failed/retried sandbox checkout.
8. Sign off accountable Owner/operator, grievance route, payment/refund handling, active hours and a controlled service area. Do not onboard an untrained restaurant into a nationwide launch.

## Incident cards

| Trigger | Responsible first action | Resolution / evidence |
| --- | --- | --- |
| Paid customer, no order visible | Bite duty operator searches exact provider reference and checkout; prevents a second payment. | Trusted verification/idempotent activation; escalate mismatch with Cashfree. Never create a fake paid order. |
| Platform/Owner money not credited | Operator separates collection, platform-bank settlement and restaurant payout. | Provider status + UTR/bank match + approved vendor payout evidence; record unknowns honestly. |
| Restaurant does not answer | Operator contacts Owner through the approved operating channel. | Enabled deadline worker cancels eligible future orders after cutoff; refund review queued. No claim of refund success before provider confirmation. |
| Restaurant rejects or customer cancels before acceptance | Owner/Customer uses supported state transition. | Paid cancellation generates one refund-review job; Admin reviews/executed refund requires authorization. |
| Cancellation after acceptance/preparation | Owner reviews the tracked request and reason. | Approved/rejected response stays visible; delivered orders cannot be cancelled. |
| Wrong/missing/unsafe food | Support records exact order/items and requested remedy; Owner responds. | Approved replacement/refund decision, evidence and provider reference; possible safety escalation. Do not require a public review as a condition for help. |
| Late delivery | Owner verifies actual preparation/handover and contacts restaurant's delivery person. | Give an honest update; do not invent live tracking/ETA. Escalate failed delivery/cancellation under approved policy. |
| Delivery person cannot confirm | Owner checks token expiry/rotation and physical handover. | Customer provides OTP only when food arrives. Five-attempt/expiry controls remain; escalate instead of bypassing OTP. |
| Refund pending or declined | Operator checks the same refund reference; does not generate a new ID to retry blindly. | Provider SUCCESS applied once; pending/declined/uncertain cases stay open until reconciled. |
| Chargeback/payment dispute | Admin preserves original order/authorization/fulfillment/refund evidence. | Respond through the approved provider channel and deadlines; no fabricated delivery proof. |
| Restaurant temporarily closes | Owner pauses/sets closure; existing accepted work remains accountable. | New preparation is blocked. Already paid in-flight checkout retains a recoverable order. |
| Login/reset email fails | Operator verifies address/redirect/sender configuration and expiry. | User controls credential entry/reset; no password in chat, no generic shared Owner password. |
| Cross-tenant access, forged callback or secret leak | Stop the affected release/action and open a security incident. | Preserve minimal evidence, rotate affected secrets through approved controls, validate isolation and rollback safely. |
| Upload is private/missing | Owner checks correct restaurant and MIME/size; Admin checks bucket setup. | Short-lived signed link; never change a private bucket to public to fix a document error. |
| Deployment/production failure | Operator records exact commit and job failure, freezes rollout. | Restore previous verified runtime; preserve database/payment history and reconcile affected orders. |

## Daily closing checklist

- Review unfinished orders and unanswered support tickets; name the operator responsible for each exception.
- Match verified collections, refunds, actual fees and provider/platform settlement evidence. Mark unreconciled items explicitly.
- Check Owner cash/UPI/online records and expenses separately from marketplace sales. Cash movement is not net profit.
- Check restaurant availability, menu/stock issues and next opening period; pause orders if the Owner cannot fulfill.
- Review scheduler heartbeat, deployed commit/QA failures and any suspicious status/access changes.
- Confirm public support/grievance routes are staffed under the approved policy. Review the next day's service area/capacity before promoting orders.
