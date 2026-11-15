# Bite Owner Feedback — Isolated handler submission/readback evidence
Date: 15 November 2026 (Asia/Kolkata)

## Scope
Task 6.07: exercise the current deployed `bite-owner-feedback` Edge Function's handler with an isolated POST simulation and readback, without writing live customer or restaurant survey data.

## Exact code
- Supabase project `wedbgpybbgsszcmffoha`, deployed function `bite-owner-feedback`, version 4.
- Backend source copied verbatim to `supabase/functions/bite-owner-feedback/index.ts` in commit `7ef9164a47c756b2f5d1a6723209aebc6d93cecd`.
- New reproducible Node 22 isolated regression suite `scripts/owner_feedback_isolated_e2e.test.cjs`, commit `9f9a2c98a46ee4cac443f6494a2a12be2f9e712f`. It executes the versioned Edge source in a VM with `fetch` intercepted to an in-memory simulated storage adapter.

## Direct in-process handler check performed
The deployed Edge source was converted from its limited TypeScript annotations to executable JavaScript in an ephemeral tool isolate. It was run with a simulated Deno environment, a fake server secret, a fake request, and a stubbed `fetch` that **never sent network traffic**.

| Check | Observation |
| --- | --- |
| Valid owner survey | HTTP **201**, `{"ok":true}` |
| In-memory simulated readback | One record, `city=Rajsamand`, `survey_version=2` |
| Phone without contact permission | Saved record's `owner_phone` is `null` |
| Too-short problem story | HTTP **400** |
| Missing privacy agreement | HTTP **400** |
| Missing marketplace platform choice | HTTP **400** |
| Pilot interest without consent | HTTP **400** |
| Request from disallowed origin | HTTP **403** |
| Simulated storage failure | HTTP **503**; no success ACK |
| No production writes | Live `public.bite_owner_feedback` row count was **0** after this check |

Only the accepted simulated response reached mocked storage; validation, origin and simulated storage errors did not create data.

## Test suite coverage added but CI not yet attested
The committed Node 22 test script also contains honeypot, oversubmission/rate-limit and GET/POST mocked adapter cases. The script is included in the existing `node --test scripts/*.test.cjs` QA command. The Node test suite's **GitHub Actions result was not confirmed in this session**; do not equate a committed test file with a passing CI run.

## What this proves and does not prove
**Proves:** The inspected deployed handler logic, using a mocked persistence adapter, can validate a well-formed survey, return success only after a simulated save, redact non-consented phone numbers, and reject several invalid inputs.

**Does not prove:** Real network delivery to the Edge URL; real Supabase REST insertion/readback; a third-party/Android browser; Mail/WhatsApp notification; CDN/cache visibility of today's page; physical device behavior; form autofill; accessibility; actual concurrent rate limits; or an authenticated owner dashboard viewing feedback.

Follow-up task **6.08** needs a browser-based test. A genuine real-network submission should be performed only with an approved test environment or approved non-fake research response, not by polluting real owner feedback with synthetic data.
