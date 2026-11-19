#!/usr/bin/env python3
"""A07: mobile and desktop inventory cards with synthetic data and zero live writes."""
import os
from pathlib import Path
from threading import Thread
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
out=ROOT/'dist/launch-qa'
out.mkdir(parents=True,exist_ok=True)
preview=out/'owner-v3-a07-stock.html'
preview.write_text("""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-v3-inventory.css"></head><body data-role="owner" style="font:14px system-ui;margin:0">
<main id="inventory" style="max-width:1024px;margin:0 auto;padding:10px">
<div class="biv3-toolbar"><div class="biv3-quick-nav" aria-label="Inventory navigation"><button aria-current="page">Stock</button><button>Purchases</button><button>Suppliers</button></div>
<input id="inventoryV3Search" placeholder="Search stock"></div><div id="inventoryV3Cards"></div></main>
<script src="/assets/owner-v3-inventory.js"></script></body></html>""")
server=ThreadingHTTPServer(('127.0.0.1',4395),lambda *args,**kw:SimpleHTTPRequestHandler(*args,directory=str(ROOT),**kw))
Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as pw:
 browser=pw.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':850})
  page.goto('http://127.0.0.1:4395/dist/launch-qa/owner-v3-a07-stock.html')
  page.evaluate("""() => {
   window.__items=[
    {id:'rice',name:'Rice',category:'Grains',unit:'kg',is_active:true,reorder_level:10},
    {id:'oil',name:'Cooking oil',category:'Oils',unit:'litre',is_active:true,reorder_level:5}
   ];
   window.__balance={rice:25,oil:4};window.__adjusted=[];
   window.__draw=()=>BiteV3Inventory.render(document.getElementById('inventoryV3Cards'),{
    items:window.__items,balances:window.__balance,query:document.getElementById('inventoryV3Search').value,
    onAdjust:id=>window.__adjusted.push(id)});
   document.getElementById('inventoryV3Search').addEventListener('input',window.__draw);
   window.__draw();
  }""")
  assert page.locator('.biv3-card').count()==2
  assert page.locator('.biv3-card.is-low').count()==1
  assert '4 litre' in page.locator('.biv3-card.is-low').inner_text()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'Overflow at {width}px'
  page.get_by_role('button',name='Adjust Cooking oil').click()
  assert page.evaluate('window.__adjusted')==['oil']
  page.locator('#inventoryV3Search').fill('rice')
  assert page.locator('.biv3-card').count()==1
  assert 'Rice' in page.locator('.biv3-card').inner_text()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'Filtered overflow at {width}px'
  page.screenshot(path=str(out/f'a07-stock-{width}.png'))
  print(f'PASS A07: existing stock, low alert, adjust and search at {width}px')
  page.close()
 browser.close()
