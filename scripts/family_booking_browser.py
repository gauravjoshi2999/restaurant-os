#!/usr/bin/env python3
"""Synthetic Chromium QA for Family / Multiple Rooms inside the real Owner Check-in."""
import json,os,re,subprocess,sys
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
subprocess.run([sys.executable,"scripts/prepare_completion_preview.py"],check=True)
base=(ROOT/"dist/qa/owner-flow.html").read_text()
fixture=(ROOT/"scripts/fixtures/hospitality_backend.js").read_text()
needle=re.search(r'<script src="assets/owner-hospitality.js\?[^"\n]+"></script>',base).group()
for kind in ('hotel','hybrid','restaurant'):
 html=base.replace(needle,f'<script>window.__BITE_HOSPITALITY_TYPE={json.dumps(kind)};</script><script>{fixture}</script>'+needle)
 (ROOT/f'dist/qa/family-{kind}.html').write_text(html)
server=ThreadingHTTPServer(('127.0.0.1',4199),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw))
Thread(target=server.serve_forever,daemon=True).start()
def check(value,message):
 assert value,message
 print("PASS:",message,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch()
  for width in [320,360,390,430]:
   for kind in ['hotel','hybrid','restaurant']:
    page=browser.new_page(viewport={'width':width,'height':860})
    page.route('**/*.supabase.co/**',lambda r:r.abort())
    page.route('**/api.cashfree.com/**',lambda r:r.abort())
    errs=[]
    page.on('pageerror',lambda e:errs.append(str(e)))
    page.goto(f'http://127.0.0.1:4199/qa/family-{kind}.html',wait_until='domcontentloaded')
    page.wait_for_function(f"document.body.dataset.businessType==='{kind}'")
    page.locator('#mainApp').wait_for(state='visible')
    if kind=='restaurant':
     check(page.locator('#hotel-register').count()==0 or page.locator('#hotel-register').is_hidden(),f'{kind} {width}px no Hotel Check-in in restaurant UI')
    else:
     page.evaluate("showPage('hotel-register')")
     form=page.locator('#bhCheckinForm')
     form.wait_for(state='visible')
     checkbox=form.locator('[name=family_enabled]')
     check(checkbox.count()==1,f'{kind} {width}px family mode in canonical check-in')
     check(form.locator('[name=family_room_ids]').count()==2,f'{kind} {width}px both physical rooms are selectable')
     form.locator('[name=room_id]').select_option('room-a')
     checkbox.check()
     room_b=form.locator('[name=family_room_ids][value=room-b]')
     room_b.check()
     check(form.locator('[name=family_room_ids][value=room-a]').is_disabled(),f'{kind} {width}px lead room cannot be added twice')
     check(form.locator('[name=family_rate_room-b]').is_visible(),f'{kind} {width}px additional nightly rate editable')
     check(form.locator('[name=family_children_room-b]').is_visible(),f'{kind} {width}px children per room')
     form.locator('[name=family_adults_room-b]').fill('2')
     form.locator('[name=family_children_room-b]').fill('2')
     summary=form.locator('[data-family-total]').inner_text()
     check('2 rooms' in summary and '2 children' in summary and '5 guests' in summary,f'{kind} {width}px family quote counts all adults and children')
     check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'{kind} {width}px no horizontal scroll')
     form.locator('[name=family_enabled]').uncheck()
     check(form.locator('[data-family-fields]').is_hidden(),f'{kind} {width}px standard single room mode preserved')
    check(not errs,f'{kind} {width}px no JS page errors: {errs[:1]}')
    page.close()
  browser.close()
finally:
 server.shutdown()
