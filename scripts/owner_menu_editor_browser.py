#!/usr/bin/env python3
"""Actual R14 modal, close/open/save functions and assets; synthetic menu writes only."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
import base64
import os
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'index.html').read_text()
modal=source[source.index('<div class="modal" id="menuItemModal"'):source.index('<div class="modal" id="restaurantModal"')]
options_modal=source[source.index('<div class="modal" id="menuOptionsModal"'):source.index('<div class="modal" id="menuItemModal"')]
styles=''.join(re.findall(r'<style[^>]*>[\s\S]*?</style>',source[:source.index('</head>')]))
prefixes=['function openMenuItem(','function menuEditScope(','function menuRestaurantId(','function closeModal(',
 "globalThis.BiteOwnerMenuEditor?.configure(","document.getElementById('menuItemForm').addEventListener("]
actual='\n'.join(next(line for line in source.splitlines() if line.startswith(prefix))for prefix in prefixes)
fixture="""
let currentUser={id:'synthetic-owner'},access={isPlatformAdmin:false,memberships:[{restaurant_id:'synthetic-restaurant',role:'owner'}]};
let activeMenuRestaurant='synthetic-restaurant';
const qa=window.__menuQA={writes:[],refreshes:0,mode:'ok',photoOk:false};
const previewItem='11111111-1111-4111-8111-111111111111',groupId='22222222-2222-4222-8222-222222222222',
 choiceId='33333333-3333-4333-8333-333333333333';
qa.quoteCalls=[];qa.quoteMode='room';
const previewRows={
 menu_option_groups:[{id:groupId,name:'Extras',min_select:0,max_select:1,is_available:true}],
 menu_option_choices:[{id:choiceId,option_group_id:groupId,name:'Room extra',price_delta:20,is_available:true}],
 menu_item_option_groups:[{option_group_id:groupId,is_available:true}]
};
const optionDb={
 from(table){
  const q={select(){return q},eq(){return q},in(){return q},order(){return q},
   then(resolve,reject){return Promise.resolve({data:previewRows[table]}).then(resolve,reject);}};
  return q;
 },
 async rpc(name,args){
  qa.quoteCalls.push({name,args});
  if(qa.quoteMode==='denied')return {error:{code:'42501',message:'Owner menu preview access denied'}};
  if(name==='bite_quote_menu_options_v2_for_channel'){
   if(args.p_owner_preview!==true)throw Error('Owner quote mode missing');
   if(qa.quoteMode==='legacy')return {error:{code:'PGRST202'}};
  }else if(name!=='bite_quote_menu_options_v2'||qa.quoteMode!=='legacy'){
   throw Error('Unexpected preview RPC: '+name);
  }
  return {data:{quote_only:true,authorizes_payment:false,currency:'INR',restaurant_id:activeMenuRestaurant,
   food_subtotal:140,lines:[{menu_item_id:previewItem,quantity:1,final_unit_price:140,base_unit_price:120,
    option_unit_total:20,options:[{choice_id:choiceId,name:'Room extra',price_delta:20}]}]}};
 }
};
BiteMenuOptions.init({sb:optionDb,getRestaurantId:()=>activeMenuRestaurant,canEditRestaurant:()=>true,
 getMenuItems:()=>[{id:previewItem,name:'Room-only paneer',price:120,available_online:false,available_room:true}]});

const row={id:'synthetic-item',restaurant_id:'synthetic-restaurant',category_id:'c',name:'Synthetic Paneer',price:120,
 description:'Synthetic fixture only',is_vegetarian:true,dietary_type:'veg',is_available:true,available_online:true,available_pos:true,available_room:true,available_qr:true,is_kids_choice:false,image_url:'https://images.example/saved.png'};
let menuItems=[row];
const sb={from(table){if(table!=='menu_items')throw Error('Unexpected table');return{
 update(payload){const call={payload,filters:[]};qa.writes.push(call);const builder={eq(k,v){call.filters.push([k,v]);return builder;},async select(cols){
 if(cols!=='id')throw Error('Unexpected projection');
 if(qa.mode==='zero')return{data:[],error:null};
 if(qa.mode==='error')return{data:null,error:{message:'Synthetic unavailable server'}};
 if(qa.mode==='hold')await new Promise(resolve=>qa.release=resolve);
 Object.assign(row,payload);return{data:[{id:row.id}],error:null};
 }};return builder;},insert(){throw Error('This fixture edits existing items only');}
 }}};async function fetchMenuData(){qa.refreshes++;menuItems=[row];}
document.getElementById('menuItemCategory').innerHTML='<option value="">Uncategorized</option><option value="c">Main course</option>';
"""
html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+\
 '<link rel="stylesheet" href="/assets/owner-menu-editor.css"><link rel="stylesheet" href="/assets/owner-menu-options.css"></head><body data-role="owner">'+\
 '<select id="menuRestaurantSelect"><option value="synthetic-restaurant">Synthetic restaurant</option></select>'+\
 '<button id="fixtureOpen" onclick="openMenuItem(\'synthetic-item\')">Edit fixture item</button>'+modal+options_modal+\
 '<script src="/assets/bite-food-types.js"></script><script src="/assets/owner-menu-editor.js"></script>'+\
 '<script src="/assets/owner-menu-options-preview.js"></script><script src="/assets/owner-menu-options.js"></script>'+\
 '<script>'+fixture+actual+'</script></body></html>'
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def do_GET(self):
  if self.path=='/menu-editor-fixture':
   data=html.encode();self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(data)
  else:super().do_GET()
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',4494),Handler);Thread(target=server.serve_forever,daemon=True).start()
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQaHAAAAGkAOGt06eBAAAAAElFTkSuQmCC')
def check(ok,label):
 if not ok:raise AssertionError(label)
 print('PASS:',label)
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('BITE_CHROMIUM_EXECUTABLE'))
  for width in (320,360,390,430,1440):
   page=browser.new_page(viewport={'width':width,'height':850});errors=[]
   page.on('pageerror',lambda error:errors.append(str(error)))
   def route(request):
    url=request.request.url
    if url.startswith('http://127.0.0.1:4494/'):request.continue_()
    elif url.startswith('https://images.example/'):
     if url.endswith('/new.png')and not page.evaluate('qa.photoOk'):request.fulfill(status=404,body='missing')
     else:request.fulfill(status=200,content_type='image/png',body=png)
    else:raise AssertionError('Unexpected remote request '+url)
   page.route('**/*',route)
   page.goto('http://127.0.0.1:4494/menu-editor-fixture')
   page.locator('#fixtureOpen').click()
   check(page.locator('#menuItemModal').is_visible(),f'Actual editor opens {width}px; script errors: {errors}')
   form=page.locator('#menuItemForm');price=form.locator('[name=price]');close=page.locator('#menuItemModal .close')
   form.locator('[name=available_online]').uncheck();close.click();page.locator('#menuItemCloseKeep').click()
   check(not form.locator('[name=available_online]').is_checked() and page.evaluate('qa.writes.length')==0,'Channel change is a dirty draft, not an immediate write')
   form.locator('[name=available_online]').check()
   price.fill('150');close.click();page.locator('#menuItemCloseKeep').click()
   check(price.input_value()=='150'and page.evaluate('qa.writes.length')==0,f'Keep editing preserves price draft without write {width}px')
   page.keyboard.press('Escape');page.locator('#menuItemCloseDiscard').click()
   check(page.locator('#menuItemModal').evaluate("e=>!e.classList.contains('show')")and page.evaluate('row.price')==120,f'Discard leaves saved item unchanged {width}px')
   page.locator('#fixtureOpen').click();price.fill('150');page.evaluate("qa.mode='zero'");close.click();page.locator('#menuItemCloseSave').click()
   page.wait_for_function("document.getElementById('menuItemError').textContent.includes('Save nahi hua:')")
   check(price.input_value()=='150'and page.locator('#menuItemModal').is_visible(),f'Zero-row save retains draft and error {width}px')
   form.locator('[name=available_online]').uncheck();page.evaluate("qa.mode='hold'");page.locator('#menuItemSaveBtn').click();page.wait_for_function('!!qa.release')
   close.click()
   check(price.is_disabled()and 'Saving' in page.locator('#menuItemCloseStatus').inner_text(),f'Pending save freezes fields and blocks dismissal {width}px')
   page.evaluate('qa.release()');page.wait_for_function("!document.getElementById('menuItemModal').classList.contains('show')")
   check(page.evaluate('row.available_online===false&&row.available_pos===true&&row.available_room===true&&row.available_qr===true'),'Save preserves independent channel choices')
   check(page.evaluate('row.price===150&&qa.refreshes===1')and not page.locator('#menuItemSaveBtn').is_disabled(),f'Confirmed single-row save closes and refreshes {width}px')
   check(page.evaluate("qa.writes.every(w=>JSON.stringify(w.filters)===JSON.stringify([['id','synthetic-item'],['restaurant_id','synthetic-restaurant']]))"),f'Actual handler keeps item and restaurant scope {width}px')
   page.locator('#fixtureOpen').click();url=form.locator('[name=image_url]');url.fill('https://images.example/new.png')
   page.wait_for_function("document.getElementById('menuItemPhotoStatus').textContent.includes('Photo did not load')")
   writes=page.evaluate('qa.writes.length');page.locator('#menuItemSaveBtn').click()
   check(page.evaluate('qa.writes.length')==writes and page.evaluate("row.image_url.endsWith('/saved.png')"),f'Failed replacement cannot overwrite saved photo {width}px')
   page.locator('#menuItemPhotoRestore').click();check(url.input_value().endswith('/saved.png'),f'Restore saved photo {width}px')
   page.locator('#menuItemPhotoRemove').click();close.click();page.locator('#menuItemCloseDiscard').click()
   check(page.evaluate("row.image_url.endsWith('/saved.png')"),f'Discard photo removal never deletes saved URL or storage object {width}px')
   page.locator('#fixtureOpen').click();url.fill('https://images.example/new.png')
   page.wait_for_function("document.getElementById('menuItemPhotoStatus').textContent.includes('Photo did not load')")
   page.evaluate('qa.photoOk=true');page.locator('#menuItemPhotoRetry').click()
   page.wait_for_function("document.getElementById('menuItemPhotoStatus').textContent.includes('Preview loaded')")
   page.evaluate("qa.mode='ok'");page.locator('#menuItemSaveBtn').click()
   page.wait_for_function("!document.getElementById('menuItemModal').classList.contains('show')")
   check(page.evaluate("row.image_url.endsWith('/new.png')"),f'Retry successful photo then explicit scoped save {width}px')
   page.locator('#fixtureOpen').click();price.fill('160');close.click()
   check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'No horizontal overflow {width}px')
   check(page.locator('#menuItemCloseSave').bounding_box()['height']>=44,f'Close recovery actions have touch targets {width}px')
   page.evaluate("currentUser={id:'another-synthetic-user'};BiteOwnerMenuEditor.sync()")
   check(not page.locator('#menuItemModal').is_visible()and price.input_value()=='',f'Account change clears previous editor {width}px')
   page.evaluate('BiteMenuOptions.open(previewItem)')
   page.locator('#menuOptionsPreviewForm [data-option-preview-choice]').check()
   button=page.locator('#menuOptionsPreviewCheck')
   result=page.locator('#menuOptionsPreviewResult')
   button.click()
   result.get_by_text('₹140.00',exact=True).wait_for()
   check(page.evaluate("qa.quoteCalls[0].args.p_owner_preview===true"),f'Room-only preview uses its guarded quote {width}px')
   check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'Room-only preview fits {width}px')
   if width==390:
    page.evaluate("qa.quoteMode='denied';qa.quoteCalls=[]")
    button.click()
    result.get_by_text('Price check failed: Owner menu preview access denied',exact=True).wait_for()
    check(page.evaluate('qa.quoteCalls.length===1'),'Access denial never retries through the public quote')
    page.evaluate("qa.quoteMode='legacy';qa.quoteCalls=[]")
    button.click()
    result.get_by_text('₹140.00',exact=True).wait_for()
    check(page.evaluate("qa.quoteCalls.map(c=>c.name).join(',')==='bite_quote_menu_options_v2_for_channel,bite_quote_menu_options_v2'"),'Older backend falls back to its existing quote')
   check(not errors,f'No browser script errors {width}px: {errors}')
   page.close()
  browser.close()
finally:server.shutdown()
