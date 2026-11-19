#!/usr/bin/env python3
"""Owner A10 synthetic Chromium contract: preview, consent and read-only cash flow."""
from pathlib import Path
import os
from threading import Thread
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist/launch-qa'
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'a10-salary-closing-preview.html').write_text("""<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-v3-salary-closing.css"></head>
<body data-role="owner" style="font:14px system-ui;margin:0">
<section id="hr" style="max-width:930px;margin:auto;padding:8px"><div id="hrA10Section" class="a10-salary-close" hidden>
 <h3>Salary Closing & Advance Adjustment</h3><div class="a10-fields">
 <label>Staff<select id="hrA10Employee"></select></label>
 <label>Month<input type="month" id="hrA10Month"></label>
 <label>Approved gross<input type="number" id="hrA10Gross"></label>
 <label>Earned bonus<input type="number" id="hrA10Bonus" value="0"></label>
 <label>Deduction<input type="number" id="hrA10Deduction" value="0"></label>
 <label>Advance applied<input type="number" id="hrA10Advance" value="0"></label>
 <label class="a10-note">Note<textarea id="hrA10Note"></textarea></label></div>
 <p id="hrA10Rate"></p><div id="hrA10Result"></div>
 <div class="a10-actions"><button id="hrA10Refresh" class="secondary">Refresh</button><button id="hrA10Preview">Preview closing</button></div>
 <div id="hrA10Review" class="a10-review" hidden></div>
 <label class="a10-approval"><input id="hrA10Approval" type="checkbox">I approve monthly salary figures. No cash payment.</label>
 <div class="a10-actions"><button id="hrA10Save" disabled>Approve monthly closing</button></div><p id="hrA10Message" class="a10-message"></p></div></section>
<script src="/assets/owner-v3-salary-closing.js"></script>
<script src="/assets/owner-v3-salary-closing-ui.js"></script></body></html>""",encoding='utf8')
server=ThreadingHTTPServer(('127.0.0.1',4398),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT),**kw))
Thread(target=server.serve_forever,daemon=True).start()
fixtures="""() => {
 const restaurant='11111111-1111-4111-8111-111111111111';
 const emp='22222222-2222-4222-8222-222222222222';
 const rows=[
 {id:'advance-1',restaurant_id:restaurant,employee_id:emp,payment_date:'2026-09-02',period_month:'2026-09-01',payment_type:'Advance',amount:500},
 {id:'advance-2',restaurant_id:restaurant,employee_id:emp,payment_date:'2026-10-20',period_month:'2026-10-01',payment_type:'Advance',amount:400},
 {id:'salary-1',restaurant_id:restaurant,employee_id:emp,payment_date:'2026-11-02',period_month:'2026-10-01',payment_type:'Salary',amount:3000},
 {id:'bonus-1',restaurant_id:restaurant,employee_id:emp,payment_date:'2026-10-28',period_month:'2026-10-01',payment_type:'Bonus',amount:250}];
 const saved=[];window.__rpcCount=0;
 const client={
  from(table){const source=table==='restaurant_employee_payments'?rows:saved;
   return {select(){return this},eq(){return this},order(){return this},
    range(a,b){return Promise.resolve({data:source.slice(a,b+1),error:null})}} },
  rpc(name,args){if(name!=='owner_close_employee_salary_month')throw Error('Wrong RPC');
   window.__rpcCount++;window.__submitted=args;
   saved.push({id:'closed-1',restaurant_id:restaurant,employee_id:emp,period_month:args.p_period_month,
    approved_gross:args.p_approved_gross,approved_bonus:args.p_approved_bonus,
    approved_deduction:args.p_approved_deduction,advance_applied:args.p_advance_applied,
    approved_at:'2026-11-19T12:00:00Z'});
   return Promise.resolve({data:'closed-1',error:null});}
 };
 window.__ctx={client,getRestaurantId:()=>restaurant,getUserId:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  getRole:()=> 'owner',getMemberships:()=>[{restaurant_id:restaurant,role:'owner'}],
  getToday:()=> '2026-11-19',getEmployees:()=>[{id:emp,restaurant_id:restaurant,
    salary_amount:10000,salary_period:'Monthly',status:'Active',full_name:'Synthetic employee'}]};
 BiteV3SalaryClosingUI.mount(window.__ctx);
}"""
with sync_playwright() as pw:
 browser=pw.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':900})
  page.goto('http://127.0.0.1:4398/dist/launch-qa/a10-salary-closing-preview.html')
  page.on('dialog',lambda dialog:dialog.accept())
  page.evaluate(fixtures)
  page.wait_for_function("document.getElementById('hrA10Result').textContent.includes('Verified advances')")
  assert page.get_by_role('button',name='Approve monthly closing').is_disabled()
  page.fill('#hrA10Gross','10000');page.fill('#hrA10Bonus','500')
  page.fill('#hrA10Deduction','100');page.fill('#hrA10Advance','600')
  page.fill('#hrA10Note','Approved deduction after salary review')
  page.get_by_role('button',name='Preview closing').click()
  assert '6,550' in page.locator('#hrA10Review').inner_text()
  assert page.get_by_role('button',name='Approve monthly closing').is_disabled()
  page.check('#hrA10Approval')
  assert page.get_by_role('button',name='Approve monthly closing').is_enabled()
  page.get_by_role('button',name='Approve monthly closing').click()
  page.wait_for_function("document.getElementById('hrA10Result').textContent.includes('Approved salary closing')")
  assert page.evaluate('window.__rpcCount')==1,'A10 created duplicate approval'
  args=page.evaluate('window.__submitted')
  assert args['p_advance_applied']==600
  assert args['p_expected_available']==900
  assert args['p_expected_paid']==3250
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'A10 overflows {width}px'
  page.screenshot(path=str(OUT/f'a10-salary-closing-{width}.png'))
  print(f'PASS A10: preview/consent/RPC, no duplicate approval, responsive {width}px')
  page.close()
 browser.close()
