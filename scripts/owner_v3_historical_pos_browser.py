#!/usr/bin/env python3
"""R03 historical POS: synthetic mobile/desktop reconciliation, never real customer data."""
import os
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
out=ROOT/'dist/launch-qa'
out.mkdir(parents=True,exist_ok=True)
page_file=out/'owner-v3-old-pos-preview.html'
page_file.write_text("""<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-v3-historical-reconcile.css"></head>
<body data-role="owner" style="font:14px system-ui,sans-serif;margin:0">
<main id="daily-book" style="max-width:940px;margin:auto;padding:10px">
<section class="bh-panel" id="haHistoricalPOS"></section></main>
<script src="/assets/owner-v3-historical-reconcile.js"></script></body></html>""",encoding='utf8')
server=ThreadingHTTPServer(('127.0.0.1',4317),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT),**kw))
Thread(target=server.serve_forever,daemon=True).start()
fixtures="""async () => {
 const restaurant='262aaba7-f48b-4fa5-9ff6-b334ededca84';
 const rows=[{id:'synthetic-oct',restaurant_id:restaurant,record_date:'2026-10-01',
  recorded_at:'2026-11-18T06:00:00Z',customer_name:'Synthetic guest',
  amount:160,received_amount:160,payment_method:'Cash',visit_type:'dine_in',guest_count:2}];
 const builder={
  select(){return this},eq(){return this},gte(){return this},lte(){return this},order(){return this},
  range(a,b){return Promise.resolve({data:rows.slice(a,b+1),error:null,count:rows.length})}
 };
 window.__opened=[];window.__scope=true;
 window.__oldResult=await BiteV3HistoricalReconcile.mount(
  document.getElementById('haHistoricalPOS'),{
   client:{from(name){if(name!=='bite_owner_historical_entries')throw Error('Wrong table');return builder}},
   restaurantId:restaurant,from:'2026-10-01',to:'2026-10-31',today:'2026-11-19',
   scope:'owner:hotel',isCurrent:()=>window.__scope,
   journal:[{id:'synthetic-receipt',source_type:'order_payment',direction:'in',day:'2026-10-01',method:'Cash',amount:50}],
   onOpen:(day,id)=>window.__opened.push({day,id})
  });
}"""
with sync_playwright() as pw:
 browser=pw.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':900})
  page.goto('http://127.0.0.1:4317/dist/launch-qa/owner-v3-old-pos-preview.html')
  page.evaluate(fixtures)
  assert page.evaluate('window.__oldResult.ok')
  panel=page.locator('#haHistoricalPOS')
  rendered=panel.inner_text()
  assert '160' in rendered, f'Old POS visible text: {rendered!r} · HTML: {panel.inner_html()[:800]!r}'
  assert 'NOT a newly collected' in panel.inner_text()
  posted=panel.locator('.v3-history-posted').inner_text()
  assert '50' in posted and 'not matched' in posted, f'Posted receipts must remain separately labelled: {posted!r}'
  assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),f'Overflow at {width}px'
  page.get_by_role('button',name='View date in POS').click()
  assert page.evaluate('window.__opened[0].day')=='2026-10-01'
  page.screenshot(path=str(out/f'old-pos-reconciliation-{width}.png'))
  print(f'PASS R03: old October bill, no double count, date drilldown, {width}px')
  page.close()
 browser.close()
