#!/usr/bin/env python3
"""Customer Reorder: actual modal and CSS at mobile/desktop viewport sizes (synthetic data)."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist/launch-qa'
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'reorder-mobile-preview.html').write_text("""<!doctype html><html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/customer-reorder-review.css"></head>
<body data-bite-app="customer" style="font:14px system-ui;padding:4px;margin:0">
 <main><h1>Existing customer cart</h1><p id="protected">Old cart: Royal Thali × 2</p>
  <button id="review">Reorder</button><p id="answer"></p></main>
 <script src="/assets/customer-reorder-review.js"></script></body></html>""",encoding='utf8')
server=ThreadingHTTPServer(('127.0.0.1',4397),lambda *a,**k:SimpleHTTPRequestHandler(*a,directory=str(ROOT),**k))
Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 browser=p.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':800})
  page.goto('http://127.0.0.1:4397/dist/launch-qa/reorder-mobile-preview.html')
  page.evaluate("""() => {
    const rows=[
      {name:'Masala Dosa',quantity:2,previous_price:120,price:130,menu_item_id:'dosa',available:true},
      {name:'Paneer Tikka',quantity:1,previous_price:220,price:220,menu_item_id:'tikka',available:false},
      {name:'Extra soup',quantity:1,previous_price:50,price:null,menu_item_id:null,available:false}
    ];
    document.querySelector('#review').onclick=()=>BiteReorderReview.promptReview(rows,{hasExistingCart:true}).then(v=>{
      document.querySelector('#answer').textContent=v?'confirmed':'cancelled';
    });
  }""")
  page.locator('#review').click()
  dlg=page.locator('dialog.bite-reorder-review[open]')
  dlg.wait_for(state='visible')
  assert 'Was ₹240 · now ₹260' in dlg.inner_text()
  assert 'Previous food items subtotal: ₹510' in dlg.inner_text()
  assert 'Current available items subtotal: ₹260' in dlg.inner_text()
  assert dlg.get_by_role('button',name='Keep existing cart').is_visible()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'overflow at {width}px'
  page.screenshot(path=str(OUT/f'reorder-review-{width}.png'))
  page.keyboard.press('Escape')
  page.get_by_text('cancelled').wait_for()
  assert page.locator('#protected').inner_text()=='Old cart: Royal Thali × 2'
  page.locator('#review').click()
  dlg.wait_for(state='visible')
  dlg.get_by_role('button',name='Replace cart').click()
  page.get_by_text('confirmed').wait_for()
  assert page.locator('#protected').inner_text()=='Old cart: Royal Thali × 2'
  print(f'PASS reorder modal: {width}px, old/new price, unavailable dish, escape, explicit consent')
  page.close()
 browser.close()
