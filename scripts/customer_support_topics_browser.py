#!/usr/bin/env python3
"""Bite support topic buttons: synthetic browser form, no real customer or payment writes."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist/launch-qa'
OUT.mkdir(parents=True,exist_ok=True)
content='''<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/customer-support-topics.css">
</head><body data-bite-app="customer" style="font:14px system-ui;margin:0;padding:12px;max-width:100%;box-sizing:border-box">
<h1>Help &amp; Support</h1>
<div id="biteSupportTopics" class="bite-support-chips" role="group" aria-label="Common support issues">
 <button type="button" data-bite-support-topic="order-delayed" aria-pressed="false">Order delayed</button>
 <button type="button" data-bite-support-topic="restaurant-rejected" aria-pressed="false">Restaurant rejected</button>
 <button type="button" data-bite-support-topic="cancel-order" aria-pressed="false">Cancellation</button>
 <button type="button" data-bite-support-topic="payment-deducted" aria-pressed="false">Money deducted</button>
 <button type="button" data-bite-support-topic="refund-status" aria-pressed="false">Refund status</button>
 <button type="button" data-bite-support-topic="sign-in" aria-pressed="false">Login or account</button>
 <button type="button" data-bite-support-topic="other" aria-pressed="false">Other</button>
</div><p id="biteSupportTopicHelp" role="status" hidden></p>
<form id="customerSupportForm">
 <label for="customerSupportCategory">Category</label>
 <select id="customerSupportCategory"><option>Order</option><option>Payment</option><option>Account</option><option>Restaurant</option><option>Other</option></select>
 <label for="customerSupportSubject">Subject</label><input id="customerSupportSubject">
 <label for="customerSupportMessage">Message</label><textarea id="customerSupportMessage"></textarea>
</form>
<script src="/assets/customer-support-topics.js"></script></body></html>'''
(OUT/'customer-support-topics-preview.html').write_text(content,encoding='utf-8')
http=ThreadingHTTPServer(('127.0.0.1',4398),lambda *args,**kwargs:SimpleHTTPRequestHandler(*args,directory=str(ROOT),**kwargs))
Thread(target=http.serve_forever,daemon=True).start()
with sync_playwright() as p:
 browser=p.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':820})
  page.goto('http://127.0.0.1:4398/dist/launch-qa/customer-support-topics-preview.html')
  page.locator('[data-bite-support-topic="payment-deducted"]').click()
  assert page.locator('#customerSupportCategory').input_value()=='Payment'
  assert page.locator('#customerSupportSubject').input_value()=='Payment deducted but order not confirmed'
  assert 'Do not pay again' in page.locator('#biteSupportTopicHelp').inner_text()
  assert page.locator('#customerSupportMessage').evaluate('el=>document.activeElement===el')
  assert page.locator('[data-bite-support-topic="payment-deducted"]').get_attribute('aria-pressed')=='true'
  subject=page.locator('#customerSupportSubject')
  subject.fill('Please check payment reference ABC')
  page.locator('[data-bite-support-topic="refund-status"]').click()
  assert page.locator('#customerSupportCategory').input_value()=='Payment'
  assert subject.input_value()=='Please check payment reference ABC'
  assert 'does not initiate a refund' in page.locator('#biteSupportTopicHelp').inner_text()
  page.locator('#customerSupportCategory').select_option('Account')
  assert page.locator('#biteSupportTopicHelp').is_hidden()
  assert page.locator('[data-bite-support-topic][aria-pressed="true"]').count()==0
  page.locator('[data-bite-support-topic="sign-in"]').click()
  assert page.locator('#customerSupportCategory').input_value()=='Account'
  assert 'Never share your password' in page.locator('#biteSupportTopicHelp').inner_text()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'Horizontal overflow at {width}px'
  assert page.locator('[data-bite-support-topic="sign-in"]').evaluate('el=>el.getBoundingClientRect().height>=44')
  page.screenshot(path=str(OUT/f'customer-support-topics-{width}.png'))
  page.evaluate("document.getElementById('customerSupportForm').reset()")
  assert page.locator('[data-bite-support-topic][aria-pressed="true"]').count()==0
  page.close()
  print(f'PASS Customer Support shortcuts at {width}px: category, subject, focus, privacy and reset')
 browser.close()
http.shutdown()
