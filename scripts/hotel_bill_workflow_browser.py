#!/usr/bin/env python3
"""Actual hotel billing controllers, synthetic data and transport; never production writes."""
import json,os
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
from prepare_checkin_scenarios import prepare
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT);prepare();OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
server=ThreadingHTTPServer(('127.0.0.1',4197),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw));Thread(target=server.serve_forever,daemon=True).start()
checks=[];errors=[]
def check(ok,label):
 assert ok,label
 print('PASS:',label);checks.append({'case':label,'status':'PASS'})
def nav(p,route):p.evaluate('(r)=>showPage(r)',route);p.locator('#'+route+'.active').wait_for()
def seed(p,paid=False,gst=False):
 p.evaluate('''({paid,gst})=>{
 const q=__BITE_HOTEL_QA,day=BiteOwner.day(),tom=BiteOwner.day(new Date(Date.now()+86400000));
 q.db.guests=[{id:'guest-bill',full_name:'Synthetic hotel guest',phone:'9999999999',country:'India',address:'Synthetic address'}];
 const front=crypto.randomUUID(),back=crypto.randomUUID();
 for(const id of [front,back])__BITE_DOCUMENT_QA.rows.set(id,{id,guest_id:'guest-bill',kind:'masked_id',status:'ready',subject_key:null,object_path:'synthetic/'+id});
 q.db.stays=[{id:'stay-bill',guest_id:'guest-bill',room_id:'room-a',status:'in_house',arrival:day,departure:tom,adults:1,children:0,nightly_rate:1400,registration:{flow_version:3,male:1,female:0,children:0,arrived_from:'Udaipur',next_destination:'Jaipur',transport:'Bus',id_front:front,id_back:back}}];
 q.db.folios=[{id:'folio-bill',stay_id:'stay-bill',status:'open'}];
 q.db.entries=[{id:'room-charge',folio_id:'folio-bill',kind:'charge',category:'room',amount:1400,tax_amount:0,status:'confirmed',description:'1 night',created_at:new Date().toISOString()},{id:'food-charge',folio_id:'folio-bill',kind:'charge',category:'food',amount:650,tax_amount:0,status:'confirmed',description:'POS-ROOM-SYNTHETIC-INTERNAL-ID',source_items:[{name:'Synthetic vegetarian meal',quantity:1,unit_price:650}],created_at:new Date().toISOString()}];
 if(paid)q.db.entries.push({id:'cash-paid',folio_id:'folio-bill',kind:'payment',category:'payment',amount:2050,status:'confirmed',method:'Cash'},{id:'upi-pending',folio_id:'folio-bill',kind:'payment',category:'payment',amount:400,status:'pending',method:'UPI',reference:'SYNTHETIC-UPI'});
 q.property.tax_profile=gst?{gstin:'08ABCDE1234F1Z5',reviewed:true,room_rate:5,food_rate:5,incidental_rate:5}:{reviewed:false};
 }''',{'paid':paid,'gst':gst})
 p.evaluate('BiteHospitality.refreshContext()');nav(p,'rooms');p.locator('[data-hotel-action=room-guest]').click();p.locator('#folios.active').wait_for()
def open_page(browser,width=390):
 p=browser.new_page(viewport={'width':width,'height':950});p.on('pageerror',lambda e:errors.append(str(e)));p.on('dialog',lambda d:d.accept());p.route('**/*.supabase.co/**',lambda r:r.abort());p.goto('http://127.0.0.1:4197/qa/checkin-personal-review.html',wait_until='domcontentloaded');p.wait_for_function("document.body.dataset.businessType==='hotel'");return p
try:
 with sync_playwright()as pw:
  browser=pw.chromium.launch()
  for width in [360,390,1440]:
   p=open_page(browser,width);seed(p,paid=True)
   check('Synthetic hotel guest'in p.locator('#folios').inner_text()and'9999999999'in p.locator('#folios').inner_text(),'Occupied room opens its guest details at '+str(width)+'px')
   check(p.locator('#folios summary').filter(has_text='Other services & refunds').count()==0,'Unused services panel is hidden')
   p.locator('[data-ha-action=checkout]').click();form=p.locator('[data-bill-form=checkout]');form.wait_for()
   check(form.locator('button[type=submit]').is_disabled()and'₹400.00 UPI'in form.inner_text(),'Zero balance explains its exact pending UPI receipt')
   p.screenshot(path=str(OUT/f'ui-hotel-checkout-pending-{width}.png'))
   form.locator('[data-bill-action=receipt-no]').click();form.locator('button[type=submit]:not([disabled])').wait_for()
   check(p.evaluate('__BITE_HOTEL_QA.db.entries.find(e=>e.id==="upi-pending").status')=='void','Not received resolves only the pending entry')
   form.locator('button[type=submit]').click();p.wait_for_function('__BITE_HOTEL_QA.db.stays[0].status==="checked_out"')
   check(p.evaluate('__BITE_HOTEL_QA.db.rooms[0].housekeeping')=='ready','Housekeeping OFF releases the checked-out room immediately')
   check(p.locator('[data-bill-action=rooms]').is_visible(),'Completed checkout offers Back to rooms')
   p.locator('[data-bill-action=rooms]').click();p.locator('#rooms.active').wait_for();check('Not ready'not in p.locator('#rooms').inner_text(),'Room board has no Not ready state while housekeeping is OFF')
   p.close()
  p=open_page(browser);seed(p,gst=True)
  with p.expect_popup()as event:p.locator('[data-hotel-action=preview]').click()
  bill=event.value;bill.wait_for_load_state();bill.get_by_text('Bill total',exact=True).wait_for()
  text=bill.locator('body').inner_text()
  check('₹2,152.50'in text and'CGST 2.5%'in text and'SGST 2.5%'in text,'Room ₹1,400 + food ₹650 adds ₹102.50 GST')
  check('POS-ROOM-'not in text and'Synthetic vegetarian meal'in text,'Guest bill shows food items without internal POS IDs')
  check(bill.get_by_role('link',name='Back to Partner').is_visible(),'Bill has a visible return to Partner button')
  check(bill.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'GST bill fits a mobile viewport')
  bill.screenshot(path=str(OUT/'ui-hotel-gst-bill-390.png'),full_page=True);bill.close();p.close()
  p=open_page(browser);seed(p)
  p.locator('[data-bill-action=tax-settings]').click();tax=p.locator('[data-bill-form=tax]');tax.locator('[name=mode]').select_option('gst');tax.locator('[name=gstin]').fill('08ABCDE1234F1Z5');tax.locator('[name=reviewed]').check();tax.locator('[type=submit]').click();p.wait_for_function('__BITE_HOTEL_QA.db.folios[0].bill_tax_profile?.billing_mode==="gst"')
  check(p.evaluate('__BITE_HOTEL_QA.db.entries.reduce((n,e)=>n+Number(e.tax_amount||0),0)')==102.5,'Owner can enable GST and update an unissued bill')
  p.close()
  p=open_page(browser);seed(p)
  p.locator('[data-hotel-action=add-guest-room]').click();f=p.locator('#bhCheckinForm');f.wait_for()
  p.wait_for_function("!!document.querySelector('#bhCheckinForm [name=id_back_id]').value")
  check(f.locator('[name=guest_id]').input_value()=='guest-bill'and f.locator('[name=booking_stay_id]').input_value()=='stay-bill','Second room reuses the same guest and linked booking')
  f.locator('[name=room_id]').select_option('room-b');f.locator('[name=nightly_rate]').fill('900');f.locator('[name=id_checked]').check();f.locator('[type=submit]').click();f.locator('.bh-review').wait_for();f.locator('[type=submit]').click();p.locator('#folios.active').wait_for();p.wait_for_function('__BITE_HOTEL_QA.db.stays.length===2')
  check(p.evaluate('__BITE_HOTEL_QA.db.guests.length===1&&__BITE_DOCUMENT_QA.rows.size===2'),'Two rooms keep one guest profile and reuse both ID sides')
  check(p.locator('.bh-linked-booking').is_visible(),'Both room bills appear in one booking panel')
  p.locator('[data-bill-action=booking-checkout]').click();form=p.locator('[data-bill-form=checkout]');form.wait_for();check(form.get_attribute('data-group')=='true','One checkout can collect the combined room balance')
  form.locator('[type=submit]').click();p.wait_for_function('__BITE_HOTEL_QA.db.stays.every(s=>s.status==="checked_out")')
  check(p.evaluate('__BITE_HOTEL_QA.db.entries.filter(e=>e.kind==="payment").reduce((n,e)=>n+e.amount,0)')==2950,'Combined collection is allocated once across room bills')
  with p.expect_popup()as event:p.locator('[data-bill-action=booking-bill]').click()
  combined=event.value;combined.get_by_text('Booking statement · 2 rooms',exact=True).wait_for();check('₹2,950.00'in combined.locator('body').inner_text(),'Combined bill attaches both room invoices with the correct total');combined.close();p.close()
  browser.close()
 check(not errors,'No hotel billing controller errors')
finally:
 server.shutdown();(OUT/'hotel-bill-workflow-evidence.json').write_text(json.dumps({'checks':checks,'page_errors':errors,'scope':'Synthetic test records only. Database transaction tests separately verify accounting, roles and atomic checkout.'},indent=2))
