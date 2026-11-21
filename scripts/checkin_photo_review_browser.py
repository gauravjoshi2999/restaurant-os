#!/usr/bin/env python3
"""Photo review/removal journeys with production controllers and synthetic private copies."""
import json,os,struct,zlib
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
from prepare_checkin_scenarios import prepare
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT);prepare();OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
server=ThreadingHTTPServer(('127.0.0.1',4198),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw));Thread(target=server.serve_forever,daemon=True).start()
def sample(side):
 w,h=480,300;color=(242,178,109)if side=='front'else(113,170,203)
 raw=b''.join(b'\0'+b''.join(bytes(color if y<65 or 30<x<135 and 90<y<240 else(224,217,207)if 160<x<440 and y%45<12 else(249,246,240))for x in range(w))for y in range(h))
 def chunk(n,d):return struct.pack('!I',len(d))+n+d+struct.pack('!I',zlib.crc32(n+d)&0xffffffff)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
FRONT=sample('front');BACK=sample('back');PDF=b'%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'
checks=[];errors=[]
def check(ok,label):
 assert ok,label
 checks.append({'case':label,'status':'PASS'});print('PASS:',label)
def file(side='front',buffer=None,mime='image/png'):return{'name':'synthetic-'+side+('.pdf'if mime=='application/pdf'else'.png'),'mimeType':mime,'buffer':buffer or(FRONT if side=='front'else BACK)}
def photo(p,b,value):
 with p.expect_file_chooser()as event:b.click()
 event.value.set_files(value or [])
 p.wait_for_function("!document.querySelector('.ha-id-dialog')||!document.querySelector('.ha-id-dialog [data-id-stage]').textContent.includes('Preparing a clear')")
def new_case(browser,width=390):
 c=browser.new_context(viewport={'width':width,'height':950});p=c.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.on('dialog',lambda d:d.accept());p.route('**/*.supabase.co/**',lambda r:r.abort())
 p.goto('http://127.0.0.1:4198/qa/checkin-personal-review.html',wait_until='domcontentloaded');p.wait_for_function("document.body.dataset.businessType==='hotel'");p.evaluate("showPage('hotel-register')");p.locator('#hotel-register.active').wait_for();return c,p,p.locator('#bhCheckinForm')
def capture(p,f,key='lead'):
 f.locator('[data-id-open="'+key+'"]').click();d=p.locator('.ha-id-dialog');photo(p,d.locator('[data-capture]'),file());check(d.locator('[data-select-side=back]').get_attribute('aria-pressed')=='true','Front capture opens the back step automatically');photo(p,d.locator('[data-capture]'),file('back'));return d
def fill(f):
 for k,v in {'full_name':'Synthetic photo guest','phone':'9999999999','address':'Synthetic address','arrived_from':'Udaipur','next_destination':'Jaipur','nightly_rate':'1200'}.items():f.locator('[name='+k+']').fill(v)
 f.locator('[name=room_id]').select_option('room-a')
def saved(p,f,back=True):
 p.evaluate('''async({front,back,includeBack})=>{const q=__BITE_HOTEL_QA,d=__BITE_DOCUMENT_QA,g='99999999-9999-4999-8999-999999999999',a=crypto.randomUUID(),b=crypto.randomUUID();q.db.guests.push({id:g,full_name:'Synthetic saved photo guest',phone:'9999999999',address:'Synthetic address',country:'India'});q.db.stays.push({id:'old-photo-stay',guest_id:g,status:'checked_out',created_at:new Date().toISOString(),registration:{id_front:a,id_back:includeBack?b:null}});for(const [id,bytes]of[[a,front],...(includeBack?[[b,back]]:[])]){const blob=new Blob([new Uint8Array(bytes)],{type:'image/png'}),path='synthetic/'+id;d.rows.set(id,{id,guest_id:g,kind:'masked_id',status:'ready',mime_type:'image/png',byte_size:blob.size,object_path:path,subject_key:null});d.objects.set(path,blob)}await BiteHospitality.reload();BiteHospitality.redraw();document.querySelector('#bhCheckinForm').__haSelectGuest(g);window.__photoIds={front:a,back:b}}''',{'front':list(FRONT),'back':list(BACK),'includeBack':back})
 p.wait_for_function("!!document.querySelector('[name=id_front_id]').value")
try:
 with sync_playwright()as pw:
  browser=pw.chromium.launch()
  for width in [360,390,1440]:
   c,p,f=new_case(browser,width);fill(f)
   check(f.locator('[data-id-side=front]').is_visible() and f.locator('[data-id-side=back]').is_visible(),'H09 both empty photo slots are visible before capture')
   d=capture(p,f)
   check(d.locator('[data-select-side=front] img').count()==1 and d.locator('[data-select-side=back] img').count()==1,'Both photo previews are visible together at '+str(width)+'px')
   check('Add the ID back'in d.inner_text(),'Back capture remains in the same ID screen')
   d.locator('[data-view-large]').click();v=p.locator('.ha-photo-viewer');v.wait_for();check(v.locator('img').is_visible(),'Back photo opens in a larger private viewer')
   v.locator('[data-photo-zoom]').click();check(v.locator('[data-photo-zoom]').get_attribute('aria-pressed')=='true','Photo can be enlarged and panned')
   v.locator('[data-viewer-close]').click();d.locator('[data-select-side=front]').click();d.locator('[data-view-large]').click();check('Front photo'in p.locator('.ha-photo-viewer').inner_text(),'Front photo can be inspected separately');p.locator('[data-viewer-close]').click()
   d.locator('[data-select-side=back]').click();d.locator('[data-next]').click();check(f.locator('[data-id-thumbnails] img').count()==2,'Form keeps both reviewable thumbnails')
   p.evaluate('window.__correctBack=document.querySelector("[name=id_back]").files[0]');f.locator('[data-id-retake-side=front]').click();d=p.locator('.ha-id-dialog');check(d.locator('[data-select-side=front]').get_attribute('aria-pressed')=='true','H09 retake front opens the correct side');photo(p,d.locator('[data-capture]'),None)
   check(f.locator('[name=id_front]').evaluate('(e)=>e.files.length')==1,'Cancelling a retake preserves the current photo')
   photo(p,d.locator('[data-upload]'),file(buffer=b'<html>invalid</html>'));check('Choose a valid'in d.locator('.ha-camera-error').inner_text(),'Invalid replacement explains the problem without losing the good photo')
   photo(p,d.locator('[data-upload]'),file());check(p.evaluate('document.querySelector("[name=id_back]").files[0]===__correctBack'),'Replacing front preserves the correct back')
   d.locator('[data-next]').click();d.locator('[data-next]').click();f.locator('[data-id-remove-side=front]').click();f.locator('[name=id_checked]').check();f.locator('[type=submit]').click()
   p.wait_for_function("document.activeElement?.dataset.haFocus==='id_front'");check(f.locator('[name=id_front]').evaluate('(e)=>e.files.length')==0 and f.locator('[name=id_back]').evaluate('(e)=>e.files.length')==1,'Removing front keeps back and check-in scrolls to the missing front')
   f.locator('[data-id-open=lead]').click();d=p.locator('.ha-id-dialog');photo(p,d.locator('[data-upload]'),file());d.locator('[data-next]').click();d.locator('[data-remove-photo]').click();check(d.locator('[data-next]').is_disabled(),'Removing back blocks completion until another back is added')
   photo(p,d.locator('[data-capture]'),file('back'));check(d.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),'Photo controls fit '+str(width)+'px without sideways scrolling')
   if width==390:p.screenshot(path=str(OUT/'ui-checkin-id-review-390.png'))
   d.locator('[data-next]').click();check(not p.evaluate('__BITE_DOCUMENT_QA.rows.size'),'Taking, viewing, removing and retaking photos creates no premature upload');c.close()
  c,p,f=new_case(browser);fill(f);f.locator('[name=male]').fill('2');d=capture(p,f);d.locator('[data-next]').click();f.locator('[data-add-id]').click();row=f.locator('[data-ha-party-list] [data-ha-id-card]');key=row.get_attribute('data-ha-id-card');row.locator('[name$=_name]').fill('Synthetic companion');d=capture(p,f,key);d.locator('[data-remove-photo]').click();check(f.locator('[name=id_back]').evaluate('(e)=>e.files.length')==1 and f.locator('[name=party_'+key+'_back]').evaluate('(e)=>e.files.length')==0,'Removing companion back does not change the lead guest photos');c.close()
  c,p,f=new_case(browser);saved(p,f);f.locator('[data-id-open=lead]').click();d=p.locator('.ha-id-dialog');d.locator('[data-select-side=front] img').wait_for();d.locator('[data-select-side=back] img').wait_for()
  check(p.evaluate('__BITE_DOCUMENT_QA.downloadCalls')==2,'Both saved photos load through authenticated private reads')
  d.locator('[data-view-large]').click();check(p.locator('.ha-photo-viewer img').get_attribute('src').startswith('blob:'),'Saved ID preview uses a temporary local URL');p.locator('[data-viewer-close]').click();d.locator('[data-remove-photo]').click()
  check(f.locator('[name=id_front_id]').input_value()=='' and f.locator('[name=id_back_id]').input_value()!='','Removing a reused front clears only that check-in selection')
  check(p.evaluate('__BITE_DOCUMENT_QA.objects.size===2&&[...__BITE_DOCUMENT_QA.rows.values()].every(d=>d.status==="ready")'),'Reviewing or replacing a reused photo never deletes guest history silently');c.close()
  c,p,f=new_case(browser);saved(p,f,False);p.evaluate('''()=>{__BITE_DOCUMENT_QA.holdDownload=true;window.__previewUrls=[];const make=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{const u=make(b);__previewUrls.push(u);return u}}''');f.locator('[data-id-open=lead]').click();p.wait_for_function('!!__BITE_DOCUMENT_QA.releaseDownload');p.evaluate('BiteGuestDocuments.clear();BiteCheckinFlow.clear();__BITE_DOCUMENT_QA.releaseDownload()');p.wait_for_function('!BiteGuestDocuments.busy()');check(p.locator('.ha-id-dialog').count()==0 and p.evaluate('__previewUrls.length===0'),'Late private reads cannot reopen a closed account/photo screen');c.close()
  c,p,f=new_case(browser);f.locator('[data-id-open=lead]').click();d=p.locator('.ha-id-dialog');photo(p,d.locator('[data-upload]'),file(buffer=PDF,mime='application/pdf'));d.locator('[data-select-side=front]').click();d.locator('[data-view-large]').click();check(p.locator('.ha-photo-viewer iframe').get_attribute('src').startswith('blob:'),'A PDF front can be inspected in the same private viewer');p.locator('[data-viewer-close]').click();photo(p,d.locator('[data-next]'),file('back'));d.locator('[data-next]').click();c.close()
  browser.close()
 check(not errors,'No photo review controller errors')
except Exception:
 try:p.screenshot(path=str(OUT/'ui-checkin-photo-failure.png'),full_page=True)
 except Exception:pass
 raise
finally:
 server.shutdown();(OUT/'checkin-photo-review-evidence.json').write_text(json.dumps({'checks':checks,'page_errors':errors,'scope':'Synthetic photos and authenticated transport fixtures; no real identity file or production entry is used. Physical phone camera hardware is not exercised.'},indent=2))
