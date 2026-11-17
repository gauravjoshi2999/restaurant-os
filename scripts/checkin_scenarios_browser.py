#!/usr/bin/env python3
"""25 real check-in situations using real UI controllers and synthetic transports."""
import base64,json,os,random,struct,zlib
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright
from prepare_checkin_scenarios import prepare
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT);prepare()
OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
server=ThreadingHTTPServer(('127.0.0.1',4196),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw))
Thread(target=server.serve_forever,daemon=True).start()
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRSEAAAAASUVORK5CYII=')
PDF=b'%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'
checks=[];errors=[]
def check(ok,label):
 assert ok,label
 print('  PASS:',label)
def record(code,label):
 checks.append({'scenario':code,'name':label,'status':'PASS'});print('PASS:',code,label)
def nav(page,route):
 page.evaluate('(id)=>showPage(id)',route);page.locator('#'+route+'.active').wait_for(state='visible')
def open_case(browser,seed='',width=390,clock=None):
 context=browser.new_context(viewport={'width':width,'height':950})
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 page.route('**/*.supabase.co/**',lambda r:r.abort())
 if clock:page.clock.install(time=clock)
 page.goto('http://127.0.0.1:4196/qa/checkin-personal-review.html?scenario='+seed,wait_until='domcontentloaded')
 page.wait_for_function("document.body.dataset.businessType==='hotel'");nav(page,'hotel-register')
 return context,page,page.locator('#bhCheckinForm')
def fill(f,extra=None):
 for name,value in {'full_name':'Synthetic Walk-in Guest','phone':'7777777777','address':'Synthetic permanent address','arrived_from':'Udaipur','next_destination':'Jaipur','nightly_rate':'1200',**(extra or {})}.items():f.locator('[name='+name+']').fill(value)
 f.locator('[name=room_id]').select_option('room-a')
def file_value(buffer=PNG,mime='image/png',name='synthetic-copy.png'):return {'name':name,'mimeType':mime,'buffer':buffer}
def raw_id(f):
 f.locator('[name=id_front]').set_input_files(file_value());f.locator('[name=id_checked]').check()
def photo(page,button,value=None):
 with page.expect_file_chooser()as event:button.click()
 event.value.set_files([] if value is None else value)
def upload_dialog(page,f,value=None,key='lead',skip=True):
 f.locator('[data-id-open="'+key+'"]').click();d=page.locator('.ha-id-dialog')
 photo(page,d.locator('[data-upload]'),value or file_value());d.locator('.ha-id-preview,.ha-id-preview-pdf').wait_for()
 page.wait_for_function("!document.querySelector('.ha-id-dialog [data-next]').disabled")
 if skip:d.locator('[data-skip]').click();d.wait_for(state='detached')
 return d
def review(f):
 f.locator('button[type=submit]').click();f.locator('.bh-review').wait_for()
def confirm(page,f):
 f.locator('button[type=submit]').click();page.locator('#folios.active').wait_for()
 page.wait_for_function("__BITE_HOTEL_QA.db.stays.some(s=>s.status==='in_house')")
def focused(page,name):
 page.wait_for_function('(n)=>document.activeElement?.name===n||document.activeElement?.dataset.haFocus===n',arg=name)
def foreign(f,prefix='foreign_',country='France'):
 card=f.locator('[data-foreign-card=lead]')if prefix=='foreign_'else f.locator('[data-foreign-card="'+prefix[6:-9]+'"]')
 card.locator('.ha-foreign-toggle').click()
 f.locator('[name='+('country'if prefix=='foreign_'else prefix+'nationality')+']').fill(country)
 for name,value in {'date_of_birth':'1990-01-01','document_last4':'A123','document_expiry':'2036-01-01','permission_last4':'V123','visa_expiry':'2036-01-01','india_arrival':f.locator('[name=arrival]').input_value(),'entry_port':'Delhi','purpose':'Tourism'}.items():f.locator('[name='+prefix+name+']').fill(value)
def noise_png():
 width,height=2400,1800;rng=random.Random(25)
 raw=b''.join(b'\0'+rng.randbytes(width*3)for _ in range(height))
 def chunk(name,data):return struct.pack('!I',len(data))+name+data+struct.pack('!I',zlib.crc32(name+data)&0xffffffff)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,1))+chunk(b'IEND',b'')
try:
 with sync_playwright()as pw:
  browser=pw.chromium.launch()
  c,p,f=open_case(browser)
  check(f.locator('[name=full_name]').input_value()==''and f.locator('[name=nightly_rate]').input_value()=='','Fresh guest and rent are blank')
  check(f.locator('[name=serial_number]').input_value()=='1'and f.locator('[name=register_date]').input_value()==p.evaluate('BiteOwner.day()'),'Serial and India entry date')
  fill(f);raw_id(f);review(f);confirm(p,f)
  check(p.evaluate('__BITE_HOTEL_QA.db.stays.length===1&&__BITE_HOTEL_QA.db.folios.length===1'),'Walk-in creates one stay and khata');record('S01','Fresh walk-in and successful check-in');c.close()

  c,p,f=open_case(browser,'draft')
  check(f.locator('[name=full_name]').input_value()=='','Draft is offered without silently filling a guest')
  p.locator('[data-hotel-action=resume-register]').click()
  check(f.locator('[name=full_name]').input_value()=='Synthetic unfinished guest'and f.locator('[name=arrival_time]').input_value()=='07:17','Resume restores the intended entry')
  nav(p,'overview');nav(p,'hotel-register');p.locator('[data-hotel-action=fresh-register]').click()
  check(f.locator('[name=full_name]').input_value()==''and f.locator('[name=nightly_rate]').input_value()=='','Start fresh clears earlier terms');record('S02','Explicit Resume and Start fresh');c.close()

  c,p,f=open_case(browser,'stale')
  check(f.locator('[name=full_name]').input_value()==''and p.locator('.ha-draft-choice').count()==0,'Completed stay is never resumed into a new check-in');record('S03','Completed old stay draft');c.close()

  for code,seed,word in [('S04','overdue','Occupied'),('S05','reserved','Reserved')]:
   c,p,f=open_case(browser,seed)
   option=f.locator('[name=room_id] option[value=room-a]')
   check(option.is_disabled()and word in option.inner_text(),'Room unavailable with a specific reason')
   check(not f.locator('[name=room_id] option[value=room-b]').is_disabled(),'A free room remains selectable');record(code,seed+' room cannot be allocated');c.close()

  c,p,f=open_case(browser,'occupied')
  f.locator('[name=mode]').select_option('reserve')
  dates=p.evaluate('[2,3].map(n=>BiteOwner.day(new Date(Date.now()+n*86400000)))')
  f.locator('[name=departure]').fill(dates[1]);f.locator('[name=arrival]').fill(dates[0])
  check(not f.locator('[name=room_id] option[value=room-a]').is_disabled(),'Room occupied now is bookable after the prior stay ends');record('S06','Future reservation uses date availability');c.close()

  c,p,f=open_case(browser,'dirty')
  check('No room is available'in f.locator('[data-room-availability]').inner_text(),'All unavailable rooms explain next action')
  f.locator('[data-room-release]').click();p.locator('[data-hotel-action=room-release][data-id=room-a]').click()
  p.locator('#bhActionEditor').wait_for(state='detached')
  check(not f.locator('[name=room_id] option[value=room-a]').is_disabled(),'Manager explicitly releases a ready vacant room')
  check(f.locator('[data-hotel-action=room-privacy]').count()==0,'Housekeeping controls remain hidden');record('S07','No available rooms and explicit vacant-room release');c.close()

  c,p,f=open_case(browser);fill(f);raw_id(f)
  f.locator('[name=departure]').fill('');f.locator('[name=departure]').fill(p.evaluate('BiteOwner.day(new Date(Date.now()+2*86400000))'))
  f.locator('[name=room_id]').select_option('room-b');f.locator('[name=mode]').select_option('reserve')
  check(f.locator('[name=nightly_rate]').input_value()=='1200'and f.locator('[name=id_front]').evaluate('(e)=>e.files.length')==1,'Date/mode/room edits retain guest terms and selected photo');record('S08','Editing stay terms without losing inputs');c.close()

  c,p,f=open_case(browser);fill(f);raw_id(f);f.locator('[name=advance_amount]').fill('100');review(f)
  p.evaluate('__BITE_HOTEL_QA.injectRace()');f.locator('button[type=submit]').click();focused(p,'room_id')
  check(f.locator('[name=room_id] option[value=room-a]').is_disabled(),'Server rejection refreshes room choices')
  check(p.evaluate('__BITE_HOTEL_QA.db.folios.length===0&&__BITE_HOTEL_QA.db.entries.length===0'),'Losing staff creates no extra folio or advance');record('S09','Another staff member takes the reviewed room');c.close()

  c,p,f=open_case(browser);fill(f,{'nightly_rate':'875','male':'2','female':'1','children':'2'});raw_id(f);review(f);confirm(p,f)
  check(p.evaluate('__BITE_HOTEL_QA.db.stays[0].nightly_rate===875&&__BITE_HOTEL_QA.db.stays[0].adults===3&&__BITE_HOTEL_QA.db.stays[0].children===2'),'Current party and rent override old master presets');record('S10','Negotiated rent and family counts');c.close()

  c,p,f=open_case(browser,width=360);f.locator('button[type=submit]').click();focused(p,'full_name')
  check(f.locator('[name=full_name]').get_attribute('aria-invalid')=='true','Missing field receives inline error and focus')
  fill(f);raw_id(f);f.locator('[name=departure]').fill(f.locator('[name=arrival]').input_value());f.locator('button[type=submit]').click();focused(p,'departure')
  check('after arrival'in f.locator('[name=departure]').locator('..').inner_text(),'Invalid departure points beside the date')
  p.screenshot(path=str(OUT/'ui-checkin-scenarios-validation-360.png'));record('S11','Missing fields and wrong dates scroll to correction');c.close()

  c,p,f=open_case(browser,clock=datetime(2026,11,17,18,35,tzinfo=timezone.utc))
  check(f.locator('[name=register_date]').input_value()=='2026-11-18'and f.locator('[name=arrival_time]').input_value()=='00:05','India midnight is correct even with UTC test host');record('S12','India date and arrival clock at midnight');c.close()

  c,p,f=open_case(browser,'returning');f.locator('[name=full_name]').fill('Returning');f.locator('[data-guest-suggestion=guest-old]').click()
  check(f.locator('[name=phone]').input_value()=='9999999999'and f.locator('[name=address]').input_value()=='Synthetic old address','Personal profile fills')
  check(f.locator('[name=vehicle_number]').input_value()=='RJ00QA0000'and f.locator('[name=nightly_rate]').input_value()=='','Travel fills while this stay rent is fresh')
  check('New guest'not in f.inner_text(),'No contradictory New guest dropdown');record('S13','Saved guest suggestions and autofill');c.close()

  c,p,f=open_case(browser,'same-name');f.locator('[name=full_name]').fill('Returning')
  check(f.locator('[data-guest-suggestion]').count()==2,'Same names remain separate phone-labelled suggestions')
  f.locator('[data-guest-suggestion=guest-other]').click();f.locator('[name=full_name]').fill('Completely different guest')
  check(f.locator('[name=guest_id]').input_value()==''and f.locator('[name=phone]').input_value()=='','Changing identity detaches the saved guest')
  check(f.locator('[data-guest-suggestion]').count()==0,'No-match search has no unrelated profiles');record('S14','Same-name guests and changed identities');c.close()

  c,p,f=open_case(browser);fill(f);raw_id(f)
  f.locator('[data-foreign-card=lead] .ha-foreign-toggle').click();f.locator('button[type=submit]').click();focused(p,'country')
  foreign(f);f.locator('[name=foreign_document_expiry]').fill('2020-01-01');f.locator('button[type=submit]').click();focused(p,'foreign_document_expiry')
  f.locator('[name=foreign_document_expiry]').fill('2036-01-01');review(f)
  p.screenshot(path=str(OUT/'ui-checkin-scenarios-foreign-390.png'));confirm(p,f)
  check(p.evaluate('__BITE_HOTEL_QA.db.stays[0].registration.foreign_details.document_last4==="A123"'),'Foreign metadata reaches scoped reservation')
  record('S15','Foreign form, field validation and save');c.close()

  c,p,f=open_case(browser);fill(f);raw_id(f);foreign(f)
  f.locator('[name=foreign_visa_status]').select_option('oci')
  check(f.locator('[name=foreign_visa_expiry]').is_disabled(),'OCI does not invent a visa expiry');review(f)
  f.locator('[name=foreign_visa_status]').select_option('exempt');f.locator('[name=foreign_document_type]').select_option('travel_document');f.locator('[name=foreign_document_no_expiry]').check()
  check(f.locator('[name=foreign_document_expiry]').is_disabled()and f.locator('[name=foreign_permission_last4]').is_disabled(),'Exempt travel document has conditional expiry and reference');review(f)
  f.locator('[data-foreign-card=lead] [data-indian-guest]').click();review(f)
  check(f.locator('[name=country]').input_value()=='India'and f.locator('[name=foreign_date_of_birth]').is_disabled(),'Indian switch removes foreign validation');record('S16','OCI, exempt travel documents and domestic switching');c.close()

  c,p,f=open_case(browser);f.locator('[data-id-open=lead]').click();d=p.locator('.ha-id-dialog')
  photo(p,d.locator('[data-capture]'))
  check(d.locator('[data-next]').is_disabled(),'Cancelling native camera does not create a false photo')
  photo(p,d.locator('[data-upload]'),file_value());d.locator('.ha-id-preview').wait_for();d.locator('[data-skip]').click()
  check(f.locator('[name=id_front]').evaluate('(e)=>e.files.length')==1,'Device upload remains available after camera cancellation');record('S17','Camera cancelled with upload fallback');c.close()

  c,p,f=open_case(browser);large=noise_png();check(len(large)>4*1024*1024,'Synthetic camera photo exceeds the storage limit')
  upload_dialog(p,f,file_value(large))
  metadata=f.locator('[name=id_front]').evaluate('(e)=>({size:e.files[0].size,type:e.files[0].type})')
  check(metadata['size']<=4*1024*1024 and metadata['type']=='image/jpeg','Large photo becomes a storage-compatible local JPEG');record('S18','Large photo resized on device');c.close()

  c,p,f=open_case(browser);upload_dialog(p,f,file_value(PNG,'','no-mime.png'))
  check(f.locator('[name=id_front]').evaluate('(e)=>e.files[0].type')=='image/png','Missing MIME is recovered from real contents')
  f.locator('[data-id-open=lead]').click();d=p.locator('.ha-id-dialog');photo(p,d.locator('[data-upload]'),file_value(b'<script>bad</script>'))
  d.locator('.ha-camera-error').get_by_text('Choose a valid',exact=False).wait_for()
  check(f.locator('[name=id_front]').evaluate('(e)=>e.files[0].size')==len(PNG),'Renamed invalid file does not erase the valid front')
  d.locator('[data-skip]').click();record('S19','Unknown MIME and renamed invalid content');c.close()

  c,p,f=open_case(browser);upload_dialog(p,f,file_value(PDF,'application/pdf','synthetic.pdf'))
  check(f.locator('[name=id_front]').evaluate('(e)=>e.files[0].type')=='application/pdf'and f.locator('[name=id_back]').evaluate('(e)=>e.files.length')==0,'PDF front can skip back without a forced camera step');record('S20','PDF front and direct optional-back skip');c.close()

  c,p,f=open_case(browser);raw_id(f);f.locator('[name=id_back]').set_input_files(file_value())
  upload_dialog(p,f)
  check(f.locator('[name=id_back]').evaluate('(e)=>e.files.length')==0,'Retaking a front removes the old back from that ID')
  record('S21','Retake replaces the correct person’s ID sides');c.close()

  c,p,f=open_case(browser);fill(f,{'male':'2','female':'1'});raw_id(f)
  for i in range(2):
   f.locator('[data-add-id]').click();card=f.locator('[data-ha-party-list] [data-ha-id-card]').nth(i);key=card.get_attribute('data-ha-id-card')
   card.locator('[name$=_name]').fill('Synthetic Companion '+str(i+1));upload_dialog(p,f,key=key)
   if i==1:
    pre='party_'+key+'_foreign_';foreign(f,pre)
  review(f);confirm(p,f)
  check(p.evaluate('__BITE_HOTEL_QA.db.stays[0].registration.additional_ids.length===2&&!!__BITE_HOTEL_QA.db.stays[0].registration.additional_ids[1].foreign_details'),'Named companions, optional backs and foreign companion persist independently')
  record('S22','Three guests with separate named ID copies');c.close()

  c,p,f=open_case(browser,clock=datetime(2026,11,17,6,30,tzinfo=timezone.utc));fill(f);raw_id(f)
  p.evaluate('document.activeElement.blur()');p.clock.fast_forward(31000)
  check(f.locator('[name=id_front]').evaluate('(e)=>e.files.length')==1,'Thirty-second polling retains the selected file after blur')
  c.set_offline(True);c.set_offline(False)
  p.wait_for_function("__BITE_HOTEL_QA.calls.filter(x=>x.name==='bite_hotel_workspace').length>=2")
  check(f.locator('[name=full_name]').input_value()=='Synthetic Walk-in Guest'and f.locator('[name=id_front]').evaluate('(e)=>e.files.length')==1,'Reconnect refreshes availability without replacing the form')
  record('S23','Background polling and reconnection keep the form');c.close()

  for method,verified in [('Cash',False),('UPI',False),('UPI',True)]:
   c,p,f=open_case(browser);fill(f);raw_id(f);f.locator('[name=advance_amount]').fill('100');f.locator('[name=advance_method]').select_option(method)
   if method=='UPI':f.locator('[name=advance_account]').fill('Owner second account')
   if verified:f.locator('[name=advance_verified]').check();f.locator('[name=advance_reference]').fill('SYNTHETIC-RECEIPT')
   review(f);text=f.locator('.bh-review').inner_text()
   check(method in text and(method=='Cash'or('Verified receipt'if verified else'Pending receipt verification')in text),'Review states cash or the actual verification status')
   confirm(p,f)
   check(p.evaluate('__BITE_HOTEL_QA.db.entries.find(e=>e.kind==="advance").status')==('pending'if method=='UPI'and not verified else'confirmed'),'Only confirmed receipts count as received');c.close()
  record('S24','Cash, pending online and verified online advance')

  c,p,f=open_case(browser);fill(f);raw_id(f);f.locator('[name=advance_amount]').fill('100');review(f)
  p.evaluate('__BITE_HOTEL_QA.loseAfterReserve=true');f.locator('button[type=submit]').click();f.locator('.bh-message').get_by_text('Synthetic response unknown',exact=False).wait_for()
  nav(p,'overview');nav(p,'hotel-register');check(f.evaluate('(el)=>el.inert'),'Uncertain previous send requires an explicit decision')
  p.locator('[data-hotel-action=resume-register]').click();p.wait_for_function("!!document.querySelector('#bhCheckinForm').dataset.stayId")
  review(f);confirm(p,f)
  check(p.evaluate('__BITE_HOTEL_QA.db.stays.length===1&&__BITE_HOTEL_QA.db.entries.filter(e=>e.kind==="advance").length===1'),'Lost successful response resumes exactly one booking and advance');c.close()
  c,p,f=open_case(browser);fill(f);raw_id(f);review(f);p.evaluate('__BITE_HOTEL_QA.loseAfterCheckin=true');f.locator('button[type=submit]').click();f.locator('.bh-message').get_by_text('Synthetic response unknown',exact=False).wait_for()
  nav(p,'overview');nav(p,'hotel-register');p.locator('[data-hotel-action=resume-register]').click();p.locator('#folios.active').wait_for()
  check(p.evaluate('__BITE_HOTEL_QA.db.stays.length===1&&__BITE_HOTEL_QA.db.entries.filter(e=>e.kind==="charge").length===1'),'A lost final check-in response opens its existing khata');c.close()
  c,p,f=open_case(browser);fill(f);raw_id(f);review(f);p.evaluate('__BITE_HOTEL_QA.loseBeforeReserve=true');f.locator('button[type=submit]').click();f.locator('.bh-message').get_by_text('Synthetic response unknown',exact=False).wait_for()
  nav(p,'overview');nav(p,'hotel-register');p.locator('[data-hotel-action=fresh-register]').click()
  p.wait_for_function("!document.querySelector('#bhCheckinForm').inert")
  check(p.evaluate('(async()=>!!(await __BITE_HOTEL_QA.replayLost()).error)()'),'A late old send is rejected after Start fresh')
  check(p.evaluate('__BITE_HOTEL_QA.db.stays.length===0&&__BITE_HOTEL_QA.db.entries.length===0'),'No ghost booking or advance after abandonment');c.close()
  c,p,f=open_case(browser);fill(f);raw_id(f);p.evaluate('__BITE_DOCUMENT_QA.failFinishAfterCommit=true');review(f);f.locator('button[type=submit]').click();focused(p,'id_front')
  nav(p,'overview');nav(p,'hotel-register');p.locator('[data-hotel-action=resume-register]').click();raw_id(f);review(f);confirm(p,f)
  check(p.evaluate('__BITE_DOCUMENT_QA.rows.size===1'),'Interrupted document finish reuses the persisted upload UUID');record('S25','Unknown responses, safe fresh start and document retries');c.close()
  check(len(checks)==25 and not errors,'All 25 scenarios pass without controller errors');browser.close()
finally:
 server.shutdown();(OUT/'checkin-25-scenarios-evidence.json').write_text(json.dumps({'checks':checks,'page_errors':errors,'scope':'Synthetic Chromium transport with actual application controllers; SQL integration separately validates real database rules. Physical Android camera hardware is outside this test.'},indent=2))
