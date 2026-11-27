# BITE owner accounts and launch acceptance

This release candidate covers three owner tasks. Wider launch acceptance remains open. Use the current main release and a consenting pilot property for the operator checks. Record the release SHA, device, property type, business date and result without guest identifiers.

| Owner task | Implemented in this batch | Operator acceptance |
| --- | --- | --- |
| Find a receipt and close the drawer | Search Cashbook by description, category, reference or method. Narrow the list to money received or paid. Headline figures and closing retain the full day. | On a normal trading day, find a POS receipt, a UPI collection and a cash expense. Compare opening cash plus cash received less cash paid with the physical drawer. Any difference needs its reason before the owner confirms closing. |
| Review a busy day | Daily Book opens the selected date from a month or range. Recent dates appear first. Mobile shows date, sales and recorded profit or loss; opening the date shows expenses, staff advances and balances. | Trace one room advance, the eventual checkout and a POS receipt using their actual dates. Confirm an advance or room-linked sale appears once on the relevant basis. Compare the daily result with the period export. |
| Explain a report total | Business Reports offers Today and This month, includes every recorded payment method, and expands each date into the contributing money movements. | Reconcile daily inflows and outflows to the method breakdown and CSV for the same restaurant, dates and demo exclusions. Verify a nonstandard method and a refund. Bank settlement requires provider evidence. |

## Product decisions

- Loyverse distinguishes counted cash from expected cash during shift closing. BITE keeps its existing drawer calculation and owner confirmation. Filtering the list only changes which entries the operator sees. [Loyverse shift reports](https://help.loyverse.com/help/shift-report-sales-summary-pos)
- Tally lets an operator work from a period to individual vouchers. BITE uses date drill-down and entry search within its existing reports. [Tally Day Book](https://help.tallysolutions.com/day-book-in-tally-ebilling/)
- Cloudbeds separates revenue, receipts and balances on a selected date. BITE keeps service dates and receipt dates visible and keeps historical imports separate from live account movements. [Cloudbeds Daily Revenue Report](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/25917112285723-Daily-Revenue-Report)

## Remaining commercial launch evidence

| Workstream | Evidence needed for a launch decision |
| --- | --- |
| Owner, staff and customer journeys | Signed-in restaurant, hotel and hybrid workflows on operators’ phones. Record the first failed step and the outcome after correction. Include role restrictions, check-in recovery, order fulfilment, sharing and exports. |
| Money and settlements | Reconcile POS, hotel folio, cashbook, expense, partial payment, refund and provider settlement against the applicable source. Keep uncertain amounts visible. Use a test environment for simulated money movement. |
| Menu channels | Complete the isolated migration rehearsal and role, checkout, POS, room and QR acceptance for the existing channel-control draft before production rollout. |
| Plans and entitlements | Resolve trial and renewal dates, purchased recharge expiry, grace and migration of existing properties. Test limits and retries for the current plan version and confirm paid terms before activation. |
| Reliability and support | Exercise offline interruption, retry, session expiry, restore and support escalation using a pilot build. Verify existing records and financial obligations stay available after recovery. |
| Pilot economics | Track activation, time to first bill, day-close discrepancies, support minutes, collection fees, infrastructure costs and willingness to renew over the planned 20–30-business pilot. Use measured costs and paid retention in the commercial decision. |

[Technical completion tracker](../BITE_MASTER_COMPLETION_TRACKER.md) · [Owner usability review](UAT002_OWNER_SIMPLE_LANGUAGE.md)
