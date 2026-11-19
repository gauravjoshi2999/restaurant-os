#!/usr/bin/env python3
"""Owner V3 A09 mobile/desktop read-only staff statement smoke; synthetic data only."""
import os
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
OUT=ROOT/'dist/launch-qa'
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'a09-staff-payment-preview.html').write_text("""<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-v3-staff-payments.css"></head>
<body data-role="owner" style="font:14px system-ui;margin:0">
<section id="hr" style="max-width:950px;margin:auto;padding:8px">
<div class="v3-pay-report"><div id="hrV3PaymentStatement"></div></div></section>
<script src="/assets/owner-v3-staff-payments.js"></script></body></html>""",encoding='utf8')
server=ThreadingHTTPServer(('127.0.0.1',4386),lambda *a,**k:SimpleHTTPRequestHandler(*a,directory=str(ROOT),**k))
Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 browser=p.chromium.launch()
 for width in [320,360,390,430,1024]:
  page=browser.new_page(viewport={'width':width,'height':900})
  page.goto('http://127.0.0.1:4386/dist/launch-qa/a09-staff-payment-preview.html')
  result=page.evaluate("""() => {
   const restaurant='11111111-1111-4111-8111-111111111111';
   const report=BiteV3StaffPayments.summarize([
    {id:'source-1',restaurant_id:restaurant,employee_id:'e1',payment_date:'2026-11-10',period_month:'2026-10-01',payment_type:'Salary',amount:15000,payment_method:'UPI'},
    {id:'source-2',restaurant_id:restaurant,employee_id:'e1',payment_date:'2026-11-12',period_month:'2026-11-01',payment_type:'Advance',amount:1500,payment_method:'Cash'},
    {id:'source-3',restaurant_id:restaurant,employee_id:'e1',payment_date:'2026-11-14',period_month:'2026-11-01',payment_type:'Deduction',amount:100,payment_method:'Cash'}
   ],{restaurantId:restaurant,month:'2026-11',mode:'paid'});
   document.getElementById('hrV3PaymentStatement').innerHTML=BiteV3StaffPayments.html(report,[{id:'e1',full_name:'Synthetic cook'}]);
   return {count:report.count,salary:report.totals.Salary,bonus:report.totals.Bonus,deduction:report.totals.Deduction};
  }""")
  assert result['count']==3 and result['salary']==1500000 and result['deduction']==10000
  panel=page.locator('#hrV3PaymentStatement')
  assert 'Synthetic cook' in panel.inner_text()
  assert '2026-10' in panel.inner_text() and '2026-11' in panel.inner_text()
  assert 'not money paid' in panel.inner_text()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'overflow at {width}px'
  page.screenshot(path=str(OUT/f'a09-staff-statement-{width}.png'))
  print(f'PASS A09: date-aware staff statement at {width}px')
  page.close()
 browser.close()
