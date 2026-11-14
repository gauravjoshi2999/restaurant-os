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
window.supabase={
 createClient:()=>({
  rpc: async name=>{
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
      restaurantId:'',
      select:()=>q,
      eq:(field,value)=>{if(field==='restaurant_id')q.restaurantId=value;return q},
      order:()=>q,limit:()=>q,
      then:(resolve,reject)=>Promise.resolve({data:table==='menu_categories'
       ?[{id:'cat-veg',name:'Main Course',sort_order:1}]
       :q.restaurantId==='262aaba7-f48b-4fa5-9ff6-b334ededca84'
         ?[{id:'dish-1',name:'Paneer Butter Masala',description:'Fresh paneer',
            price:window.__qrMenuPrice,image_url:null,is_vegetarian:true,category_id:'cat-veg'},
           {id:'dish-2',name:'Veg Sandwich',description:'Fresh vegetables',price:120,
            image_url:null,is_vegetarian:true,category_id:'cat-veg'}]
         :[{id:'dish-1',name:'Paneer Butter Masala',description:'Fresh paneer',price:180,
             image_url:null,is_vegetarian:true,category_id:'cat-veg'},
           {id:'dish-3',name:'Chicken Curry',description:'Spiced',price:250,
             image_url:null,is_vegetarian:false,category_id:'cat-veg'}],
       error:null}).then(resolve,reject)
    };return q;
  }
 })
};
"""
def check(condition,message):
 if not condition:raise AssertionError(message)
 print('PASS:',message)

try:
 with sync_playwright() as playwright:
  browser=playwright.chromium.launch()
  for width in (320,390,430):
   page=browser.new_page(viewport={'width':width,'height':820})
   page.route('**/supabase.min.js',lambda route:route.fulfill(status=200,
     content_type='application/javascript',body=SUPABASE_MOCK))
   page.goto(f'http://127.0.0.1:4189/menu-qr.html?restaurant={RID}',wait_until='load')
   page.wait_for_function("document.getElementById('restaurantName').textContent==='Hotel Maharani Palace'",timeout=8000)
   check(page.locator('.item').count()==2,f'Pure Veg menu shows two available items at {width}px')
   check('Pure Veg Restaurant' in page.locator('#restaurantDescription').inner_text(),f'Correct restaurant details at {width}px')
   check(page.locator('#vegSwitch').is_hidden() and page.locator('#pureVegLabel').is_visible(),
         f'Pure Veg restaurant hides redundant vegetarian checkbox at {width}px')
   check(page.locator('form').count()==0 and page.get_by_text('Add to Cart').count()==0
     and page.get_by_text('Pay Now').count()==0,f'No guest order/login/checkout controls at {width}px')
   page.locator('#dishSearch').fill('Paneer')
   check(page.locator('.item').count()==1 and 'Paneer Butter Masala' in page.locator('#menu').inner_text(),
         f'Dish search works for Pure Veg menu at {width}px')
   page.locator('#dishSearch').fill('')
   check('₹180' in page.locator('#menu').inner_text(),f'Original menu price appears at {width}px')
   page.evaluate("window.__qrMenuPrice=240")
   page.locator('#refreshMenuBtn').click()
   page.wait_for_function("document.getElementById('menu').textContent.includes('₹240')",timeout=8000)
   check('₹240' in page.locator('#menu').inner_text(),f'Price updates using SAME QR link at {width}px')
   check(page.locator('#refreshMenuBtn').is_enabled(),f'Refresh rate action resets at {width}px')
   check(page.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),
         f'QR menu no horizontal overflow at {width}px')
   check(page.evaluate('window.__qrTestWrites.length===0'),f'QR menu makes no writes at {width}px')
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
  page=browser.new_page(viewport={'width':390,'height':820})
  page.route('**/supabase.min.js',lambda route:route.fulfill(status=200,
   content_type='application/javascript',body=SUPABASE_MOCK))
  page.goto(f'http://127.0.0.1:4189/menu-qr-card.html?restaurant={RID}',wait_until='load')
  page.locator('#printBtn:enabled').wait_for(timeout=8000)
  check(page.locator('#code canvas, #code img').count()>0,'Restaurant QR generated from bundled local library')
  check(f'restaurant={RID}' in page.locator('#menuLink').inner_text(),'QR links to same restaurant read-only menu')
  check(page.locator('#downloadBtn').is_enabled() and page.locator('#copyBtn').is_enabled(),'QR can be printed, saved or linked')
  check(page.evaluate('window.__qrTestWrites.length===0'),'Printing menu QR requires no order/payment write')
  page.close()
  browser.close()
finally:
 server.shutdown()
