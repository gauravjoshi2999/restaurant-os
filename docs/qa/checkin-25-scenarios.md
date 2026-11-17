# Check-in: 25 operational scenarios

The manager and guest perspectives were exercised using the production controllers with clearly marked synthetic browser data. Database tests run in disposable PostgreSQL and roll back their records. No guest, ID, booking, payment or advance is created for QA in production.

## Findings and changes

- Occupied rooms were selectable because the picker only excluded inactive/blocked rooms. Check-in now checks physical occupation, reservation dates, readiness and adjacent-stay timing. A future reservation may use a room after the present guest leaves. The server remains authoritative when staff compete for a room.
- The last local draft silently filled a new check-in. Guest fields now start empty, with explicit Resume / Start fresh. Completed, cancelled and expired drafts are discarded. Unknown server responses must be reconciled before a fresh send; a serialized request tombstone prevents a late old send creating a ghost booking.
- Background refresh could replace a blurred form and lose selected photo files. Availability refresh now updates room choices without replacing the form. Submission locks edits while a quote or upload is in progress.
- Normal camera photos can exceed the private 4 MB storage limit. JPEG/PNG photos up to 24 MB are resized on the device; real contents determine safe MIME normalization. The storage limit stays 4 MB. Invalid replacements preserve the previous valid front. Back can be skipped directly; companions retain separate named ID slots.
- Foreign / OCI guest opens a separate conditional form, including nationality, birth date, travel document last four characters, validity, visa/OCI/exemption and India arrival details. The same option works for a named companion. Switching to the Indian guest form removes foreign-only validation. Full document numbers are kept out of text fields and bills; private ID copies keep their existing access controls.

## Scenario matrix

| ID | Situation | Expected result | Evidence |
|---|---|---|---|
| S01 | Walk-in with no previous entry | Blank guest/rent, current India date/time, one stay and khata | Browser |
| S02 | Unfinished earlier draft | Explicit Resume or empty Start fresh | Browser + unit |
| S03 | Draft belongs to a completed stay | Old identity is not restored | Browser + unit |
| S04 | Earlier guest is overdue and still in the room | Occupied room disabled despite expired booking dates | Browser + unit |
| S05 | Another guest reserved the same dates | Reserved room disabled with reason | Browser + SQL |
| S06 | Room occupied now but free for a later booking | Future reservation remains possible | Browser + unit |
| S07 | All vacant rooms await release | Clear empty state and explicit manager release; housekeeping OFF respected | Browser |
| S08 | Dates, room or booking mode change | Keep name, negotiated rent and photo files | Browser |
| S09 | Another staff member takes the room after review | Server rejects loser; no extra folio or advance | Browser + SQL + existing concurrent SQL suite |
| S10 | Family negotiates a different rate | Current counts and rent are independent of old room presets | Browser + SQL |
| S11 | Required value missing / departure wrong | Focus and scroll to inline field error on mobile | Browser at 360px + existing 360/390/1440px suite |
| S12 | Check-in just after India midnight | India calendar date and arrival time agree | Browser |
| S13 | Returning guest searched by name/mobile | Profile/travel autofill, fresh current stay terms | Browser |
| S14 | Two people share a name / selected identity edited | Distinct phone suggestions; changed identity detaches old profile | Browser |
| S15 | Foreign guest with incomplete/expired details | Dedicated form, correct field errors, scoped metadata saved | Browser + SQL |
| S16 | OCI, visa exemption, non-passport no-expiry document, domestic switch | Conditional fields match permission/document choice | Browser + SQL + unit |
| S17 | Camera/file chooser cancelled | No false success; upload fallback remains available | Browser |
| S18 | Camera photo above 4 MB | Local resized JPEG within private storage limit | Browser |
| S19 | Missing MIME / file renamed as an image | Normalize genuine image; reject invalid contents without losing previous photo | Browser + unit |
| S20 | PDF front, no back available | Front accepted and back skipped without forced camera | Browser |
| S21 | Retake front after both sides were selected | Clear the corresponding old back only after a valid replacement | Browser |
| S22 | Three guests, separate IDs, one foreign companion | Named ID subjects saved independently; backs optional | Browser + existing SQL party suite |
| S23 | Thirty-second polling / connection returns | Form and actual File objects survive refresh | Browser |
| S24 | Cash / unverified UPI / verified UPI advance | Review and ledger preserve confirmed vs pending distinction and account note | Browser + existing accounting SQL suite |
| S25 | Lost booking response, safe fresh start, interrupted ID finish | Resume one booking/advance; tombstone late old send; reuse upload UUID | Browser + SQL |

## Repeatable checks

```sh
node --test scripts/*.test.cjs
python scripts/checkin_scenarios_browser.py
python scripts/hotel_accounts_browser.py
psql -v ON_ERROR_STOP=1 -f supabase/hotel_checkin_scenarios.sql
psql -v ON_ERROR_STOP=1 -f scripts/checkin_scenarios_pg_test.sql
```

The SQL commands require the isolated CI fixtures and preceding migrations in `.github/workflows/qa.yml`; they are not instructions to seed production. Browser evidence is `checkin-25-scenarios-evidence.json` in the workflow artifact. Release outcomes are recorded in the pull request after the actual runs.

## Scope limits

Chromium exercises the actual file chooser, rear-camera capture hint, cancellation, upload, preview and resizing code. Physical Android camera apps, lens permissions and device-specific HEIC output require a real-device check; this test does not claim that hardware was exercised. HEIC shows an actionable JPEG/PNG conversion message.

The foreign form is a hotel register entry, not submission to the government. Current official context: [OCI FAQs](https://www.ociservices.gov.in/onlineOCI/onlineOCI/faq), [government accommodation reporting notice](https://dipr.mizoram.gov.in/post/compliance-with-the-immigration-and-foreigners-act-2025-and-the-protected-area-permit-requirements-in-respect-of-foreign-nationals-staying-in-accommodation-units-regarding), and [official Form III accommodation portal](https://indianfrro.gov.in/frro/FormC/login.isp). The UI explicitly links the separate reporting portal and makes no filing-success claim.
