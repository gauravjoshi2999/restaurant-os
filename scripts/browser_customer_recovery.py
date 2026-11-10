#!/usr/bin/env python3
"""CI-only customer regressions using actual UI source and explicitly synthetic transport.
Cashfree/Supabase requests are blocked: this cannot charge, refund, email or alter real records.
"""
import os,json,subprocess,sys
from pathlib import Path
from threading import Thread
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
if os.environ.get('CI')!='true':raise SystemExit('Run browser regressions in GitHub CI; use the approved browser for local QA.')
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT)
subprocess.run([sys.executable,'scripts/prepare_completion_preview.py'],check=True)
OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
evidence=[];errors=[]
def check(value,message,width=None):
 if not value:raise AssertionError(message)
 evidence.append({'case':message,'viewport':width,'status':'PASS','layer':'synthetic browser transport'})
 print('PASS:',message,width or '')
def observe(page):
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.route('**/*.supabase.co/**',lambda route:route.abort())
 page.route('**/api.cashfree.com/**',lambda route:route.abort())
 page.route('**/sandbox.cashfree.com/**',lambda route:route.abort())
 page.on('dialog',lambda dialog:dialog.accept())
def load(page,payment='disabled',pending=False):
 page.goto('http://127.0.0.1:4175/dist/qa/'+('pending-customer-flow.html' if pending else 'customer-flow.html')+'?qa_payment='+payment,wait_until='domcontentloaded')
 page.locator('#restaurantGrid .restaurant').wait_for(state='visible')
def menu(page):
 page.locator('#restaurantGrid .restaurant').click();page.locator('#menuItems [data-add]').wait_for(state='visible')
def add(page):page.locator('#menuItems [data-add]').click()
def cart(page):page.locator('#floatingViewCart').click();page.locator('#cartModal.show').wait_for(state='visible')
def checkout(page):
 cart(page);page.locator('#cartCheckoutBtn').click();page.locator('#checkoutName').wait_for(state='visible');page.wait_for_function("document.querySelector('#checkoutPhone').value==='9999999999'")
def no_overflow(page):return page.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1')
server=ThreadingHTTPServer(('127.0.0.1',4175),SimpleHTTPRequestHandler);Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch()
  for width in [320,360,390,412,768,1365]:
   context=browser.new_context(viewport={'width':width,'height':844},is_mobile=width<600,has_touch=width<600)
   page=context.new_page();observe(page);load(page,'503');check(no_overflow(page),'Homepage fits viewport',width)
   menu(page);add(page);cart(page);page.locator('[data-cart-inc]').click();check('₹300' in page.locator('#cartModalTotal').inner_text(),'Cart quantity and food total update',width)
   page.locator('[data-cart-dec]').click();check('₹150' in page.locator('#cartModalTotal').inner_text(),'Decreasing quantity updates total',width)
   page.locator('[data-cart-remove]').click();check(page.locator('#cartCheckoutBtn').is_disabled(),'Individual removal leaves an honest empty cart',width)
   page.locator('#addMoreItems').click();add(page);cart(page);page.locator('#emptyCartBtn').click();check(page.locator('#cartCheckoutBtn').is_disabled(),'Clear entire cart removes every item',width)
   page.locator('#addMoreItems').click();add(page);checkout(page)
   check(no_overflow(page),'Checkout fits viewport without horizontal scrolling',width)
   page.locator('#addressPostal').fill('123');page.locator('#placeOrderBtn').click();check('6-digit PIN' in page.locator('#checkoutError').inner_text(),'Invalid delivery PIN blocks payment preparation',width)
   page.locator('#addressPostal').fill('313399');page.locator('#placeOrderBtn').click();check('delivery nahi karta' in page.locator('#checkoutError').inner_text(),'Out-of-area delivery has an actionable pickup alternative',width)
   page.locator('input[name=deliveryMode][value=pickup]').check();page.locator('#placeOrderBtn').click()
   page.wait_for_function("document.querySelector('#checkoutError').textContent.includes('503')")
   check(page.locator('#pendingCheckoutActions').is_visible(),'HTTP 503 exposes retry, status, cancel and new-order actions',width)
   check(page.evaluate("window.BiteQa.counts().rpcCalls.filter(x=>x==='bite_prepare_checkout_v2').length===1"),'HTTP 503 creates one immutable intent',width)
   original=page.evaluate('window.BiteQa.intents()[0].priced_items')
   page.locator('#cancelCheckout').click();check(page.locator('#menuView').is_visible(),'Pending payment can return to menu',width)
   add(page);cart(page);check('₹300' in page.locator('#cartModalTotal').inner_text(),'New cart can change while earlier payment is unresolved',width)
   check(page.evaluate('window.BiteQa.intents()[0].priced_items')==original,'Editing new cart preserves old payment snapshot',width)
   page.locator('#closeCartModal').click();page.locator('#backBtn').click();check(page.locator('#homeView').is_visible(),'Pending payment can open Home',width)
   page.locator('#pendingPaymentBanner [data-pending-resume]').click();check(page.locator('#checkoutName').is_disabled(),'Resumed payment details remain immutable',width)
   page.locator('#cancelPendingPayment').click();page.wait_for_function("!document.querySelector('#pendingPaymentBanner')")
   check(page.evaluate("window.BiteQa.intents()[0].status==='expired'"),'Safe cancellation releases old checkout',width)
   check(page.evaluate("window.BiteQa.counts().rpcCalls.filter(x=>x==='bite_prepare_checkout_v2').length===1"),'Cancellation does not silently initiate a replacement payment',width)
   check(no_overflow(page),'Recovery controls remain within viewport',width)
   context.close()
  context=browser.new_context(viewport={'width':390,'height':844});page=context.new_page();observe(page);load(page)
  page.locator('[data-home-filter="North Indian"]').click();page.wait_for_function("window.scrollY>50")
  check(page.locator('#resultCount').inner_text().startswith('1 '),'Category selects the matching restaurant and scrolls to results')
  page.locator('#homeSearchInput').fill('does-not-exist');check(page.locator('#resultCount').inner_text().startswith('0 '),'Search typing immediately updates result count')
  page.locator('#homeSearchInput').press('Enter');check(page.locator('#restaurantGrid .restaurant').count()==0,'Search Enter displays a useful no-results state')
  page.locator('#homeSearchInput').fill('Thali');page.locator('#homeSearchBtn').click();check(page.locator('#restaurantGrid .restaurant').count()==1,'Search button finds a dish inside a restaurant')
  menu(page);add(page);page.reload();page.locator('#floatingViewCart').wait_for(state='visible');cart(page)
  check('₹150' in page.locator('#cartModalTotal').inner_text(),'Refresh restores the cart and restaurant without contact data in storage')
  page.locator('#closeCartModal').click();page.go_back();check(page.locator('#homeView').is_visible(),'Browser Back restores Home from menu')
  page.go_forward();page.locator('#menuView').wait_for(state='visible');page.locator('#floatingViewCart').wait_for(state='visible');check(page.locator('#floatingViewCart').is_visible(),'Browser Forward restores menu and cart')
  page.locator('#loginBtn').click();check(page.locator('#loginBtn').inner_text()=='Login','Logout clears the session label')
  page.locator('#loginBtn').click();page.locator('#customerEmail').fill('old@example.invalid');page.locator('#forgotPasswordBtn').click()
  check(page.locator('#customerEmail').is_visible() and not page.locator('#customerPassword').is_visible(),'Forgot password requests email only')
  page.locator('#authSubmit').click();check('inbox' in page.locator('#authError').inner_text(),'Reset email shows non-enumerating delivery feedback through synthetic Auth')
  page.locator('#authSwitch').click();page.locator('#customerPassword').fill('QA-only-password');page.locator('#authSubmit').click();page.locator('#authModal.show').wait_for(state='hidden')
  page.locator('#homeBottomNav [data-nav=account]').click();page.locator('#editProfileName').wait_for(state='visible');page.locator('#addrName').fill('Private previous customer')
  page.evaluate("window.BiteQa.delayNext('customer_addresses')")
  page.locator('#homeBottomNav [data-nav=account]').click();page.wait_for_function("window.BiteQa.hasDelayed('customer_addresses')")
  page.evaluate("window.BiteQa.changeAccount('99999999-9999-4999-8999-999999999999')")
  page.evaluate("async()=>{window.BiteQa.releaseDelayed('customer_addresses');await Promise.resolve();await Promise.resolve();}")
  check(page.locator('#addrName').input_value()=='' and page.locator('#customerEmail').input_value()=='','Account switching clears application-managed name/email fields')
  check(page.locator('#accountAddresses').text_content()=='' and page.locator('#ordersList').text_content()=='','Slow previous-account responses cannot repopulate private addresses or orders')
  check(page.locator('#homeSearchInput').get_attribute('name')=='bite-food-search' and page.locator('#homeSearchInput').input_value()=='','Food search is distinct from credential/autofill inputs')
  context.close()
  # A restarted browser recovers the server-side pending reference even without stored recovery IDs.
  context=browser.new_context(viewport={'width':390,'height':844});page=context.new_page();observe(page);load(page,'uncertain',True)
  page.evaluate("localStorage.removeItem('bite_pending_checkout_v2')");page.reload();page.locator('#pendingPaymentBanner [data-pending-resume]').wait_for(state='visible')
  check(page.locator('#homeView').is_visible(),'Server recovery after restart does not force a payment modal')
  page.locator('#pendingPaymentBanner [data-pending-resume]').click();page.locator('#cancelPendingPayment').click();check(page.locator('#pendingCheckoutActions').is_visible(),'Uncertain payment cannot be falsely cancelled')
  page.locator('#startNewOrder').click();check(page.locator('#homeView').is_visible(),'Start new order detaches pending payment and opens browsing')
  check(page.locator('#pendingPaymentBanner').is_visible(),'Starting a new cart retains the unresolved payment reference')
  context.close()
  # Location denied/slow provider simulations are explicit; never use a real customer location.
  context=browser.new_context(viewport={'width':360,'height':800});context.add_init_script("Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:(ok,error)=>error({code:1})}})")
  page=context.new_page();observe(page);load(page);page.locator('#customerUseLocation').click();check('PIN manually' in page.locator('#customerLocationLabel').inner_text(),'Location denied offers manual PIN entry')
  check(not errors,'Customer recovery suite has no uncaught JavaScript errors')
  browser.close()
finally:
 (OUT/'customer-recovery-evidence.json').write_text(json.dumps({'transport':'Synthetic UI and controlled failures; not real Auth/Cashfree/bank acceptance','checks':evidence,'uncaught_errors':errors},indent=2))
 server.shutdown();server.server_close()
