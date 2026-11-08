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
            "() => !document.querySelector('#resultCount').textContent.toLowerCase().includes('loading')",
            timeout=30000,
        )
        check("Bite" in page.title(), "Customer storefront title and document loaded")
        cards = page.locator("#restaurantGrid .restaurant")
        cards.first.wait_for(state="visible", timeout=20000)
        check(cards.count() > 0, "Public approved restaurants are discoverable from live Supabase data")

        # Browse a restaurant and confirm its menu is reachable without login.
        cards.first.click()
        page.locator("#menuView:not(.hidden)").wait_for(state="visible", timeout=20000)
        page.locator("#restaurantName").wait_for(state="visible")
        check(bool(page.locator("#restaurantName").inner_text().strip()), "Customer can open a restaurant menu without login")

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
            "() => !document.querySelector('#resultCount').textContent.toLowerCase().includes('loading')",
            timeout=30000,
        )
        overflow = mobile.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(overflow <= 1, f"Customer page has no horizontal overflow at 390px (overflow={overflow}px)")
        check(mobile.locator("#restaurantGrid").is_visible(), "Customer restaurant discovery is visible on mobile")
        browser.close()
finally:
    server.shutdown()
    server.server_close()
