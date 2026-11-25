#!/usr/bin/env python3
"""Actual Customer/QR HTML with synthetic public API responses, never live writes."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse, parse_qs
import json
import os
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
RID='262aaba7-f48b-4fa5-9ff6-b334ededca84'
MIX='11111111-1111-4111-8111-111111111111'
base=dict(city='Rajsamand',accepts_delivery=True,accepts_pickup=True,serviceable=True,
 is_published=True,onboarding_status='approved',status='Active',opening_time='00:00',closing_time='00:00',
 is_temporarily_closed=False,delivery_paused=False,default_delivery_fee=0,minimum_order_amount=0,
 estimated_prep_minutes=30,cover_image_path=None,average_rating=0)
restaurants=[dict(base,id=RID,name='Hotel Maharani Palace',cuisine_tags=['Pure Vegetarian (शुद्ध शाकाहारी) • North Indian']),
 dict(base,id=MIX,name='Mixed Fixture Restaurant',cuisine_tags=['North Indian'])]
rows=[dict(id='v1',restaurant_id=RID,category_id='c',name='Paneer',price=120,is_vegetarian=True,dietary_type=None,is_available=True),
 dict(id='v2',restaurant_id=MIX,category_id='c',name='Dosa',price=120,is_vegetarian=True,dietary_type='veg',is_available=True),
 dict(id='e',restaurant_id=MIX,category_id='c',name='Special Egg Dish',price=150,is_vegetarian=False,dietary_type='egg',is_available=True),
 dict(id='m',restaurant_id=MIX,category_id='c',name='Chicken Curry',price=200,is_vegetarian=False,dietary_type='nonveg',is_available=True)]
server=ThreadingHTTPServer(('127.0.0.1',4493),lambda *a,**k:SimpleHTTPRequestHandler(*a,directory=str(ROOT),**k))
Thread(target=server.serve_forever,daemon=True).start()

def check(condition,message):
 if not condition:raise AssertionError(message)
 print('PASS:',message)

def configure(page,state):
 def route(request):
  url=request.request.url
  if url.startswith('http://127.0.0.1:4493/'):
   request.continue_();return
  if 'supabase' in url and url.endswith(('/supabase.js','/supabase.min.js')):
   request.continue_();return
  headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, OPTIONS'}
  if request.request.method=='OPTIONS':request.fulfill(status=204,headers=headers);return
  path=urlparse(url).path
  if '/rest/v1/' in path:
   if request.request.method not in ('GET','POST'):raise AssertionError('Unexpected write '+path)
   if '/rpc/' in path:
    if path.endswith('/bite_storefront'):data={'restaurants':restaurants,'categories':[]}
    elif path.endswith('/list_public_restaurants'):data=restaurants
    else:raise AssertionError('Unexpected RPC '+path)
   elif path.endswith('/menu_items'):
    query=parse_qs(urlparse(url).query)
    if state.get('legacy') and 'dietary_type' in query.get('select',[''])[0]:
     request.fulfill(status=400,headers=headers,json={'code':'42703','message':'column menu_items.dietary_type does not exist'});return
    data=[r.copy() for r in rows if not state.get('onlyveg') or r['is_vegetarian']]
    if 'restaurant_id' in query:data=[r for r in data if r['restaurant_id']==query['restaurant_id'][0].removeprefix('eq.')]
    if state.get('legacy'):
     for r in data:r.pop('dietary_type',None)
   elif path.endswith('/menu_categories'):data=[{'id':'c','name':'Main Course','sort_order':1}]
   else:data=[]
   request.fulfill(status=200,headers=headers,json=data);return
  if path.endswith('/auth/v1/settings'):
   request.fulfill(status=200,headers=headers,json={'external':{'google':False}});return
  # Block payment SDK, analytics, unapproved auth/financial APIs and remote images.
  request.abort()
 page.route('**/*',route)

def diet(page,value):
 page.locator('#biteFilterOpen').click()
 page.locator('#biteFilterTabDiet').click()
 page.locator('input[name="bite-filter-diet"][value="'+value+'"]').check()
 page.locator('#biteFilterApply').click()

try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('BITE_CHROMIUM_EXECUTABLE'))
  for width in (320,360,390,430,1440):
   page=browser.new_page(viewport={'width':width,'height':850})
   page.add_init_script("sessionStorage.setItem('bite_customer_location_intro_v1','1')")
   page.on('pageerror',lambda error:print('DIETARY PAGE ERROR:',str(error)))
   state={};configure(page,state)
   page.goto('http://127.0.0.1:4493/customer.html',wait_until='domcontentloaded')
   page.locator('#restaurantGrid .restaurant').first.wait_for(timeout=20000)
   diet(page,'pureveg')
   check(page.locator('#restaurantGrid .restaurant').count()==1 and 'Hotel Maharani Palace' in page.locator('#restaurantGrid').inner_text(),f'Pure Veg filter uses explicit restaurant declaration {width}px')
   page.locator('#clearDiscoveryBtn').click()
   diet(page,'egg')
   check(page.locator('#restaurantGrid .restaurant').count()==1 and 'Mixed Fixture' in page.locator('#restaurantGrid').inner_text(),f'Egg filter uses owner metadata {width}px')
   page.get_by_role('button',name='View menu of Mixed Fixture Restaurant',exact=True).click()
   page.locator('#menuItems [data-menu-item-id="e"]').wait_for()
   check('100% Pure' not in page.locator('#biteRestaurantFacts').inner_text(),f'Mixed restaurant has no Pure Veg claim {width}px')
   page.locator('#menuEggFilter').click()
   check(page.locator('#menuItems .menuitem').count()==1 and page.locator('#menuItems .food-type.egg').count()==1,f'Egg menu filter and badge {width}px')
   page.get_by_role('button',name='Add Special Egg Dish',exact=True).click()
   page.locator('#menuNonvegFilter').click()
   check(page.locator('#menuItems .menuitem').count()==1 and 'Chicken Curry' in page.locator('#menuItems').inner_text(),f'Non-veg excludes Egg {width}px')
   check(page.locator('#cartCount').inner_text()=='(1)',f'Diet filters preserve cart {width}px')
   page.locator('#menuVegToggle').check()
   check(page.locator('#menuItems .menuitem').count()==1 and 'Dosa' in page.locator('#menuItems').inner_text(),f'Veg excludes Egg/meat {width}px')
   page.locator('#menuResetFilters').click()
   check(page.locator('#menuItems .menuitem').count()==3,f'Clear filters restores menu {width}px')
   check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'Customer has no horizontal overflow {width}px')
   page.goto(f'http://127.0.0.1:4493/menu-qr.html?restaurant={MIX}')
   page.locator('#menu .item').first.wait_for()
   page.locator('#qrDiet').select_option('egg')
   check(page.locator('#menu .item').count()==1 and page.locator('#menu .mark.egg').count()==1,f'QR uses same Egg metadata {width}px')
   page.locator('#qrDiet').select_option('nonveg')
   check(page.locator('#menu .item').count()==1 and 'Chicken Curry' in page.locator('#menu').inner_text(),f'QR Non-veg excludes Egg {width}px')
   state['onlyveg']=True
   page.reload();page.locator('#menu .item').first.wait_for()
   check(page.locator('#pureVegLabel').is_hidden() and page.locator('#vegSwitch').is_visible(),f'Only available veg dishes never certify an untagged restaurant {width}px')
   check(page.locator('form').count()==0 and page.get_by_text('Add to Cart').count()==0,f'QR remains view-only {width}px')
   check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'QR has no horizontal overflow {width}px')
   if width==360:
    state['legacy']=True
    page.goto('http://127.0.0.1:4493/customer.html')
    page.locator('#restaurantGrid .restaurant').first.wait_for(timeout=20000)
    check(page.locator('#restaurantGrid .restaurant').count()==2,'Missing optional metadata column retains legacy public discovery during rollout')
   page.close()
  browser.close()
finally:server.shutdown()
