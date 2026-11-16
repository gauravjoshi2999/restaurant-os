#!/usr/bin/env python3
"""Click contracts on actual Owner markup/controllers, isolated synthetic transport.
SQL/security/concurrency are independently exercised by the PostgreSQL CI job.
"""
import json,os,re,subprocess,sys,zipfile
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT)
OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,'scripts/prepare_completion_preview.py'],check=True)
base=(ROOT/'dist/qa/owner-flow.html').read_text()
fixture=(ROOT/'scripts/fixtures/hospitality_backend.js').read_text()
for kind in ['hotel','hybrid','restaurant','new','cashier']:
 html=base.replace('<script src="assets/owner-hospitality.js?v=20261116-2"></script>',f'<script>window.__BITE_HOSPITALITY_TYPE={json.dumps(kind)};</script><script>{fixture}</script><script src="assets/owner-hospitality.js?v=20261116-2"></script>')
 assert fixture in html
 if kind=='new':html=html.replace("window.__BITE_QA_ROLE='owner';","window.__BITE_QA_ROLE='new-hotel-owner';",1)
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
 page.evaluate('window.scrollTo(0,0)')
 page.screenshot(path=str(OUT/f'ui-universal-{label}.png'),full_page=page.viewport_size['width']>=1000)
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
     check(page.locator('#pageTitle').evaluate('(e)=>getComputedStyle(e).color')!='rgb(255, 255, 255)',f'{kind} header title readable on warm background')
    if width<760:
     actual=page.locator('#biteOwnerBottomNav [data-bite-page]').evaluate_all('(es)=>es.map(e=>e.dataset.bitePage)')
     expected=['overview','orders','pos','menu','more'] if kind=='restaurant' else ['overview','hotel-register','rooms','folios','more']
     check(actual==expected,f'{kind} capability tabs at {width}px')
     check(all(v>=44 for v in page.locator('#biteOwnerBottomNav button').evaluate_all('(es)=>es.map(e=>e.getBoundingClientRect().height)')),f'{kind} 44px navigation targets at {width}px')
    if kind=='hotel':
     check(page.locator('#overview [data-owner-dashboard]').is_hidden(),'Hotel Home hides restaurant workflow')
     if width==360:page.evaluate('window.__BITE_HOTEL_QA.delayMs=800')
     nav(page,'rooms')
     if width==360:check('Loading current property' in page.locator('#rooms').inner_text(),'Slow property response displays a loading state');page.locator('#rooms .bh-room-title').first.wait_for(state='visible');page.evaluate('window.__BITE_HOTEL_QA.delayMs=0')
     check(page.locator('#rooms .bh-room-title').count()==2,'Real configured room cards render in shell')
     screenshot(page,f'{kind}-rooms-{width}')
     nav(page,'hotel-register');f=page.locator('#bhCheckinForm');f.locator('[name=full_name]').fill('Synthetic Walk-in');f.locator('[name=phone]').fill('9999999999');f.locator('[name=room_id]').select_option('room-a')
     f.locator('[data-hotel-action=save-draft]').click();check('Draft saved' in f.locator('.bh-message').inner_text(),'Registration draft is explicitly not checked in')
     if width==360:
      page.reload(wait_until='domcontentloaded');page.wait_for_function("document.body.dataset.businessType==='hotel'");nav(page,'hotel-register');f=page.locator('#bhCheckinForm');check(f.locator('[name=full_name]').input_value()=='Synthetic Walk-in','Refresh restores a nonfinancial registration draft')
     f.locator('button[type=submit]').click();check(page.locator('.bh-review').is_visible(),'Guest/room review precedes mutation')
     check(page.evaluate('window.__BITE_HOTEL_QA.db.stays.length')==0,'Review does not allocate a room')
     if width==360:
      page.context.set_offline(True);f.locator('button[type=submit]').click();check('Offline' in f.locator('.bh-message').inner_text(),'Offline confirmation never claims a server check-in');check(page.evaluate('window.__BITE_HOTEL_QA.db.stays.length')==0,'Offline retry creates no stay');page.context.set_offline(False)
     screenshot(page,f'hotel-register-{width}')
     f.locator('button[type=submit]').click();page.locator('#folios.active').wait_for(state='visible');page.locator('#folios [data-hotel-action=entry]').first.wait_for(state='visible')
     check(page.evaluate('window.__BITE_HOTEL_QA.db.stays.length')==1,'Confirm check-in opens one stay and folio')
     if width==390:
      nav(page,'rooms');page.locator('[data-hotel-action=room-privacy][data-id=room-a]').click();ed=page.locator('#bhActionEditor form');ed.locator('[name=do_not_disturb]').check();ed.locator('[name=cleaning_requested]').check();ed.locator('button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached')
      check('Do Not Disturb' in page.locator('#rooms').inner_text(),'DND and stayover cleaning request are visible on the occupied room')
      page.locator('[data-hotel-action=room-status][data-id=room-a]').click();ed=page.locator('#bhActionEditor form');ed.locator('[name=status]').select_option('cleaning');ed.locator('button[type=submit]').click();check('Do Not Disturb' in ed.locator('.bh-message').inner_text(),'DND prevents starting cleaning through the UI')
      page.locator('[data-hotel-action=room-privacy][data-id=room-a]').click();ed=page.locator('#bhActionEditor form');ed.locator('[name=do_not_disturb]').uncheck();ed.locator('button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached');nav(page,'folios')
     entry(page,'charge',100,'Laundry')
     entry(page,'payment',500,'UPI received pending','UPI')
     check('verification pending' in page.locator('#folios').inner_text(),'Pending bank receipt is visible separately')
     page.locator('#folios [data-hotel-action=verify-payment]').click();ed=page.locator('#bhActionEditor form');ed.locator('[name=description]').fill('Verified UPI');ed.locator('[name=reference]').fill('SYNTHETIC-REFERENCE');ed.locator('button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached')
     entry(page,'payment',600,'Remaining cash','Cash')
     if width==390:
      page.locator('#folios [data-hotel-action=split-bill]').click();ed=page.locator('#bhActionEditor form');ed.locator('[name=first_name]').fill('Synthetic Company');ed.locator('[name=second_name]').fill('Synthetic Guest Payer');ed.locator('[name=first_percent]').fill('40');ed.locator('button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached');check('Synthetic Company' in page.locator('#folios').inner_text(),'Payer split saves without creating a second folio or receipt')
     screenshot(page,f'hotel-folio-{width}')
     if width==390:
      page.context.set_offline(True);page.locator('#folios [data-hotel-action=checkout]').click();check('Offline' in page.locator('#folios .bh-message').first.inner_text(),'Offline checkout never claims settlement');check(page.evaluate("window.__BITE_HOTEL_QA.db.stays[0].status==='in_house'"),'Interrupted checkout preserves the active stay');page.context.set_offline(False);page.locator('#folios [data-hotel-action=checkout]').wait_for(state='visible')
     page.locator('#folios [data-hotel-action=checkout]').click();page.wait_for_function("window.__BITE_HOTEL_QA.db.stays[0].status==='checked_out'")
     check(page.evaluate("window.__BITE_HOTEL_QA.db.rooms[0].housekeeping==='dirty'"),'Checkout leaves room Dirty')
     check(page.locator('#folios [data-hotel-action=checkout]').count()==0,'Settled folio has no second checkout action')
     if width==390:
      with page.expect_popup() as split:page.locator('#folios [data-hotel-action=split-preview]').first.click()
      check('Synthetic Company' in split.value.locator('body').inner_text(),'Settled split statement opens the first payer bill');split.value.close()
      nav(page,'hotel-register');ret=page.locator('#bhCheckinForm');ret.locator('[name=guest_search]').fill('9999999999');ret.locator('[name=guest_id]').select_option(index=1);check(ret.locator('[name=full_name]').input_value()=='Synthetic Walk-in','Returning guest lookup safely reuses the saved profile');check(page.evaluate('window.__BITE_HOTEL_QA.db.guests.length')==1,'Returning guest lookup creates no duplicate profile')
     nav(page,'rooms');page.locator('[data-hotel-action=room-status][data-id=room-a]').click();ed=page.locator('#bhActionEditor form');ed.locator('[name=status]').select_option('cleaning');ed.locator('button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached')
     check(page.evaluate("window.__BITE_HOTEL_QA.db.rooms[0].housekeeping==='cleaning'"),'Housekeeping action updates existing room')
     nav(page,'settings');page.locator('#settings [data-hotel-action=modules]').click();page.locator('#business-modules.active').wait_for(state='visible')
     for _ in range(3):page.locator('#business-modules form button[type=submit]').click()
     check('Review & save' in page.locator('#business-modules').inner_text(),'Four-step module review works without duplicate registration')
     screenshot(page,f'hotel-modules-{width}')
     nav(page,'reservations');page.locator('#reservations [data-hotel-action=group-booking]').click();ed=page.locator('#bhActionEditor form');ed.locator('[name=name]').fill('Synthetic family group');ed.locator('[name=guest_id]').select_option(index=1);[box.check() for box in ed.locator('[name=room_ids]').all()];ed.locator('button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached');check(page.evaluate('window.__BITE_HOTEL_QA.db.groups.length')==1,'Group booking opens linked individual room folios')
     nav(page,'reports');page.locator('#reports [data-hotel-form=report-filter] button[type=submit]').click()
     if width==390:
      page.locator('#bhOperationalReports [data-hotel-action=close-shift]').wait_for(state='visible');check('Food sales (source orders once)' in page.locator('#bhOperationalReports').inner_text(),'Combined report separates source food sales from hotel collections')
      page.locator('#bhOperationalReports [data-hotel-action=close-shift]').click();ed=page.locator('#bhActionEditor form');ed.locator('[name=opening_cash]').fill('100');ed.locator('[name=counted_cash]').fill('1200');ed.locator('button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached');page.locator('#bhOperationalReports').get_by_text('Closed ',exact=False).wait_for(state='visible');check(page.evaluate('window.__BITE_HOTEL_QA.db.closings.length')==1,'Combined closing records one immutable reviewed snapshot')
      audit=page.locator('[data-hotel-form=audit-search]');audit.locator('[name=query]').fill('checkout');audit.locator('button[type=submit]').click();check('checkout' in page.locator('#bhAuditResults').inner_text(),'Audit search queries the complete scoped history')
     if width==390:
      with page.expect_download() as download:page.locator('#reports [data-hotel-action=report-export]').click()
      saved=OUT/'hotel-ledger.xlsx';download.value.save_as(saved)
      check(b'Laundry' in zipfile.ZipFile(saved).read('xl/worksheets/sheet1.xml'),'Excel export contains actual selected hotel ledger rows')
      screenshot(page,'hotel-reports-390')
    elif kind=='restaurant' and width==390:
     nav(page,'pos');page.locator('#posNewSaleBtn').click();page.locator('#orderModal.show').wait_for(state='visible');page.locator('#posPickerItemName').fill('QA Veg');page.locator('#posMenuSuggestions button').first.click();page.locator('#posItemEntry [onclick="confirmPosItemInline()"]').click();page.locator('[name=bite_order_type]').select_option('POS - Takeaway');check(page.locator('#bitePOSTableField').is_hidden(),'Takeaway bill has no table assignment');page.locator('#posPaidAmount').fill('150');page.locator('#createOrderBtn').click();page.locator('#orderModal').wait_for(state='hidden');check(page.evaluate('window.__BITE_HOTEL_QA.db.sales[0].channel')=='POS - Takeaway','Existing POS creates a real typed takeaway command')
    elif kind=='hybrid' and width<760:
     page.locator('#biteOwnerBottomNav [data-bite-page=more]').click()
     check(all(page.locator(f'#biteOwnerMoreScreen [data-owner-route={r}]').is_visible() for r in ['orders','pos','menu','reports','hr','settings']),'Hybrid More exposes food operations and shared tools')
     screenshot(page,f'hybrid-more-{width}')
     if width==390:
      nav(page,'hotel-register');f=page.locator('#bhCheckinForm');f.locator('[name=full_name]').fill('Synthetic Room Diner');f.locator('[name=phone]').fill('8888888888');f.locator('[name=room_id]').select_option('room-a');f.locator('button[type=submit]').click();f.locator('button[type=submit]').click();page.locator('#folios.active [data-hotel-action=entry]').first.wait_for(state='visible')
      nav(page,'pos');page.locator('#posNewSaleBtn').click();page.locator('#orderModal.show').wait_for(state='visible');page.locator('#posPickerItemName').fill('QA Veg');page.locator('#posMenuSuggestions button').first.click();page.locator('#posItemEntry [onclick="confirmPosItemInline()"]').click();page.locator('[name=bite_tender]').select_option('room');page.wait_for_function('document.querySelector("#biteRoomPOSFolio").options.length>1');page.locator('#biteRoomPOSFolio').select_option(index=1);page.locator('[name=bite_food_discount]').fill('10');page.locator('[name=bite_discount_reason]').fill('Synthetic loyalty discount');page.locator('#createOrderBtn').click();page.locator('#orderModal').wait_for(state='hidden');page.wait_for_function('!document.querySelector("#createOrderBtn").disabled')
      check('Room folio' in page.locator('#posRows').inner_text(),'Existing POS displays room transfer instead of a second collection');check('140' in page.locator('#posSalesTotal').inner_text() and 'Discount / waiver' in page.locator('#posRows').inner_text(),'Room discount appears in both the net POS sale and its folio charge')
      nav(page,'folios');entry(page,'charge',100,'Room laundry');entry(page,'payment',1240,'Room checkout cash','Cash');page.locator('#folios [data-hotel-action=checkout]').click();page.wait_for_function("window.__BITE_HOTEL_QA.db.stays[0].status==='checked_out'")
      check(len(page.evaluate('window.__BITE_HOTEL_QA.db.entries.filter(e=>e.category==="food")'))==1,'Hybrid checkout includes one source POS food charge')
      with page.expect_popup() as popup:page.locator('#folios [data-hotel-action=preview]').click()
      check('Synthetic Room Diner' in popup.value.locator('body').inner_text(),'Invoice preview opens the correct guest statement');popup.value.close()
      screenshot(page,'hybrid-checkout-390')
      nav(page,'pos')
      with page.expect_popup() as linked_invoice:page.locator('#posRows [data-room-folio-invoice]').click()
      check('Synthetic Room Diner' in linked_invoice.value.locator('body').inner_text() and '1,240' in linked_invoice.value.locator('body').inner_text(),'Room-linked POS PDF uses the guest folio statement after settlement');linked_invoice.value.close()
    nav(page,'overview');screenshot(page,f'{kind}-home-{width}')
    page.close()
  page=browser.new_page(viewport={'width':390,'height':900});page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.route('**/*.supabase.co/**',lambda r:r.abort())
  page.goto('http://127.0.0.1:4185/qa/new-owner.html',wait_until='domcontentloaded');page.locator('#business-modules.active').wait_for(state='visible')
  page.locator('#business-modules [name=business_type][value=hotel]').check();page.locator('#business-modules button[type=submit]').click();page.locator('#business-modules [name=name]').fill('Synthetic newly created hotel');page.locator('#business-modules button[type=submit]').click();page.locator('#business-modules button[type=submit]').click();screenshot(page,'new-hotel-setup-review-390');page.locator('#business-modules button[type=submit]').click();page.wait_for_function("document.body.dataset.businessType==='hotel'")
  check(page.evaluate('window.__BITE_HOTEL_QA.db.rooms.length')==0,'New hotel onboarding creates no invented rooms')
  nav(page,'rooms');page.locator('#rooms [data-hotel-action=new-room]').click();ed=page.locator('#bhActionEditor form');ed.locator('[name=number]').fill('301');ed.locator('[name=nightly_rate]').fill('1200');ed.locator('button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached');check(page.locator('#rooms .bh-room-title').count()==1,'New hotel owner adds a real room through existing app')
  nav(page,'hr');staff=page.locator('#hr [data-hotel-form=member]');staff.locator('[name=email]').fill('accountant@example.test');staff.locator('[name=role]').select_option('accountant');staff.locator('button[type=submit]').click();page.wait_for_function("window.__BITE_HOTEL_QA.db.members.length===1");check('accountant@example.test' in page.locator('#hr .bh-record').inner_text(),'Staff account access uses verified email instead of internal identifiers');page.close()
  page=browser.new_page(viewport={'width':390,'height':900});page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.route('**/*.supabase.co/**',lambda r:r.abort());page.goto('http://127.0.0.1:4185/qa/cashier-owner.html',wait_until='domcontentloaded');page.wait_for_function("document.body.dataset.businessType==='restaurant'")
  check(page.locator('#accountRole').inner_text()=='CASHIER','Cashier signs into the same Owner shell with their property role');check(page.locator('#biteOwnerBottomNav [data-bite-page=menu]').count()==0,'Cashier navigation excludes menu management and hotel identity screens')
  nav(page,'pos');page.locator('#posNewSaleBtn').click();page.locator('#orderModal.show').wait_for(state='visible');page.locator('#posPickerItemName').fill('QA Veg');page.locator('#posMenuSuggestions button').first.click();page.locator('#posItemEntry [onclick="confirmPosItemInline()"]').click();page.locator('[name=bite_order_type]').select_option('POS - Dine-in');page.locator('#posPaidAmount').fill('150');page.locator('#createOrderBtn').click();page.locator('#orderModal').wait_for(state='hidden');check(page.evaluate('window.__BITE_HOTEL_QA.db.sales[0].channel')=='POS - Dine-in','Cashier reuses the existing POS editor to save a dine-in bill');screenshot(page,'cashier-pos-390');page.close()
  page=browser.new_page(viewport={'width':1440,'height':900});page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*.supabase.co/**',lambda r:r.abort());page.goto('http://127.0.0.1:4185/qa/admin-flow.html',wait_until='domcontentloaded');page.wait_for_function("document.body.dataset.role==='super_admin'");check(page.locator('#bitePropertySelect').is_hidden(),'Admin shell hides the Owner property selector');check(page.locator('#biteHotelHome').is_hidden(),'Admin shell does not display hotel operations');page.close()
  check(not errors,'Universal Owner browser journeys have no JavaScript page errors')
  browser.close()
finally:
 server.shutdown();(OUT/'universal-owner-browser-evidence.json').write_text(json.dumps({'checks':evidence,'errors':errors},indent=2))
