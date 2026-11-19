#!/usr/bin/env python3
"""Owner V3 A05: synthetic Customer Khata period / mobile / copy-print gate smoke."""
import os
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'dist/launch-qa'
out.mkdir(parents=True,exist_ok=True)
(out/'owner-v3-khata-preview.html').write_text('''<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-v3-period.css">
<link rel="stylesheet" href="/assets/owner-v3-khata.css"></head>
<body data-role="owner" style="font-family:Arial,sans-serif;margin:0">
<div id="khata" style="max-width:900px;margin:auto;padding:10px;box-sizing:border-box">
<div id="khataV3Cards"></div>
<div id="khataV3Statement" class="v3-khata-statement"></div></div>
<script src="/assets/owner-v3-period.js"></script>
<script src="/assets/owner-v3-khata.js"></script>
</body></html>''')
server=ThreadingHTTPServer(('127.0.0.1',4299),
 lambda *args,**kwargs:SimpleHTTPRequestHandler(*args,directory=str(ROOT),**kwargs))
Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as pw:
 browser=pw.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':780})
  page.goto('http://127.0.0.1:4299/dist/launch-qa/owner-v3-khata-preview.html',wait_until='load')
  result=page.evaluate("""() => {
   const customer={id:'guest1',full_name:'Test Customer',phone:'9876543210',status:'Active'};
   const entries=[
    {entry_id:'opening',customer_id:customer.id,entry_date:'2026-11-01',entry_type:'debit',
     amount:100,source_type:'manual',created_at:'2026-11-01T11:00:00Z'},
    {entry_id:'receipt',customer_id:customer.id,entry_date:'2026-11-18',entry_type:'credit',
     amount:40,source_type:'manual',created_at:'2026-11-18T11:00:00Z'}
   ];
   const test=window.__a05={customer,entries,collect:0,opening:0,print:0};
   window.print=()=>test.print++;
   const render=complete=>window.BiteV3Khata.renderStatement({
    host:document.getElementById('khataV3Statement'),customer,entries,balance:60,
    complete,key:'ownerA:restaurant1',today:'2026-11-19',
    onChange:()=>render(true),onCollect:()=>test.collect++,onOpening:()=>test.opening++
   });
   test.render=render;
   window.BiteV3Khata.customerCards(document.getElementById('khataV3Cards'),{
    customers:[customer],balances:[{customer_id:customer.id,balance:60}],
    selectedId:customer.id,onCollect:()=>test.collect++
   });
   const report=render(true);
   return {verified:report.verified,opening:report.openingCents,
     receipt:report.receiptCents,closing:report.closingCents};
  }""")
  assert result=={'verified':True,'opening':0,'receipt':4000,'closing':6000},f'Invalid Khata statement at {width}: {result}'
  assert page.locator('[data-v3-khata-collect-due]').is_visible()
  page.locator('[data-v3-khata-collect-due]').click()
  page.locator('[data-v3-khata-opening]').click()
  assert page.evaluate('__a05.collect===1 && __a05.opening===1')
  page.locator('#v3KhataStatementPeriod [data-bv3-period-toggle]').click()
  page.locator('#v3KhataStatementPeriod [data-bv3-period-mode=day]').click()
  page.locator('#v3KhataStatementPeriod [name=day]').fill('2026-11-18')
  page.locator('#v3KhataStatementPeriod [type=submit]').click()
  page.wait_for_function("document.querySelector('#v3KhataStatementPeriod')?.textContent.includes('18 Nov 2026')")
  assert page.locator('.v3-khata-statement-totals').inner_text().count('₹100.00')>=1
  assert '₹40.00' in page.locator('.v3-khata-statement-totals').inner_text()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'Horizontal Khata overflow at {width}px'
  page.evaluate('__a05.render(false)')
  assert page.locator('.v3-khata-warning').is_visible()
  page.locator('[data-v3-khata-print]').click()
  assert page.evaluate('__a05.print===0'),'Incomplete statement must not print as verified'
  page.screenshot(path=str(out/f'owner-khata-{width}.png'))
  print(f'PASS A05 Khata partial collection, date filter and print safety: {width}px')
  page.close()
 browser.close()
