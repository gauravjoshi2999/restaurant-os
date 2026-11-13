# BITE — Multi-Restaurant Isolation & Workflow QA
**Checked:** 2026-11-13 (Asia/Kolkata)  
**Repository:** `gauravjoshi2999/restaurant-os`  
**Scope:** Existing customer and Partner flows; isolated synthetic 2-restaurant runtime tests; read-only Supabase production policy and configuration inspection.

## Automated result
- **PASS:** GitHub [Bite QA #43359973704](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43359973704) at commit `83cb35b9cd207828bfabe38d902c253c3fd2943f`.
- **Node tests:** 139 passed, 0 failed. Chromium browser smoke/completion workflow passed.
- New reproducible suite: `scripts/multi_restaurant_isolation.test.cjs`, executed in the normal GitHub QA workflow. Synthetic restaurants A/B, owners A/B, their device tokens and order events are created in-memory; **no live database, payment gateway or Firebase state is modified** by these tests.

## Two-restaurant behavior matrix
| Assertion | Method | Result |
| --- | --- | --- |
| Owner A registers an FCM token for Restaurant A | Execute actual registration Edge Function with mocked auth and DB | PASS |
| Owner A denied for Restaurant B | Execute actual registration Edge Function | PASS |
| Owner B denied registering/unregistering A's token | Execute actual registration Edge Function | PASS |
| Paid eligible order A pushes to A's device and never B's | Execute actual dispatcher with isolated fake Postgres and fake Google FCM endpoints | PASS |
| Event claims A but actual order is B | Execute actual dispatcher; zero push | PASS |
| Unpaid order A | Execute actual dispatcher; zero push | PASS |
| Duplicate owner mapping for A | Execute actual dispatcher; zero push | PASS |
| Unauthorized dispatcher request | Execute actual dispatcher; HTTP 403, zero push | PASS |
| Customer live checkout session ownership, per-restaurant context | Source guard checks + existing checkout tests | PASS for implemented checks |
| Owner notification action guards | Actual owner-side source assertions + read-only deployed SQL function inspection | PASS for implemented checks |
| Delivery handoff scoped to authenticated restaurant owner | Read-only deployed `create_delivery_handoff` SQL function inspection + existing regression source | Guard present (not live two-owner exercise) |

## Production read-only checks
- **Restaurants:** 11 total, 6 approved/active/published.
- **Owner assignments:** 5 restaurants have owner mappings; 0 duplicated restaurant-owner assignments; 0 accounts assigned as owner across multiple restaurants.
- **Notifications:** 1 enabled FCM device serving 1 restaurant. Other owners cannot be assumed to receive push notifications until their Partner device registers.
- **RLS:** Enabled on `restaurants`, `restaurant_members`, `orders`, `order_items`, `order_financials`, `bite_owner_push_devices`, and `bite_owner_push_events`. Every checked `restaurant_*` base table has RLS enabled.
- **Server order action:** `bite_owner_notification_order_action` checks current `auth.uid()`, restaurant-owner membership, matching order ID **and** restaurant ID, actual paid status, and `Received` status.
- **Server delivery handoff:** `create_delivery_handoff` is a SECURITY DEFINER function with an explicit `has_restaurant_role(v_order.restaurant_id, array['owner'])` guard. Such functions warrant continuing security review when changed.
- **Last 7 days of push outbox at audit:** 3 events, 2 marked sent, 1 failed. "Sent" means processed by the server/provider and does **not** prove Android display/audio.

## Limitations / real device verification
This run is a **multi-tenant automated regression QA and production configuration audit**, not proof of a second owner successfully receiving a phone notification or of two real paid/fulfilled orders. To claim end-to-end production success for a newly onboarded restaurant, verify with a second authorized owner account and registered Android device, then run a consented legitimate paid order, confirm owner actions/status, and complete handoff/OTP. Avoid test payments on the live gateway unless explicitly required and authorized. Existing payment webhooks and settlement paths were not modified.

## Onboarding gate for each new restaurant
Verify exactly one owner mapping, owner account login, registered Partner push token and notifications permission, published menu and operational hours, delivery zone, Cashfree setup where applicable, and handoff workflow. Repeat the automated QA suite on every main-branch change.
