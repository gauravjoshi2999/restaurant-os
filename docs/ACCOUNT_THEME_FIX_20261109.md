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

## Current palette revision — requested later on 9 November

The user rejected the cream/forest palette and requested familiar Zomato/Swiggy-style colours. The current shared stylesheet replaces that palette with food red actions (#d92d3a), orange highlights (#ff5200), a light grey canvas (#f1f2f5), neutral cards/fields and charcoal Owner/Admin navigation. Customer navigation is light with red active states. Green remains only for semantic ratings, availability and success states.

The Customer header uses the original dark-text Bite logo, and the charcoal sidebar uses its neutral light-text variant. All six themed pages have fresh stylesheet versions and matching browser theme colour. Account form layout, IDs, validation, authentication and business handlers are unchanged.

Local visual review covered the public storefront, all twelve Account controls in a 390px frame and the data-free Owner layout. Account controls remained aligned with zero horizontal overflow. Text, secondary text, placeholders, primary buttons, sidebar text and the orange outlet badge have contrast ratios of 14.13, 5.61, 4.65, 4.79, 11.35 and 4.70 respectively. The existing public Chromium suite retains the desktop/390px/340px form regression checks.

Colour references: [Zomato brand book](https://www.zomato.com/content_guidelines.pdf) and [Swiggy brand guidelines](https://www.swiggy.com/corporate/wp-content/uploads/2026/06/Masterbrand-Internal-Guidelines.pdf). Bite retains its own name and logo.
