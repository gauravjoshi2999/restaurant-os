#!/usr/bin/env python3
"""Owner V3 PDF H04/H05 — actual click paths on isolated synthetic hotel transport."""
import json,os,re,subprocess,sys
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
subprocess.run([sys.executable,'scripts/prepare_completion_preview.py'],check=True)
base=(ROOT/'dist/qa/owner-flow.html').read_text()
fixture=(ROOT/'scripts/fixtures/hospitality_backend.js').read_text()
needle=re.search(r'<script src="assets/owner-hospitality.js\?[^"\n]+"></script>',base).group()
html=base.replace(needle,'<script>window.__BITE_HOSPITALITY_TYPE="hotel";</script><script>'+fixture+'</script>'+needle)
assert needle in html
(ROOT/'dist/qa/owner-room-detail.html').write_text(html)
OUT=ROOT/'dist/launch-qa'
OUT.mkdir(parents=True,exist_ok=True)
server=ThreadingHTTPServer(('127.0.0.1',4196),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw))
Thread(target=server.serve_forever,daemon=True).start()
passed=[]
errors=[]
def check(ok,label):
 assert ok,label
 passed.append(label)
 print('PASS:',label,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch()
  for width in (320,360,390,430,1024):
   page=browser.new_page(viewport={'width':width,'height':900})
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('dialog',lambda d:d.accept())
   page.route('**/*.supabase.co/**',lambda r:r.abort())
   page.goto('http://127.0.0.1:4196/qa/owner-room-detail.html',wait_until='domcontentloaded')
   page.wait_for_function("document.body.dataset.businessType==='hotel'")
   page.evaluate("showPage('rooms')")
   page.locator('#rooms.active .bh-room-grid .bh-room-card').first.wait_for(state='visible')
   cards=page.locator('#rooms .bh-room-card')
   check(cards.count()==2,f'{width}px real room board shows only two fixture rooms')
   overview=page.locator('#rooms .bh-room-overview').inner_text()
   check('Reserved today' in overview and 'Other / unavailable' in overview,
         f'{width}px room overview distinguishes non-available states')
   page.locator('#rooms [data-hotel-action=room-details][data-id=room-a]').click()
   detail=page.locator('#rooms #bhActionEditor .bh-room-detail')
   detail.wait_for(state='visible')
   check('Room 101' in detail.inner_text() and 'Available today' in detail.inner_text(),
         f'{width}px H05 shows correct vacant room and current status')
   check(detail.locator('[data-hotel-action=room-detail-checkin]').count()==1,
         f'{width}px available room offers non-mutating new check-in')
   check(detail.locator('[data-hotel-action=room-status]').count()==0,
         f'{width}px housekeeping OFF hides readiness changes')
   check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),
         f'{width}px room detail has no horizontal overflow')
   page.screenshot(path=str(OUT/f'owner-h04-h05-{width}.png'))
   detail.locator('[data-hotel-action=room-detail-checkin]').click()
   form=page.locator('#hotel-register.active #bhCheckinForm')
   form.wait_for(state='visible')
   check(form.locator('[name=room_id]').input_value()=='room-a',
         f'{width}px room shortcut preselects room 101 without booking it')
   check(page.evaluate("window.__BITE_HOTEL_QA.db.stays.length===0"),
         f'{width}px room shortcut creates no stay or payment')

   # Add source-linked synthetic front-desk data (never a production write).
   page.evaluate("""() => {
    const q=window.__BITE_HOTEL_QA,d=q.db,t=window.BiteOwner.day();
    const tomorrow=new Date(Date.parse(t+'T12:00:00+05:30')+2*86400000).toISOString().slice(0,10);
    d.guests.push({id:'synthetic-guest',property_id:q.property.id,full_name:'Synthetic Guest'});
    d.stays.push({id:'synthetic-stay',property_id:q.property.id,room_id:'room-a',guest_id:'synthetic-guest',status:'in_house',arrival:t,departure:tomorrow});
    d.folios.push({id:'synthetic-folio',property_id:q.property.id,stay_id:'synthetic-stay',status:'open'});
    d.entries.push({id:'synthetic-charge',folio_id:'synthetic-folio',kind:'charge',category:'room',amount:1200,status:'confirmed',tax_amount:0});
    d.entries.push({id:'synthetic-receipt',folio_id:'synthetic-folio',kind:'payment',amount:300,method:'Cash',status:'confirmed'});
   }""")
   page.evaluate("BiteHospitality.reload()")
   page.evaluate("showPage('rooms')")
   page.locator('#rooms.active [data-hotel-action=room-details][data-id=room-a]').click()
   detail=page.locator('#rooms #bhActionEditor .bh-room-detail')
   check('Synthetic Guest' in detail.inner_text() and '₹900' in detail.inner_text(),
         f'{width}px H05 uses original guest and folio balance, not sample totals')
   check(detail.locator('[data-hotel-action=room-detail-checkin]').count()==0,
         f'{width}px occupied room never offers a new check-in')
   check(detail.locator('[data-hotel-action=room-detail-extra]').count()==1,
         f'{width}px active guest can open existing hotel-extra form')
   detail.locator('[data-hotel-action=room-detail-extra]').click()
   page.locator('#folios.active #bhActionEditor form[data-action=charge]').wait_for(state='visible')
   check(page.locator('#folios [data-hotel-form=entry] [name=amount]').count()==1,
         f'{width}px extra charges reuse the existing folio entry form')
   check(page.evaluate("window.__BITE_HOTEL_QA.db.entries.length===2"),
         f'{width}px opening extra form posts no unapproved charge')
   page.close()
  check(not errors,'No uncaught page JavaScript errors: '+str(errors[:3]))
  browser.close()
finally:
 server.shutdown()
 (OUT/'owner-h04-h05-evidence.json').write_text(json.dumps({'checks':passed,'errors':errors},indent=2))
