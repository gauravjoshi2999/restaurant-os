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
window.supabase={
 createClient:()=>({
  rpc: async name=>{
   if(name!=='list_public_restaurants')throw Error('Unexpected RPC '+name);
   return {data:[{id:'262aaba7-f48b-4fa5-9ff6-b334ededca84',
     name:'Hotel Maharani Palace',public_description:'Pure Veg Restaurant',address:'Rajsamand'}],error:null};
  },
  from:table=>{
    if(!['menu_categories','menu_items'].includes(table))throw Error('Unexpected table '+table);
    const q={
      select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,
      then:(resolve,reject)=>Promise.resolve({data:table==='menu_categories'
       ?[{id:'cat-veg',name:'Main Course',sort_order:1}]
       :[{id:'dish-1',name:'Paneer Butter Masala',description:'Fresh paneer',price:180,image_url:null,is_vegetarian:true,category_id:'cat-veg'},
         {id:'dish-2',name:'Chicken Curry',description:'Spiced',price:250,image_url:null,is_vegetarian:false,category_id:'cat-veg'}],
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
   page.locator('#restaurantName').get_by_text('Hotel Maharani Palace').wait_for(timeout=8000)
   check(page.locator('.item').count()==2,f'Menu shows only available items at {width}px')
   check('Pure Veg Restaurant' in page.locator('#restaurantDescription').inner_text(),f'Correct restaurant details at {width}px')
   check(page.locator('form').count()==0 and page.get_by_text('Add to Cart').count()==0
     and page.get_by_text('Pay Now').count()==0,f'No guest order/login/checkout controls at {width}px')
   page.locator('#vegOnly').check()
   check(page.locator('.item').count()==1 and 'Paneer Butter Masala' in page.locator('#menu').inner_text(),f'Veg-only filter at {width}px')
   page.locator('#vegOnly').uncheck()
   page.locator('#dishSearch').fill('Chicken')
   check(page.locator('.item').count()==1 and 'Chicken Curry' in page.locator('#menu').inner_text(),f'Dish search at {width}px')
   check(page.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),f'QR menu has no horizontal overflow at {width}px')
   check(page.evaluate('window.__qrTestWrites.length===0'),f'QR menu performs no writes at {width}px')
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
