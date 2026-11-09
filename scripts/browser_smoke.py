#!/usr/bin/env python3
"""Real Chromium smoke checks for the public Bite customer journey.

This deliberately tests only public, unauthenticated behavior. Owner/Admin
journeys require dedicated test identities and are tracked separately.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
import os
import time

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
server = ThreadingHTTPServer(("127.0.0.1", 4173), SimpleHTTPRequestHandler)
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()

def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print("PASS:", message)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1365, "height": 900})
        page.goto("http://127.0.0.1:4173/customer.html", wait_until="domcontentloaded")
        page.locator("#resultCount").wait_for(state="visible", timeout=30000)
        page.wait_for_function(
            "() => !/loading|finding/i.test(document.querySelector('#resultCount').textContent)",
            timeout=30000,
        )
        check("Bite" in page.title(), "Customer storefront title and document loaded")
        cards = page.locator("#restaurantGrid .restaurant")
        cards.first.wait_for(state="visible", timeout=20000)
        check(cards.count() > 0, "Public approved restaurants are discoverable from live Supabase data")
        availability_fields = page.evaluate("""() => restaurants.length > 0 && restaurants.every(r =>
            ['is_temporarily_closed','temporary_closure_until','delivery_paused','opening_time','closing_time'].every(k => Object.prototype.hasOwnProperty.call(r,k)))""")
        check(availability_fields, "Public restaurant listing returns the new availability fields from Supabase")

        # Exercise the customer-visible closure state using the live restaurant record.
        original = page.evaluate("() => ({id:restaurants[0].id,closed:restaurants[0].is_temporarily_closed,until:restaurants[0].temporary_closure_until})")
        page.evaluate("id => {const r=restaurants.find(r=>r.id===id);r.is_temporarily_closed=true;r.temporary_closure_until=null;renderRestaurants()}", original['id'])
        closed_card = page.locator('.restaurant[data-id="' + original['id'] + '"]')
        check("temporarily closed" in closed_card.inner_text().lower(),
              "Customer restaurant card displays temporary closure state")
        page.evaluate("o => {const r=restaurants.find(r=>r.id===o.id);r.is_temporarily_closed=o.closed;r.temporary_closure_until=o.until;renderRestaurants()}", original)

        page.locator('#homeSearchInput').fill('BITE-NO-MATCH-ZZ-123')
        check(page.locator('#restaurantGrid .restaurant').count() == 0, 'Unmatched search shows an actionable empty state')
        page.get_by_role('button', name='Show all restaurants', exact=True).click()
        check(page.locator('#restaurantGrid .restaurant').count() > 0, 'Reset restores public restaurant discovery')

        # Browse a restaurant and confirm its menu is reachable without login.
        cards.first.click()
        page.locator("#menuView:not(.hidden)").wait_for(state="visible", timeout=20000)
        page.locator("#restaurantName").wait_for(state="visible")
        check(bool(page.locator("#restaurantName").inner_text().strip()), "Customer can open a restaurant menu without login")
        page.locator('#menuItems [data-add]').first.wait_for(state='visible', timeout=20000)
        page.locator('#menuSearchInput').fill('BITE-NO-DISH-ZZ-123')
        check(page.locator('#menuItems .menuitem').count() == 0, 'Menu search filters actual dishes')
        page.locator('#menuSearchInput').fill('')
        page.locator('#menuVegToggle').check()
        check(page.locator('#menuItems .menuitem').count() == page.locator('#menuItems .food-type.veg').count(), 'Veg only excludes non-vegetarian and unclassified dishes')
        page.locator('#menuVegToggle').uncheck()
        add = page.locator('#menuItems [data-add]').first
        item_id = add.get_attribute('data-add')
        add.click()
        page.locator('[data-add="' + item_id + '"]').click()
        check(page.locator('#cartCount').inner_text() == '(2)', 'Menu quantity changes update the cart')
        page.locator('[data-menu-dec="' + item_id + '"]').click()
        check(page.locator('#cartCount').inner_text() == '(1)', 'Removing one item updates both menu and cart')
        page.locator('#continueBtn').click()
        check(page.locator('#cartModal.show').is_visible(), 'Cart detail opens with the selected dish')
        page.locator('#closeCartModal').click()
        page.locator('#backBtn').click()
        check(not page.locator('#cartFloating').is_visible(), 'Floating cart is hidden outside the restaurant menu')

        # The marketplace must not create orders while no payment provider is configured.
        button = page.locator("#placeOrderBtn")
        check(button.is_disabled(), "Checkout remains disabled without an approved payment provider")
        check("payment setup pending" in button.inner_text().lower(), "Checkout explains that payment setup is pending")
        check("cash on delivery" not in page.locator("body").inner_text().lower(), "No cash-on-delivery option is offered")

        # Forgot-password UI must be reachable and validate the email before sending.
        page.locator("#loginBtn").click()
        page.locator("#authModal.show").wait_for(state="visible", timeout=5000)
        check(page.locator("#forgotPasswordBtn").is_visible(), "Customer login exposes a forgot-password action")
        page.locator("#forgotPasswordBtn").click()
        check("sahi email" in page.locator("#authError").inner_text().lower(),
              "Forgot-password flow validates email before requesting a reset link")

        # Android-sized viewport smoke check.
        mobile = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        mobile.goto("http://127.0.0.1:4173/customer.html", wait_until="domcontentloaded")
        mobile.locator("#resultCount").wait_for(state="visible", timeout=30000)
        mobile.wait_for_function(
            "() => !/loading|finding/i.test(document.querySelector('#resultCount').textContent)",
            timeout=30000,
        )
        overflow = mobile.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(overflow <= 1, f"Customer page has no horizontal overflow at 390px (overflow={overflow}px)")
        check(mobile.locator("#restaurantGrid").is_visible(), "Customer restaurant discovery is visible on mobile")

        # Owner / Super Admin sign-in entrypoint must fit an Android viewport.
        owner = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        owner.goto("http://127.0.0.1:4173/index.html", wait_until="domcontentloaded")
        owner.locator("#authScreen").wait_for(state="visible", timeout=20000)
        check(owner.locator("#authScreen").is_visible(), "Owner / Super Admin sign-in screen loads before authentication")
        check(not owner.locator("#mainApp").is_visible(), "Owner / Admin dashboards stay protected before authentication")
        owner_overflow = owner.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(owner_overflow <= 1, f"Owner sign-in page has no horizontal overflow at 390px (overflow={owner_overflow}px)")
        browser.close()
finally:
    server.shutdown()
    server.server_close()
