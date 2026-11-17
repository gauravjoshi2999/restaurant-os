# Hotel bill and checkout workflow

The register requires both ID sides for every new lead/companion ID. A valid front leads directly to the required back step; there is no Skip action. Existing historical stays remain readable and can check out.

An occupied room opens the guest’s khata directly, including contact details. Another room can reuse the same guest and retained ID sides, with its own dates, guests and agreed rent. Linked rooms share a booking panel, combined statement and atomic Checkout all rooms. Each room retains its own numbered invoice for the monthly bill-wise report.

The checkout panel lists pending receipts by amount and method. Owner/manager explicitly chooses Received or Not received. A zero balance does not hide an unverified receipt. Held deposits and guest credits remain visible; they are not silently discarded. These commands preserve the existing transaction, audit, role and idempotency protections.

Housekeeping OFF means an unoccupied, unblocked room is immediately available after checkout. Housekeeping ON retains cleaning/inspection and its task queue. A maintenance block still prevents check-in.

GST is configured by the owner under Billing & GST. A hotel without GST registration uses a plain guest bill. Registered billing adds room/food tax to the total and shows separate CGST and SGST amounts, with service/SAC breakdown. Applying tax to an open bill is audit logged. Issued invoices are immutable. A combined booking statement attaches the individual room invoices and does not create duplicate sales.

The invoice has a Back to Partner control and a print-only clean layout. Internal POS identifiers, private ID copies and account notes are excluded from the guest document.

## Verification

- `scripts/hotel_bill_workflow_browser.py`: 360/390/1440px occupied-room navigation, exact pending-receipt blocker, Not received resolution, successful checkout, housekeeping OFF availability, GST arithmetic and print return button, owner GST setup, linked-room ID/profile reuse and combined collection.
- `scripts/hotel_bill_workflow_pg_test.sql`: real isolated PostgreSQL GST totals, receipt permissions, immutable invoices, linked stays, atomic group checkout/retry, bill-wise GST split, immediate room release and compulsory ID back.
- The existing 25-scenario register suite and existing customer/Owner/private-document/accounting/concurrency suites continue to run. Test records are synthetic; no live receipt, guest ID, checkout or hotel registration is changed for testing.

Current tax references: [official hotel accommodation FAQ](https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=2167151&lang=2&reg=48), [CGST collection/invoice provisions](https://cbic-gst.gov.in/hindi/CGST-bill-e.html), [invoice particulars](https://cbic-gst.gov.in/gst-invoice-rules.html). The owner confirms the hotel’s actual registration and food/extra-charge rate. This setting does not validate registration with a government service.
