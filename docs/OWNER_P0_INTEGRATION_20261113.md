# Owner P0 combined integration — test branch only

Prepared on main commit `49df497145d71c32cf3e5cca5f0c8db1b3fc9b5f`; includes source Draft PRs #14, #16, #18, #20 and #23.

## Scope
- Owner mobile navigation and one-tap POS (#14)
- Idempotent POS payment retries (#16)
- Offline POS draft lifecycle (#18)
- Owner Cash Closing review/confirmation (#20)
- Seven-source cashbook closing serialization migration plus database tests (#23)

## Conflict handling
The current main branch contains owner-menu-options CSS/JS added after source PR baselines. These files were preserved when inserting mobile navigation and closing scripts. All Chromium smoke commands from the source PRs were combined. Financial and Owner source patches were applied against existing main code, not by overwriting main's whole index.html.

## Release gates — do NOT merge or deploy before approval
1. All GitHub Actions static JS/Chromium/PostgreSQL fixture and two-session locking tests green.
2. Owner Android hardware test: persistent sign-in, nav/scroll and real order notifications; test editing/deleting drafts.
3. Isolated staging on a copy of existing Supabase schema, RLS and triggers: payment methods, khata, refunds, staff, expenses, purchases and two-session cash closing; validate Owner/Staff/cross-restaurant roles.
4. Verify live Cashfree checkout and order flow unaffected using authorized safe testing. No settlement claims based on sandbox.
5. Back up DB, review migration, explicitly approve production SQL apply and merge/deployment separately.

This PR is a synthetic integration candidate and remains Draft; no changes to production DB or website.
