#!/usr/bin/env python3
"""Owner V3 A13 synthetic salary-status responsive browser smoke. No real payments."""
import os
from pathlib import Path
from threading import Thread
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
out=ROOT/'dist/launch-qa'
out.mkdir(parents=True,exist_ok=True)
(out/'a13-salary-status-preview.html').write_text("""<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-v3-salary-status.css"></head>
<body data-role="owner" style="font:14px system-ui;margin:0">
<main id="hr" style="max-width:950px;margin:auto;padding:9px">
<section class="a13-board" id="hrV3SalaryStatusSection">
<div class="a13-head"><div><h2>Salary Status · Paid / Pending</h2>
<p>Approved salary-month record</p></div>
<div class="a13-select"><label>Salary month<input type="month" id="hrV3SalaryStatusMonth" value="2026-10"></label>
<button id="refresh">View status</button></div></div>
<div id="hrV3SalaryStatusResult" role="status"></div></section></main>
<script src="/assets/owner-v3-salary-status.js"></script></body></html>""",encoding='utf8')
srv=ThreadingHTTPServer(('127.0.0.1',4399),
 lambda *a,**k:SimpleHTTPRequestHandler(*a,directory=str(ROOT),**k))
Thread(target=srv.serve_forever,daemon=True).start()
script="""() => {
 const r='11111111-1111-4111-8111-111111111111';
 const emps=['Paid employee','Partially paid employee','Unpaid employee','Adjustments only','Not closed employee']
  .map((name,i)=>({id:String(i),restaurant_id:r,joining_date:'2026-08-01',full_name:name,status:'Active',employee_code:'B'+i}));
 const closing=[{id:'a',restaurant_id:r,employee_id:'0',period_month:'2026-10-01',approved_gross:10000,approved_bonus:0,approved_deduction:0,advance_applied:0},
 {id:'b',restaurant_id:r,employee_id:'1',period_month:'2026-10-01',approved_gross:10000,approved_bonus:0,approved_deduction:0,advance_applied:0},
 {id:'c',restaurant_id:r,employee_id:'2',period_month:'2026-10-01',approved_gross:10000,approved_bonus:0,approved_deduction:0,advance_applied:0},
 {id:'d',restaurant_id:r,employee_id:'3',period_month:'2026-10-01',approved_gross:500,approved_bonus:0,approved_deduction:0,advance_applied:500}];
 const payments=[{id:'p0',restaurant_id:r,employee_id:'0',period_month:'2026-10-01',payment_date:'2026-11-10',payment_type:'Salary',amount:10000},
 {id:'p1',restaurant_id:r,employee_id:'1',period_month:'2026-10-01',payment_date:'2026-11-11',payment_type:'Salary',amount:3000}];
 const api=BiteV3SalaryStatus;
 function paint(month){
  const report=api.summarize({restaurantId:r,month,today:'2026-11-19',employees:emps,
     closings:month==='2026-10'?closing:[],payments:month==='2026-10'?payments:[]});
  document.getElementById('hrV3SalaryStatusResult').innerHTML=api.render(report);
  window.__report=report;
 }
 document.getElementById('refresh').onclick=()=>paint(document.getElementById('hrV3SalaryStatusMonth').value);
 paint('2026-10');
}"""
with sync_playwright() as p:
 browser=p.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':900})
  page.goto('http://127.0.0.1:4399/dist/launch-qa/a13-salary-status-preview.html')
  page.evaluate(script)
  content=page.locator('#hrV3SalaryStatusResult').inner_text()
  assert 'Partially paid' in content and 'Not closed' in content and 'Settled by adjustments' in content
  assert '17,000' in content,content
  assert page.evaluate('window.__report.stats.paid')==1
  assert page.evaluate('window.__report.stats.partial')==1
  assert page.evaluate('window.__report.stats.unpaid')==1
  assert page.evaluate('window.__report.stats.adjusted')==1
  assert page.evaluate('window.__report.stats.open')==1
  assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),f'overflow: {width}px'
  page.screenshot(path=str(out/f'a13-salary-status-{width}.png'))
  page.locator('#hrV3SalaryStatusMonth').fill('2026-09')
  page.locator('#refresh').click()
  assert page.evaluate('window.__report.stats.open')==5
  assert page.evaluate('window.__report.remainingCents')==0
  assert 'No approved closing' in page.locator('#hrV3SalaryStatusResult').inner_text()
  print(f'PASS A13: statuses, no imagined due, month refresh, {width}px')
  page.close()
 browser.close()
