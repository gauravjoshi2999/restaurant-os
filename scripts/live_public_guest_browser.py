#!/usr/bin/env python3
"""Bite production GUEST browser acceptance (no login, order, payment or writes).

Run only after a release has passed the exact live-file hash attestation.
This is a public-read-only smoke test; authenticated flows still need a real
test identity, phone and provider-confirmed payment.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from urllib.parse import urlsplit

SITE = "https://gauravjoshi2999.github.io/restaurant-os/"
READ_ONLY_RPCS = frozenset({
    "bite_storefront", "list_public_restaurants", "check_restaurant_delivery_area",
})


def allow_request(url: str, method: str) -> bool:
    """Fail closed on every authenticated, financial or data-changing request."""
    u = urlsplit(url)
    method = method.upper()
    if u.hostname in ("api.cashfree.com", "sandbox.cashfree.com"):
        return False
    if u.hostname and u.hostname.endswith(".supabase.co"):
        if method in ("GET", "HEAD", "OPTIONS"):
            return True
        if method == "POST" and u.path.startswith("/rest/v1/rpc/"):
            return u.path.rsplit("/", 1)[-1] in READ_ONLY_RPCS
        return False
    # Fetch external fonts/scripts/images, but never issue browser POSTs to
    # uncontrolled hosts. GET from the public site is the only required action.
    return method in ("GET", "HEAD", "OPTIONS")


def assert_condition(value: bool, description: str) -> None:
    if not value:
        raise AssertionError(description)
    print("PASS:", description)


def check_public_page(page, path: str, sha: str):
    response = page.goto(SITE + path + "?bite_live_smoke=" + sha,
                         wait_until="domcontentloaded", timeout=30000)
    assert_condition(response is not None and response.status == 200,
                     path + ": public page returned HTTP 200")
    assert_condition("Bite" in page.title(),
                     path + ": Bite title visible to guest")


def inspect_customer(page):
    page.locator("#resultCount").wait_for(state="visible", timeout=30000)
    page.wait_for_function(
        "() => !/finding|loading/i.test(document.querySelector('#resultCount').textContent)",
        timeout=30000,
    )
    cards = page.locator("#restaurantGrid .restaurant")
    cards.first.wait_for(state="visible", timeout=25000)
    assert_condition(cards.count() >= 1,
                     "Customer can discover at least one public restaurant using real data")
    assert_condition(page.locator(".customer-brand .bite-premium-icon").is_visible(),
                     "Live Customer header contains the correct Bite branding")
    assert_condition(page.locator(".bite-language-row").count() == 0,
                     "Live Customer has no duplicate language switcher")
    assert_condition(page.locator("#discoveryLocationForm").is_hidden(),
                     "Live Customer has no duplicate PIN form")

    page.locator("#biteLocationOpen").click()
    assert_condition(page.locator("#biteLocationSheet").is_visible(),
                     "Public location sheet opens on mobile")
    assert_condition(page.locator("#biteSheetPin").is_visible(),
                     "PIN entry is accessible")
    page.keyboard.press("Escape")
    assert_condition(not page.locator("#biteLocationSheet").is_visible(),
                     "Location sheet closes without storing a new PIN")

    cards.first.click()
    page.locator("#menuView:not(.hidden)").wait_for(state="visible", timeout=25000)
    page.locator("#menuItems .menuitem").first.wait_for(state="visible", timeout=25000)
    assert_condition(bool(page.locator("#restaurantName").inner_text().strip()),
                     "Real public restaurant menu opens without a login")
    assert_condition(page.locator("#menuSearchInput").is_visible(),
                     "Menu search is accessible on mobile")
    page.locator("#backBtn").click()
    page.locator("#homeView:not(.hidden)").wait_for(state="visible")
    assert_condition(cards.count() >= 1,
                     "Customer can return from menu without losing restaurant browsing")


def inspect_owner(page):
    page.locator("#authScreen").wait_for(state="visible", timeout=25000)
    assert_condition(page.locator("#authEmail").is_visible(),
                     "Owner sign-in accepts mobile or email")
    assert_condition(page.locator("#authPassword").is_visible(),
                     "Owner sign-in asks for password")
    assert_condition(page.locator("#mainApp").is_hidden(),
                     "No private Owner/Admin dashboard opens while signed out")


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only live Bite browser smoke")
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.sha):
        parser.error("SHA must be exactly the approved 40 lowercase hex characters")
    forbidden = []
    page_errors = []
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for width in (390, 1280):
                context = browser.new_context(
                    viewport={"width": width, "height": 844},
                    is_mobile=width == 390, has_touch=width == 390,
                    device_scale_factor=1,
                )
                def gate(route):
                    req = route.request
                    if not allow_request(req.url, req.method):
                        forbidden.append(req.method + " " + urlsplit(req.url).path)
                        route.abort()
                        return
                    route.continue_()
                context.route("**/*", gate)
                page = context.new_page()
                page.on("pageerror", lambda exc: page_errors.append(str(exc)[:200]))
                check_public_page(page, "customer.html", args.sha)
                inspect_customer(page)
                check_public_page(page, "index.html", args.sha)
                inspect_owner(page)
                context.close()
            assert_condition(not forbidden,
                             "No real order/payment/auth/financial write request was attempted")
            assert_condition(not page_errors,
                             "Customer/Owner guest pages have no uncaught JS errors")
        finally:
            browser.close()
    print("PASS: Live guest-browser checks completed at approved SHA " + args.sha)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print("FAIL: Live guest-browser smoke: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
