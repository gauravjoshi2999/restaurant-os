#!/usr/bin/env python3
"""Actual UI controllers with a synthetic transport. PG17 tests own DB/security evidence."""
import json,os,subprocess,sys
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT)
OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,'scripts/prepare_completion_preview.py'],check=True)
html=(ROOT/'dist/qa/owner-flow.html').read_text();fixture=(ROOT/'scripts/fixtures/hospitality_backend.js').read_text()
needle='<script src="assets/owner-hospitality.js?v=20261116-3"></script>'
multi_fixture="""<script>
+const multiFactory=window.supabase.createClient;window.supabase.createClient=(...args)=>{const c=multiFactory(...args),base=c.rpc.bind(c),qa=window.__BITE_HOTEL_QA;const second={...structuredClone(qa.property),id:'34343434-3434-4434-8434-343434343434',name:'Second hotel QA',business_type:'hotel',outlets:[],capabilities:[...BiteCapabilities.defaults.hotel],configured_capabilities:[...BiteCapabilities.defaults.hotel]};c.rpc=async(name,args)=>{if(localStorage.getItem('qa_multiple_properties')==='on'){if(name==='bite_owner_context')return{data:[structuredClone(qa.property),second],error:null};if(name==='bite_hotel_workspace'&&args.p_property===second.id)return{data:{rooms:[{id:'second-room',number:'S-201',room_type:'Suite',nightly_rate:999,adults:2,children:0,housekeeping:'ready',active:true}],guests:[],stays:[],folios:[],entries:[],audit:[],expenses:[],members:[]},error:null};}return base(name,args)};return c};
+</script>""".replace('\n+','\n')
html=html.replace(needle,'<script>window.__BITE_HOSPITALITY_TYPE="hybrid";</script><script>'+fixture+'</script>'+multi_fixture+needle)
assert fixture in html
(ROOT/'dist/qa/remaining-owner.html').write_text(html)
shared_fixture="""<script>
const sharedFactory=window.supabase.createClient;window.supabase.createClient=(...args)=>{const c=sharedFactory(...args),rpc=c.rpc.bind(c),d=window.__BITE_HOTEL_QA.db;c.rpc=async(name,a)=>{if(!['bite_hotel_workspace','bite_property_command'].includes(name))return rpc(name,a);const v=await(await fetch('/qa-shared-workspace')).json();if(v)Object.assign(d,v);const out=await rpc(name,a);if(!v||name==='bite_property_command'&&!out.error)await fetch('/qa-shared-workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});return out};return c};
</script>"""
(ROOT/'dist/qa/shared-owner.html').write_text(html.replace(needle,shared_fixture+needle))

new_html=html.replace('window.__BITE_HOSPITALITY_TYPE="hybrid"','window.__BITE_HOSPITALITY_TYPE="new-restaurant"').replace("window.__BITE_QA_ROLE='owner'","window.__BITE_QA_ROLE='new-restaurant-owner'")
(ROOT/'dist/qa/new-restaurant-owner.html').write_text(new_html)
customer=(ROOT/'dist/qa/customer-flow.html').read_text()
# The customer token endpoint is separately tested against SQL, including anon privileges.
guest_fixture='''<script>
const guestFactory=window.supabase.createClient;window.supabase.createClient=(...args)=>{const c=guestFactory(...args),rpc=c.rpc.bind(c);c.rpc=async(name,a)=>{
 if(name!=='bite_guest_folio')return rpc(name,a);
 if(a.p_token!=='a'.repeat(64))return{data:null,error:{code:'42501'}};
 return{data:{property:{name:'Synthetic hotel',phone:'9999999999'},number:'TEST-BILL',status:'open',arrival:'2026-11-16',departure:'2026-11-17',expires_at:new Date(Date.now()+3600000).toISOString(),totals:{charges:1000,paid:1200,balance:-200,deposit_held:0,pending:0},entries:[{kind:'charge',description:'Room night',amount:1000,tax:0,status:'confirmed'}],refunds:[{amount:200,status:window.__GUEST_REFUND_STATUS||'processing',method:'UPI',reference_tail:'1234'}]},error:null};};return c};
</script>'''
customer=customer.replace('<script>\nconst SUPABASE_URL=',guest_fixture+'<script>\nconst SUPABASE_URL=',1)
if guest_fixture not in customer:
 customer=customer.replace('const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);',guest_fixture.removeprefix('<script>').removesuffix('</script>')+'\nconst sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);',1)
assert 'const guestFactory=' in customer
(ROOT/'dist/qa/remaining-customer.html').write_text(customer)
shared_state={'db':None}
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT/'dist'),**kw)
 def do_GET(self):
  if self.path=='/qa-shared-workspace':
   body=json.dumps(shared_state['db']).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
  else:super().do_GET()
 def do_POST(self):
  if self.path!='/qa-shared-workspace':self.send_error(404);return
  shared_state['db']=json.loads(self.rfile.read(int(self.headers['Content-Length'])));self.send_response(200);self.end_headers();self.wfile.write(b'{}')
server=ThreadingHTTPServer(('127.0.0.1',4186),Handler);Thread(target=server.serve_forever,daemon=True).start()
evidence=[];errors=[]
def check(ok,label):
 assert ok,label
 evidence.append({'case':label,'status':'PASS','layer':'synthetic Chromium UI'});print('PASS:',label)
def nav(page,route):
 b=page.locator(f'#biteOwnerBottomNav [data-bite-page="{route}"]')
 if b.count() and b.is_visible():b.click()
 else:
  more=page.locator('#biteOwnerBottomNav [data-bite-page=more]')
  if more.is_visible():more.click();page.locator(f'#biteOwnerMoreScreen [data-owner-route="{route}"]').click()
  else:page.locator(f'.nav [data-page="{route}"]').click()
 page.locator(f'#{route}.active').wait_for(state='visible')
def finish(page):page.locator('#bhActionEditor form button[type=submit]').click();page.locator('#bhActionEditor').wait_for(state='detached')
def shot(page,name):page.screenshot(path=str(OUT/f'ui-remaining-{name}.png'),full_page=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch()
  for width in [360,390,1440]:
   context=browser.new_context(viewport={'width':width,'height':900},permissions=['clipboard-read','clipboard-write'])
   page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
   page.route('**/*.supabase.co/**',lambda r:r.abort());page.route('**/api.cashfree.com/**',lambda r:r.abort())
   page.goto('http://127.0.0.1:4186/qa/remaining-owner.html',wait_until='domcontentloaded');page.wait_for_function("document.body.dataset.businessType==='hybrid'")
   nav(page,'settings');form=page.locator('[data-ops-form=policy]');form.locator('[name=early_checkin_fee]').fill('25');form.locator('[name=reviewed]').check();form.locator('button[type=submit]').click();page.wait_for_function('window.__BITE_HOTEL_QA.property.hotel_policy?.early_checkin_fee===25')
   check(page.locator('[data-ops-form=policy] [name=early_checkin_fee]').input_value()=='25','Owner-reviewed policy persists at '+str(width)+'px')
   nav(page,'hotel-register');f=page.locator('#bhCheckinForm');f.locator('[name=full_name]').fill('Synthetic OCI guest');f.locator('[name=phone]').fill('9999999900');f.locator('[name=is_oci]').check();f.locator('[name=room_id]').select_option('room-a');f.locator('[name=booking_source]').select_option('external_booking');f.locator('[name=booking_reference]').fill('SYNTHETIC-PREPAID');f.locator('[name=advance_amount]').fill('100');f.locator('[name=advance_method]').select_option('UPI');f.locator('button[type=submit]').click();page.locator('.bh-review').wait_for(state='visible')
   check('Agreed total:' in page.locator('.bh-review').inner_text(),'Server quote is reviewed before prepaid registration at '+str(width)+'px')
   check(page.evaluate('window.__BITE_HOTEL_QA.db.stays.length')==0,'Quote review does not allocate a stay')
   f.locator('button[type=submit]').click();page.locator('#folios.active').wait_for(state='visible');page.locator('#biteGuestOperations').wait_for(state='visible')
   check('verification pending' in page.locator('#folios').inner_text(),'Unverified prepaid UPI remains pending')
   page.locator('[data-ops-action=compliance]').click();f=page.locator('#bhActionEditor form');f.locator('[name=travel_document_checked]').check();f.locator('[name=arrival_reference]').fill('SYNTHETIC-EXTERNAL-ACK');finish(page)
   check('Acknowledgment recorded' in page.locator('#biteGuestOperations').inner_text(),'OCI arrival acknowledgment stays separate from departure')
   page.locator('[data-hotel-action=share]').click();page.locator('[data-ops-action=issue-link]').click();page.locator('[data-guest-bill-link]').wait_for(state='visible')
   check('#stay='+'a'*64 in page.locator('[data-guest-bill-link]').input_value(),'Guest bill token uses a URL fragment')
   page.locator('[data-ops-action=copy-link]').click();page.locator('[data-ops-action=revoke-link]').click();page.get_by_text('Guest link revoked',exact=True).wait_for(state='visible')
   check(page.evaluate("window.__BITE_HOTEL_QA.calls.some(c=>c.args.p_action==='guest_link_revoke')"),'Revocation calls the authorized property endpoint')
   nav(page,'rooms');page.locator('#rooms [data-hotel-action=room-privacy][data-id=room-a]').click();f=page.locator('#bhActionEditor form');f.locator('[name=do_not_disturb]').check();f.locator('[name=cleaning_requested]').check();finish(page)
   nav(page,'housekeeping');page.locator('[data-ops-action=task-step]').first.click();page.get_by_text('Do Not Disturb is active',exact=True).wait_for(state='visible')
   check(page.evaluate("window.__BITE_HOTEL_QA.db.tasks[0].status==='requested'"),'DND keeps cleaning task waiting')
   nav(page,'rooms');page.locator('#rooms [data-hotel-action=room-privacy][data-id=room-a]').click();page.locator('#bhActionEditor [name=do_not_disturb]').uncheck();finish(page)
   nav(page,'housekeeping');page.locator('[data-ops-action=task-step]').first.click();page.wait_for_function("window.__BITE_HOTEL_QA.db.tasks[0].status==='in_progress'");page.locator('[data-ops-action=task-step]').first.click();page.wait_for_function("window.__BITE_HOTEL_QA.db.tasks[0].status==='completed'")
   check(page.evaluate("window.__BITE_HOTEL_QA.db.rooms[0].housekeeping==='cleaning'"),'Cleaning completion still needs supervisor Ready inspection')
   shot(page,'cleaning-'+str(width))
   nav(page,'pos');page.locator('#posNewSaleBtn').click();page.locator('#orderModal.show').wait_for(state='visible');page.locator('#posPickerItemName').fill('QA Veg');page.locator('#posMenuSuggestions button').first.click();page.locator('#posItemEntry [onclick="confirmPosItemInline()"]').click();page.locator('[name=bite_tender]').select_option('room');page.locator('#biteRoomPOSFolio').select_option(index=1);page.locator('[name=bite_fulfilment]').select_option('room_service');page.locator('[name=bite_service_note]').fill('Deliver with cutlery');page.locator('#createOrderBtn').click();page.locator('#orderModal').wait_for(state='hidden')
   nav(page,'room-service');page.locator('[data-ops-action=task-step]').first.wait_for(state='visible')
   check('Deliver with cutlery' in page.locator('#room-service').inner_text(),'Existing room POS creates a fulfillment task')
   for status in ['in_progress','ready','completed']:
    page.locator('[data-ops-action=task-step]').first.click();page.wait_for_function("window.__BITE_HOTEL_QA.db.tasks.find(t=>t.kind==='room_service').status==='"+status+"'")
   check(page.evaluate("window.__BITE_HOTEL_QA.db.entries.filter(e=>e.category==='food').length") == 1,'Service progress leaves exactly one source food folio entry')
   check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Service queue has no horizontal overflow at '+str(width)+'px')
   page.evaluate("""()=>{const q=window.__BITE_HOTEL_QA,d=q.db;d.entries.push({id:crypto.randomUUID(),folio_id:d.folios[0].id,kind:'payment',category:'payment',amount:1350,method:'Cash',description:'Synthetic credit fixture after a price correction',status:'confirmed',created_at:new Date().toISOString()})}""")
   nav(page,'folios');page.locator('[data-ops-action=refund-request]').click();f=page.locator('#bhActionEditor form');f.locator('[name=amount]').fill('200');f.locator('[name=reason]').fill('Synthetic approved credit return');finish(page)
   page.locator('[data-ops-action=refund-progress]').click();f=page.locator('#bhActionEditor form');f.locator('[name=status]').select_option('paid');f.locator('button[type=submit]').click();page.get_by_text('Verify the actual return and reference',exact=True).wait_for(state='visible');check(page.evaluate("window.__BITE_HOTEL_QA.db.refund_requests[0].status==='requested'"),'Return cannot be marked paid without verified reference')
   f.locator('[name=reference]').fill('SYNTHETIC-RETURN-1234');f.locator('[name=return_verified]').check();finish(page);page.locator('#biteGuestOperations').get_by_text('₹200 · paid',exact=True).wait_for(state='visible');check(True,'Owner sees saved refund progress after verification')
   nav(page,'settings');page.locator('[data-ops-action=apply-outlet]').click();f=page.locator('#bhActionEditor form');f.locator('[name=city]').fill('Rajsamand');f.locator('[name=address]').fill('Synthetic new outlet address');finish(page);page.get_by_text('pending · Lead added',exact=True).wait_for(state='visible')
   check(page.evaluate("window.__BITE_HOTEL_QA.db.outlet_applications[0].onboarding_status==='pending'"),'Restaurant application remains pending Admin review')
   # Dine-in/online toggles use the existing configuration wizard, with POS/service retained.
   page.locator('#settings [data-hotel-action=modules]').click()
   for _ in range(2):page.locator('#business-modules button[type=submit]').click()
   page.locator('#business-modules [name=capabilities][value=dine_in]').uncheck();page.locator('#business-modules [name=capabilities][value=online_food_orders]').uncheck()
   for _ in range(2):page.locator('#business-modules button[type=submit]').click()
   page.wait_for_function("!window.__BITE_HOTEL_QA.property.capabilities.includes('dine_in')")
   nav(page,'pos');page.locator('#posNewSaleBtn').click();page.locator('#orderModal.show').wait_for(state='visible')
   check(page.locator('[name=bite_order_type] option[value="POS - Dine-in"]').count()==0,'Disabling dine-in removes table/order-type options')
   page.locator('#posPickerItemName').fill('QA Veg');page.locator('#posMenuSuggestions button').first.click();page.locator('#posItemEntry [onclick="confirmPosItemInline()"]').click();page.locator('[name=bite_tender]').select_option('room');page.locator('#biteRoomPOSFolio').select_option(index=1);page.locator('[name=bite_fulfilment]').select_option('room_service');page.locator('#createOrderBtn').click();page.locator('#orderModal').wait_for(state='hidden')
   nav(page,'room-service');check(page.evaluate("window.__BITE_HOTEL_QA.db.tasks.filter(t=>t.kind==='room_service').length") == 2,'POS and room service still work with online food orders disabled')
   check(page.locator('#biteOwnerBottomNav [data-bite-page=orders]').count()==0,'Disabled online orders have no navigation tab')
   # Actual shell property handoff and late-response invalidation, synthetic transport.
   page.evaluate("localStorage.setItem('qa_multiple_properties','on')")
   page.evaluate('BiteHospitality.refreshContext(false)');page.evaluate('window.__BITE_HOTEL_QA.delayMs=800;void BiteHospitality.reload()');page.locator('#bitePropertySelect').select_option('34343434-3434-4434-8434-343434343434');page.wait_for_function("document.body.dataset.businessType==='hotel'");nav(page,'rooms');page.locator('#rooms').get_by_text('S-201',exact=True).wait_for(state='visible');page.wait_for_timeout(900)
   check(page.locator('#rooms').get_by_text('101',exact=True).count()==0,'Property handoff reloads the app and clears the prior property workspace')
   check(page.locator('#biteHotelOrderAlert').is_hidden(),'Other property food orders do not show a hotel alert')
   shot(page,'second-property-'+str(width));context.close()
  page=browser.new_page(viewport={'width':390,'height':900});page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*.supabase.co/**',lambda r:r.abort())
  page.goto('http://127.0.0.1:4186/qa/new-restaurant-owner.html',wait_until='domcontentloaded');page.locator('#business-modules.active').wait_for(state='visible')
  page.locator('#business-modules [name=business_type][value=restaurant]').check();page.locator('#business-modules button[type=submit]').click();page.locator('#business-modules [name=name]').fill('Synthetic new cloud kitchen')
  for _ in range(3):page.locator('#business-modules button[type=submit]').click()
  page.wait_for_function("document.body.dataset.businessType==='restaurant'");nav(page,'settings')
  check(page.locator('[data-ops-form=policy]').count()==0,'New restaurant setup has no hotel policy form')
  page.locator('[data-ops-action=apply-outlet]').click();f=page.locator('#bhActionEditor form');f.locator('[name=city]').fill('Rajsamand');f.locator('[name=address]').fill('Synthetic new kitchen road');f.locator('[name=phone]').fill('9999999900');finish(page);page.get_by_text('pending · Lead added',exact=True).wait_for(state='visible')
  check(page.evaluate('window.__BITE_HOTEL_QA.db.rooms.length')==0,'New restaurant owner can apply without creating hotel rooms');page.close()
  # Two independent browser sessions reload the same synthetic server state.
  sessions=[browser.new_context(viewport={'width':390,'height':900}) for _ in range(2)];pages=[c.new_page() for c in sessions]
  for page in pages:
   page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*.supabase.co/**',lambda r:r.abort());page.goto('http://127.0.0.1:4186/qa/shared-owner.html',wait_until='domcontentloaded');page.wait_for_function("document.body.dataset.businessType==='hybrid'");nav(page,'rooms')
  pages[0].locator('[data-hotel-action=room-status][data-id=room-a]').click();pages[0].locator('#bhActionEditor [name=status]').select_option('cleaning');finish(pages[0]);pages[1].bring_to_front();pages[1].wait_for_function("BiteHospitality.getWorkspace().rooms[0].housekeeping==='cleaning'",timeout=40000)
  check(pages[1].locator('#rooms .bh-room-title').first.inner_text().endswith('cleaning'),'Second browser session automatically refreshes the housekeeping list')
  pages[1].locator('[data-hotel-action=room-status][data-id=room-a]').click();pages[1].locator('#bhActionEditor [name=status]').select_option('ready');finish(pages[1]);pages[0].bring_to_front();pages[0].wait_for_function("BiteHospitality.getWorkspace().rooms[0].housekeeping==='ready'",timeout=40000)
  check(pages[0].locator('#rooms .bh-room-title').first.inner_text().endswith('ready'),'Supervisor Ready status returns to the first session')
  for c in sessions:c.close()
  # Guest sees progress without an authenticated hotel membership or location interruption.
  for width in [360,390,1440]:
   page=browser.new_page(viewport={'width':width,'height':900});page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*.supabase.co/**',lambda r:r.abort())
   page.goto('http://127.0.0.1:4186/qa/remaining-customer.html#stay='+'a'*64,wait_until='domcontentloaded');page.locator('#biteGuestStayContent').get_by_text('Processing by hotel',exact=False).wait_for(state='visible')
   check(page.locator('#biteLocationSheet').is_hidden(),'Guest bill opens without location picker at '+str(width)+'px')
   page.evaluate("window.__GUEST_REFUND_STATUS='paid'");page.locator('[data-guest-refresh]').click();page.get_by_text('Return recorded as paid by hotel',exact=False).wait_for(state='visible')
   check('reference ending 1234' in page.locator('#biteGuestStayContent').inner_text(),'Guest sees verified progress and masked return reference')
   check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Guest bill fits '+str(width)+'px')
   shot(page,'guest-bill-'+str(width))
   if width==1440:
    page.emulate_media(media='print');check(page.locator('#homeView').is_hidden() and page.locator('#biteGuestStayContent').is_visible(),'Guest print layout contains only the hotel bill');pdf=page.pdf(path=str(OUT/'guest-hotel-bill.pdf'),format='A4',print_background=True);check(len(pdf)>5000,'Hotel guest bill saves as a rendered PDF');page.emulate_media(media='screen')
   page.locator('#biteGuestStayClose').click();page.evaluate("BiteGuestStay.open('b'.repeat(64))");page.get_by_text('This guest link is invalid, expired or revoked. Ask the hotel for a new link.',exact=True).wait_for(state='visible');check(page.locator('#biteGuestStayContent').get_by_text('TEST-BILL',exact=False).count()==0,'Revoked guest link clears the previous bill');page.close()
  browser.close()
 check(not errors,'No page errors in remaining workflow browser tests')
finally:
 (OUT/'owner-remaining-browser-evidence.json').write_text(json.dumps({'checks':evidence,'page_errors':errors,'scope':'Synthetic browser transport; no real payment or government filing'},indent=2));server.shutdown()
