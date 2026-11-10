# Decisions and factual inputs needed for launch

Do not send passwords, API secrets, bank account numbers or government-ID images in chat. Configure secrets in the relevant secure provider dashboard. Use restricted document upload only after its acceptance test passes.

| Input / decision | Why it is needed |
| --- | --- |
| Approve the exact reviewed code/migration/Edge release | The supplied execution brief explicitly requires approval before production deployment. A separate market-launch decision remains. |
| Confirm public legal entity/proprietor, business address and customer support contact | The current Contact page contains a name and in-app assistance route, not a complete approved business disclosure. |
| Name the grievance officer and public email/contact | Required grievance mechanism and staffing must be real and approved. |
| Confirm platform/restaurant licences and tax classification with qualified reviewers | Do not invent FSSAI/GST details. Tax invoice responsibility and applicable charges must match Bite's actual e-commerce model. |
| Cashfree merchant and marketplace/Easy Split approval, vendor onboarding/KYC and settlement agreement | Ordinary PG credentials and a paid order do not establish marketplace payout permission or vendor settlement readiness. |
| Reconcile the ₹174 reference against current provider settlement and the merchant bank | Application data alone cannot establish bank credit. Provide the actual status/UTR through an approved secure workflow. |
| Verified sending domain / SMTP configuration and permitted reset redirects | Production signup/recovery delivery needs actual configuration and a user-controlled acceptance test. A free-tier provider must still verify its sender and limits. |
| Approved test account access / sandbox configuration | Needed to certify new authenticated Customer–Owner–Admin journeys without charging real customers. Retired QA logins were not reenabled. |
| Backup/restore evidence and an approved isolated staging environment | Required before broader launch/load/restore testing. Paid database branches and production load are not implicitly approved. |
| Approve public policies, commercial commission/fee/payout terms and a staffed pilot operating window | Drafts and proposed internal playbooks are not signed business agreements or public SLAs. |

No fixed launch date, marketing spend, refund/payout budget or public compliance claim has been invented.
