#!/usr/bin/env python3
"""Click contracts on actual Owner markup/controllers, isolated synthetic transport.
SQL/security/concurrency are independently exercised by the PostgreSQL CI job.
"""
import json,os,re,subprocess,sys
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT)
OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,'scripts/prepare_completion_preview.py'],check=True)
base=(ROOT/'dist/qa/owner-flow.html').read_text()
fixture=(ROOT/'scripts/fixtures/hospitality_backend.js').read_text()
for kind in ['hotel','hybrid','restaurant']:
 html=base.replace('<script src="assets/owner-hospitality.js?v=20261116-1"></script>',f'<script>window.__BITE_HOSPITALITY_TYPE={json.dumps(kind)};</script><script>{fixture}</script><script src="assets/owner-hospitality.js?v=20261116-1"></script>')
 assert fixture in html
 (ROOT/f'dist/qa/{kind}-owner.html').write_text(html)
server=ThreadingHTTPServer(('127.0.0.1',4185),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw));Thread(target=server.serve_forever,daemon=True).start()
evidence=[];errors=[]
def check(ok,label):
 assert ok,label
 evidence.append({'case':label,'status':'PASS','layer':'synthetic browser UI'});print('PASS:',label)
def nav(page,route):
 b=page.locator(f'#biteOwnerBottomNav [data-bite-page="{route}"]')
 if b.count() and b.is_visible():b.click()
 else:
  more=page.locator('#biteOwnerBottomNav [data-bite-page=more]')
  if more.is_visible():
   more.click();page.locator(f'#biteOwnerMoreScreen [data-owner-route="{route}"]').click()
  else:page.locator(f'.nav [data-page="{route}"]').click()
 page.locator(f'#{route}.active').wait_for(state='visible')
def screenshot(page,label):
 page.screenshot(path=str(OUT/f'ui-universal-{label}.png'),full_page=True)
def entry(page,action,amount,description,method=None):
 page.locator(f'#folios [data-hotel-action=entry][data-id="{action}"]').click()
 f=page.locator('#bhActionEditor form');f.locator('[name=amount]').fill(str(amount));f.locator('[name=description]').fill(description)
 if method:f.locator('[name=method]').select_option(method)
 f.locator('button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached')
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch()
  for width in [360,390,1440]:
   for kind in ['restaurant','hotel','hybrid']:
    page=browser.new_page(viewport={'width':width,'height':900});page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
    page.route('**/*.supabase.co/**',lambda r:r.abort());page.route('**/api.cashfree.com/**',lambda r:r.abort())
    page.goto(f'http://127.0.0.1:4185/qa/{kind}-owner.html',wait_until='domcontentloaded')
    page.wait_for_function("document.body.dataset.businessType === '"+kind+"'")
    page.locator('#mainApp').wait_for(state='visible')
    check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'{kind} Home no horizontal overflow at {width}px')
    if width<760:
     actual=page.locator('#biteOwnerBottomNav [data-bite-page]').evaluate_all('(es)=>es.map(e=>e.dataset.bitePage)')
     expected=['overview','orders','pos','menu','more'] if kind=='restaurant' else ['overview','hotel-register','rooms','folios','more']
     check(actual==expected,f'{kind} capability tabs at {width}px')
     check(all(v>=44 for v in page.locator('#biteOwnerBottomNav button').evaluate_all('(es)=>es.map(e=>e.getBoundingClientRect().height)')),f'{kind} 44px navigation targets at {width}px')
    if kind=='hotel':
     check(page.locator('#overview [data-owner-dashboard]').is_hidden(),'Hotel Home hides restaurant workflow')
     nav(page,'rooms');check(page.locator('#rooms .bh-room-title').count()==2,'Real configured room cards render in shell')
     screenshot(page,f'{kind}-rooms-{width}')
     nav(page,'hotel-register');f=page.locator('#bhCheckinForm');f.locator('[name=full_name]').fill('Synthetic Walk-in');f.locator('[name=phone]').fill('9999999999');f.locator('[name=room_id]').select_option('room-a')
     f.locator('[data-hotel-action=save-draft]').click();check('Draft saved' in f.locator('.bh-message').inner_text(),'Registration draft is explicitly not checked in')
     f.locator('button[type=submit]').click();check(page.locator('.bh-review').is_visible(),'Guest/room review precedes mutation')
     check(page.evaluate('window.__BITE_HOTEL_QA.db.stays.length')==0,'Review does not allocate a room')
     screenshot(page,f'hotel-register-{width}')
     f.locator('button[type=submit]').click();page.locator('#folios.active').wait_for(state='visible');page.locator('#folios [data-hotel-action=entry]').first.wait_for(state='visible')
     check(page.evaluate('window.__BITE_HOTEL_QA.db.stays.length')==1,'Confirm check-in opens one stay and folio')
     entry(page,'charge',100,'Laundry')
     entry(page,'payment',500,'UPI received pending','UPI')
     check('verification pending' in page.locator('#folios').inner_text(),'Pending bank receipt is visible separately')
     page.locator('#folios [data-hotel-action=verify-payment]').click();ed=page.locator('#bhActionEditor form');ed.locator('[name=description]').fill('Verified UPI');ed.locator('[name=reference]').fill('SYNTHETIC-REFERENCE');ed.locator('button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached')
     entry(page,'payment',600,'Remaining cash','Cash')
     screenshot(page,f'hotel-folio-{width}')
     page.locator('#folios [data-hotel-action=checkout]').click();page.wait_for_function("window.__BITE_HOTEL_QA.db.stays[0].status==='checked_out'")
     check(page.evaluate("window.__BITE_HOTEL_QA.db.rooms[0].housekeeping==='dirty'"),'Checkout leaves room Dirty')
     check(page.locator('#folios [data-hotel-action=checkout]').count()==0,'Settled folio has no second checkout action')
     nav(page,'rooms');page.locator('[data-hotel-action=room-status][data-id=room-a]').click();ed=page.locator('#bhActionEditor form');ed.locator('[name=status]').select_option('cleaning');ed.locator('button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached')
     check(page.evaluate("window.__BITE_HOTEL_QA.db.rooms[0].housekeeping==='cleaning'"),'Housekeeping action updates existing room')
     nav(page,'settings');page.locator('#settings [data-hotel-action=modules]').click();page.locator('#business-modules.active').wait_for(state='visible')
     for _ in range(3):page.locator('#business-modules form button[type=submit]').click()
     check('Review & save' in page.locator('#business-modules').inner_text(),'Four-step module review works without duplicate registration')
     screenshot(page,f'hotel-modules-{width}')
    elif kind=='hybrid' and width<760:
     page.locator('#biteOwnerBottomNav [data-bite-page=more]').click()
     check(all(page.locator(f'#biteOwnerMoreScreen [data-owner-route={r}]').is_visible() for r in ['orders','pos','menu','reports','hr','settings']),'Hybrid More exposes food operations and shared tools')
     screenshot(page,f'hybrid-more-{width}')
    nav(page,'overview');screenshot(page,f'{kind}-home-{width}')
    page.close()
  check(not errors,'Universal Owner browser journeys have no JavaScript page errors')
  browser.close()
finally:
 server.shutdown();(OUT/'universal-owner-browser-evidence.json').write_text(json.dumps({'checks':evidence,'errors':errors},indent=2))
