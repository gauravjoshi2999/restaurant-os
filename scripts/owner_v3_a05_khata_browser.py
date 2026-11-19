#!/usr/bin/env python3
"""A05 Khata: synthetic financial and mobile UX checks; never touch production data."""
import os
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
out=ROOT/'dist/launch-qa'
out.mkdir(parents=True,exist_ok=True)
html=out/'khata-v3-preview.html'
html.write_text("""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-v3-period.css">
<link rel="stylesheet" href="/assets/owner-v3-khata.css"></head>
<body data-role="owner" style="font-family:Arial,sans-serif;margin:0;overflow-x:hidden">
<main style="box-sizing:border-box;max-width:1000px;margin:auto;padding:10px">
<h1>Customer Khata</h1><div id="khataV3Cards" aria-label="Mobile customer cards"></div>
<section id="khataV3Statement" class="v3-khata-statement"></section>
</main><script src="/assets/owner-v3-period.js"></script>
<script src="/assets/owner-v3-khata.js"></script></body></html>""")
server=ThreadingHTTPServer(('127.0.0.1',4299),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT),**kw))
Thread(target=server.serve_forever,daemon=True).start()

with sync_playwright() as pw:
 browser=pw.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':850})
  page.goto('http://127.0.0.1:4299/dist/launch-qa/khata-v3-preview.html')
  page.evaluate("""() => {
    const customer={id:'customer-1',full_name:'Demo customer',phone:'9876543210',status:'Active'};
    const entries=[
     {entry_id:'opening',customer_id:'customer-1',source_type:'manual',entry_type:'debit',entry_date:'2026-11-01',created_at:'2026-11-01T08:00:00Z',amount:100,description:'Opening due'},
     {entry_id:'receipt',customer_id:'customer-1',source_type:'manual',entry_type:'credit',entry_date:'2026-11-18',created_at:'2026-11-18T08:00:00Z',amount:40,description:'Cash collection',payment_method:'Cash'}
    ];
    window.__A05={customer,entries,collects:[],selected:[]};
    window.__renderKhata=()=>{
      window.__A05.report=BiteV3Khata.renderStatement({
       host:document.getElementById('khataV3Statement'),
       customer,entries,balance:60,complete:true,
       key:'owner-1:restaurant-1',today:'2026-11-19',onChange:window.__renderKhata
      });
    };
    window.__renderKhata();
    BiteV3Khata.customerCards(document.getElementById('khataV3Cards'),{
      customers:[customer],balances:[{customer_id:customer.id,balance:60}],selectedId:customer.id,
      onSelect:id=>window.__A05.selected.push(id),
      onCollect:id=>window.__A05.collects.push(id)
    });
  }""")
  assert page.evaluate('__A05.report.closingCents')==6000
  assert page.locator('#khataV3Statement').get_by_text('Demo customer').is_visible()
  assert page.get_by_text('Opening before period').count()==1
  assert page.locator('#khataV3Statement').get_by_text('₹60.00 due').count()>=1
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'A05 horizontal overflow at {width}'
  page.locator('#v3KhataStatementPeriod [data-bv3-period-toggle]').click()
  page.locator('#v3KhataStatementPeriod [data-bv3-period-mode=day]').click()
  page.locator('#v3KhataStatementPeriod [name=day]').fill('2026-11-10')
  page.locator('#v3KhataStatementPeriod [type=submit]').click()
  page.wait_for_function('__A05.report.closingCents===10000')
  assert page.locator('#khataV3Statement').get_by_text('₹100.00 due').count()>=1
  page.screenshot(path=str(out/f'khata-v3-{width}.png'))
  print(f'PASS: A05 statement opening/closing, 320–1024 px and selected record day at {width}px')
  page.close()
 browser.close()
