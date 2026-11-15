# Bite — Customer Location / PIN Reliability Fix
Date: 2026-11-15

## Root cause, verified against production
- Public restaurant discovery uses Supabase `bite_storefront(p_postal_code)` and server-validated restaurant delivery PIN zones, not Google Maps itself.
- Published, active delivery-zone rows in the current Supabase project list **313324 only** (4 restaurants). A guessed `313300` postcode is **not** an authorized delivery service area.
- The existing **Near me** button requested browser GPS but only sorted restaurants by distance. It did not set or verify delivery ZIP.
- Customer checkout uses Leaflet/OpenStreetMap for the map and Nominatim for reverse-geocoded addresses. Nominatim can suggest an approximate neighboring postal code. Its guess previously replaced the checkout postal input without regard to the existing 313324 PIN.

## Shipped fix, deliberately no billing or data migration
1. **On signed-in first use with no delivery PIN**, open the existing mobile location sheet with two choices: explicit `Find restaurants near me` permission action or entering a 6-digit delivery PIN. Do not call geolocation automatically before the user's tap.
2. When a signed-in user has a PIN for which no displayed restaurant delivers but pickup is available, give a one-time prompt to update their location/PIN. Avoid repeated dialogs in the same browser session.
3. On manual GPS permission, retain coordinates in volatile client memory for distance ordering. Browser denial/timeout offers a manual PIN fallback. Never silently change stored PIN.
4. When GPS is available and stored PIN is out of range, show nearby **pickup-capable restaurants** under All restaurants, without granting delivery eligibility, displaying a verified delivery fee, or bypassing checkout serviceability checks. Explicit Delivery filter remains strict.
5. For checkout map geocoding, preserve any nonempty customer-entered delivery PIN. When Nominatim suggests another 6-digit PIN (e.g. 313300 vs confirmed 313324), show both numbers and ask the customer to verify; never overwrite the existing PIN.
6. Existing server-side checkout/geofence, RLS, authentication, owner/admin, and payment flows are unchanged.

## Why Google Maps alone will not resolve all postal mismatches
GPS coordinates and a map's reverse-geocoded postal code are not the same as an India Post-delivery/serviceable postal-code boundary. Even Google warns reverse geocoding is an approximation. The secure approach is GPS coordinates for proximity, a **customer-confirmed PIN**, and a separate restaurant-authorized delivery-zone check at checkout.

## Google Maps integration when the owner enables billing
**Not enabled in this release.** Google OAuth Client ID/Secret are not Google Maps API keys.
1. Google Cloud Console > APIs & Services: link a billing account and enable **Maps JavaScript API**, and the appropriate Geocoding service for map reverse lookup. Optional: Places API (New) for address suggestions.
2. Create a **new browser API key** restricted by *Websites* to `https://gauravjoshi2999.github.io/*` (and any later approved domain). Restrict allowed APIs only to what Bite uses; configure billing budget alerts and quotas. **Do not** reuse OAuth Client Secret or a privileged server key.
3. Integrate Google Maps map picker/Geocoder behind a feature flag, retaining the same manual PIN confirmation. Set up an accurate session/usage budget and test live Android Chrome + APK separately before cutover.
4. Keep the existing current map until a restricted Google Maps key and billing approval are confirmed; do not silently create paid Google Cloud resources.

## Acceptance checks
- With no PIN, sign in: customer sees the location sheet once and can deny GPS but still set a PIN.
- Test 313324: live delivery-eligible restaurants remain available.
- Test 313300: no ineligible delivery; use GPS to view nearby pickup-only alternatives or change to confirmed 313324.
- Simulate reverse-geocode `address.postcode='313300'` with input `313324`: existing PIN is preserved and mismatch explained.
- Continue to validate checkout from server-side restaurant zone and PIN; no fake payment/automatic order.

References:
- https://developers.google.com/maps/documentation/geocoding/reverse-geocoding
- https://developers.google.com/maps/documentation/javascript/get-api-key
- https://developers.google.com/maps/api-security-best-practices
- https://developers.google.com/maps/billing-and-pricing/india
- https://operations.osmfoundation.org/policies/nominatim/
