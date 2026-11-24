#!/usr/bin/env python3
"""Actual Owner boot markup with frozen synthetic auth; no external requests."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
import json
import re
import subprocess
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(ROOT / 'scripts/prepare_completion_preview.py')], check=True)
base = (ROOT / 'dist/qa/owner-flow.html').read_text()
needle = 'getSession:async()=>({data:{session}})'
assert needle in base
base = base.replace(needle, 'getSession:()=>{window.__bootReads++;return window.__bootPending;}')
setup = '''<script>
window.__bootReads=0;
window.__bootPending=new Promise(resolve=>{window.__finishBootRead=resolve;});
localStorage.setItem('bite_boot_qa_saved_login','synthetic-preserved');
</script>'''
base = base.replace('<script>window.__BITE_QA_ROLE=', setup + '<script>window.__BITE_QA_ROLE=', 1)
(ROOT / 'dist/qa/owner-boot-pending.html').write_text(base)
server = ThreadingHTTPServer(('127.0.0.1', 0), lambda *a, **kw: SimpleHTTPRequestHandler(*a, directory=str(ROOT/'dist'), **kw))
Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/qa/owner-boot-pending.html'
checks = []

def check(value, label):
    assert value, label
    checks.append(label)
    print('PASS:', label, flush=True)

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for width in (320, 360, 390, 430, 1440):
            context = browser.new_context(viewport={'width': width, 'height': 900})
            # Only local, nonfinancial fixture assets can be requested.
            context.route('**/*', lambda route: route.continue_() if urlsplit(route.request.url).hostname == '127.0.0.1' else route.abort())
            page = context.new_page()
            page.clock.install()
            page.goto(url, wait_until='domcontentloaded')
            page.wait_for_function('window.__bootReads===1')
            page.clock.fast_forward(11000)
            page.locator('#authSessionRetry').wait_for(state='visible')
            # Recovery renders the message/button before the current layout pass
            # settles. Assert the real fields/guard with Playwright's waiter.
            try:
                page.locator('#authEmail').wait_for(state='visible')
                page.locator('#mainApp').wait_for(state='hidden')
            except Exception as exc:
                diagnostic = page.evaluate('''() => ({
                    body:document.body.className,
                    authForm:getComputedStyle(document.querySelector('#authForm')).display,
                    authInput:getComputedStyle(document.querySelector('#authEmail')).visibility,
                    appDisplay:getComputedStyle(document.querySelector('#mainApp')).display,
                    error:document.querySelector('#authError').textContent
                })''')
                raise AssertionError(f'{width}px recovery state: {diagnostic}') from exc
            check(page.locator('#authEmail').is_visible() and page.locator('#mainApp').is_hidden(), f'{width}px stalled session reveals login/reconnect with private workspace hidden')
            page.locator('#authSessionRetry').click()
            check(page.locator('#authSessionRetry').is_disabled(), f'{width}px reconnect blocks repeated taps')
            page.clock.fast_forward(11000)
            check(page.locator('#authSessionRetry').is_enabled() and page.evaluate('__bootReads===1'), f'{width}px reconnect observes the original session operation')
            page.evaluate('__finishBootRead({data:{session:null}})')
            page.wait_for_timeout(1)
            check(page.locator('#mainApp').is_hidden(), f'{width}px late session result cannot activate the workspace')
            page.locator('#authSessionRetry').click()
            page.wait_for_function('!document.querySelector("#authSessionRetry").disabled')
            check(page.evaluate("localStorage.getItem('bite_boot_qa_saved_login')==='synthetic-preserved'"), f'{width}px recovery preserves saved storage')
            check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), f'{width}px recovery controls fit viewport')
            context.close()

        # A parser-blocking script never reaches auth setup: early watchdog must
        # still offer reload without removing the private-workspace boot guard.
        context = browser.new_context(viewport={'width': 390, 'height': 844})
        def stall(route):
            parsed = urlsplit(route.request.url)
            if parsed.path == '/assets/owner-core.js':
                return  # deliberately unresolved local dependency
            if parsed.hostname == '127.0.0.1':
                route.continue_()
            else:
                route.abort()
        context.route('**/*', stall)
        page = context.new_page()
        page.clock.install()
        page.goto(url, wait_until='commit')
        page.locator('#biteSessionSplash').wait_for(state='visible')
        page.wait_for_function('!!window.BiteOwnerSession')
        page.clock.fast_forward(13000)
        page.locator('#biteBootRecovery').wait_for(state='visible')
        check(page.locator('#biteBootRecovery button').is_visible() and page.locator('#mainApp').is_hidden(), 'blocked dependency leaves reload available and private app hidden')
        check(page.evaluate("document.body.classList.contains('bite-session-check')"), 'blocked dependency never bypasses authentication guard')
        context.close()
        browser.close()
finally:
    server.shutdown()
    out = ROOT / 'dist/launch-qa'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'owner-session-recovery-evidence.json').write_text(json.dumps({'layer': 'isolated synthetic Chromium', 'checks': checks}, indent=2))
