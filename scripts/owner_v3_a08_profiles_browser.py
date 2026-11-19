#!/usr/bin/env python3
"""Owner V3 A08 profile cards across phone/desktop, synthetic data only."""
from pathlib import Path
from threading import Thread
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
import os
root=Path(__file__).resolve().parents[1];os.chdir(root)
out=root/'dist/launch-qa';out.mkdir(parents=True,exist_ok=True)
(out/'a08-profiles-preview.html').write_text("""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/owner-v3-employee-profiles.css">
<style>body{font:14px system-ui;margin:0;background:#faf9fd}#hr{box-sizing:border-box;padding:12px;max-width:900px;margin:auto}</style></head>
<body data-role="owner"><main id="hr">
<label>Employee search<input id="query" aria-label="Search"></label>
<div id="hrProfileCards"></div></main>
<script src="/assets/owner-v3-employee-profiles.js"></script></body></html>""",encoding='utf8')
server=ThreadingHTTPServer(('127.0.0.1',4329),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(root),**kw))
Thread(target=server.serve_forever,daemon=True).start()
fixture="""() => {
const rid='11111111-1111-4111-8111-111111111111';
const data=[
{id:'33333333-3333-4333-8333-333333333333',restaurant_id:rid,full_name:'Synthetic Reception',position:'Reception',status:'Active',employee_code:'SYN-001'},
{id:'44444444-4444-4444-8444-444444444444',restaurant_id:rid,full_name:'Synthetic Cook',position:'Cook',status:'Inactive'},
{id:'55555555-5555-4555-8555-555555555555',restaurant_id:'22222222-2222-4222-8222-222222222222',full_name:'Other tenant',status:'Active'}
];
window.__clicked=[];const host=document.getElementById('hrProfileCards');
host.innerHTML=BiteOwnerA08Profiles.html(data,{restaurantId:rid,visibility:'all',day:'2026-10-01',verifiedDay:{date:'2026-10-01',rows:[{id:data[0].id,status:'Present'}]}});
host.addEventListener('click',e=>{let b=e.target.closest('[data-a08p-action]');if(b)window.__clicked.push(b.dataset.a08pAction)});
}"""
with sync_playwright() as p:
 browser=p.chromium.launch()
 for width in (320,360,390,430,1024):
  page=browser.new_page(viewport={'width':width,'height':850})
  page.goto('http://127.0.0.1:4329/dist/launch-qa/a08-profiles-preview.html')
  page.evaluate(fixture)
  text=page.locator('#hrProfileCards').inner_text()
  assert 'Synthetic Reception' in text and 'Synthetic Cook' in text
  assert 'Other tenant' not in text and 'Present' in text
  assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),f'A08 horizontal overflow at {width}'
  page.locator('[data-a08p-action="edit"]').first.click()
  assert page.evaluate('window.__clicked[0]')=='edit'
  page.screenshot(path=str(out/f'a08-profiles-{width}.png'),full_page=True)
  print('PASS A08 staff cards',width)
  page.close()
 browser.close()
