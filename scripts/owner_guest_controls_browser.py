#!/usr/bin/env python3
"""Production UI controllers, synthetic data/ID uploads, real mobile click paths."""
import base64,json,os,re,subprocess,sys
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT)
subprocess.run([sys.executable,'scripts/prepare_completion_preview.py'],check=True)
base=(ROOT/'dist/qa/owner-flow.html').read_text()
needle=re.search(r'<script src="assets/owner-hospitality.js\?[^"\n]+"></script>',base).group()
fixtures=''.join('<script>'+(ROOT/'scripts/fixtures'/name).read_text()+'</script>'for name in ['hospitality_backend.js','guest_documents_backend.js','checkin_scenarios.js','owner_guest_controls_backend.js'])
trial_fixture = """<script>
(function(){
 const create=window.supabase.createClient;
 window.supabase.createClient=(...args)=>{
  const client=create(...args),rpc=client.rpc.bind(client);
  window.__BITE_TRIAL_QA={calls:[],status:'trial'};
  client.rpc=async(name,params)=>{
   if(name!=='bite_property_trial_usage')return rpc(name,params);
   const trial=window.__BITE_TRIAL_QA;
   trial.calls.push(params.p_property);
   if(trial.status==='error')return {error:{message:'Synthetic backend outage'}};
   if(trial.status==='not_enrolled')return {data:{status:trial.status}};
   return {data:{status:trial.status,ends_at:'2026-12-28T13:42:00Z',
    pos_bills_used:125,pos_bill_limit:300,pos_bills_remaining:175,active_rooms:12,room_limit:15}};
  };
  return client;
 };
})();
</script>"""
property_fixture='<script>window.__BITE_HOSPITALITY_TYPE=new URLSearchParams(location.search).get("kind")||"hotel";</script>'
purchase_fixture = """<script>
(function(){
 if(new URLSearchParams(location.search).get('subscription')!=='sandbox')return;
 document.documentElement.dataset.biteSubscriptionSandbox='true';
 const state=window.__BITE_SUBSCRIPTION_QA={calls:[],mode:'pending',tier:null,openings:[]};
 window.Cashfree=options=>({checkout:async args=>state.openings.push({options,args})});
 const offers=[
  {offer_code:'starter_year',catalog_version:1,tier:'starter',billing_months:12,amount_paise:149900,room_limit:15,pos_bill_limit:1000},
  {offer_code:'plus_month',catalog_version:1,tier:'plus',billing_months:1,amount_paise:39900,room_limit:30,pos_bill_limit:null},
  {offer_code:'pos_recharge_500',catalog_version:1,tier:null,amount_paise:19900,extra_pos_bills:500}
 ];
 const factory=window.supabase.createClient;
 window.supabase.createClient=(...args)=>{
  const client=factory(...args),invoke=client.functions.invoke.bind(client.functions);
  return new Proxy(client, {get(target,key){
   if(key!=='functions'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
   return {async invoke(name,options){
    if(name!=='bite-subscription-sandbox')return invoke(name,options);
    const data=options.body;
    state.calls.push(data);
    if(data.action==='status')return {data:{environment:'sandbox',subscription:{
     status:state.tier?'active':'no_plan',tier:state.tier,ends_at:'2026-12-28T13:42:00Z',pos_bills_remaining:1000,
     room_limit:15,offers
    }}};
    if(data.action==='checkout')return {data:{environment:'sandbox',attempt_id:data.request_id,payment_session_id:'synthetic-session'}};
    if(state.mode==='verified')state.tier='starter';
    return {data:{environment:'sandbox',status:state.mode==='pending'?'awaiting_payment':state.mode}};
   }};
  }});
 };
})();
</script>"""
(ROOT/'dist/qa/owner-guest-controls.html').write_text(base.replace(needle,property_fixture+fixtures+trial_fixture+purchase_fixture+needle))
OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
server=ThreadingHTTPServer(('127.0.0.1',4194),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw));Thread(target=server.serve_forever,daemon=True).start()
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRSEAAAAASUVORK5CYII=')
evidence=[];errors=[]
def check(value,label):
 assert value,label
 evidence.append(label);print('PASS:',label,flush=True)
def visit(browser,width=390,scenario='',kind='hotel',subscription=''):
 context=browser.new_context(viewport={'width':width,'height':950});page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.route('**/*.supabase.co/**',lambda r:r.abort());page.goto('http://127.0.0.1:4194/qa/owner-guest-controls.html?scenario='+scenario+'&kind='+kind+'&subscription='+subscription,wait_until='domcontentloaded');page.wait_for_function("(kind)=>document.body.dataset.businessType===kind",arg=kind);return context,page
def nav(page,route):
 page.evaluate('(id)=>showPage(id)',route);page.locator('#'+route+'.active').wait_for(state='visible')
def photo(form,name):
 form.locator('[name="'+name+'"]').set_input_files({'name':'synthetic-private-copy.png','mimeType':'image/png','buffer':PNG})
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch()
  for width in [320,360,390,430]:
   c,page=visit(browser,width,'overdue');nav(page,'overview')
   link=page.locator('#biteV3Home [data-bv3-route=checkouts]');link.wait_for(state='visible');check(page.locator('#biteV3Home [data-checkout-count]').inner_text()=='1',f'{width}px PDF H02 checkout heading shows actual due count')
   check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'{width}px Home fits mobile width')
   link.click();page.locator('#checkouts.active').wait_for();check(page.locator('#checkouts .bh-record').count()==1,f'{width}px checkout opens due guest list')
   page.locator('#checkouts [data-hotel-action=folio]').click();page.locator('#folios.active .bh-guest-bill-top').wait_for();check('Synthetic Returning Guest' in page.locator('#folios').inner_text(),f'{width}px due guest opens correct folio')
   nav(page,'overview');page.locator('#biteV3HeaderBell').click();page.locator('[data-bv3-notice-index]').first.click();page.locator('#folios.active').wait_for();check('Synthetic Returning Guest' in page.locator('#folios').inner_text(),f'{width}px notification opens guest folio')
   nav(page,'hotel-register');f=page.locator('#bhCheckinForm');check(f.locator('[data-foreign-card=lead]').evaluate('(e)=>!!e.closest(".ha-id-section")') is False,f'{width}px guest type is outside ID camera section')
   check(f.locator('[data-foreign-body]').first.is_hidden(),f'{width}px foreign / OCI details are collapsed for Indian guests')
   check('Guest type: Indian' in f.locator('[data-foreign-card=lead]').inner_text(),f'{width}px clear Indian guest type setting')
   page.screenshot(path=str(OUT/f'guest-controls-{width}.png'));c.close()
  c,page=visit(browser);nav(page,'hotel-register');f=page.locator('#bhCheckinForm')
  for name,value in {'full_name':'Synthetic Four Adult Family','phone':'7777777777','address':'QA address','arrived_from':'Udaipur','next_destination':'Jaipur','male':'2','nightly_rate':'1200','advance_amount':'2000'}.items():f.locator('[name='+name+']').fill(value)
  f.locator('[name=room_id]').select_option('room-a');f.locator('[name=family_enabled]').check();f.locator('[name=family_room_ids][value=room-b]').check();f.locator('[name=family_adults_room-b]').fill('2')
  photo(f,'id_front');photo(f,'id_back');f.locator('[name=id_checked]').check();f.locator('button[type=submit]').click();check('2 guest IDs' in f.inner_text(),'Four adult family asks for only one additional ID')
  f.locator('[data-add-id]').click();extra=f.locator('[data-ha-party-list] [data-ha-id-card]').first;extra.locator('input[name$=_name]').fill('Synthetic Second Adult');key=extra.get_attribute('data-ha-id-card');photo(f,'party_'+key+'_front');photo(f,'party_'+key+'_back');f.locator('[name=id_checked]').check()
  f.locator('button[type=submit]').click();f.locator('.bh-review').wait_for();check(f.locator('[data-ha-id-card]').count()==2,'Four adults review succeeds with exactly two ID records')
  f.locator('button[type=submit]').click();page.locator('#folios.active').wait_for();page.wait_for_function('__BITE_HOTEL_QA.db.stays.filter(s=>s.status==="in_house").length===2')
  check(page.evaluate('__BITE_HOTEL_QA.db.entries.filter(e=>e.kind==="advance").reduce((n,e)=>n+e.amount,0)===2000'),'Family check-in records total advance once')
  # Optional IDs remain available rather than enforcing a hard maximum of two.
  nav(page,'hotel-register');f=page.locator('#bhCheckinForm');f.locator('[name=male]').fill('4');f.locator('[data-add-id]').click();f.locator('[data-add-id]').click();check(f.locator('[data-ha-id-card]').count()==3,'Third guest ID is optional and can be added')
  nav(page,'hr');form=page.locator('[data-access-form=staff]');form.wait_for();check(not form.locator('[name=permissions][value=reporting]').is_checked() and not form.locator('[name=permissions][value=checkout]').is_checked(),'New staff default to entry access without reports or checkout')
  form.locator('[name=email]').fill('staff@example.test');form.locator('[name=role]').select_option('manager');form.locator('[name=permissions][value=checkout]').check();form.locator('button[type=submit]').click();page.wait_for_function('!!__BITE_HOTEL_QA.savedAccess');check(page.evaluate('__BITE_HOTEL_QA.savedAccess.p_permissions.includes("checkout")'),'Owner can grant checkout permission')
  page.locator('[data-access-edit]').first.click();form=page.locator('[data-access-form=staff]');form.locator('[name=active]').uncheck();form.locator('button[type=submit]').click();page.wait_for_function('__BITE_HOTEL_QA.savedAccess.p_active===false');check(True,'Owner can revoke staff login access')
  nav(page,'settings');card=page.locator('#biteOwnerDataControls');card.locator('[data-data-load]').click();card.locator('[data-data-all]').wait_for();card.locator('[data-data-all]').check();card.locator('[data-data-review]').click();card.locator('[name=confirmation]').wait_for();card.locator('[name=confirmation]').fill(page.evaluate('__BITE_HOTEL_QA.property.name'));card.locator('button[type=submit]').click();page.wait_for_function('__BITE_HOTEL_QA.db.stays.length===0&&__BITE_HOTEL_QA.db.folios.length===0');check('records deleted' in page.locator('#biteOwnerDataControls .bh-message').inner_text(),'Owner deletion removes selected stays/bills and confirms success')
  c.close()
  c,page=visit(browser,390,'expense-entry')
  check(page.evaluate("BiteHospitality.getMore().some(row=>row[0]==='expenses'&&row[1]==='Record expense')"),'Entry-only staff can find Record expense in More')
  nav(page,'expenses')
  form=page.locator('#expenses [data-hotel-form=expense]')
  form.locator('[name=description]').fill('Laundry QA')
  form.locator('[name=amount]').fill('500')
  form.locator('button[type=submit]').click()
  form.get_by_text('Expense saved.',exact=True).wait_for()
  check(page.evaluate('__BITE_HOTEL_QA.expense.p_payload.amount')==500,'Entry-only staff saves an expense from the actual form')
  check(not page.locator('#expenses').get_by_text('Expense history').count(),'Entry-only form contains no historical expenses')
  page.evaluate("showPage('daily-book')")
  page.locator('#overview.active').wait_for()
  check(not page.locator('#daily-book').is_visible(),'Entry-only staff cannot navigate directly to Daily Book')
  c.close()
  c,page=visit(browser,390,'guest-entry');nav(page,'hotel-register')
  f=page.locator('#bhCheckinForm')
  check(f.locator('[name=advance_amount]').is_hidden() and f.locator('[name=deposit_amount]').is_hidden(),'Guest-entry staff cannot enter advances or deposits')
  check(not page.locator('#hotel-register [data-gr-action=open-past]').count(),'Guest-entry staff see no old bills shortcut')
  for name,value in {'full_name':'Synthetic Reception Check-in','phone':'7777777777','address':'QA address','arrived_from':'Udaipur','next_destination':'Jaipur','male':'1','nightly_rate':'1200'}.items():f.locator('[name='+name+']').fill(value)
  f.locator('[name=room_id]').select_option('room-a')
  photo(f,'id_front');photo(f,'id_back');f.locator('[name=id_checked]').check()
  f.locator('button[type=submit]').click();f.locator('.bh-review').wait_for()
  f.locator('button[type=submit]').click()
  page.locator('#reservations.active').get_by_text('Check-in saved.',exact=True).wait_for()
  check(not page.locator('#folios').is_visible(),'Guest-entry check-in saves and returns to Reservations without opening a bill')
  nav(page,'settings')
  page.locator('#settings').get_by_role('heading',name='Settings',exact=True).wait_for()
  check(not page.locator('#biteTrialUsage').count() and page.evaluate('__BITE_TRIAL_QA.calls.length')==0,
        'Reception cannot see or fetch the Owner trial usage card')
  c.close()
  for width,kind in [(320,'hybrid'),(360,'hotel'),(390,'hybrid'),(430,'hybrid'),(1440,'restaurant')]:
   c,page=visit(browser,width,kind=kind)
   nav(page,'settings')
   card=page.locator('#biteTrialUsage')
   card.get_by_text('Trial ends 28 Dec 2026, 7:12 pm IST.',exact=True).wait_for()
   if kind!='hotel':
    check(card.get_by_text('125 of 300 used',exact=True).is_visible() and card.get_by_text('175',exact=True).is_visible(),
          f'{width}px {kind} Owner sees issued and remaining POS bills')
   else:
    check(not card.get_by_text('POS bills',exact=True).count(),'Hotel-only Settings omits POS usage')
   if kind!='restaurant':
    check(card.get_by_text('12 of 15',exact=True).is_visible(),f'{width}px {kind} Owner sees active room usage')
   else:
    check(not card.get_by_text('Active rooms',exact=True).count(),'Restaurant-only Settings omits room usage')
   check(page.evaluate("BiteHospitality.prop().id===__BITE_TRIAL_QA.calls.at(-1)"),'Trial loads for the selected property')
   check(card.evaluate('(el)=>el.getBoundingClientRect().right<=innerWidth+1&&el.scrollWidth<=el.clientWidth+1'),
         f'{width}px subscription card fits the viewport')
   if width==390:
    card.screenshot(path=str(OUT/'guest-controls-trial-usage-390.png'))
    page.evaluate("__BITE_TRIAL_QA.status='error'; showPage('settings')")
    card.get_by_text('Could not load trial usage.',exact=True).wait_for()
    check(not card.locator('dl').is_visible(),'Trial request failure clears previous figures')
    page.evaluate("__BITE_TRIAL_QA.status='expired'")
    card.get_by_role('button',name='Retry',exact=True).click()
    card.get_by_text('Trial ended 28 Dec 2026, 7:12 pm IST.',exact=True).wait_for()
    check(not card.get_by_text('POS bills left',exact=True).count(),'Expired trial omits remaining POS allowance')
    page.evaluate("__BITE_TRIAL_QA.status='not_enrolled'; showPage('settings')")
    card.get_by_text('This property has no trial yet.',exact=True).wait_for()
    check(not card.locator('dl').is_visible(),'Unenrolled property does not show usage or payment prompts')
   c.close()
  c,page=visit(browser,390,kind='hybrid',subscription='sandbox')
  nav(page,'settings')
  purchase=page.locator('.bh-subscription-purchase')
  chooser=purchase.get_by_role('combobox',name='Choose a plan or recharge')
  chooser.wait_for()
  chooser.select_option('starter_year')
  purchase.get_by_role('button',name='Choose Starter').click()
  purchase.get_by_text('Payment is awaiting confirmation.',exact=True).wait_for()
  check(page.evaluate("__BITE_SUBSCRIPTION_QA.openings[0].options.mode")=='sandbox',
        'Owner checkout opens Cashfree sandbox')
  pending_id=page.evaluate("__BITE_SUBSCRIPTION_QA.calls.find(x=>x.action==='checkout').request_id")
  page.reload(wait_until='domcontentloaded')
  page.wait_for_function("document.body.dataset.businessType==='hybrid'")
  nav(page,'settings')
  purchase.get_by_role('button',name='Continue test payment').click()
  purchase.get_by_text('Payment is awaiting confirmation.',exact=True).wait_for()
  check(page.evaluate("__BITE_SUBSCRIPTION_QA.calls.find(x=>x.action==='checkout').request_id")==pending_id,
        'Returning to Settings reuses the same attempt after reload')
  page.evaluate("__BITE_SUBSCRIPTION_QA.mode='verified'")
  purchase.get_by_role('button',name='Check payment').click()
  purchase.get_by_text('Test payment verified.',exact=True).wait_for()
  chooser.select_option('starter_year')
  purchase.get_by_role('button',name='Renew Starter').wait_for()
  chooser.select_option('pos_recharge_500')
  purchase.get_by_role('button',name='Recharge',exact=True).wait_for()
  purchase.screenshot(path=str(OUT/'guest-controls-subscription-checkout-390.png'))
  c.close()
  c,page=visit(browser,390,scenario='guest-entry',subscription='sandbox')
  nav(page,'settings')
  check(not page.locator('.bh-subscription-purchase').count(),'Reception cannot see sandbox subscription purchase controls')
  c.close()
  c,page=visit(browser,390,kind='hybrid')
  nav(page,'settings')
  page.locator('#biteTrialUsage').wait_for()
  check(not page.locator('.bh-subscription-purchase').count(),'Normal Owner app exposes trial usage without paid checkout')
  c.close()
  check(not errors,'No JavaScript page errors: '+str(errors[:2]));browser.close()
finally:
 server.shutdown();(OUT/'owner-guest-controls-evidence.json').write_text(json.dumps({'checks':evidence,'errors':errors},indent=2))
