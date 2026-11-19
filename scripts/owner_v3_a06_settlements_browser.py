#!/usr/bin/env python3
"""Synthetic Owner A06 payment/refund/settlement mobile and desktop smoke test.
Never calls Supabase or payment providers."""
import os
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
out=ROOT/'dist/launch-qa'
out.mkdir(parents=True,exist_ok=True)
preview=out/'owner-a06-preview.html'
preview.write_text("""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-v3-settlements.css"></head>
<body data-role="owner" style="margin:0;background:#fbf7f3;font:14px/1.4 system-ui,Arial,sans-serif">
<main style="box-sizing:border-box;margin:auto;max-width:1100px;padding:12px">
<section id="owner-settlements"></section></main>
<script src="/assets/owner-v3-settlements.js"></script></body></html>""",encoding='utf8')
server=ThreadingHTTPServer(('127.0.0.1',4326),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT),**kw))
Thread(target=server.serve_forever,daemon=True).start()
fixture=r"""async () => {
 const rid='11111111-1111-4111-8111-111111111111';
 const id='33333333-3333-4333-8333-333333333333';
 const rows={
  order_financials:[{id:'44444444-4444-4444-8444-444444444444',order_id:id,
   restaurant_id:rid,channel:'Own Platform',is_demo:false,
   payment_status:'paid',settlement_status:'not_ready',customer_payable_amount:174,
   commission_amount:17.40,provider_fee_actual:null,created_at:'2026-11-19T08:00:00Z'}],
  restaurant_settlements:[],
  bite_refund_jobs:[{id:'55555555-5555-4555-8555-555555555555',order_id:id,
   restaurant_id:rid,amount:174,status:'approved',provider_status:null,
   provider_refund_id:null,provider_checked_at:null,created_at:'2026-11-19T09:00:00Z'}],
  bite_provider_checks:[]
 };
 const db={from(table){
  const q={select(){return this},eq(k,v){if(k!=='restaurant_id'||v!==rid)throw Error('Missing tenant guard');return this},
   order(){return this},range(a,b){return Promise.resolve({data:rows[table].slice(a,b+1),error:null})}};
  return q;
 }};
 window.__a06Open=await BiteOwnerA06.open({el:document.getElementById('owner-settlements'),client:db,restaurantId:rid,
  userId:'test-user',getSession:()=>({role:'owner',restaurantId:rid,userId:'test-user'}),
  getOrders:()=>[{id,restaurant:rid,code:'BITE-174',isDemo:false}]});
}"""
with sync_playwright() as pw:
 browser=pw.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':850})
  page.goto('http://127.0.0.1:4326/dist/launch-qa/owner-a06-preview.html')
  page.evaluate(fixture)
  area=page.locator('#owner-settlements')
  assert page.get_by_role('heading',name='Settlements & Refunds').count()==1
  assert '174' in area.inner_text()
  assert 'Provider check still needed' in area.inner_text()
  assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),f'A06 overflow at {width}px'
  page.locator('.a06-record summary').first.click()
  assert area.get_by_text('Owner bank arrival:').is_visible()
  page.get_by_role('tab',name='Refunds').click()
  assert 'Approved in Bite' in area.inner_text()
  page.get_by_role('tab',name='Settlements').click()
  assert 'No settlement batches are recorded' in area.inner_text()
  page.get_by_role('tab',name='Payments').click()
  assert 'BITE-174' in area.inner_text()
  page.screenshot(path=str(out/f'a06-settlements-{width}.png'))
  print(f'PASS A06: paid ≠ payout, refund unverified, tabs & 320–1024 responsive at {width}px')
  page.close()
 browser.close()
