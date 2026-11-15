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

## Verified result — 16 November 2026
- GitHub pull request [#116](https://github.com/gauravjoshi2999/restaurant-os/pull/116) merged after full Bite QA success.
- **Bite QA run [#935](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43775876100): SUCCESS** (head SHA `28f6deca3c56c430aa8c6ccc1e3a2fa69f460dac`).
- Job `static-qa`: SUCCESS, including `Run Chromium customer journey smoke tests` and `Upload synthetic QA evidence`.
- Job `cashbook-postgres-qa`: SUCCESS.
- Logs explicitly show `python scripts/owner_feedback_mobile_browser.py` executed, `PASS: owner feedback mobile browser suite; zero real API submissions`, and check lines for all widths **320, 390, 430 px**.
- Simulated HTTP `200` with `ok:false` and HTTP `503` were rejected without showing success; mock `201` with `ok:true` produced the thank-you. Invalid fields, consent gates, repeated navigation, payload fields, no browser errors, and zero external requests all passed.
- Artifact `bite-ui-qa-ac1bc08e00a49feb99aaa5455b43b697d339d900` contains the synthetic QA evidence file and the mobile screenshot, according to the workflow artifact response.
- Live Supabase `public.bite_owner_feedback` row count **0** after automated QA.

**Limit:** This is real Chromium execution of the actual repository HTML with a mocked endpoint at emulated phone dimensions. It does not prove physical Android WebView/Chrome behavior or a real network POST/DB insert. Those remain a separate acceptance task; do not claim the survey is certified on an actual customer's Android device.
