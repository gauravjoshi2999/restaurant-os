#!/usr/bin/env python3
"""Real Chromium, synthetic Supabase only: payment recovery across mobile reload."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

if os.environ.get('CI')!='true':
    raise SystemExit('Run in GitHub CI only; no live payment data is used.')
ROOT=Path(__file__).resolve().parents[1]
HTML="""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px system-ui;margin:0;background:#f5f6fa}.modal{padding:12px}
.modal-box{max-width:480px;margin:20px auto;background:white;border-radius:14px;padding:16px}
.field{margin:10px 0}label{display:block}input,select,button{font:inherit;min-height:44px;box-sizing:border-box}
input,select{width:100%;padding:8px}button{padding:8px 12px} .actions{display:flex;flex-wrap:wrap;gap:8px}
</style></head><body><div id="paymentModal" class="modal"><div class="modal-box">
<h2>Record order payment</h2><div id="paymentOrderLabel"></div><input id="paymentOrderId" type="hidden">
<div class="field"><label>Amount</label><input id="paymentAmount" type="number"></div>
<div class="field"><label>Method</label><select id="paymentMethod"><option>Cash</option><option>UPI</option></select></div>
<div class="field"><label>Date</label><input id="paymentDate" type="date"></div>
<div class="field"><label>Reference</label><input id="paymentReference"></div>
<div class="field"><label>Notes</label><input id="paymentNotes"></div>
<div class="actions"><button id="paymentSaveBtn" onclick="BitePOSPaymentUI.save(__ctx)">Save payment</button>
<button id="paymentCheckBtn" style="display:none" onclick="BitePOSPaymentUI.check(__ctx)">Check status</button></div>
<p id="paymentMessage" role="status" aria-live="polite"></p></div></div></body></html>"""
INIT="""(mode) => {
  window.__mode=mode;window.__calls=[];window.__rows=new Map();window.__refreshes=0;window.__closed=0;
  const db={from:table=>{
    if(table!=='restaurant_order_payments')throw Error('Wrong table');
    return {
      insert:async row=>{
        window.__calls.push(row);
        if(window.__mode==='timeout-before'&&window.__calls.length===1)return {error:{message:'offline'}};
        if(window.__rows.has(row.id))return {error:{code:'23505',message:'duplicate'}};
        window.__rows.set(row.id,{...row});return {error:window.__mode==='timeout-after'?{message:'timeout'}:null};
      },
      select:()=>{
        const filter={};const q={eq:(k,v)=>{filter[k]=v;return q},
          maybeSingle:async()=>{
            const row=window.__rows.get(filter.id);
            return {data:row&&Object.entries(filter).every(([k,v])=>row[k]===v)?row:null,error:null};
          }};
        return q;
      }
    };
  }};
  window.__ctx={sb:db,userId:'owner-a',restaurantId:'rest-a',role:'owner',orderId:'order-a',
    order:{id:'order-a',restaurant:'rest-a',channel:'POS - Counter',status:'Received',amount:300,code:'POS-1'},
    paymentSummaryFor:()=>({paid_amount:0,balance_amount:300}),
    money:n=>'₹'+Number(n).toFixed(2),today:()=> '2026-11-13',
    closeModal:()=>{window.__closed++},
    loadCloudData:async()=>{window.__refreshes++}
  };
}"""
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('http://bite-qa.local/pos-payment',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
    def setup(mode):
        page.add_script_tag(path=str(ROOT/'assets/bite-pos-payment-safety.js'))
        page.add_script_tag(path=str(ROOT/'assets/bite-pos-payment-ui.js'))
        page.evaluate(INIT,mode)
    page.goto('http://bite-qa.local/pos-payment',wait_until='domcontentloaded')
    setup('timeout-before')
    page.evaluate('BitePOSPaymentUI.open(__ctx)')
    page.locator('#paymentAmount').fill('120.25')
    page.locator('#paymentMethod').select_option('UPI')
    page.locator('#paymentReference').fill('UPI-123')
    page.locator('#paymentSaveBtn').click()
    page.wait_for_function("document.getElementById('paymentMessage').textContent.includes('verification pending')")
    saved=page.evaluate("""() => {
      const key=BitePOSPayment.key({uid:'owner-a',restaurantId:'rest-a',orderId:'order-a'});
      return JSON.parse(localStorage.getItem(key));
    }""")
    assert saved['details']['amount']==120.25
    assert page.evaluate('__calls.length')==1
    assert page.locator('#paymentCheckBtn').is_visible()
    print('PASS: timeout before commit retains a pending payment and Check status')

    page.reload(wait_until='domcontentloaded')
    setup('success')
    page.evaluate('BitePOSPaymentUI.open(__ctx)')
    page.wait_for_function("document.getElementById('paymentMessage').textContent.includes('database mein nahi mila')")
    assert page.locator('#paymentAmount').input_value()=='120.25'
    assert page.locator('#paymentReference').input_value()=='UPI-123'
    page.locator('#paymentSaveBtn').click()
    page.wait_for_function('window.__closed===1')
    assert page.evaluate('__calls.length')==1
    assert page.evaluate('__calls[0].id')==saved['id']
    assert page.evaluate('__rows.size')==1
    assert page.evaluate("BitePOSPayment.getPending(localStorage,{uid:'owner-a',restaurantId:'rest-a',orderId:'order-a'})===null")
    print('PASS: reload restores details and safely retries same UUID')

    page.evaluate("""() => {
      window.__rows.clear();window.__calls=[];window.__closed=0;window.__mode='timeout-after';
    }""")
    page.evaluate('BitePOSPaymentUI.open(__ctx)')
    page.locator('#paymentAmount').fill('45.50')
    page.locator('#paymentSaveBtn').click()
    page.wait_for_function('window.__closed===1')
    assert page.evaluate('__calls.length')==1
    assert page.evaluate('__rows.size')==1
    assert page.evaluate("BitePOSPayment.getPending(localStorage,{uid:'owner-a',restaurantId:'rest-a',orderId:'order-a'})===null")
    print('PASS: timeout after commit is reconciled without duplicate receipt')
    assert not errors,errors
    browser.close()
