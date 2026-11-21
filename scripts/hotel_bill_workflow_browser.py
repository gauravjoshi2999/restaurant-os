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
  family=p.locator('[data-h12-family-bill]')
  family.wait_for(state='visible')
  check('₹2,950.00' in family.inner_text(),'H12 family total shows both room folios once')
  check(family.locator('details').count()==2,'H12 family bill has one expandable ledger per room')
  before=p.evaluate('JSON.stringify(__BITE_HOTEL_QA.db.entries)')
  family.locator('summary').first.click()
  check(family.locator('details[open] .bh-guest-bill-line').count()>0,'H12 expanded room displays existing ledger entries')
  check(p.evaluate('JSON.stringify(__BITE_HOTEL_QA.db.entries)')==before,'Family ledger review creates no charge or receipt')
  check(p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Family bill fits mobile width')
  p.locator('[data-bill-action=booking-select-checkout]').click();selection=p.locator('[data-bill-form=select-rooms]');selection.wait_for()
  check(selection.locator('[name=selection]').count()==2,'H13 lists two active rooms as individual checkboxes')
  room_b=p.evaluate("(__BITE_HOTEL_QA.db.folios.find(f=>f.stay_id===__BITE_HOTEL_QA.db.stays.find(s=>s.room_id==='room-b').id)).id")
  selection.locator('[name=selection][value="'+room_b+'"]').check()
  selection.locator('[type=submit]').click();single=p.locator('[data-bill-form=checkout]');single.wait_for()
  check(single.get_attribute('data-group')=='false' and single.get_attribute('data-id')==room_b and float(single.locator('[name=amount]').input_value())==900,'Selected room reviews only its own balance')
  check(p.evaluate('__BITE_HOTEL_QA.db.stays.every(s=>s.status==="in_house")'),'Room selection does not checkout any room')
  single.locator('[data-bill-action=close]').click()
  p.locator('[data-bill-action=booking-checkout]').click();form=p.locator('[data-bill-form=checkout]');form.wait_for();check(form.get_attribute('data-group')=='true','One checkout can collect the combined room balance')
  form.locator('[type=submit]').click();p.wait_for_function('__BITE_HOTEL_QA.db.stays.every(s=>s.status==="checked_out")')
  check(p.evaluate('__BITE_HOTEL_QA.db.entries.filter(e=>e.kind==="payment").reduce((n,e)=>n+e.amount,0)')==2950,'Combined collection is allocated once across room bills')
  with p.expect_popup()as event:p.locator('[data-bill-action=booking-bill]').click()
  combined=event.value;combined.get_by_text('Booking statement · 2 rooms',exact=True).wait_for();check('₹2,950.00'in combined.locator('body').inner_text(),'Combined bill attaches both room invoices with the correct total');combined.close();p.close()
  p=open_page(browser);seed(p)
  p.evaluate("""() => {const d=__BITE_HOTEL_QA.db,original=d.stays[0];original.group_id='selected-group';
  d.rooms.push({id:'room-c',number:'103',room_type:'Deluxe',nightly_rate:700,adults:2,children:0,active:true,housekeeping:'ready'});
  d.groups.push({id:'selected-group',name:'Synthetic selected rooms',payer_guest_id:original.guest_id});
  for(const [id,room,amount] of [['two','room-b',900],['three','room-c',700]]){
   d.stays.push({...original,id:'selected-'+id,room_id:room,nightly_rate:amount});
   d.folios.push({id:'selected-folio-'+id,stay_id:'selected-'+id,status:'open'});
   d.entries.push({id:'selected-charge-'+id,folio_id:'selected-folio-'+id,kind:'charge',category:'room',amount,tax_amount:0,status:'confirmed',description:'Synthetic room rent'});
  }}""")
  p.evaluate("BiteHospitality.reload()")
  p.evaluate("BiteHospitality.redraw()")
  p.locator('[data-bill-action=booking-select-checkout]').click()
  rooms=p.locator('[data-bill-form=select-rooms]')
  rooms.locator('[name=selection][value="folio-bill"]').check()
  rooms.locator('[name=selection][value="selected-folio-three"]').check()
  rooms.locator('[type=submit]').click();selected=p.locator('[data-bill-form=checkout]');selected.wait_for()
  check(float(selected.locator('[name=amount]').input_value())==2750,'H13 two of three rooms show selected balance only')
  before=p.evaluate("JSON.stringify(__BITE_HOTEL_QA.db.entries)")
  with p.expect_popup() as event:selected.locator('[data-bill-action=checkout-preview]').click()
  preview=event.value;preview.get_by_text('Booking statement · 2 rooms',exact=True).wait_for()
  check('₹2,750.00' in preview.locator('body').inner_text(),'H13 draft preview covers selected room bills only')
  check(p.evaluate("JSON.stringify(__BITE_HOTEL_QA.db.entries)")==before,'Checkout preview creates no receipt')
  preview.close()
  check('Unpaid credit checkout is not enabled' in selected.inner_text(),'H13 unpaid balance cannot be mistaken for recorded payment')
  selected.locator('[name=method]').select_option('Split')
  selected.locator('[name=cash_amount]').fill('1000')
  selected.locator('[name=upi_amount]').fill('1700')
  check(selected.locator('[type=submit]').is_disabled(),'H13 wrong split total blocks checkout')
  selected.locator('[name=upi_amount]').fill('1750')
  selected.locator('[name=reference]').fill('SYNTHETIC-SPLIT')
  check(selected.locator('[type=submit]').is_disabled(),'H13 unverified UPI blocks checkout')
  selected.locator('[name=verified]').check()
  check(selected.locator('[type=submit]').is_enabled(),'H13 exact verified split enables checkout')
  selected.locator('[type=submit]').click()
  p.wait_for_function("__BITE_HOTEL_QA.db.stays.filter(x=>x.status==='checked_out').length===2")
  check(p.evaluate("__BITE_HOTEL_QA.db.entries.filter(e=>e.kind==='payment'&&e.status==='confirmed'&&e.method==='Cash').reduce((a,e)=>a+e.amount,0)")==1000,'H13 Cash receipts match selected tender')
  check(p.evaluate("__BITE_HOTEL_QA.db.entries.filter(e=>e.kind==='payment'&&e.status==='confirmed'&&e.method==='UPI').reduce((a,e)=>a+e.amount,0)")==1750,'H13 UPI receipts match selected tender')
  check(p.evaluate("__BITE_HOTEL_QA.db.stays.find(x=>x.id==='selected-two').status==='in_house'"),'H13 unselected room remains active')
  check(p.evaluate("__BITE_HOTEL_QA.calls.some(x=>x.args?.p_action==='booking_checkout_collect'&&x.args?.p_payload?.selected_only===true)"),'H13 subset uses explicit atomic server action')
  p.close()
  browser.close()
 check(not errors,'No hotel billing controller errors')
except Exception:
 try:
  p.screenshot(path=str(OUT/'ui-hotel-bill-failure.png'),full_page=True)
  (OUT/'hotel-bill-failure-debug.json').write_text(json.dumps({'body':p.locator('body').inner_text(),'errors':errors,'state':p.evaluate('({db:__BITE_HOTEL_QA.db,calls:__BITE_HOTEL_QA.calls})')},indent=2))
 except Exception:pass
 raise
finally:
 server.shutdown();(OUT/'hotel-bill-workflow-evidence.json').write_text(json.dumps({'checks':checks,'page_errors':errors,'scope':'Synthetic test records only. Database transaction tests separately verify accounting, roles and atomic checkout.'},indent=2))
