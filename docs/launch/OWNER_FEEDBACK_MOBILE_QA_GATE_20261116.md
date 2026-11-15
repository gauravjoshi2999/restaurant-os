# Owner Feedback — Mobile Chromium QA gate (16 Nov 2026)

**Purpose:** Independently verify the newly added `scripts/owner_feedback_mobile_browser.py` against the real `owner-feedback.html` source in GitHub Actions Chromium on simulated phone viewports **320, 390 and 430 pixels**.

This Pull Request is a QA evidence trigger; the browser test and workflow inclusion were already committed on main. Its CI `Bite QA` check runs the same source code without accepting real customer submissions.

## Acceptance
- Four-step validation, previous/next data retention, exclusive selections, contact consent/phone gating.
- Clear error on HTTP 200 with `ok:false` and HTTP 503; retry succeeds only with 201 + `ok:true`.
- No horizontal overflow at all three tested sizes, no browser JS errors, no external network writes.
- Synthetic request is intercepted before it reaches Supabase; real response count must remain unchanged.
- Actual device/real endpoint POST are **not** verified by emulation.

**Release impact:** No restaurant, menu, money, authentication, live feedback or deployment configuration change. Do not consider commercial launch authorized because this PR passes.

**Evidence:** GitHub Actions job logs and `dist/launch-qa/owner-feedback-mobile-evidence.json` artifact (and `ui-owner-feedback-390.png`) if the job passes.
