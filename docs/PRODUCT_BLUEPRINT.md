# Bite — Eat. Repeat. | Master Product Specification

**Status: AUTHORITATIVE REQUIREMENTS — supersedes the previous 120-question interview, the older Product Blueprint, and all earlier feature decisions.**
**Source of truth:** User's Complete Master Prompt — Restaurant Marketplace Website, 2026-11-07.
**Initial release:** India; one restaurant per Owner account; three product panels only.

## 1. Product and architecture

Bite is a full-stack, multi-tenant restaurant marketplace connecting Customers with Restaurants. It has exactly three primary panels:
1. Customer Website
2. Restaurant Owner Dashboard
3. Platform Admin Dashboard

The product must be genuinely connected to persistent Supabase data and trusted backend operations. No fake payment success, hardcoded sales, demo orders presented as real, or UI-only controls.

Brand: **Bite**. Tagline: **Eat. Repeat.**

Current technical foundation discovered in the repository: GitHub Pages static frontend, Supabase Auth/PostgreSQL/RLS, customer page `customer.html`, owner/admin page `index.html`, and public delivery handoff page `delivery.html`. GitHub Pages is only static hosting; privileged payment, refund, OTP, webhook and time-triggered work must run in trusted server-side functions (e.g. Supabase Edge Functions), never in browser code. Keep only browser-safe Supabase project URL and publishable key in frontend.

## 2. Customer Website

### Discovery and restaurant pages
- Search restaurants by name, area, food or category; choose delivery address/location.
- Only show restaurants that serve the customer's delivery area.
- Categories, featured restaurants, popular dishes, ratings/reviews, offers/coupons.
- Filters: open now, veg/non-veg, low price, low delivery charge, rating.
- Restaurant details: name/logo, address/location, phone, hours, rating/reviews, minimum order, delivery charge, ETA, menu.
- Browse menu and prices without login.

### Customer account
- Register/login with mobile+password or email+password; forgot password.
- Do not require SMS OTP for normal login.
- Require login only to place an order.
- Profile: name, mobile, email, password, saved Home/Office/Other addresses, edit profile, order history, downloadable bills, favourites.

### Menu and cart
- Dish name/photo/price/description, veg/non-veg, category, availability, special instructions.
- Customer can request less spicy, no onion, no garlic, or other instructions.
- Cart add/remove/change quantity; automatic totals, delivery charge and coupon discount.
- Persist cart across return visits. One restaurant per order; different restaurants require separate orders.

### Checkout and order lifecycle
- Delivery or self pickup. Online payment only; never show COD.
- Customer pays the displayed total; no separate gateway fee line added to customer.
- Confirm order only after trusted provider confirms successful payment.
- Use an approved marketplace payment provider with restaurant KYC, split settlement, commission, payouts, refunds and reconciliation.
- Statuses: Order Placed → Order Accepted → Preparing → Ready → Out for Delivery / Ready for Pickup → Delivered.
- Customer may cancel before restaurant acceptance. After acceptance, allow cancellation request. If preparation has started, owner approval is required. Delivered orders cannot be cancelled.
- Complaints/refund requests must be trackable and refunds must use provider-supported refund operations.
- Order history: detail, PDF bill, reorder, date search and payment status.

### Reviews and support
- Only completed-order customers may submit 1–5 star rating and written review.
- Owner can view and reply. Customer can report inappropriate review; Admin investigates.
- Support tickets: wrong item, missing item, payment, refund and order issue; customer sees ticket status.

## 3. Restaurant Owner Dashboard

### Current Owner scope update — 9 November 2026
The subsequent accepted Owner workflow retains the existing Overview, Orders, Menu Management, Tables, Customer Khata, Cashbook, Expenses, Purchases & Suppliers, Inventory, Employees & HR, Reports and Settings. Complete and verify these existing operations first. This supersedes their older exclusion below; it does not authorize enabling disabled POS creation, POS refunds, kitchen/KOT, multiple branches or aggregator integrations. Keep historical data safe. HR/payroll automation and recipe stock deduction are not implied by these manual business records.


### Registration and approval
- Register mobile, restaurant name/address/location/category, menu/photos, bank settlement details and required business documents.
- New restaurant remains Pending until Platform Admin approval.

### Dashboard and order management
- Show today's sales, online orders, pending orders, expenses, estimated profit, payment collection summary and quick links to Orders, Menu, Accounts, Reports, Settings.
- New order alert with sound and browser push notification (where supported/permission granted).
- Accept/reject with reason; acceptance deadline is 5 minutes. If unanswered, trigger configured automatic cancellation and provider refund workflow.
- Show order details, customer address after appropriate stage, payment status, date-wise search/history.
- No separate Kitchen Staff login, KDS or KOT. Owner manages kitchen verbally.
- Owner advances order through preparation and clicks **Delivery Ke Liye Taiyar** when ready.

### Restaurant-managed delivery handoff
- On ready, reveal customer address/location and allow generation of secure, time-limited delivery link shareable by WhatsApp with restaurant's own delivery person.
- Link works without delivery login; shows customer name, address, map and order details; expires on successful delivery or expiry time.
- 4-digit delivery OTP is provided by customer at handoff; delivery person enters it on link. OTP is never exposed in link. Validate securely with attempt limits; successful OTP marks Delivered and notifies customer/owner.
- If OTP unavailable, escalate to Support.
- Delivery person's personal number is never exposed to customer. Customer contacts owner, who can relay messages.
- Initial release does NOT include platform delivery-partner registration/login/dashboard/assignment/tracking.

### Menu, offers and settings
- Full menu CRUD, photo upload, price, description, veg/non-veg, category, availability.
- Restaurant coupons/discounts with dates, terms and minimum order.
- Owner can edit restaurant profile, logo/photos, phone, hours, temporary closure, delivery timing, minimum order, delivery areas/pincodes and area-wise delivery charge.
- Pause delivery without closing restaurant; accepted orders must still be fulfilled.
- Restaurant name, address and bank detail changes require Admin approval.
- One Owner account manages one Restaurant only. No multiple branches.

### Simple business accounts and bills
- Daily online order sales, daily income, daily expenses, category/amount/date, optional bill photo.
- Automatic daily calculations; monthly sales/expense summaries; date-wise historical records; PDF and Excel exports.
- No complex accounting, no inventory/stock management, no daily closing button. Each date remains separate.
- Order invoice PDF and WhatsApp share; include restaurant, items, quantities, prices, delivery charge, discount and total.
- Reviews view/reply/report.

## 4. Platform Admin Dashboard

- Summary: total/pending/active/suspended restaurants, customers, orders, sales, commission, pending refunds and settlement summary.
- Restaurant onboarding: documents, approve/reject, activate/suspend/reactivate, details, orders, commission.
- Customer list/details and justified suspend/reactivate.
- All orders with detail, status, payment status, restaurant/date filters and search.
- Payments: transactions, commission, restaurant settlements, pending settlements, refunds, decisions and reconciliation.
- Commission: default proposed 10%, configurable globally and per restaurant; transparent calculation; restaurant cannot bypass it.
- Marketplace provider: KYC, split settlement, platform commission, payout, refunds and reconciliation. Follow provider's approved marketplace model and Indian law. Do not hold customer funds in an unauthorized platform account.
- Gateway fees may be deducted from restaurant settlement only when provider agreement supports it and this is disclosed. Settlement timing follows actual provider cycle (next-day only if available).
- Support tickets: complaints, refunds, wrong/missing item, payment and delivery issues.
- Website management: food categories, featured restaurants, platform coupons/offers, website settings, reported reviews, commission.
- Audit logs: profile/bank changes, approvals, suspensions, commission changes, refund decisions, order status changes.

## 5. Payment and revenue rules

- Commission-based; no monthly subscription in initial release.
- No COD. Online payment only.
- Proposed default platform commission 10%.
- No separate gateway fee charged to customer.
- Gateway fee is not platform profit; actual provider fee and settlement rules must be used.
- Test calculation only: ₹500 order, 10% commission ₹50, assumed provider fee ₹11.51, illustrative restaurant settlement ₹438.49.
- Actual settlement is provider-controlled and depends on approved agreement, fees, taxes, refunds and payout cycle.
- Test mode until merchant/provider onboarding and approval are complete. Never represent test mode as live collection.

## 6. Notifications

Real-time notifications for new order, accepted/rejected/cancelled, ready, delivery confirmation, refund status, restaurant approval, complaint and admin updates. Owner gets in-dashboard notification, sound and browser push where supported and permitted.

## 7. Security and privacy

Secure Auth, RBAC, strict customer and restaurant tenant isolation, Admin-only platform access, secure password handling, protected backend endpoints, verified provider webhooks, secure OTP, expiring delivery links, audit logs, backup, input validation, rate limiting and secure uploads. No user-metadata-based authorization. Never expose Supabase service-role/payment secrets in browser. Every exposed public table must have appropriate RLS; review SECURITY DEFINER functions and grants.

## 8. Design

Professional mobile-first responsive experience for Android, tablet and desktop. Simple Hindi/English option, easy navigation, clear touch targets, attractive restaurant cards and quality food imagery, fast loading. Owner UI must be understandable to non-technical small-business operators. Avoid unnecessary features.

## 9. Explicit exclusions for initial release

The following older prototype features are NOT part of this Master Prompt and must not appear as active product modules or navigation: POS/counter order creation, POS refunds, KOT/KDS, automated payroll, multiple branches, Zomato/Swiggy integrations/manual channel workflows, hotel modules, platform delivery-partner fleet, subscriptions. Existing database objects/data are not to be destructively dropped merely to hide these features; archive/deprecate safely and preserve records unless a separately approved data migration explicitly authorizes deletion.

## 10. Technical delivery and phased implementation

Full-stack application: frontend, backend, database, Auth/RBAC, protected APIs, marketplace payment integration, realtime orders, notifications, PDF invoice, Excel reports, secure image upload, Admin dashboard, production deployment. Maintainable architecture; all important data persistent.

Provide complete source, schema, setup instructions, env documentation, Admin bootstrap, deployment instructions, development test credentials (never production passwords) and testing checklist.

Phases:
1. Database, Auth, RBAC and tenant isolation.
2. Customer storefront and restaurant discovery.
3. Owner dashboard and menu management.
4. Order management and online payment provider integration.
5. Delivery link, OTP and confirmation.
6. Admin dashboard and restaurant approval.
7. Business accounts, reports, PDF bills and Excel exports.
8. Notifications, security, tests and deployment.

Before implementation: verify dependencies, inspect live schema/data/migrations, design target schema and architecture, and confirm marketplace provider onboarding requirements. Implement and test each phase end-to-end. Do not claim a feature is complete based only on a UI, syntax check, or deployment.
