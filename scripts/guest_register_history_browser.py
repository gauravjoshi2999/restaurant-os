#!/usr/bin/env python3
"""Guest register, dismissible foreign form and returning ID reuse. Synthetic records only."""
import base64,json,os
from pathlib import Path
from zipfile import ZipFile
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
from prepare_checkin_scenarios import prepare
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT);prepare();OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
server=ThreadingHTTPServer(('127.0.0.1',4199),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw));Thread(target=server.serve_forever,daemon=True).start()
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRSEAAAAASUVORK5CYII=');checks=[];errors=[]
def check(ok,label):
 if not ok:
  try:p.screenshot(path=str(OUT/'ui-guest-register-failure.png'),full_page=True)
  except Exception:pass
 assert ok,label
 checks.append({'case':label,'status':'PASS'});print('PASS:',label)
def nav(p,route):p.evaluate('(r)=>showPage(r)',route);p.locator('#'+route+'.active').wait_for()
def new_case(browser,width=390):
 c=browser.new_context(viewport={'width':width,'height':950});p=c.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.on('dialog',lambda d:d.accept());p.route('**/*.supabase.co/**',lambda r:r.abort());p.goto('http://127.0.0.1:4199/qa/checkin-personal-review.html',wait_until='domcontentloaded');p.wait_for_function("document.body.dataset.businessType==='hotel'");nav(p,'hotel-register');return c,p,p.locator('#bhCheckinForm')
def raw(f):
 for n,v in {'full_name':'Synthetic unfinished guest','phone':'7777777777','address':'Synthetic address','arrived_from':'Udaipur','next_destination':'Jaipur','nightly_rate':'1200'}.items():f.locator('[name='+n+']').fill(v)
 f.locator('[name=room_id]').select_option('room-a')
 for n in ['id_front','id_back']:f.locator('[name='+n+']').set_input_files({'name':'synthetic.png','mimeType':'image/png','buffer':PNG})
 f.locator('[name=id_checked]').check()
def seed(p):
 p.evaluate('''async(bytes)=>{
 const q=__BITE_HOTEL_QA,d=__BITE_DOCUMENT_QA,ga='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',gb='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',comp=crypto.randomUUID();
 q.db.guests=[{id:ga,full_name:'Current Synthetic Guest',phone:'9999999999',address:'Current synthetic address',country:'India',email:'guest@example.invalid',id_type:'Masked ID',id_last4:'0000'},{id:gb,full_name:'Synthetic Foreign Guest',phone:'8888888888',address:'Paris synthetic address',country:'France',email:'foreign@example.invalid',id_type:'Passport',id_last4:'A123'}];
 function copy(guest,subject=null){const id=crypto.randomUUID(),path='synthetic/'+id,blob=new Blob([new Uint8Array(bytes)],{type:'image/png'});d.rows.set(id,{id,guest_id:guest,subject_key:subject,kind:'masked_id',status:'ready',mime_type:'image/png',byte_size:blob.size,object_path:path});d.objects.set(path,blob);return id}
 const aFront=copy(ga),aBack=copy(ga),cFront=copy(ga,comp),cBack=copy(ga,comp),bFront=copy(gb),bBack=copy(gb);
 const fd={nationality:'France',date_of_birth:'1990-01-01',document_type:'passport',document_last4:'A123',document_expiry:'2036-01-01',visa_status:'visa',permission_last4:'V123',visa_expiry:'2036-01-01',india_arrival:'2026-10-01',entry_port:'Delhi',purpose:'Tourism'};
 const reg={entry_date:'2026-11-10',male:1,female:1,children:1,arrived_from:'Udaipur',next_destination:'Jaipur',transport:'Car',vehicle_number:'RJ00QA0000',id_front:aFront,id_back:aBack,additional_ids:[{subject_key:comp,name:'Synthetic companion',id_front:cFront,id_back:cBack}],guest_snapshot:{full_name:'Current Synthetic Guest',phone:'9999999999',address:'Current synthetic address',country:'India'}};
 q.db.stays=[{id:'stay-old',guest_id:ga,room_id:'room-a',register_number:1,arrival:'2026-10-01',departure:'2026-10-02',arrival_time:'07:17:00',adults:1,children:0,nightly_rate:900,status:'checked_out',created_at:'2026-10-01T01:00:00Z',registration:{...reg,entry_date:'2026-10-01',male:1,female:0,children:0,additional_ids:[],guest_snapshot:{full_name:'Synthetic Original Guest',phone:'9999999999',address:'Original synthetic address',country:'India'}}},{id:'stay-latest',guest_id:ga,room_id:'room-a',register_number:2,arrival:'2026-11-10',departure:'2026-11-11',arrival_time:'08:12:00',adults:2,children:1,nightly_rate:1900,status:'checked_out',created_at:'2026-11-10T01:00:00Z',registration:reg},{id:'stay-foreign',guest_id:gb,room_id:'room-b',register_number:3,arrival:'2026-11-12',departure:'2026-11-13',arrival_time:'09:00:00',adults:1,children:0,nightly_rate:1500,status:'checked_out',created_at:'2026-11-12T01:00:00Z',registration:{...reg,entry_date:'2026-11-12',male:1,female:0,children:0,id_front:bFront,id_back:bBack,additional_ids:[],guest_snapshot:{full_name:'Synthetic Foreign Guest',phone:'8888888888',address:'Paris synthetic address',country:'France'},foreign_details:fd}}];
 q.db.folios=q.db.stays.map(s=>({id:'folio-'+s.id,stay_id:s.id,status:'settled'}));q.db.next_register_number=4;window.__registerSeed={ga,gb,comp,aFront,aBack,cFront,cBack,bFront,bBack};await BiteHospitality.reload();BiteHospitality.redraw();
 }''',list(PNG))
try:
 with sync_playwright()as pw:
  browser=pw.chromium.launch()
  for width in [360,390,1440]:
   c,p,f=new_case(browser,width);card=f.locator('[data-foreign-card=lead]');card.locator('.ha-foreign-toggle').click();card.locator('[data-close-foreign]').last.click()
   check(f.locator('[name=foreign_enabled]').input_value()=='0' and f.locator('[name=country]').input_value()=='India','Closing an unused foreign form restores Indian check-in at '+str(width)+'px')
   card.locator('.ha-foreign-toggle').click();f.locator('[name=country]').fill('France');f.locator('[name=foreign_document_last4]').fill('A123');card.locator('[data-close-foreign]').first.click()
   check(card.locator('[data-foreign-body]').is_hidden() and f.locator('[name=foreign_enabled]').input_value()=='1','Closing filled foreign details preserves nationality and reporting data')
   raw(f);f.locator('[type=submit]').click();p.wait_for_function("document.activeElement?.name==='foreign_date_of_birth'");check(card.locator('[data-foreign-body]').is_visible(),'Validation opens the collapsed foreign form and focuses the missing field')
   check(card.locator('[data-frro-link]').get_attribute('href')=='https://indianfrro.gov.in/formIII/','Reporting opens the official migrated Form III URL')
   p.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Synthetic clipboard denial')}}})");card.locator('[data-copy-frro]').click();card.locator('[data-frro-address]').wait_for();check('https://indianfrro.gov.in/formIII/' in card.locator('[data-frro-address]').inner_text(),'Clipboard denial reveals a selectable browser link')
   card.locator('[data-indian-guest]').click();f.locator('[type=submit]').click();f.locator('.bh-review').wait_for();check(f.locator('[name=foreign_date_of_birth]').is_disabled(),'Indian form closes foreign requirements completely')
   p.locator('[data-gr-action=close-checkin]').first.click();p.locator('.gr-close-checkin [data-gr-action=discard-close]').click();p.locator('#rooms.active').wait_for();check(p.evaluate('__BITE_HOTEL_QA.db.stays.length===0&&__BITE_DOCUMENT_QA.rows.size===0'),'Discarding the unused check-in creates no guest stay or ID upload')
   nav(p,'hotel-register');seed(p);p.locator('[data-gr-action=register]').click();p.locator('#guests.active').wait_for();table=p.locator('#guests .gr-sheet')
   check(table.locator('tbody tr').count()==3 and 'Synthetic Original Guest'in table.inner_text(),'Register lists each historical stay with its saved identity')
   check(p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Register sheet stays inside '+str(width)+'px viewport')
   p.locator('[data-gr-filter=month]').fill('2026-10');check(table.locator('tbody tr').count()==1,'Month filter selects the correct register entries');p.locator('[data-gr-action=reset]').click()
   p.locator('[data-gr-filter=query]').fill('8888888888');check(table.locator('tbody tr').count()==1 and'Synthetic Foreign Guest'in table.inner_text(),'Search finds the exact mobile profile');p.locator('[data-gr-action=reset]').click()
   p.locator('[data-gr-action=record][data-id=stay-old]').click();record=p.locator('.gr-record-dialog');record.locator('.gr-id-tile img').first.wait_for();check('Original synthetic address'in record.inner_text() and'07:17'in record.inner_text(),'Record sheet includes historical address and arrival time')
   record.locator('[data-gr-action=view-photo]').first.click();p.locator('.ha-photo-viewer img').wait_for();check(p.locator('.ha-photo-viewer img').get_attribute('src').startswith('blob:'),'Historical ID photo opens privately in the existing enlarged viewer');p.locator('[data-viewer-close]').click();record.locator('[data-gr-action=close-record]').first.click()
   if width==390:p.screenshot(path=str(OUT/'ui-guest-register-390.png'),full_page=True)
   p.locator('[data-gr-action=record][data-id=stay-latest]').click();p.locator('.gr-record-dialog [data-gr-action=repeat]').click();f=p.locator('#bhCheckinForm');p.wait_for_function("!!document.querySelector('[name=id_back_id]').value&&!!document.querySelector('[data-ha-party-list] [name$=_back_id]').value")
   check(f.locator('[name=full_name]').input_value()=='Current Synthetic Guest' and f.locator('[name=arrived_from]').input_value()=='Udaipur' and f.locator('[name=vehicle_number]').input_value()=='RJ00QA0000','Returning guest fills current personal and saved travel details')
   check([f.locator('[name='+k+']').input_value()for k in ['male','female','children']]==['1','1','1'] and f.locator('[data-ha-party-list] [data-ha-id-card]').count()==1,'Returning guest restores the party count and named companion')
   check(f.locator('[name=id_front_id]').input_value()==p.evaluate('__registerSeed.aFront') and f.locator('[name=party_'+p.evaluate('__registerSeed.comp')+'_back_id]').input_value()==p.evaluate('__registerSeed.cBack'),'Both lead and companion ID sides are reused after authorization')
   check(f.locator('[name=room_id]').input_value()==''and f.locator('[name=nightly_rate]').input_value()==''and f.locator('[name=arrival]').input_value()==p.evaluate('BiteOwner.day()'),'New room, current dates and agreed rent stay under manager control')
   check(p.evaluate('__BITE_DOCUMENT_QA.rows.size===6&&__BITE_HOTEL_QA.db.stays.length===3'),'Register viewing and repeat selection do not duplicate data');c.close()
  c,p,f=new_case(browser);seed(p);p.evaluate("document.querySelector('#bhCheckinForm').__haSelectGuest(__registerSeed.gb)");p.wait_for_function("document.querySelector('[name=id_back_id]').value===__registerSeed.bBack")
  check(f.locator('[name=country]').input_value()=='France' and f.locator('[name=foreign_document_last4]').input_value()=='A123' and f.locator('[name=foreign_entry_port]').input_value()=='Delhi','Foreign returning guests restore nationality, passport, permission and arrival metadata')
  p.evaluate('__BITE_DOCUMENT_QA.holdList=true');p.evaluate("document.querySelector('#bhCheckinForm').__haSelectGuest(__registerSeed.ga)");p.wait_for_function('!!__BITE_DOCUMENT_QA.releaseList');p.evaluate('__BITE_DOCUMENT_QA.holdList=false');p.evaluate("document.querySelector('#bhCheckinForm').__haSelectGuest(__registerSeed.gb)");p.wait_for_function("document.querySelector('[name=id_back_id]').value===__registerSeed.bBack");p.evaluate('__BITE_DOCUMENT_QA.releaseList()');p.wait_for_timeout(150)
  check(f.locator('[name=id_front_id]').input_value()==p.evaluate('__registerSeed.bFront'),'Late saved-ID responses cannot attach another guest’s photos');c.close()
  c,p,f=new_case(browser);seed(p);p.evaluate('__BITE_DOCUMENT_QA.holdList=true');p.evaluate("document.querySelector('#bhCheckinForm').__haSelectGuest(__registerSeed.ga)");p.wait_for_function('!!__BITE_DOCUMENT_QA.releaseList');f.locator('[data-id-open=lead]').click();d=p.locator('.ha-id-dialog')
  with p.expect_file_chooser()as fc:d.locator('[data-upload]').click()
  fc.value.set_files({'name':'synthetic-new.png','mimeType':'image/png','buffer':PNG});d.locator('[data-select-side=front] img').wait_for();d.locator('[data-select-side=front]').click();d.locator('[data-remove-photo]').click();d.locator('.ha-dialog-close').click();p.evaluate('__BITE_DOCUMENT_QA.holdList=false;__BITE_DOCUMENT_QA.releaseList()');p.wait_for_function("document.querySelector('[name=id_back_id]').value===__registerSeed.aBack")
  check(f.locator('[name=id_front_id]').input_value()==''and f.locator('[name=id_front]').evaluate('(e)=>e.files.length')==0,'A delayed lookup does not restore a photo the manager deliberately removed');c.close()
  c,p,f=new_case(browser);seed(p);p.evaluate("__BITE_DOCUMENT_QA.rows.get(__registerSeed.aBack).status='deleted';__BITE_DOCUMENT_QA.rows.get(__registerSeed.cFront).subject_key=crypto.randomUUID();document.querySelector('#bhCheckinForm').__haSelectGuest(__registerSeed.ga)");p.wait_for_function("document.querySelector('[name=id_front_id]').value===__registerSeed.aFront")
  check(f.locator('[name=id_back_id]').input_value()==''and f.locator('[name=id_back]').evaluate('(e)=>e.required'),'Deleted saved copies remain required for the new stay')
  check(f.locator('[name=party_'+p.evaluate('__registerSeed.comp')+'_front_id]').input_value()=='','A different person reference cannot populate a companion ID');c.close()
  c,p,f=new_case(browser);seed(p);nav(p,'guests')
  with p.expect_download()as event:p.locator('[data-gr-action=excel]').click()
  dest=OUT/'guest-register.xlsx';event.value.save_as(dest)
  with ZipFile(dest)as z:sheet=z.read('xl/worksheets/sheet1.xml').decode()
  check('Synthetic Original Guest'in sheet and'Permanent address'in sheet and p.evaluate('__registerSeed.aFront')not in sheet,'Excel includes the full register fields without private photo IDs or links')
  with p.expect_popup()as event:p.locator('[data-gr-action=print]').click()
  printed=event.value;printed.get_by_role('link',name='Back to Partner').wait_for();check(printed.locator('tbody tr').count()==3,'Print register includes all filtered entries and a return button');printed.close()
  p.evaluate("__BITE_HOTEL_QA.db.stays.push(...Array.from({length:55},(_,i)=>({...__BITE_HOTEL_QA.db.stays[0],id:'history-'+i,register_number:i+4})))");p.evaluate('BiteHospitality.reload()');p.locator('[data-gr-action=next]').click();check(p.locator('#guests .gr-sheet tbody tr').count()==8,'Long history is paginated without dropping older records');c.close()
  c,p,f=new_case(browser);f.locator('[name=full_name]').fill('Synthetic kept draft');p.locator('[data-gr-action=close-checkin]').first.click();p.locator('[data-gr-action=draft-close]').click();p.locator('#rooms.active').wait_for();nav(p,'hotel-register');p.locator('[data-hotel-action=resume-register]').click();check(f.locator('[name=full_name]').input_value()=='Synthetic kept draft','Close check-in can retain the typed draft for explicit Resume');c.close()
  browser.close()
 check(not errors,'No guest register or returning-check-in controller errors')
finally:
 server.shutdown();(OUT/'guest-register-history-evidence.json').write_text(json.dumps({'checks':checks,'page_errors':errors,'scope':'Synthetic records and private-photo transports. No production guest, document, reservation or official report is changed.'},indent=2))
