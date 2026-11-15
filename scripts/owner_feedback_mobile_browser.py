#!/usr/bin/env python3
"""Task 6.08: Actual Bite survey HTML in Chromium mobile emulation, no live writes.

Serves the checked-out owner-feedback.html locally. Every external request is
blocked, except the survey Edge URL which is intercepted and fulfilled with
synthetic responses. No real owner, customer, payment or Supabase data changes.
Requires: python -m pip install playwright; python -m playwright install chromium
"""
from __future__ import annotations

import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EDGE_PATH = "/functions/v1/bite-owner-feedback"
EDGE_HOST = "wedbgpybbgsszcmffoha.supabase.co"
OUT = ROOT / "dist" / "launch-qa"


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print("PASS:", message)


class LocalHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        pass


def visible_step(page, number: int):
    check(page.locator("#stepCounter").inner_text() == f"{number} / 4",
          f"progress reads {number} / 4")
    check(page.locator(".step:visible").count() == 1,
          f"only step {number} is visible")
    check(page.locator(f'.step[data-step="{number - 1}"]').is_visible(),
          f"correct step {number} shown")


def exercise(page, width: int, replies: list[tuple[int, dict]], base: str):
    page_errors = []
    outgoing = []
    submissions = []
    response_queue = list(replies)

    def route_request(route):
        req = route.request
        p = urlsplit(req.url)
        if p.hostname == "127.0.0.1" and p.port == int(urlsplit(base).port):
            route.continue_()
            return
        if p.hostname == EDGE_HOST and p.path == EDGE_PATH:
            origin = req.headers.get("origin", base)
            headers = {
                "access-control-allow-origin": origin,
                "access-control-allow-methods": "POST, OPTIONS",
                "access-control-allow-headers": "content-type",
                "cache-control": "no-store",
            }
            if req.method == "OPTIONS":
                route.fulfill(status=204, headers=headers)
                return
            check(req.method == "POST", "survey sends POST only")
            submissions.append(json.loads(req.post_data or "{}"))
            status, response = response_queue.pop(0) if response_queue else (500, {"error": "Unexpected POST"})
            route.fulfill(status=status, headers={**headers, "content-type": "application/json"},
                          body=json.dumps(response, ensure_ascii=False))
            return
        outgoing.append(f"{req.method} {req.url}")
        route.abort()

    page.route("**/*", route_request)
    page.on("pageerror", lambda exc: page_errors.append(str(exc)))
    response = page.goto(base + "/owner-feedback.html", wait_until="load")
    check(response is not None and response.status == 200, f"real source HTML loads at {width}px")
    check(page.locator("#survey").is_visible(), f"survey available at {width}px")
    visible_step(page, 1)
    check(page.evaluate("window.scrollY") == 0, "initial screen not auto-scrolled")
    check(page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
          f"no horizontal overflow at {width}px")

    # Required city field and four-step navigation.
    page.locator("#next").click()
    visible_step(page, 1)
    page.locator("#city").fill("Rajsamand")
    page.locator("#restaurant_name").fill("QA Restaurant - simulated")
    page.locator("#next").click()
    visible_step(page, 2)
    page.locator("#next").click()
    visible_step(page, 2)
    page.locator('#problems input[value="orders"]').check()
    page.locator("#real_story").fill(
        "During the lunch rush, orders need editing while new customers are waiting."
    )
    page.locator("#back").click()
    visible_step(page, 1)
    check(page.locator("#city").input_value() == "Rajsamand", "Back retains entered city")
    page.locator("#next").click()
    visible_step(page, 2)
    check(page.locator("#real_story").input_value().startswith("During the lunch rush"),
          "Next retains problem description")
    page.locator("#next").click()
    visible_step(page, 3)
    page.locator("#next").click()
    visible_step(page, 3)
    check("Online platform" in page.locator("#error").inner_text(),
          "platform validation displays understandable instruction")
    page.locator('#marketplace_platforms input[value="none"]').check()
    check(page.locator("#no_platform").is_visible(), "none shows non-user question")
    page.locator('#marketplace_platforms input[value="zomato"]').check()
    check(not page.locator('#marketplace_platforms input[value="none"]').is_checked(),
          "selecting Zomato clears mutually exclusive none")
    check(page.locator("#uses_platform").is_visible(), "platform users see follow-up questions")
    page.locator("#next").click()
    visible_step(page, 4)
    page.locator("#send").click()
    visible_step(page, 4)
    page.locator("#one_change").fill(
        "Show a clear mobile alert and make billing fast during peak hours."
    )
    page.locator("#pilot_interest").check()
    page.locator("#privacy_agreed").check()
    page.locator("#send").click()
    check("Trial" in page.locator("#error").inner_text(),
          "trial without phone and contact consent is blocked")
    page.locator("#owner_phone").fill("9999999999")
    page.locator("#contact_consent").check()
    check(page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
          f"no horizontal overflow at final step at {width}px")

    # Some devices are slow. The button must recover from explicit failure or
    # a misleading 200 HTTP response with ok:false, rather than show success.
    for index, (status, body) in enumerate(replies):
        previous = len(submissions)
        page.locator("#send").click()
        page.wait_for_function(
            "n => document.querySelector('#success').style.display==='block' || "
            "document.querySelector('#error').textContent.trim().length>0",
            arg=None,
            timeout=10000,
        )
        check(len(submissions) == previous + 1, f"one POST per tap at {width}px")
        if status >= 400 or body.get("ok") is not True:
            check(not page.locator("#success").is_visible(),
                  f"no false thank-you for server reply {status} at {width}px")
            check(page.locator("#send").is_enabled(),
                  f"retry enabled after reply {status} at {width}px")
        else:
            check(page.locator("#success").is_visible(),
                  f"confirmed thank-you at {width}px")
            check(page.locator("#surveyPanel").is_hidden(),
                  f"form hidden after confirmed save at {width}px")
            break

    check(not outgoing, f"no external network requests at {width}px: {outgoing}")
    check(not page_errors, f"no browser JavaScript errors at {width}px: {page_errors}")
    check(len(submissions) >= 1, "submission request captured in memory")
    first = submissions[0]
    check(first["city"] == "Rajsamand" and first["marketplace_platforms"] == ["zomato"],
          "correct structured data was sent")
    check(first["pilot_interest"] and first["contact_consent"] and first["privacy_agreed"],
          "survey consent flags submitted correctly")
    check(first["biggest_problems"] == ["orders"], "selected problems preserved")
    check(not first["website"], "hidden anti-bot field stays empty")

    if page.locator("#success").is_visible():
        if width == 390:
            OUT.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(OUT / "ui-owner-feedback-390.png"), full_page=True)
        page.locator("#again").click()
        visible_step(page, 1)
        check(page.locator("#city").input_value() == "", "start again clears old answer")
        check(page.locator("#success").is_hidden(), "restart hides old confirmation")

    return {
        "width": width,
        "steps": 4,
        "mock_post_count": len(submissions),
        "mock_response_statuses": [s for s, _ in replies],
        "external_network_requests": len(outgoing),
        "browser_errors": len(page_errors),
        "production_writes": 0,
    }


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), LocalHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    evidence = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, replies in [
                    (320, [(201, {"ok": True})]),
                    (390, [(200, {"ok": False}), (503, {"error": "Server busy"}),
                           (201, {"ok": True})]),
                    (430, [(201, {"ok": True})]),
                ]:
                    ctx = browser.new_context(
                        viewport={"width": width, "height": 844},
                        device_scale_factor=2,
                        is_mobile=True,
                        has_touch=True,
                        locale="hi-IN",
                        timezone_id="Asia/Kolkata",
                    )
                    try:
                        evidence.append(exercise(ctx.new_page(), width, replies, base))
                    finally:
                        ctx.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "owner-feedback-mobile-evidence.json").write_text(
        json.dumps({"environment": "synthetic local Chromium mobile emulation",
                    "live_endpoint_called": False, "checks": evidence},
                   indent=2) + "\n", encoding="utf-8"
    )
    print("PASS: owner feedback mobile browser suite; zero real API submissions")


if __name__ == "__main__":
    main()
