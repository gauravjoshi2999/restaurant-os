# Owner workspace verification — 9 November 2026

## Result

All twelve retained Owner sections were opened through an actual, non-Admin Owner login against the live Supabase backend. The tested build fixes page navigation and invalid nested sections, preserves saved settings, separates demo/unpaid activity from verified collections, and provides CSV, Excel and printable bills/reports. Frontend source is deployed through the existing GitHub Pages workflow; this does not certify real payment collection.

## Concrete defects fixed

- `applyRoleUI()` wrote inline `display:none!important` onto pages, while navigation only toggled a class. Page activation now clears stale inline styles and explicitly manages visibility and accessibility state.
- A missing closing Purchases section nested Inventory, Cashbook, HR, Khata, Reports and Settings under an inactive page. All twenty dashboard sections are now independent siblings; a structural release check prevents recurrence.
- Multiple contradictory Owner recovery styles created competing scroll containers and prevented the mobile header from sticking. Five obsolete layout/recovery blocks were retired in favor of one Owner stylesheet. The mobile drawer scrolls independently, closes after selection and removes closed navigation from keyboard focus.
- Restaurant state mapping discarded saved description, delivery fees, minimum order, timing and availability fields. These fields now survive cloud loading and settings save. The unchanged Settings save was verified against existing values of delivery fee 25, minimum order 149 and prep time 30.
- Rejected/demo orders were counted in live daily operations. Live KPIs exclude demo records; rejected orders are not active work. India business dates are independent of the browser/host timezone.
- Business reports previously treated unpaid and simulated orders as sales. Verified collections now come from financial snapshots, demo expenses are excluded, and missing provider fees remain unknown. CSV formula injection is neutralized; Excel downloads use a real XLSX archive with literal text and numeric cells.
- Cashbook success messages were cleared by data refresh. Successful save/closing feedback now survives refresh. Repeated Khata/HR save taps are guarded.
- A locked or expired delivery link could not be regenerated after handover, although the error instructed the Owner to do so. The existing Owner-only RPC now accepts Ready or Handed Over delivery orders, invalidates prior tokens, and retains expiry/OTP safeguards. The Owner has a New delivery link action. WhatsApp message line breaks and the handover status counter were also corrected.

## Browser verification

The authenticated build was exercised in Chromium using the existing Demo Royal Thali House Owner account. No credentials were recorded in source or this report.

| Area | Observed result |
| --- | --- |
| Navigation | Overview, Orders, Menu, Tables, Khata, Cashbook, Expenses, Purchases, Inventory, HR, Reports and Settings all opened. |
| Expenses | Temporary entry saved for 17, edited to 19 and read back. |
| Khata | Temporary customer, debit 100 and collection 40 produced balance 60. Collection appeared automatically in Cashbook. |
| Cashbook | Expense 19, customer collection 40, purchase payment 3 and manual income 9 appeared with their correct sources. |
| Menu | Temporary unavailable item saved for 23 and read back with its availability control. |
| Tables | Temporary three-seat table saved and read back. |
| Inventory | Temporary item and opening stock 5 saved; linked purchase added another 2. |
| Purchases | Supplier saved; purchase total 10, paid 3, balance 7 and one linked stock item verified. |
| HR | Employee saved and Present attendance read back. |
| Settings | Stored fee/minimum/prep/description/cuisine values loaded correctly; unchanged save returned success. |
| Reports | Actual browser Excel download opened with openpyxl; nine entries matched displayed income 711 and outflow 2972 at test time. These figures include temporary QA records and are not business performance claims. |
| Bills | Demo order BITE-DEMO-20261031-1 opened a printable bill: items 139 + 219, total 358, explicit DEMO ONLY / no payment notice. |
| Mobile | All twelve sections were checked at 340 CSS-pixel width with zero horizontal overflow. At 681px, header remained at top while scrolling and drawer scroll did not move the background. This is responsive Chromium testing, not a physical Android-device certification. |

## Repeatable automated evidence

- `python scripts/check_frontend.py`: syntax and existing security/payment guards pass.
- `python scripts/check_owner_structure.py`: twenty independent pages, unique IDs and external Owner script syntax pass.
- `node --test scripts/owner_behavior.test.cjs`: six behavioral tests pass, including all twelve routes, Admin/Owner separation, India dates, payment-safe totals and exports.
- `scripts/owner_database_regression.sql`: ten groups passed as a dedicated non-Admin Owner: tenant/view isolation, foreign-write denial, Menu CRUD, Tables, Expenses/Cashbook sync, Khata, manual Cashbook, supplier/purchase/inventory posting, negative-stock guard, HR/attendance/leave/salary, Settings/commission protection and closing reconciliation. Business test writes rolled back.
- `scripts/owner_delivery_regression.sql`: three groups passed: Owner order progression and pickup; token lookup and five-attempt lock; Owner regeneration after handover, old-token invalidation, Customer-only OTP and completion. All temporary customer/order/token rows rolled back.
- Actual Excel bytes were independently opened with openpyxl; numeric cells, Hindi strings and formula-like literal strings were verified.

## Data preservation and review boundary

Transactional database tests rolled back all business writes. Browser QA created nine explicitly named `BITE QA 20261109` parent records plus associated test stock/ledger/attendance rows. Two exact-ID cleanup attempts were not executed because the database deletion confirmation expired. These temporary browser records remain for approved cleanup; do not describe them as genuine business activity. The QA expense was marked demo, the dedicated QA restaurant remains unpublished, and the dedicated QA login was disabled. No pre-existing business record was deleted or reassigned.

## Production boundaries

Online marketplace checkout remains disabled until the approved payment provider and trusted verification are connected. No payment, refund or payout was simulated. Supabase still reports leaked-password protection disabled, four anonymous and twenty-nine authenticated SECURITY DEFINER review notices, an intentional RPC-only/no-policy handoff table, thirteen multiple-policy performance notices and fifty-four unused-index informational notices. All public tables remain under RLS. These broader production/security items are not erased by passing Owner workflow tests.
