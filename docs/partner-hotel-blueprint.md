# Bite Partner — guest register and daily accounts blueprint

This extends the existing Partner dashboard. Preserve its cream/charcoal/orange design, mobile navigation and housekeeping visibility preference.

## Main screens

| Screen | Main controls | Result |
| --- | --- | --- |
| Home | **Check-in** | Opens the guest registration form directly |
| Check-in | Guest details → room allocation → optional advance → review/confirm | A numbered stay and guest khata |
| Guest Khata | Add food, add extra charge, receive payment, checkout | One running bill with the current balance |
| Daily Book | Other income, expense, staff advance, salary, opening/transfers | Daily cash and online movement, including existing POS/room receipts |
| Settings | Hotel GSTIN, rates, bill prefix/next number, usual online account | New bill/charge settings; issued bills stay unchanged |
| Monthly reports | Monthly accounts Excel; bill-wise GST Excel | Files for owner review and CA reconciliation |

## Check-in form

1. **Serial no. — Auto** and **Entry date — Auto** at the top. The displayed next serial is a preview; the database assigns the final unique serial on save, starting at 1 for new numbered registrations.
2. Guest counts: **Male**, **Female**, **Children**. At least one adult; counts must fit the selected room.
3. **Guest name**, **Permanent address**, **Arriving from**, **Next destination**, **Mobile number**.
4. **Arrived by**: Car / Bike / Bus / Train / Other. A car/bike requires **Vehicle registration number**.
5. **ID front — Required**; **ID back — Optional, if available**. JPEG/PNG/PDF up to 4 MB, saved privately. ID copies do not appear on bills.
6. **Room number**, **Check-in date**, **Expected checkout**, **Agreed room rent per night**. Owner/manager can change the quoted rate; availability is checked on the server.
7. Optional **Advance received**, **Cash/UPI/Bank/Card**, **Online account — Short note**, and transaction reference. Money is recorded only when actually received; online receipts require verification.
8. Review and confirm. Failed or repeated requests must not create another stay or receipt.

Returning-guest search reuses the existing profile. Nationality/OCI and foreign-guest reporting remain available under additional details; existing records and workflows are retained.

## Guest khata and checkout

- **Add food** reuses the existing menu/POS room posting.
- **Add extra charge** requires an amount and reason, such as “Extra mattress”.
- **Receive payment** accepts a partial amount. Its account note is internal.
- **Checkout & collect balance** displays total bill − confirmed payments and records the remaining Cash/Online payment before issuing the final bill.
- Pending receipts, unresolved deposits, outstanding service orders and refund issues must be resolved before checkout.
- Food appears once as a sale; a partial payment/advance is a receipt, not another sale.

Example: room ₹1,200 + food ₹300, both before 5% GST → subtotal ₹1,500 + CGST ₹37.50 + SGST ₹37.50 = ₹1,575. If ₹300 was already received, ₹1,275 remains.

## Guest-facing bill

Hotel name, address, phone and GSTIN when registered; bill number and date; guest/room/stay details; room rent; attached itemized food lines; extra charges; taxable subtotal, applicable CGST/SGST, final total, payments received and balance. Private ID copies, account labels and operational ledger notes are excluded.

Invoice numbers are unique by property and financial year and at most 16 characters. Set a 1–3 character prefix and next numeric counter to continue an existing series. Issued invoice numbers and snapshots are immutable.

GST is configurable per property and charge category. Do not charge GST for an unregistered hotel or silently change old invoices. The requested 5% is split into 2.5% CGST and 2.5% SGST where applicable; room/restaurant applicability needs the property's actual GST registration and reviewed rates.

References:
- Ministry of Finance FAQ, 16 September 2025: https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=2167151&lang=2&reg=48
- CBIC Notification 15/2025: https://taxinformation.cbic.gov.in/view-pdf/1010456/ENG/Notifications
- CGST Rule 46 tax-invoice particulars and financial-year numbering.

## Daily and monthly accounting

Keep **billed sales**, **receipts**, **expenses** and **staff advances** separate:

- Standalone POS sale: counted once.
- Final hotel room + food bill: counted once; its room-posted POS order is excluded from standalone POS sales.
- Other income: entered with source/reason.
- Expense: groceries, flour, vegetables, gas, electricity, newspaper, milk, repairs and other actual costs.
- Staff advance: money paid to staff, not salary expense again.
- Earned monthly salary: record the whole salary cost once; pay only the remaining balance after advances.
- Opening balances and account transfers/settlements: money movements without creating revenue or expense.

**Recorded cash/online balance** = starting recorded balance + receipts − payouts.
**Recorded profit/loss** = billed sales excluding output GST − recorded costs including earned salary. Completeness depends on recording all relevant costs; this is an operating book, not a filed GST return or audited statement.

The Excel has one row per date with POS sale, room/food bill, other income, total sale, GST, net sale, expense, staff advance, cash received/paid/closing, online received/paid/closing and recorded profit/loss. The GST export groups issued bills by bill number with taxable service, SAC, CGST and SGST.

## Verification and rollout

Use a feature branch, isolated PostgreSQL tests and synthetic browser transport before applying the additive schema. Preserve all real orders, payment/refund/provider logic, guest histories, menus, staff records and the current redesign. No real guest IDs or real-money test transactions are used for QA. Browser tests prove controller behavior with synthetic transport; production data-entry and bank settlement require separate verification.
