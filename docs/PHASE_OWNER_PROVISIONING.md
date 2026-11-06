# Phase: Restaurant Owner Provisioning

## Implemented
- Super Admin can use **Invite Owner** on a restaurant row.
- The owner email is the login ID; the owner chooses their password through Supabase's secure invitation flow.
- The server-side Edge Function verifies the caller's JWT and checks `is_platform_admin()` before using the Auth Admin API.
- The function creates the Auth invitation and adds a `restaurant_members` row with role `owner`.
- The service-role key is used only inside the Edge Function and is never shipped to the browser.
- If membership assignment fails, the newly invited Auth user is deleted as a compensating rollback.
- Existing restaurant membership RLS policies continue to scope the Owner to restaurants they belong to.

## Current constraints / release checks
- The first version invites a new email address. If the email already has an Auth account, the UI reports that a new email is needed; attaching an existing account is not yet implemented.
- Invitation delivery depends on Supabase Auth email/SMTP configuration. A successful function response indicates Auth accepted the invitation request, not that the recipient opened it.
- Auth redirect allow-list / Site URL must point to the deployed app so the invite link returns to the login page.
- Owner and Super Admin currently use the same app URL; the role-specific workspace is selected after login. A separate owner-only URL is a later UI task.
- Do not test by inviting a real customer without their permission. Use a controlled test email for end-to-end verification.

## Manual end-to-end test
1. Sign in as Super Admin.
2. Add a test restaurant with status Active.
3. Click **Invite Owner** on that row and enter a controlled test email.
4. Confirm the invitation email arrives and opens the RestaurantOS app.
5. Set the owner's password and sign in.
6. Confirm the role label is **RESTAURANT OWNER** and the restaurant data is limited to the assigned restaurant.
7. Confirm a non-admin account receives a 403 response if it attempts to invoke the invitation function.
