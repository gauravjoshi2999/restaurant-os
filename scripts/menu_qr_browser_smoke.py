#!/usr/bin/env python3
"""QR-only dining menu: real HTML and local QR library, in-memory Supabase fixture.
No live account, order or payment writes are made by this test.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from pathlib import Path
from playwright.sync_api import sync_playwright
import os

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
server=ThreadingHTTPServer(("127.0.0.1",4189),SimpleHTTPRequestHandler)
Thread(target=server.serve_forever,daemon=True).start()
RID="262aaba7-f48b-4fa5-9ff6-b334ededca84"
SUPABASE_MOCK=r"""
window.__qrTestWrites=[];
window.__qrMenuPrice=180;
window.__qrSchema='current';
window.__qrReads=[];
const channelDishes=[
 {id:'qr-only',name:'QR Only Dish',available_qr:true,available_online:false,is_available:true},
 {id:'online-only',name:'Online Only Dish',available_qr:false,available_online:true,is_available:true},
 {id:'room-only',name:'Room Only Dish',available_qr:false,available_room:true,is_available:true},
 {id:'paused',name:'Paused Dish',available_qr:true,is_available:false}
].map(row=>({...row,category_id:'cat-veg',is_vegetarian:true,price:90}));
window.supabase={
 createClient:()=>({
  rpc: async name=>{
   if(name==='bite_storefront')return {data:{restaurants:[{id:'262aaba7-f48b-4fa5-9ff6-b334ededca84',cover_image_path:null},{id:'11111111-1111-4111-8111-111111111111',cover_image_path:null}]},error:null};
   if(name!=='list_public_restaurants')throw Error('Unexpected RPC '+name);
   return {data:[
     {id:'262aaba7-f48b-4fa5-9ff6-b334ededca84',
       name:'Hotel Maharani Palace',public_description:'Pure Veg Restaurant',
       cuisine_tags:['Pure Vegetarian (शुद्ध शाकाहारी)'],address:'Rajsamand'},
     {id:'11111111-1111-4111-8111-111111111111',
       name:'Mixed Menu Demo Restaurant',public_description:'Mixed menu',
       cuisine_tags:['Indian'],address:'Test'}
   ],error:null};
  },
  from:table=>{
    if(!['menu_categories','menu_items'].includes(table))throw Error('Unexpected table '+table);
    const q={
      filters:{},
      select:()=>q,
      eq:(field,value)=>{q.filters[field]=value;return q},
      order:()=>q,limit:()=>q,
      then:(resolve,reject)=>settle().then(resolve,reject)
    };
    const settle=async()=>{
      if(table==='menu_categories')
        return {data:[{id:'cat-veg',name:'Main Course',sort_order:1},{id:'cat-breakfast',name:'Breakfast',sort_order:2}],error:null};
      window.__qrReads.push({...q.filters});
      const missingFlag=window.__qrSchema==='legacy'&&q.filters.available_qr;
      if(missingFlag)return {error:{code:'42703',message:'column menu_items.available_qr does not exist'}};
      if(window.__qrSchema==='denied')return {error:{code:'42501',message:'permission denied'}};
      const data=q.filters.restaurant_id==='262aaba7-f48b-4fa5-9ff6-b334ededca84'
         ?[{id:'dish-1',name:'Paneer Butter Masala',description:'Fresh paneer',
            price:window.__qrMenuPrice,image_url:null,is_vegetarian:true,category_id:'cat-veg'},
           {id:'dish-2',name:'Veg Sandwich',description:'Fresh vegetables',price:120,
            image_url:null,is_vegetarian:true,category_id:'cat-breakfast'}]
         :[{id:'dish-1',name:'Paneer Butter Masala',description:'Fresh paneer',price:180,
             image_url:null,is_vegetarian:true,category_id:'cat-veg'},
           {id:'dish-3',name:'Chicken Curry',description:'Spiced',price:250,
             image_url:null,is_vegetarian:false,category_id:'cat-veg'}];
      const rows=window.__qrSchema==='channels'?[...data,...channelDishes]:data;
      return {data:rows.filter(row=>q.filters.is_available!==true||row.is_available!==false)
        .filter(row=>q.filters.available_qr!==true||row.available_qr!==false),error:null};
    };
    return q;
  }
 })
};
"""
def check(condition,message):
 if not condition:raise AssertionError(message)
 print('PASS:',message)

try:
 with sync_playwright() as playwright:
  browser=playwright.chromium.launch(executable_path=os.environ.get('BITE_CHROMIUM_EXECUTABLE'))
  for width in (320,360,390,430,1440):
   page=browser.new_page(viewport={'width':width,'height':820})
   page.route('**/supabase.min.js',lambda route:route.fulfill(status=200,
     content_type='application/javascript',body=SUPABASE_MOCK))
   page.goto(f'http://127.0.0.1:4189/menu-qr.html?restaurant={RID}',wait_until='load')
   page.wait_for_function("document.getElementById('restaurantName').textContent==='Hotel Maharani Palace'",timeout=8000)
   check(page.locator('.item').count()==2,f'Pure Veg menu shows two available items at {width}px')
   check(page.locator('.hero-photo img').is_visible() and 'assets/food/meal-1100.jpg' in page.locator('#restaurantCoverImage').get_attribute('src'),f'QR hero matches customer cover at {width}px')
   check(page.locator('.brand img').get_attribute('src')=='assets/bite-selected-wordmark.webp',f'New Bite logo in header at {width}px')
   check('Pure Veg Restaurant' in page.locator('#restaurantDescription').inner_text(),f'Correct restaurant details at {width}px')
   check(page.locator('#vegSwitch').is_hidden() and page.locator('#pureVegLabel').is_visible(),
         f'Pure Veg restaurant hides redundant vegetarian checkbox at {width}px')
   check(page.locator('form').count()==0 and page.get_by_text('Add to Cart').count()==0
     and page.get_by_text('Pay Now').count()==0,f'No guest order/login/checkout controls at {width}px')
   page.locator('#dishSearch').fill('Paneer')
   check(page.locator('.item').count()==1 and 'Paneer Butter Masala' in page.locator('#menu').inner_text(),
         f'Dish search works for Pure Veg menu at {width}px')
   page.locator('#dishSearch').fill('')
   page.locator('#jumpToMenuBtn').click()
   page.wait_for_function('window.scrollY>40',timeout=8000)
   page.wait_for_function("document.querySelector('#menu .item').getBoundingClientRect().top<innerHeight-80",timeout=8000)
   check(page.evaluate("document.querySelector('#menu .item').getBoundingClientRect().top<innerHeight-80"),
     f'Jump button makes dish cards visible at {width}px')
   page.locator('#categories [data-category="cat-breakfast"]').click()
   page.wait_for_function("document.getElementById('selectedCategoryTitle').textContent==='Breakfast'",timeout=8000)
   check(page.locator('.item').count()==1 and 'Veg Sandwich' in page.locator('#menu').inner_text(),f'Breakfast filters dishes at {width}px')
   page.wait_for_function("document.querySelector('#menu .item').getBoundingClientRect().top<innerHeight-80",timeout=8000)
   check(page.evaluate("document.querySelector('#menu .item').getBoundingClientRect().top<innerHeight-80"),
     f'Breakfast tap displays matching dish cards in the viewport at {width}px')
   page.locator('#categories [data-category="all"]').click()
   check('₹180' in page.locator('#menu').inner_text(),f'Original menu price appears at {width}px')
   page.evaluate("window.__qrMenuPrice=240")
   page.locator('#refreshMenuBtn').click()
   page.wait_for_function("document.getElementById('menu').textContent.includes('₹240')",timeout=8000)
   check('₹240' in page.locator('#menu').inner_text(),f'Price updates using SAME QR link at {width}px')
   check(page.locator('#refreshMenuBtn').is_enabled(),f'Refresh rate action resets at {width}px')
   check(page.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),
         f'QR menu no horizontal overflow at {width}px')
   check(page.evaluate('window.__qrTestWrites.length===0'),f'QR menu makes no writes at {width}px')
   page.evaluate("window.__qrSchema='channels'; window.__qrReads=[]")
   page.locator('#refreshMenuBtn').click()
   page.get_by_text('QR Only Dish',exact=True).wait_for(timeout=8000)
   check(page.locator('.item').count()==3 and all(page.get_by_text(dish,exact=True).count()==0
     for dish in ('Online Only Dish','Room Only Dish','Paused Dish')),f'QR exposes only active QR dishes at {width}px')
   check(page.evaluate("window.__qrReads.length===1 && window.__qrReads[0].available_qr===true"),
     f'QR visibility filter is sent to the database at {width}px')
   if width==390:
    page.evaluate("window.__qrSchema='legacy'; window.__qrReads=[]")
    page.locator('#refreshMenuBtn').click()
    page.wait_for_function("window.__qrReads.length===2 && !document.getElementById('refreshMenuBtn').disabled")
    check(page.locator('.item').count()==2 and page.evaluate("""() => {
      const [first,retry]=window.__qrReads;
      return first.available_qr===true && !('available_qr' in retry) &&
        first.restaurant_id===retry.restaurant_id && first.is_available===true && retry.is_available===true;
    }"""),'Legacy QR retry preserves outlet and global availability')
    page.evaluate("window.__qrSchema='denied'; window.__qrReads=[]")
    page.locator('#refreshMenuBtn').click()
    page.wait_for_function("document.getElementById('menuFreshness').textContent.includes('latest update verify nahi hua')")
    check(page.locator('.item').count()==2 and page.evaluate("window.__qrReads.length===1 && window.__qrReads[0].available_qr===true"),
      'Permission error retains the previous snapshot and never retries with a broader query')
   page.close()
  page=browser.new_page(viewport={'width':390,'height':820})
  page.route('**/supabase.min.js',lambda route:route.fulfill(status=200,
    content_type='application/javascript',body=SUPABASE_MOCK))
  page.goto('http://127.0.0.1:4189/menu-qr.html?restaurant=11111111-1111-4111-8111-111111111111',wait_until='load')
  page.wait_for_function("document.getElementById('restaurantName').textContent==='Mixed Menu Demo Restaurant'",timeout=8000)
  check(page.locator('#vegSwitch').is_visible() and page.locator('#pureVegLabel').is_hidden(),
        'Mixed-menu restaurant retains Veg filter')
  page.locator('#vegOnly').check()
  check(page.locator('.item').count()==1 and 'Paneer Butter Masala' in page.locator('#menu').inner_text(),
        'Mixed-menu Veg filter excludes non-veg dishes')
  page.close()
  page=browser.new_page(viewport={'width':390,'height':820},accept_downloads=True)
  page.route('**/supabase.min.js',lambda route:route.fulfill(status=200,
   content_type='application/javascript',body=SUPABASE_MOCK))
  page.goto(f'http://127.0.0.1:4189/menu-qr-card.html?restaurant={RID}',wait_until='load')
  page.locator('#printBtn:enabled').wait_for(timeout=8000)
  check(page.locator('#biteBrandLogo').evaluate('(img)=>img.complete&&img.naturalWidth>0'),
    'Official selected Bite image is ready before QR card download')
  check(page.locator('#code canvas, #code img').count()>0,'Restaurant QR generated from bundled local library')
  check(f'restaurant={RID}' in page.locator('#menuLink').inner_text(),'QR links to same restaurant read-only menu')
  check(page.locator('#downloadBtn').is_enabled() and page.locator('#copyBtn').is_enabled(),'QR can be printed, saved or linked')
  check(page.locator('#biteBrandLogo').get_attribute('src')=='assets/bite-selected-wordmark.webp','QR card uses the new Bite mark')
  check(page.locator('.qr-brand-block').is_visible()
     and page.locator('#biteBrandLogo').is_visible()
     and page.locator('#biteBrandLogo').evaluate('(img)=>img.complete&&img.naturalWidth>0'),
     'Selected full Bite wordmark with its tagline is visible under QR')
  qr_ink=page.evaluate("""() => {
    const c=document.querySelector('#code canvas');
    if(!c)return null;
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    for(let i=0;i<d.length;i+=4){
      if(d[i]<220&&d[i+1]<180&&d[i+2]<150&&d[i+3]>200)
        return [d[i],d[i+1],d[i+2]];
    }
    return null;
  }""")
  check(qr_ink is not None and abs(qr_ink[0]-53)<12
      and abs(qr_ink[1]-22)<12 and abs(qr_ink[2]-110)<12,
      'QR matrix uses Bite purple modules on white')
  with page.expect_download(timeout=12000) as transfer:
    page.locator('#downloadBtn').click()
  downloaded=transfer.value
  check(downloaded.suggested_filename.startswith('bite-branded-menu-qr-')
      and downloaded.suggested_filename.endswith('.png'),
      'Download saves a fully branded card PNG')
  check(Path(downloaded.path()).read_bytes()[:8]==b'\x89PNG\r\n\x1a\n',
      'Branded QR download is a genuine PNG')
  page.emulate_media(media='print')
  check(page.locator('#biteBrandLogo').is_visible()
      and page.locator('.qr-brand-block').is_visible()
      and page.locator('.toolbar').is_hidden(),
      'Print card keeps Bite logo and tagline while hiding toolbar')
  check(page.evaluate('window.__qrTestWrites.length===0'),'Printing menu QR requires no order/payment write')
  page.close()
  browser.close()
finally:
 server.shutdown()
