#!/usr/bin/env python3
"""Real hotel-account UI controllers with synthetic RPC/Storage transport only."""
import base64,json,os,re,subprocess,sys,zipfile
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT)
OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,'scripts/prepare_completion_preview.py'],check=True)
html=(ROOT/'dist/qa/owner-flow.html').read_text()
needle=re.search(r'<script src="assets/owner-hospitality.js\?[^"\n]+"></script>',html).group()
fixture=(ROOT/'scripts/fixtures/hospitality_backend.js').read_text()
docs=(ROOT/'scripts/fixtures/guest_documents_backend.js').read_text()
extra=r"""
(function(){
 const factory=window.supabase.createClient;
 window.supabase.createClient=(...args)=>{
  const c=factory(...args),rpc=c.rpc.bind(c),q=window.__BITE_HOTEL_QA;
  q.db.register_version=1;q.db.next_register_number=1;
  c.rpc=async(name,a={})=>{
   if(name==='bite_daily_book'){
    const day=window.BiteOwner.day(),d={day,pos_sales:100,hotel_sales:1575,other_income:50,gross_sales:1725,tax:75,net_sales:1650,expenses:100,staff_advance:200,cash_in:300,cash_out:100,cash_balance:1200,online_in:250,online_out:50,online_balance:200,profit:1550};
    return{data:{from:a.p_from,to:a.p_to,days:[d],journal:[],accounts:[{account:'Second account',method:'UPI',balance:200}],staff:[],gst_invoices:[{date:day,number:'H/26-27/000042',guest:'Synthetic Guest',gstin:'08ABCDE1234F1Z5',total:1575,tax_lines:[{category:'room',sac:'996311',rate:5,taxable:1200,cgst:30,sgst:30},{category:'food',sac:'996331',rate:5,taxable:300,cgst:7.5,sgst:7.5}]}]},error:null};
   }
   if(name==='bite_property_command'&&a.p_action==='checkout_collect'){
    const v=a.p_payload;
    if(v.amount>0){const payment=await rpc(name,{...a,p_action:'payment',p_payload:{...v,description:'Final checkout payment'},p_request:crypto.randomUUID()});if(payment.error)return payment}
    return rpc(name,{...a,p_action:'checkout',p_payload:{folio_id:v.folio_id},p_request:crypto.randomUUID()});
   }
   const r=await rpc(name,a);
   if(name==='bite_property_command'&&a.p_action==='reserve'&&!r.error){q.db.stays.find(s=>s.id===r.data.id).register_number=1}
   return r;
  };return c;
 };
})();
"""
html=html.replace(needle,'<script>window.__BITE_HOSPITALITY_TYPE="hotel";</script><script>'+fixture+'</script><script>'+docs+'</script><script>'+extra+'</script>'+needle)
(ROOT/'dist/qa/hotel-accounts-owner.html').write_text(html)
server=ThreadingHTTPServer(('127.0.0.1',4192),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw))
Thread(target=server.serve_forever,daemon=True).start()
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRSEAAAAASUVORK5CYII=')
checks=[];errors=[]
def check(ok,label):
 assert ok,label
 checks.append({'case':label,'status':'PASS','layer':'Synthetic Chromium transport'});print('PASS:',label)
def nav(page,route):
 page.evaluate('(id)=>showPage(id)',route);page.locator('#'+route+'.active').wait_for(state='visible')
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch()
  for width in [360,390,1440]:
   page=browser.new_page(viewport={'width':width,'height':950},accept_downloads=True)
   page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
   page.route('**/*.supabase.co/**',lambda r:r.abort())
   page.goto('http://127.0.0.1:4192/qa/hotel-accounts-owner.html',wait_until='domcontentloaded')
   page.wait_for_function("document.body.dataset.businessType==='hotel'")
   check('Open front desk' not in page.locator('#overview').inner_text(),'Home uses Check-in wording at '+str(width)+'px')
   nav(page,'hotel-register');f=page.locator('#bhCheckinForm')
   check(f.get_attribute('data-enhanced')=='true','Enhanced register is active')
   check(f.locator('[name=serial_number]').input_value()=='1','First serial previews 1')
   check(f.locator('[name=register_date]').input_value()==page.evaluate('BiteOwner.day()'),'Entry date follows India calendar')
   for name,value in {'full_name':'Synthetic Register Guest','phone':'9999999999','address':'Synthetic permanent address','arrived_from':'Udaipur','next_destination':'Jaipur'}.items():f.locator('[name='+name+']').fill(value)
   f.locator('[name=transport]').select_option('Bike')
   check(f.locator('[name=vehicle_number]').evaluate('(x)=>x.required'),'Bike reveals a required vehicle number')
   f.locator('[name=vehicle_number]').fill('RJ01AB1234')
   f.locator('[name=room_id]').select_option('room-a')
   f.locator('[name=nightly_rate]').fill('1200')
   f.locator('[name=advance_amount]').fill('100')
   f.locator('button[type=submit]').click()
   check(f.locator('.bh-review').count()==0,'Missing ID front blocks submission before a reservation')
   f.locator('[name=id_front]').set_input_files({'name':'synthetic-front.png','mimeType':'image/png','buffer':PNG})
   f.locator('[name=id_checked]').check()
   check(not f.locator('[name=id_back]').evaluate('(x)=>x.required'),'ID back stays optional')
   check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Check-in fits '+str(width)+'px')
   page.screenshot(path=str(OUT/f'ui-hotel-checkin-{width}.png'),full_page=width>760)
   f.locator('button[type=submit]').click();f.locator('.bh-review').wait_for()
   f.locator('button[type=submit]').click()
   page.locator('#folios.active [data-ha-action=extra]').wait_for(state='visible')
   check(page.evaluate('__BITE_DOCUMENT_QA.rows.size')==1,'One private front is retained; optional back adds no empty file')
   payload=page.evaluate("__BITE_HOTEL_QA.calls.filter(x=>x.name==='bite_property_command'&&x.args.p_action==='reserve').at(-1).args.p_payload")
   check(payload['nightly_rate']==1200 and payload['registration']['vehicle_number']=='RJ01AB1234','Agreed rent and travel details reach the scoped RPC')
   page.locator('#folios [data-ha-action=extra]').click()
   e=page.locator('#bhActionEditor form');e.locator('[name=amount]').fill('150');e.locator('[name=description]').fill('Extra mattress');e.locator('button[type=submit]').click()
   page.locator('#folios').get_by_text('Extra mattress',exact=True).first.wait_for(state='visible')
   page.locator('#folios [data-hotel-action=entry][data-id=payment]').click()
   e=page.locator('#bhActionEditor form');e.locator('[name=amount]').fill('125');e.locator('button[type=submit]').click()
   page.locator('#bhActionEditor').wait_for(state='detached')
   page.locator('#folios [data-ha-action=checkout]').click()
   check('925.00' in page.locator('.ha-checkout-summary').inner_text(),'Checkout shows remaining balance after advance and partial payment')
   page.locator('[data-ha-form=checkout] button[type=submit]').click()
   page.wait_for_function("__BITE_HOTEL_QA.db.folios[0].status==='settled'")
   check(page.evaluate('__BITE_HOTEL_QA.db.stays.length')==1,'Check-in and checkout preserve one stay')
   nav(page,'daily-book');page.locator('.ha-book-table').wait_for()
   check('Second account' in page.locator('#daily-book').inner_text(),'Account-wise online balance appears')
   with page.expect_download() as d:page.locator('[data-ha-action=excel]').click()
   with zipfile.ZipFile(d.value.path()) as z:
    sheet=z.read('xl/worksheets/sheet1.xml').decode()
    check('Staff advance paid' in sheet and 'Online closing' in sheet,'Monthly Excel contains separate advances and online balances')
   with page.expect_download() as d:page.locator('[data-ha-action=gst]').click()
   with zipfile.ZipFile(d.value.path()) as z:
    sheet=z.read('xl/worksheets/sheet1.xml').decode()
    check('H/26-27/000042' in sheet and 'CGST amount' in sheet,'GST Excel includes bill number and tax split')
   check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Daily Book fits '+str(width)+'px with contained table scrolling')
   page.screenshot(path=str(OUT/f'ui-hotel-daily-book-{width}.png'),full_page=width>760)
   page.close()
  browser.close()
 check(not errors,'No controller page errors')
finally:
 server.shutdown();(OUT/'hotel-accounts-browser-evidence.json').write_text(json.dumps({'checks':checks,'page_errors':errors,'scope':'Synthetic data only. SQL integration separately verifies real accounting logic.'},indent=2))
