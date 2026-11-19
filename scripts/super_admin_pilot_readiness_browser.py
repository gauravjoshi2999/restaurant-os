#!/usr/bin/env python3
"""Synthetic Super Admin pilot readiness browser checks. No live money or credentials."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist/launch-qa'
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'pilot-readiness-test.html').write_text("""<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/super-admin-pilot-readiness.css">
<style>body{margin:0;font:14px system-ui;background:#faf9f7}.sa-card{padding:16px;border:1px solid #eee;border-radius:15px;background:#fff}main{max-width:900px;margin:auto;padding:12px}</style>
</head><body data-role="super_admin"><main><div id="pilot"></div></main>
<script src="/assets/super-admin-pilot-readiness.js"></script></body></html>""",encoding='utf8')
server=ThreadingHTTPServer(('127.0.0.1',4389),lambda *a,**kw:
 SimpleHTTPRequestHandler(*a,directory=str(ROOT),**kw))
Thread(target=server.serve_forever,daemon=True).start()
make_fake="""() => {
 const response={bite_provider_checks:0,restaurant_settlements:0,bite_refund_jobs:3};
 const logs=[];window.__logs=logs;window.__ok=true;
 const client={from(table){logs.push(table);return{select(fields,options){
  if(fields!=='id'||options.head!==true)throw Error('Sensitive row data requested');
  return {in(){return this},then(done){return Promise.resolve({count:response[table],error:null}).then(done)}};
 }}}};
 window.__client=client;
 return BitePilotReadiness.mount({client,container:document.getElementById('pilot'),isCurrent:()=>window.__ok});
}"""
with sync_playwright() as pw:
 browser=pw.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':900})
  page.goto('http://127.0.0.1:4389/dist/launch-qa/pilot-readiness-test.html')
  page.evaluate(make_fake)
  page.wait_for_function("document.getElementById('pilot').textContent.includes('Pilot Launch Readiness')")
  text=page.locator('#pilot').inner_text()
  assert 'Provider reconciliation records' in text
  assert 'merchant bank credit not proven' in text
  assert 'Restaurant settlement records' in text
  assert 'vendor bank payout not proven' in text
  assert 'Refunds awaiting follow-up' in text
  assert 'real Cashfree dashboard' in text
  assert page.evaluate('window.__logs.length')==3
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'horizontal overflow at {width}px'
  page.screenshot(path=str(OUT/f'super-admin-pilot-{width}.png'))
  print(f'PASS pilot readiness: 3 aggregate sources, no bank claims, {width}px')
  page.close()
 browser.close()
