#!/usr/bin/env python3
"""Synthetic Owner cash closing review in real Chromium; no login, API or DB writes."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'index.html').read_text(encoding='utf-8')
match=re.search(r'<section class="page" id="cashbook">.*?</section>',source,re.S)
assert match, 'Owner cashbook page missing'
section=match.group(0).replace('class="page" id="cashbook"','class="page active" id="cashbook"')
start=source.index('let cashbookEntries=[],cashbookClosing=null,cashbookLastLoadedKey=null;')
end=source.index('let hrEmployees=[]',start)
cashbook_js=source[start:end]
styles='\n'.join(re.findall(r'<style[^>]*>(.*?)</style>',source,re.S))
fixture='''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>'''+styles+'''</style></head><body data-role="owner">
<div id="mainApp"><div class="main"><div class="content">'''+section+'''</div></div></div></body></html>'''
setup=r"""() => {
 window.access={role:'owner',restaurantId:'r1',memberships:[{role:'owner',restaurant_id:'r1'}]};
 window.state={restaurants:[{id:'r1',name:'Test Restaurant'}]};
 window.currentUser={id:'owner1'};
 window.localDateInput=()=> '2026-11-13';
 window.money=n=>'₹'+Number(n||0).toFixed(2);
 window.esc=s=>String(s??'').replace(/[&<>"']/g,'');
 window.__rows=[{entry_id:'p1',source_id:'p1',source_type:'order_payment',restaurant_id:'r1',
  entry_date:'2026-11-13',direction:'in',amount:'50.00',payment_method:'Cash',
  category:'Order payment',description:'POS cash',created_at:'2026-11-13T10:00:00Z'},
  {entry_id:'p2',source_id:'p2',source_type:'order_payment',restaurant_id:'r1',
  entry_date:'2026-11-13',direction:'in',amount:'200.00',payment_method:'UPI',
  category:'Order payment',description:'POS UPI',created_at:'2026-11-13T10:01:00Z'}];
 window.__closing=null;window.__rpcCalls=0;
 window.sb={
  from(name){
   const q={select(){return q},eq(){return q},
    order(){return Promise.resolve({data:name==='restaurant_cashbook_entries'?window.__rows:[],error:null})},
    maybeSingle(){return Promise.resolve({data:name==='restaurant_cashbook_closings'?window.__closing:null,error:null})}};
   return q;
  },
  async rpc(name,p){
   window.__rpcCalls++;
   window.__closing={opening_cash:p.p_opening_cash,cash_in:50,cash_out:0,
    expected_cash:p.p_opening_cash+50,counted_cash:p.p_counted_cash,
    difference:p.p_counted_cash-p.p_opening_cash-50,notes:p.p_notes};
   return {data:'closing-id',error:null};
  }
 };
 document.getElementById('cashbookRestaurant').innerHTML='<option value="r1">Test Restaurant</option>';
 document.getElementById('cashbookDate').value='2026-11-13';
}"""

def check(value,label):
 assert value,label
 print('PASS:',label)

with sync_playwright() as playwright:
 browser=playwright.chromium.launch(headless=True)
 try:
  for width in (320,390):
   page=browser.new_page(viewport={'width':width,'height':820},device_scale_factor=1,is_mobile=True,has_touch=True)
   page.set_content(fixture)
   page.add_style_tag(path=str(ROOT/'assets/owner-layout.css'))
   page.add_script_tag(path=str(ROOT/'assets/owner-cash-closing.js'))
   page.evaluate(setup)
   page.add_script_tag(content=cashbook_js)
   page.evaluate('loadCashbook()')
   page.locator('#cashbookOpeningCash').fill('100')
   page.locator('#cashbookReviewBtn').click()
   page.wait_for_function("document.getElementById('cashbookCloseMessage').textContent.includes('Counted cash')")
   check('Counted cash' in page.locator('#cashbookCloseMessage').inner_text(),f'{width}px: blank cash blocked')
   page.locator('#cashbookCountedCash').fill('145')
   page.locator('#cashbookReviewBtn').click()
   page.wait_for_function("document.getElementById('cashbookCloseMessage').textContent.includes('reason')")
   check('reason' in page.locator('#cashbookCloseMessage').inner_text(),f'{width}px: discrepancy reason required')
   page.locator('#cashbookClosingNote').fill('Five rupees short')
   page.locator('#cashbookReviewBtn').click()
   page.locator('#cashbookClosingReview').wait_for(state='visible')
   review=page.locator('#cashbookClosingReview')
   check(review.is_visible() and 'Expected ₹150.00' in review.inner_text(),f'{width}px: cash-only closing review visible')
   check('Difference ₹-5.00' in review.inner_text(),f'{width}px: discrepancy preview correct')
   confirm=page.locator('#cashbookCloseBtn')
   check(confirm.is_visible() and confirm.is_enabled(),f'{width}px: explicit confirmation available')
   page.locator('#cashbookCountedCash').fill('150')
   check(not confirm.is_visible(),f'{width}px: editing amount invalidates review')
   page.locator('#cashbookReviewBtn').click()
   confirm.click()
   page.wait_for_function("document.getElementById('cashbookStatus').textContent==='Closed'")
   check(page.locator('#cashbookStatus').inner_text()=='Closed',f'{width}px: server close verified')
   check(page.evaluate('window.__rpcCalls')==1,f'{width}px: exactly one close RPC')
   page.close()
 finally:
  browser.close()
