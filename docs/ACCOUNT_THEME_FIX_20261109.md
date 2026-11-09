# Account layout and softer shared palette — 9 November 2026

The previous storefront refresh did not retain the Account form layout rules. Address and support labels consequently rendered inline with native-width controls on mobile. This is a layout regression, independent of the account database.

## Repair

- Account profile, saved addresses, address form and help/support now have independent cards. Every field has a matching label, a bounded full-width control and consistent spacing. At mobile widths the address form has one column; the checkbox keeps its small intended size. Enter in the address form uses the existing validation/save handler.
- Existing account, address and support element IDs, API handlers and authentication checks are retained. No account records, messages or payments were created, deleted or migrated for this repair.
- A shared stylesheet gives Customer, Owner/Admin, delivery verification, business information and test pages a warm stone canvas, cream fields, forest header/navigation, sage cards and restrained terracotta actions. A dark-background logo variant preserves the existing Bite mark.
- Component styles load before the palette, with versioned CSS references and one matching browser theme colour per page.

## Validation

- CUA inspected the actual Account markup through generated local-only, script-free layout previews. All twelve address/support controls at 340px had their label above the field, height at least 49px and widths inside their container. Checkbox width was 19px; horizontal overflow was zero. Customer home and Owner layout previews also had zero horizontal overflow at 340px.
- A 390-by-844 iframe using that same Account markup provided visual review of the address and support layout without any sign-in or user data. These previews are generated only in ignored dist/qa and do not create a production authentication bypass.
- Main text, secondary text, placeholders, header text and primary-button colour pairs were checked for contrast (9.98, 5.37, 4.86, 9.02 and 5.13 respectively).
- Existing static/Owner structure checks and twelve behavioral cases passed locally. Public Chromium CI coverage now verifies all Account label/control positions, control bounds, touch heights, checkbox size, long order-dropdown text, non-white surfaces and local validation at desktop, 390px and 340px. It does not submit addresses or support messages.
