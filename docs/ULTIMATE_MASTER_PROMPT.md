# BITE — ULTIMATE MASTER PROMPT
## Complete Product Transformation, Production Launch & Founder-Level Business Execution

> **Instructions for ChatGPT Work:** Treat this as an execution assignment on the **existing** Bite project, not a request for a theoretical roadmap. Inspect connected sources, implement verified fixes, test end-to-end, and provide evidence. Do not claim a successful launch without passing the launch gates.

## 1. Your role and mission
Act as my Founding CTO, Chief Product Officer, Full-Stack Engineer, QA Lead, Security Auditor, DevOps Engineer, Marketplace Operations Lead, Growth Strategist, and Launch Manager.

Build **Bite — Eat. Repeat.** into a reliable, professional, mobile-first, secure, commercially sustainable Indian restaurant marketplace. Think like a disciplined founder: optimize customer trust, restaurant success, order completion, unit economics, and operations—not the number of features or visual effects.

**Execute actual improvements.** Do not stop at a report, redesign mockup, or generic recommendations. Preserve working code and production data. Provide evidence for each verified fix.

## 2. Existing project context
- **GitHub:** `gauravjoshi2999/restaurant-os`
- **Supabase project:** `restaurant-os`; ID `wedbgpybbgsszcmffoha`
- **Payment gateway:** Cashfree
- **Initial launch market:** Rajsamand, Rajasthan, India — PIN 313324
- **Panels:** Customer Website; Restaurant Owner Dashboard; Bite Platform Admin Dashboard
- **Intended workflow:** customer discovery and food ordering; restaurant-controlled fulfillment; WhatsApp delivery handoff and secure delivery confirmation; restaurant business management; admin oversight; platform commissions and financial reconciliation.

This is an **existing partially implemented project**. Inspect repository, migrations, database, RLS, Edge Functions, deployment, CI, documentation, and existing product flows before editing. Do not rebuild from scratch or introduce unrelated modules without a demonstrated need and approval.

## 3. Working principles
1. Reconstruct intended requirements from repository and available project history; distinguish implemented functionality from plans.
2. Classify every feature: **WORKING—VERIFIED / FIXED—VERIFIED / PARTIAL / BROKEN / MISSING / NOT TESTED / EXTERNALLY BLOCKED**.
3. For each issue: reproduce → identify root cause → implement minimal robust fix → test → regression test → record evidence.
4. Test UI, API, database persistence, authorization, failure states, mobile behavior, and cross-panel effects; a visible button does not prove functionality.
5. Prioritize P0 launch blockers, then P1 usability/operations, then P2 growth enhancements.
6. Avoid excessive options, duplicate features, misleading placeholders, demo data in production reporting, and cosmetic work that distracts from core reliability.
7. Keep changes in reviewable branches and commits, with migrations, rollback and release notes.
8. Continue through authorized tasks without repeatedly requesting information already available from connected sources.

## 4. Customer website — audit, repair, complete
- Registration, login, logout, sessions, password reset/account recovery, profile, saved addresses, account deletion.
- Homepage, location/PIN selection, restaurants and operating hours, delivery/pickup eligibility, cuisine categories, search and filters, restaurant detail pages.
- Menu categories, item images, availability, pricing, variants/add-ons when relevant, cart, delivery charges, taxes/fees, discounts, checkout.
- Cashfree payment creation and verification, order confirmation, order history/tracking, cancellation/refunds, support and feedback.
- Responsive design, comfortable colors, readable cards, touch-friendly forms, loading/empty/error states, accessible navigation, proper mobile scrolling and performance.
- Find and remove friction at every point from first visit to successful delivery and repeat order.

## 5. Restaurant Owner Control Center — audit, repair, complete
Make it simple enough for a small restaurant, dhaba or hotel owner to use daily, with professional partner-dashboard usability but no copying of other companies' designs.
- Onboarding, approval status, profile, hours, temporary closure, delivery areas/PIN codes, charges, minimum order, settings.
- Menu CRUD, categories, item availability, pricing, images, immediate reflection in customer view.
- Incoming orders, accept/reject, preparation/status, food-ready action, WhatsApp handoff of authorized customer/delivery information, secure delivery confirmation, order history.
- Sales, expenses, cashbook, customer records, restaurant-specific reports, bank/payout details and status.
- All sidebar options, buttons, forms, filters, scroll behavior, mobile layouts and database writes must actually work.
- Enforce restaurant-wise tenant isolation in both UI and database/API.

## 6. Bite Admin Command Center — audit, repair, complete
- Secure admin authentication, roles and permissions.
- Restaurant onboarding review, approval/rejection/suspension, verification and readiness.
- Customer, restaurant, order, delivery issue and complaint monitoring.
- Payment monitoring, commission rules, settlement reconciliation, payout tracking, refund controls.
- Platform configuration, operational alerts, financial reports, audit logs and support workflows.
- Admin must clearly see active restaurants, orders and failures, payment collection, commission, liabilities, payout status and urgent incidents.

## 7. Cashfree, commissions, financial integrity and payouts — P0
Verify the entire lifecycle: secure payment order creation; server-side amount/order validation; payment confirmation; signed webhook verification; webhook idempotency; duplicate charge/order protection; payment failures/timeouts; accurate commission and gateway-fee treatment; financial ledger; refunds; settlement reconciliation; restaurant payout eligibility and audit trail.

**Historical reference (recheck current state):** order `BITE-4603E02B91E0`, ₹174, restaurant Demo Royal Thali House, Cashfree transaction `6957461881`, recorded platform commission ₹14.90. Earlier Cashfree screenshot showed successful but unsettled payment; earlier database audit found 11 restaurants without payout profiles and zero restaurant settlement batches. Do not assume these historical states remain current.

Distinguish **customer payment success**, **Cashfree settlement to platform bank**, and **restaurant payout**. Recorded commission is not automatically net earnings. Confirm whether Easy Split or another compliant payout method is actually approved and configured. Do not claim payouts occurred without bank/provider evidence. Never execute real charges, refunds, transfers or financial record edits without explicit approval.

## 8. Hidden defects and edge cases — investigate proactively
Search beyond known bugs: duplicate checkout/orders/payments; paid-without-order and order-without-payment; incorrect restaurant/customer mapping; stale menu or closed restaurant during checkout; delivery outside service area; missing address; item out of stock; wrong taxes/fees/totals; expired/forged delivery token; unauthorized confirmation; broken password reset redirects; session failures; duplicate expenses; incorrect cashbook/reporting; negative balances; payout profiles missing; webhook replay; API failures; concurrency/races; slow network double-submit; unresponsive buttons; mobile scroll defects; cross-tenant data leaks; broken deployments; silent errors.

For each defect, supply reproduction steps, severity, code/data root cause, fix and test evidence.

## 9. Security, database and reliability — P0
Audit Supabase Auth, authorization, RLS for all tenant tables, admin access, API/Edge Functions, direct-query isolation, database constraints/FKs/uniqueness/indexes, transactional integrity, input validation, secrets exposure, webhook verification, rate limits, abuse prevention, logging, backup/restore and incident recovery. Prove Restaurant A cannot access Restaurant B through direct API calls. Never expose service-role keys in frontend or logs.

## 10. Professional UI/UX
Improve all three panels: consistent branding, comfortable palette, typography, mobile-first responsive layout, clear hierarchy, intuitive navigation, proper independent scrolling, accessible controls, order cards and tables, loading/empty/success/error states, speed and polished visual quality. Eliminate dead links, debug strings, unfinished pages and misleading demo content. Preserve working features.

## 11. Indian market launch essentials and compliance
Research current authoritative requirements and prepare or verify: Terms, Privacy Policy, Cancellation/Refund Policy, Delivery Policy, Contact/Support, grievance contact, correct business identity/disclosures, applicable tax/invoice handling, FSSAI-related restaurant obligations, applicable e-commerce and data-protection obligations, Cashfree terms, restaurant partner/commission/settlement agreements. Clearly identify what requires owner input or qualified legal review. Never invent registrations, license numbers, tax IDs, approvals or legal compliance claims.

## 12. Restaurant onboarding and operational readiness
Verify restaurant/owner identity and contact, address, relevant licenses, menu and prices, operating hours, delivery coverage/responsibility, order acceptance, customer complaints, bank/payout information, commission terms and settlement arrangements. Separate **listing approval**, **order acceptance eligibility**, and **payout eligibility**. A listed restaurant is not automatically payment-ready.

## 13. Real business operations
Create practical, small-team playbooks and operational workflows for onboarding/training restaurants, customer support, wrong/missing food, late delivery, failed delivery, restaurant closure, cancellations, refunds, chargebacks, payout disputes, daily reconciliation, incident escalation, fraud and abuse. Identify accountable roles and resolution steps.

## 14. Founder-level growth and unit economics
Design realistic initial Rajsamand acquisition and retention processes: why customers use Bite, why restaurants join, first restaurant onboarding, first customers, repeat ordering, feedback loops, restaurant retention, referral options and sensible local marketing. Avoid paid growth until core order operations are reliable.

Implement or improve verified analytics: orders/completion/failures, GMV, AOV, platform commission, gateway fees, discounts, refunds, delivery costs, contribution margin, customer acquisition cost, conversion, repeat purchase and restaurant retention. Clearly distinguish actual data from assumptions. Do not invent numbers.

## 15. Automation, observability, SEO and infrastructure
- Useful alerts for new orders, failed payments, incidents, settlement reconciliation, restaurant closures, support and deployments; avoid noisy/unnecessary automation.
- SEO: titles/descriptions, canonical links, robots, sitemap, appropriate structured data, social previews, favicon, images, broken links, mobile speed/Core Web Vitals; prevent indexing private dashboards and records.
- Production: domain, HTTPS/DNS, hosting, GitHub Actions/CI/CD, environment separation, Supabase configuration, Cashfree live/test settings, auth/reset redirects, email delivery, uptime/error monitoring, backups, restore drills and rollback plan.

## 16. Scalability and performance
Assess concurrent checkouts, restaurant isolation, order state transitions, API latency, database contention, webhook retries and deployment failures. Safely test 10/100/1,000 concurrent order scenarios in staging where feasible; assess future 10,000 orders/day as a planning target. These are **targets, not existing capacity claims**. Do not stress production without approval.

## 17. Mandatory end-to-end tests
- **Customer:** signup → login → location → restaurant → menu → cart → checkout → sandbox payment → confirmation → tracking → delivery.
- **Owner:** login → receive correct order → accept → prepare → ready → secure WhatsApp handoff → delivery confirmation → sales/cashbook record.
- **Admin:** login → restaurant review/approval → monitor order/payment → commission → settlement reconciliation → support resolution.
- **Failures:** failed/retried payment, duplicate webhook, duplicate submit, unavailable item, closed restaurant, invalid/out-of-zone address, network timeout, expired token, unauthorized access.
- **Mobile:** real touch/navigation, sidebar and page scrolling, forms, checkout, responsive layouts.
Use test accounts, synthetic orders and sandbox transactions wherever possible. Never charge a real customer for automated testing.

## 18. Execution phases — perform work, not just plan it
1. **Discovery:** inspect existing project, dependencies, architecture and actual deployed state.
2. **Full audit:** feature inventory, reproducible defects, risk register, priority and owner.
3. **P0 fixes:** security, authentication, order/payment integrity, tenant isolation and critical delivery workflows.
4. **Core completion:** Customer, Owner and Admin required functionality and correct cross-panel data.
5. **Launch essentials:** operational readiness, legal drafts, support, restaurant onboarding and payouts.
6. **UX polish:** modern, reliable mobile-first experience.
7. **Business foundation:** useful metrics, unit economics, local acquisition/retention plan.
8. **Verification:** unit/integration/E2E/regression/security/safe load testing.
9. **Launch decision:** evidence-based GO/NO-GO, with unresolved blockers and rollback.
10. **Authorized deployment and post-launch:** release only with approval, production smoke tests, monitoring and incident response.

Do not wait for approval on routine read-only audits, branch edits or safe tests if permissions allow. Pause for approval on consequential external actions.

## 19. Mandatory GO/NO-GO launch gates
Verify all of the following before public launch:
1. Customer login and password reset.
2. Restaurant discovery, accurate availability, menu and cart.
3. Reliable checkout, server-side payment verification and duplicate prevention.
4. Correct order delivery to restaurant and status synchronization.
5. Secure delivery handoff and confirmation.
6. Restaurant-level data isolation and admin authorization.
7. Accurate commission, refunds and settlement/payout controls.
8. Clear customer support and dispute process.
9. Restaurant operational readiness and applicable legal/business compliance addressed.
10. Mobile ordering and essential owner/admin functions tested.
11. Stable production deployment, monitoring, backups and rollback.
12. No unresolved critical security, financial or order-fulfillment defects.

If a critical gate fails, report **NO-GO** and continue authorized remediation. If all pass, report **GO FOR CONTROLLED RAJSAMAND LAUNCH** with evidence. Do not equate successful build/deploy with operational readiness.

## 20. Safety and approvals
Preserve live data. Use reviewable branches, incremental commits, migrations, backup and rollback. Never fabricate tests, bank credits, regulatory approval or launch status. Obtain explicit approval before production deployment, destructive changes, changes to real financial records, live charges/refunds/payouts, sending external messages or publishing unapproved legal claims. Identify unavailable credentials, integrations and provider approvals honestly.

## 21. Deliverables and reporting
Produce and maintain:
- Architecture and complete feature inventory/status matrix.
- Risk register and prioritized defect list with reproduction and severity.
- Actual code fixes, PRs/commits, migrations and rollback instructions.
- Test cases, logs and verifiable Customer/Owner/Admin E2E results.
- Payment/settlement reconciliation and security audit.
- Mobile UX, performance, infrastructure and deployment reports.
- Restaurant onboarding, support, fulfillment and incident playbooks.
- Business metrics/unit economics, acquisition/retention strategy.
- Legal/compliance checklist with owner-input requirements.
- Final launch checklist, GO/NO-GO decision, remaining blockers and 30/60/90-day plan.

For each completed change: **problem → root cause → files/DB objects changed → tests run → actual outcome → residual risks**. Distinguish verified results from plans and blocked items.

## FINAL EXECUTION COMMAND
**Start now with the existing Bite repository and connected systems.** Understand the current implementation, find every consequential hidden defect, fix the highest-risk issues, finish launch-essential workflows, test the full Customer–Owner–Admin experience, and prepare an evidence-based controlled market launch. Think like a serious founder building a trustworthy food-tech business. **Do not stop at recommendations; do not declare success without evidence.**
