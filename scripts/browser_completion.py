#!/usr/bin/env python3
"""Chromium interaction checks on isolated synthetic transport, not real Auth/provider E2E.
Run in GitHub CI. The actual source controllers and markup are used; Supabase is mocked.
"""
import os,json,subprocess,sys
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
if os.environ.get('CI')!='true':raise SystemExit('Run this browser suite in GitHub CI; use the approved browser for local QA.')
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT)
subprocess.run([sys.executable,'scripts/prepare_completion_preview.py'],check=True)
OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
evidence=[];errors=[]
def check(value,message):
 if not value:raise AssertionError(message)
 evidence.append({'case':message,'status':'PASS','layer':'synthetic UI transport'})
 print('PASS:',message)
def observe(page):
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.route('**/*.supabase.co/**',lambda route:route.abort())
 page.route('**/api.cashfree.com/**',lambda route:route.abort())
 page.on('dialog',lambda dialog:dialog.accept())
def nav(page,target):
 button=page.locator('.nav [data-page="'+target+'"]')
 toggle=page.locator('.sidebar-toggle')
 if toggle.is_visible() and toggle.get_attribute('aria-expanded')!='true':toggle.click()
 button.click()
server=ThreadingHTTPServer(('127.0.0.1',4174),SimpleHTTPRequestHandler);Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch()
  customer=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);observe(customer)
  customer.goto('http://127.0.0.1:4174/dist/qa/customer-flow.html',wait_until='domcontentloaded')
  customer.locator('#restaurantGrid .restaurant').wait_for(state='visible')
  check('QA FIXTURE' in customer.locator('body').inner_text(),'Preview is explicitly synthetic and cannot charge or sign in real users')
  # Direct Restaurant Ordering: WhatsApp source link must open only one restaurant,
  # with no discovery or escape into another restaurant catalogue.
  direct=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);observe(direct)
  direct.goto('http://127.0.0.1:4174/dist/qa/customer-flow.html?direct=1&restaurant=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',wait_until='domcontentloaded')
  direct.locator('#menuItems [data-menu-item-id]').first.wait_for(state='visible')
  check(direct.locator('#restaurantName').inner_text()=='QA Rajsamand Kitchen','Restaurant link opens only the linked restaurant menu')
  check(direct.evaluate("""() => {
    return BITE_DIRECT_MODE===true
      && restaurants.length===1
      && activeRestaurant?.id==='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      && publicMenuSearch.every(item=>item.restaurant_id===activeRestaurant.id);
  }"""),'Direct mode scopes discovery and menu search to exactly one restaurant')
  check(direct.evaluate("""() => ['homeView','backBtn','homeBottomNav'].every(id=>{
    const el=document.getElementById(id);return !el || getComputedStyle(el).display==='none';
  })"""),'Restaurant link hides other restaurants and marketplace navigation')
  direct.evaluate("showCustomerView('home')")
  check(direct.locator('#menuView').is_visible(),'Direct restaurant view refuses to navigate back to marketplace')
  direct.close()
  invalid=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);observe(invalid)
  invalid.goto('http://127.0.0.1:4174/dist/qa/customer-flow.html?direct=1&restaurant=cccccccc-cccc-4ccc-8ccc-cccccccccccc',wait_until='domcontentloaded')
  invalid.wait_for_function("document.getElementById('restaurantName').textContent==='Restaurant unavailable'")
  check(invalid.locator('#homeView').is_hidden() and invalid.locator('#restaurantGrid .restaurant').count()==0,
        'Unknown or unpublished direct link cannot fall back to other restaurant listings')
  invalid.close()

  # Category selection must navigate to the actual refreshed restaurant results,
  # not merely toggle the active chip while leaving the hero on screen.
  customer.locator('[data-home-filter="all"]').click()
  customer.wait_for_function("""() => {
    const results=document.getElementById('restaurantResults');
    const header=document.querySelector('.header');
    if(!results||!header)return false;
    const y=results.getBoundingClientRect().top,headerBottom=header.getBoundingClientRect().bottom;
    return window.scrollY>50 && y>=headerBottom-8 && y<=headerBottom+65;
  }""",timeout=6000)
  check(customer.evaluate("""() => {
    const results=document.getElementById('restaurantResults').getBoundingClientRect();
    return results.top>0 && results.top<innerHeight*0.4;
  }"""),'Aaj kya khayenge category click scrolls filtered restaurants below the mobile sticky header')
  customer.evaluate("window.scrollTo({top:0,behavior:'instant'})")
  customer.locator('[data-home-filter="North Indian"]').click()
  check(customer.locator('[data-home-filter="North Indian"]').get_attribute('aria-pressed')=='true','Thali and curries category keeps selected filter after scrolling')
  customer.locator('[data-home-filter="all"]').click()
  check(customer.locator('[data-home-filter="all"]').get_attribute('aria-pressed')=='true','Everything category restores all restaurant results')
  customer.locator('#discoveryPinInput').fill('313399');customer.locator('#discoveryLocationForm button[type=submit]').click()
  customer.wait_for_function("document.querySelector('#resultCount').textContent.startsWith('0 ')")
  check(customer.locator('#restaurantGrid .restaurant').count()==0,'Out-of-area PIN removes delivery restaurants')
  customer.locator('[data-service-filter="pickup"]').click()
  check(customer.locator('#restaurantGrid .restaurant').count()==1,'Explicit pickup stays available outside delivery PIN')
  customer.locator('#discoveryPinInput').fill('313324');customer.locator('#discoveryLocationForm button[type=submit]').click();customer.locator('[data-service-filter="delivery"]').click()
  customer.locator('#restaurantGrid .restaurant').click()
  customer.locator('#menuItems [data-menu-item-id]').wait_for(state='visible')
  customer.evaluate("window.__biteQaDishImage=document.querySelector('#menuItems .menuphoto')")
  customer.locator('#menuItems [data-add]').first.click()
  check(customer.evaluate("document.querySelector('#menuItems .menuphoto')===window.__biteQaDishImage"), 'ADD leaves existing dish image and menu DOM mounted')
  check(customer.locator('#menuItems .item-quantity span').first.inner_text()=='1', 'ADD updates the dish quantity inline')
  check('150' in customer.locator('#floatingCartTotal').inner_text(), 'ADD updates cart total without rebuilding menu')
  customer.locator('#menuItems [data-menu-dec]').first.click()
  check(customer.locator('#menuItems [data-add]').count()==1, 'Minus returns dish quantity to ADD inline')
  check(customer.evaluate("document.querySelector('#menuItems .menuphoto')===window.__biteQaDishImage"), 'Minus also preserves the loaded image node')
  customer.locator('#restaurantFavourite').click()
  customer.wait_for_function("document.querySelector('#restaurantFavourite').getAttribute('aria-pressed')==='true'")
  check('Saved' in customer.locator('#restaurantFavourite').inner_text(),'Favourite button persists through the Customer transport')
  customer.locator('#homeBottomNav [data-nav="orders"]').click();customer.locator('[data-invoice]').wait_for(state='visible')
  with customer.expect_download(timeout=20000) as download:customer.locator('[data-invoice]').click()
  receipt=OUT/'receipt.pdf';download.value.save_as(receipt)
  check(receipt.read_bytes().startswith(b'%PDF-1.4'),'Customer bill downloads as an actual PDF file')
  customer.locator('[data-reorder]').click();customer.locator('#cartModal.show').wait_for(state='visible')
  check('QA Veg Thali' in customer.locator('#cartModalLines').inner_text(),'Reorder opens a reviewable cart with current available items')
  # Simulate a very long order visually: the checkout footer must remain within the viewport.
  customer.evaluate("""() => {
    const lines=document.getElementById('cartModalLines');
    const sample=lines.querySelector('.cart-product');
    if(!sample)throw Error('Synthetic fixture has no cart product');
    for(let i=0;i<14;i++)lines.appendChild(sample.cloneNode(true));
    document.getElementById('cartModalScroll').scrollTop=0;
  }""")
  for height in (844,568):
   customer.set_viewport_size({'width':390,'height':height})
   check(customer.evaluate("""() => {
    const button=document.getElementById('cartCheckoutBtn');
    const panel=document.querySelector('#cartModal .cart-modal-box');
    const scroll=document.getElementById('cartModalScroll');
    const r=button.getBoundingClientRect(),p=panel.getBoundingClientRect();
    return button.offsetParent!==null && !button.disabled &&
      r.top>=p.top && r.bottom<=Math.min(innerHeight,p.bottom)+1 &&
      scroll.scrollHeight>scroll.clientHeight;
   }"""),f'Proceed to checkout remains visible with 15 cart rows at {height}px viewport')
   customer.evaluate("document.getElementById('cartModalScroll').scrollTop=99999")
   check(customer.evaluate("""() => {
    const r=document.getElementById('cartCheckoutBtn').getBoundingClientRect();
    return r.top>=0 && r.bottom<=innerHeight+1;
   }"""),f'Cart footer stays visible after scrolling the items at {height}px viewport')
  customer.set_viewport_size({'width':390,'height':844})
  # Real restaurant after-hours bug: cart button used to be silently disabled.
  # Keep review possible, show opening hours, and never launch a payment while closed.
  customer.evaluate("activeRestaurant.is_temporarily_closed=true;activeRestaurant.temporary_closure_until=null;window.__BITE_QA_SERVER_RESTAURANT.is_temporarily_closed=true;renderCartModal()")
  check(customer.locator('#cartCheckoutBtn').is_enabled(),'Closed restaurant CTA stays tappable to explain hours rather than silently disabling')
  check(customer.locator('#cartClosedNotice').is_visible(),'Closed restaurant cart shows an explanatory warning')
  check('temporarily closed' in customer.locator('#cartClosedNotice').inner_text().lower(),'Temporary closure provides a specific reason')
  customer.locator('#cartCheckoutBtn').click()
  check(customer.locator('#cartModal.show').is_visible() and not customer.locator('#checkoutModal').is_visible(),'Closed restaurant never launches checkout or charges the customer')
  customer.evaluate("activeRestaurant.is_temporarily_closed=false;window.__BITE_QA_SERVER_RESTAURANT.is_temporarily_closed=false;renderCartModal()")
  check(customer.locator('#cartCheckoutBtn').is_enabled() and customer.locator('#cartCheckoutBtn').inner_text()=='Proceed to checkout','Available restaurant restores working checkout button')
  customer.locator('#cartCheckoutBtn').click();customer.locator('#checkoutCoupon').fill('QA10');customer.locator('#applyCheckoutCoupon').click()
  customer.wait_for_function("document.querySelector('#checkoutSummary').textContent.includes('155')")
  check('₹155' in customer.locator('#checkoutSummary').inner_text(),'Coupon total is 150 food + 20 delivery − 15 discount')
  check(customer.locator('#placeOrderBtn').is_disabled(),'Synthetic provider readiness cannot unlock a real payment')
  check(customer.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),'Customer has no horizontal overflow at 390px')
  customer.screenshot(path=str(OUT/'ui-customer.png'),full_page=False)
  customer.evaluate("window.BiteCheckoutUX.showResult('Payment confirmed','Synthetic UI test only')")
  check(customer.locator('#checkoutOutcomePanel').is_visible() and not customer.locator('#checkoutFormPanel').is_visible(), 'Success screen replaces checkout fields rather than repeating Pay button')
  customer.locator('#checkoutOutcomeBrowse').click()
  check(not customer.locator('#checkoutModal').is_visible() and customer.locator('#menuView').is_visible(), 'Checkout close returns to menu instead of reopening payment')
  customer.locator('#homeBottomNav [data-nav="account"]').click();customer.locator('#customerProfileEdit').wait_for(state='visible')
  customer.locator('#editProfileName').fill('QA updated name');customer.locator('#editProfilePhone').fill('9999999999');customer.locator('#editCustomerProfile button[type=submit]').click()
  check('saved' in customer.locator('#profileEditStatus').inner_text().lower(),'Customer profile form exposes save feedback')
  customer.locator('[data-bite-language="hi"]').click();customer.wait_for_function("document.documentElement.lang==='hi'")
  check(customer.locator('#editProfilePhone').input_value()=='9999999999','Hindi navigation does not rewrite user-entered values')
  customer.locator('[data-bite-language="en"]').click()
  owner=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);observe(owner)
  owner.goto('http://127.0.0.1:4174/dist/qa/owner-flow.html',wait_until='domcontentloaded');owner.locator('#mainApp').wait_for(state='visible');
  nav(owner,'pos')
  owner.locator('#posNewSaleBtn').wait_for(state='visible')
  check(not owner.locator('.side').evaluate("(el) => el.classList.contains('sidebar-open')") and owner.locator('#posNewSaleBtn').is_visible(),
        'POS & Billing is reachable from mobile sidebar and the drawer closes on selection')
  owner.locator('#posNewSaleBtn').click()
  owner.locator('#orderModal.show').wait_for(state='visible')
  check(owner.locator('#posPaymentSection').is_visible() and owner.locator('#orderRestaurant').input_value()=='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'New POS Bill opens the real restaurant-scoped payment form')
  check(owner.locator('#posWhatsAppConsent').count()==1,
        'POS form has explicit WhatsApp bill consent before any customer share')
  owner.locator('#posAddItemTrigger').click()
  owner.locator('#posPickerItemName').fill('QA Veg Thali')
  owner.locator('#posPickerQuantity').fill('2')
  owner.locator('#posPickerPrice').fill('150')
  owner.get_by_role('button',name='＋ Add to bill').click()
  check('₹300' in owner.locator('#orderGrandTotal').inner_text(),
        'Mobile POS item picker totals two ₹150 dishes without saving a real bill')
  owner.locator('#orderModal button.close').click()
  nav(owner,'menu');owner.locator('#biteCouponWorkspace summary').click();owner.locator('#biteCouponForm').wait_for(state='visible')
  owner.locator('#biteCouponForm [name=code]').fill('QATEST10');owner.locator('#biteCouponForm [name=title]').fill('QA ten percent');owner.locator('#biteCouponForm [name=discount_value]').fill('10');owner.locator('#biteCouponForm button[type=submit]').click()
  check('QATEST10' in owner.locator('#biteCouponList').inner_text(),'Owner coupon form creates a scoped offer')
  owner.locator('#biteCouponList [data-coupon-toggle]').click()
  check('Enable' in owner.locator('#biteCouponList').inner_text(),'Owner can pause an existing offer')
  owner.locator('#addMenuItemBtn').click();owner.locator('#biteMenuPhoto').set_input_files({'name':'unsupported.svg','mimeType':'image/svg+xml','buffer':b'<svg/>'});owner.locator('#biteUploadMenuPhoto').click()
  check('only' in owner.locator('#biteMenuUploadStatus').inner_text(),'Unsupported SVG uploads fail before any Storage request')
  owner.locator('#menuItemModal button.close').click();nav(owner,'settings');owner.locator('#biteDocumentForm').wait_for(state='visible')
  check(owner.locator('#biteDocumentForm input[type=file]').count()==1,'Owner private-document upload form is present')
  check(owner.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),'Owner has no horizontal overflow at 390px')
  owner.screenshot(path=str(OUT/'ui-owner.png'),full_page=False)
  admin=browser.new_page(viewport={'width':1365,'height':900});observe(admin)
  admin.goto('http://127.0.0.1:4174/dist/qa/admin-flow.html',wait_until='domcontentloaded');admin.locator('#mainApp').wait_for(state='visible');nav(admin,'customers');admin.locator('#biteCustomerRows .bite-record').wait_for(state='visible')
  check('QA customer' in admin.locator('#biteCustomerRows').inner_text(),'Admin customer directory is reachable from guarded navigation')
  nav(admin,'storefront');admin.locator('#biteCategoryForm [name=name]').fill('QA breakfast');admin.locator('#biteCategoryForm [name=cuisine_tag]').fill('North Indian');admin.locator('#biteCategoryForm button[type=submit]').click()
  check('QA breakfast' in admin.locator('#biteCategoryList').inner_text(),'Admin website category form saves and refreshes')
  nav(admin,'financials');admin.locator('#biteProviderOperations').wait_for(state='visible')
  check(admin.locator('#biteDeadlineToggle').is_disabled(),'Acceptance timeout cannot enable without a healthy scheduler')
  check('Payment collected' in admin.locator('#biteProviderOperations').inner_text(),'Admin finance distinguishes collection, settlement and payout stages')
  admin.screenshot(path=str(OUT/'ui-admin.png'),full_page=False)
  pending=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);observe(pending)
  pending.goto('http://127.0.0.1:4174/dist/qa/pending-customer-flow.html',wait_until='domcontentloaded');pending.locator('#pendingPaymentBanner [data-pending-check]').wait_for(state='visible');pending.locator('#pendingPaymentBanner [data-pending-check]').click()
  check(pending.locator('#checkoutPendingPanel').is_visible(), 'Recovered payment shows compact status instead of disabled address form')
  check(not pending.locator('#checkoutFormPanel').is_visible(), 'Pending payment does not trap customer inside address form')
  check('₹155' in pending.locator('#checkoutSummary').text_content(),'Reload recovery preserves the saved server-priced payment total')
  check(pending.locator('#checkoutName').is_disabled() and pending.locator('#addressPostal').is_disabled(),'Recovered checkout contact/address stay immutable until payment resolution')
  check(pending.locator('#bitePendingStartFresh').is_visible(), 'Pending payment offers safe Start a new order button on mobile')
  pending.locator('#bitePendingBack').click()
  check(not pending.locator('#checkoutModal').is_visible(), 'Back to menu dismisses recovered checkout without getting stuck')
  check(pending.locator('#homeView').is_visible(), 'Pending payment Back to menu returns to browsing, keeping payment unresolved')
  pending.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
  pending.wait_for_timeout(150)
  check(not pending.locator('#checkoutModal').is_visible(), 'Browser back from Cashfree keeps the customer browsing without reopening the modal')
  check(pending.locator('#pendingPaymentBanner [data-pending-check]').is_visible(), 'Previous payment stays accessible only through a small reminder')
  pending.locator('#pendingPaymentBanner [data-pending-check]').click()
  pending.evaluate("window.__BITE_QA_TERMINATION_DELAY=true;window.__BITE_QA_CANCEL_CALLS=0")
  pending.locator('#bitePendingStartFresh').click()
  check(not pending.locator('#checkoutModal').is_visible(), 'Start a new order immediately returns to browsing without waiting for a Cashfree cancel')
  check(not pending.locator('#pendingPaymentBanner').is_visible(), 'Fresh order hides the previous reminder without showing it twice')
  check(not pending.locator('#bitePaymentReturnStatus').count(), 'Cashfree return must not create a second payment status banner')
  pending.locator('#restaurantGrid .restaurant').first.click()
  pending.locator('#menuItems [data-add]').first.click()
  pending.locator('#floatingViewCart').click()
  pending.locator('#cartCheckoutBtn').click()
  pending.locator('#checkoutFormPanel').wait_for(state='visible',timeout=6000)
  check(not pending.locator('#checkoutPendingPanel').is_visible(), 'New cart checkout shows its own form without reopening previous payment')
  pending.wait_for_function("window.__BITE_QA_CANCEL_CALLS>=3 && document.getElementById('placeOrderBtn').textContent==='Pay online' && !document.getElementById('placeOrderBtn').disabled",timeout=25000)
  check(pending.evaluate("window.__BITE_QA_CANCEL_CALLS>=3"),'One cancellation click automatically follows provider status to terminal confirmation')
  check(pending.locator('#placeOrderBtn').inner_text()=='Pay online','Only after confirmed old cancellation does the new checkout enable Pay online')
  check(not pending.locator('#pendingPaymentBanner').count(), 'Verified abandoned payment reminder disappears after safe cancellation')
  check(not errors,'All three fixture panels complete without uncaught JavaScript errors')
  browser.close()
finally:
 (OUT/'browser-evidence.json').write_text(json.dumps({'transport':'synthetic; not real Auth, Storage, Cashfree or bank acceptance','checks':evidence,'uncaught_errors':errors},indent=2))
 server.shutdown();server.server_close()
