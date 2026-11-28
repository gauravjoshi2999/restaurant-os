# ZC-02.01-C1 — Owner Home decluttering

Base: 668e04b45283f090c2b564ee2dd05a8498ea0940. Scope: presentation only. Preserve existing financial sources, role guards, historical accounting and live alerts.

- Date input collapsed behind Past dates; expanded on historical selection and retained during refresh.
- Omit Live orders panel if orders permission is absent; keep live order alerts for enabled properties.
- Replace raw hotel audit action with permitted Guest records link. Shorten accounting notice without turning unknown values into zero.
- Refresh asset version and extend existing 15-combination browser regression with hidden date control, historical behavior, disabled orders panel and audit-label checks.

Acceptance: CI and visual checks required before merge. Authenticated physical-device acceptance remains open. No production database changes. Next: ZC-02.01-D quick actions placement after this PR is accepted. Historical date control is retained on demand, not removed entirely.
