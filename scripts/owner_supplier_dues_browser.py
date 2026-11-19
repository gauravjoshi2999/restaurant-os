#!/usr/bin/env python3
"""A04 supplier due modal: synthetic UI/transport, never uses production funds."""
import os, json, subprocess, sys
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
out=ROOT/'dist/launch-qa';out.mkdir(parents=True,exist_ok=True)
test_html=out/'supplier-payments-preview.html'
test_html.write_text('''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-supplier-dues.css"></head>
<body data-role="owner" style="font-family:Arial,sans-serif;margin:0;overflow-x:hidden">
<main style="max-width:760px;box-sizing:border-box;padding:10px;margin:auto"><h1>Purchases</h1><div id="supplierDueSummary"></div></main>
<script src="/assets/owner-supplier-dues.js"></script></body></html>''')
server=ThreadingHTTPServer(('127.0.0.1',4298),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT),**kw))
Thread(target=server.serve_forever,daemon=True).start()

with sync_playwright() as pw:
 browser=pw.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':800})
  page.goto('http://127.0.0.1:4298/dist/launch-qa/supplier-payments-preview.html',wait_until='load')
  page.evaluate("""() => {
   const purchase={id:'bill-one',restaurant_id:'restaurant-1',purchase_date:'2026-10-01',
    supplier_name_snapshot:'Synthetic supplier',total_amount:900,paid_amount:100};
   const payments=[{restaurant_id:'restaurant-1',purchase_id:'bill-one',payment_date:'2026-10-20',amount:200}];
   window.__A04_QA={purchase,payments,calls:[],success:0};
   const x=window.__A04_QA;
   const show=id=>window.BiteSupplierDues.open({
    purchase:x.purchase,payments:x.payments,today:'2026-11-19',owner:true,
    onSave:async p=>{x.calls.push(p)},
    onSuccess:async()=>{x.success+=1}
   });
   window.BiteSupplierDues.renderSummary(document.getElementById('supplierDueSummary'),{
    purchases:[purchase],payments,available:true,owner:true,onOpen:show
   });
  }""")
  assert '600.00' in page.locator('#supplierDueSummary').inner_text(),f'Wrong supplier due at {width}'
  page.locator('[data-bsp-pay]').click()
  assert page.get_by_role('dialog',name='Record supplier payment').is_visible()
  assert '600.00' in page.locator('.bsp-due').inner_text()
  page.locator('.bsp-dialog [data-bsp-close]').first.click()
  assert page.evaluate('__A04_QA.calls.length')==0,'Cancel must not record payment'
  page.locator('[data-bsp-pay]').click()
  page.locator('[name=amount]').fill('200')
  page.locator('[name=date]').fill('2026-11-19')
  page.locator('[name=confirmed]').check()
  page.locator('.bsp-form [type=submit]').click()
  page.wait_for_function("__A04_QA.calls.length===1 && __A04_QA.success===1")
  call=page.evaluate('__A04_QA.calls[0]')
  assert call['amount']==200 and call['date']=='2026-11-19' and call['method']=='Cash'
  assert len(call['requestId'])==36
  assert page.locator('.bsp-dialog').count()==0
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'Horizontal overflow at {width}px'
  page.screenshot(path=str(out/f'supplier-payments-{width}.png'))
  print(f'PASS: A04 supplier due / cancellation / recorded payment dialog at {width}px')
  page.close()
 browser.close()
