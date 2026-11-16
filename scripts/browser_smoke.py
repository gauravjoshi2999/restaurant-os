#!/usr/bin/env python3
"""Real Chromium smoke checks for the public Bite customer journey.

This deliberately tests only public, unauthenticated behavior. Owner/Admin
journeys require dedicated test identities and are tracked separately.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
import os
import time

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
server = ThreadingHTTPServer(("127.0.0.1", 4173), SimpleHTTPRequestHandler)
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()

def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print("PASS:", message)


def check_premium_ui(page):
    """Exercise new customer-only controls with live public data; never create an order."""
    brand = page.locator(".customer-brand .bite-premium-icon")
    check(brand.is_visible(), "Updated Bite brand mark is visible in customer header")
    check(brand.evaluate("img => img.complete && img.naturalWidth > 0"),
          "Green Bite brand SVG loads correctly")
    check(page.locator(".customer-brand .bite-brand-copy strong").inner_text() == "Bite",
          "Compact Bite wordmark and tagline replace off-theme logo")
    check(page.locator(".bite-language-row").count() == 0,
          "Customer language toggle is not injected")
    check(page.locator("#discoveryLocationForm").is_hidden(),
          "Duplicate PIN entry card is absent from restaurant discovery")

    location = page.locator("#biteLocationOpen")
    check(location.is_visible(), "Premium header location picker is accessible")
    location.click()
    sheet = page.locator("#biteLocationSheet")
    check(sheet.is_visible(), "Location bottom sheet opens")
    check(page.locator("#biteSheetPin").is_visible(), "Location sheet exposes PIN input")
    page.keyboard.press("Escape")
    check(not sheet.is_visible(), "Escape closes location sheet")
    check(location.evaluate("el => document.activeElement === el"), "Location picker restores focus")

    search = page.locator("#homeSearchInput")
    search.fill("paneer")
    suggestion_box = page.locator("#biteSearchSuggestions")
    suggestion_box.wait_for(state="visible", timeout=6000)
    check(bool(suggestion_box.inner_text().strip()), "Live restaurant/dish search shows suggestions")
    if suggestion_box.locator("button").count():
        suggestion_box.locator("button").first.click()
        check(not suggestion_box.is_visible(), "Choosing a suggestion closes the popup")
    search.fill("")
    check(not suggestion_box.is_visible(), "Clearing search removes suggestions")


def check_history_filters(page):
    """Synthetic DOM-only browser test; no customer identity or database writes."""
    page.evaluate("""() => {
        for (const id of ['homeView','menuView','accountView']) {
            document.getElementById(id).classList.add('hidden');
        }
        document.getElementById('ordersView').classList.remove('hidden');
        document.body.dataset.view='orders';
        document.getElementById('ordersList').innerHTML =
          '<article class="ordercard"><span class="ordercode">BITE-QA-101</span><span class="orderrestaurant">Hotel Maharani Palace</span><span class="orderstatus received">Received</span></article>'
          + '<article class="ordercard"><span class="ordercode">BITE-QA-102</span><span class="orderrestaurant">Royal Thali House</span><span class="orderstatus completed">Completed</span></article>'
          + '<article class="ordercard"><span class="ordercode">BITE-QA-103</span><span class="orderrestaurant">Bajrang Food Court</span><span class="orderstatus cancelled">Cancelled</span></article>';
        window.BiteHistoryPremium.applyFilters();
    }""")
    cards=page.locator('#ordersList > .ordercard:visible')
    check(cards.count() == 3, 'Order history initially displays all available orders')
    page.locator('[data-bite-history-filter="active"]').click()
    check(cards.count() == 1 and 'Maharani' in cards.first.inner_text(),
          'Ongoing filter shows only active orders')
    page.locator('[data-bite-history-filter="completed"]').click()
    check(cards.count() == 1 and 'Royal' in cards.first.inner_text(),
          'Delivered filter includes real Completed status')
    page.locator('[data-bite-history-filter="cancelled"]').click()
    check(cards.count() == 1 and 'Bajrang' in cards.first.inner_text(),
          'Cancelled filter excludes active and delivered orders')
    search=page.locator('#biteHistorySearch')
    search.fill('not-an-order')
    check(page.locator('#biteHistoryNoMatches').is_visible(),
          'No matching order gives an actionable empty state')
    page.locator('#biteHistoryNoMatches button').click()
    check(cards.count() == 3 and not search.input_value(),
          'Clear search and filters restores all orders')
    search.fill('BITE-QA-102')
    check(cards.count() == 1 and 'Royal' in cards.first.inner_text(),
          'Order ID search filters history without new backend requests')
    search.fill('')
    check(not page.locator('#biteHistoryNoMatches').is_visible(),
          'Clearing order search dismisses the empty state')


def check_account_layout(page, width):
    """Render the real Account markup without credentials or any business writes."""
    page.evaluate("""() => {
        for (const id of ['homeView','menuView','ordersView']) document.getElementById(id).classList.add('hidden');
        document.getElementById('accountView').classList.remove('hidden');
        // Legacy form layout test intentionally renders both real forms; hub subpages are tested below.
        document.getElementById('accountView').removeAttribute('data-section');
        document.body.dataset.view='account';
        document.getElementById('cartFloating').classList.remove('show');
        document.getElementById('accountProfile').textContent='Layout check only';
        const option=document.createElement('option');
        option.textContent='BITE-123456789 — A restaurant with a long name — test order for layout only';
        document.getElementById('customerSupportOrder').append(option);
        document.getElementById('customerSupportOrder').selectedIndex=1;
    }""")
    fields = page.evaluate("""() => [...document.querySelectorAll('#accountView .account-field input, #accountView .account-field select, #accountView .account-field textarea')].map(el => {
        const label=document.querySelector('label[for="'+el.id+'"]');
        const r=el.getBoundingClientRect(), l=label?.getBoundingClientRect(), p=el.parentElement.getBoundingClientRect();
        return {id:el.id,width:r.width,height:r.height,parent:p.width,labelAbove:!!l&&l.bottom<=r.top+1,leftAligned:!!l&&Math.abs(l.left-r.left)<=1};
    })""")
    check(len(fields) == 12, f"Account exposes all twelve labeled address/support controls at {width}px")
    check(all(f['labelAbove'] and f['leftAligned'] for f in fields), f"Every Account label is above its field at {width}px")
    check(all(f['width'] > 0 and f['width'] <= f['parent'] + 1 and f['height'] >= 44 for f in fields), f"Account controls fit their containers with usable touch height at {width}px")
    if width <= 600:
        columns=page.locator('.account-address-form .account-form-grid').evaluate("el => getComputedStyle(el).gridTemplateColumns")
        check(len(columns.split()) == 1, f"Address fields use one clear mobile column at {width}px")
    checkbox=page.locator('#addrDefault').bounding_box()
    check(checkbox and 16 <= checkbox['width'] <= 24, f"Default-address checkbox keeps its intended size at {width}px")
    overflow=page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")
    check(overflow <= 1, f"Account and Support have no horizontal overflow at {width}px")
    colors=page.evaluate("""() => ({body:getComputedStyle(document.body).backgroundColor,panel:getComputedStyle(document.querySelector('.account-address-card')).backgroundColor,field:getComputedStyle(document.getElementById('addrName')).backgroundColor})""")
    check(all(c not in ['rgb(255, 255, 255)','rgba(0, 0, 0, 0)'] for c in colors.values()), f"Account canvas, card and fields use neutral marketplace surfaces at {width}px")
    page.locator('#addrSave').click()
    check(bool(page.locator('#addrError').inner_text().strip()), f"Address validation feedback is visible before any authenticated write at {width}px")
    # In-memory fixture for Edit navigation; never touches customer addresses in Supabase.
    page.evaluate("""() => {
        accountAddressRows=[{
          id:'qa-address',label:'Home',recipient_name:'QA Guest',
          recipient_phone:'9999999999',address_line:'QA Test Lane',
          landmark:'',city:'Rajsamand',state:'Rajasthan',postal_code:'313324',is_default:true
        }];
        document.getElementById('accountAddresses').innerHTML=
          '<div class="account-address"><button type="button" data-aedit="qa-address">Edit</button></div>';
    }""")
    page.locator('[data-aedit="qa-address"]').click()
    check(page.locator('#addrFormTitle').inner_text() == 'Edit delivery address'
          and page.locator('#addrName').input_value() == 'QA Guest'
          and page.locator('#addrLine').input_value() == 'QA Test Lane'
          and page.locator('#addrCancel').is_visible(),
          f"Edit saved address opens populated form and Cancel action at {width}px")
    page.locator('#addrCancel').click()
    check(page.locator('#addrFormTitle').inner_text() == 'Add a delivery address'
          and page.locator('#addrId').input_value() == '',
          f"Cancel edit clears stale address ID and resets the form at {width}px")
    page.evaluate("""() => {
      accountAddressRows=[];
      document.getElementById('accountAddresses').textContent='No saved address yet.';
    }""")

    # New Account Center: actual navigation and responsive layout, no authenticated writes.
    page.evaluate("document.getElementById('accountView').dataset.section='overview'")
    check(page.locator('#biteAccountHub').is_visible(),
          f"Premium account overview is visible at {width}px")
    check(page.locator('#biteAccountAvatar').is_visible()
          and page.locator('#biteAccountHub .bite-account-group').count() >= 2,
          f"Profile hero and grouped actions appear at {width}px")
    page.locator('#biteAccountHub [data-bite-account-go="addresses"]').click()
    check(page.locator('.account-address-card').is_visible()
          and page.locator('.account-support-card').is_hidden(),
          f"Address Book opens its real existing form from Account Center at {width}px")
    page.locator('#accountBackBtn').click()
    check(page.locator('#biteAccountHub').is_visible(),
          f"Back returns to Account Center without leaving the page at {width}px")
    page.locator('#biteAccountHub [data-bite-account-go="preferences"]').click()
    check(page.locator('#biteAccountVeg').is_visible(),
          f"Vegetarian preference is reachable at {width}px")
    page.locator('#accountBackBtn').click()
    page.locator('#biteAccountHub [data-bite-account-go="support"]').first.click()
    check(page.locator('#customerSupportForm').is_visible(),
          f"Customer Help opens existing real ticket form at {width}px")
    page.locator('#accountBackBtn').click()
    page.evaluate("document.getElementById('accountView').removeAttribute('data-section')")


def check_scheduled_picker_no_charge(page):
    """Owner opt-in simulated in browser memory only. Never calls auth, RPC or Cashfree."""
    check(page.evaluate("() => typeof BiteSchedule !== 'undefined' && typeof activeRestaurant !== 'undefined' && !!activeRestaurant"),
          "Scheduled picker modules are present on public menu")
    page.evaluate("""() => {
        const modal=document.getElementById('checkoutModal');
        const panel=document.getElementById('checkoutFormPanel');
        if(!modal || !panel || !activeRestaurant)throw new Error('Missing menu / checkout mount');
        window.__qaScheduleOriginal=activeRestaurant;
        window.__qaScheduleModalClass=modal.className;
        window.__qaSchedulePanelClass=panel.className;
        const pay=document.getElementById('placeOrderBtn');
        window.__qaSchedulePayButton={text:pay.textContent,disabled:pay.disabled,
          aria:pay.getAttribute('aria-disabled')};
        window.__qaScheduleNote=document.getElementById('checkoutPaymentNote')?.textContent||'';
        window.__qaScheduleDeliveryMode=document.querySelector('input[name="deliveryMode"]:checked')?.value||'delivery';
        activeRestaurant={...activeRestaurant,
          accepts_scheduled_delivery:true,accepts_delivery:true,delivery_paused:false,
          is_temporarily_closed:true,
          temporary_closure_until:new Date(Date.now()+60*60000).toISOString(),
          scheduled_lead_minutes:90,scheduled_horizon_days:3,
          opening_time:'10:00:00',closing_time:'23:00:00'};
        document.querySelector('input[name="deliveryMode"][value="delivery"]').checked=true;
        modal.classList.remove('hidden');modal.classList.add('show');
        panel.classList.remove('hidden');
        BiteSchedule.sync();
    }""")
    try:
        check(page.locator('#biteDeliverySchedule').is_visible(), 'Schedule controls display for opted-in delivery restaurant')
        check(page.locator('#placeOrderBtn').is_disabled(),
              'Closed restaurant cannot open payment without a preferred delivery slot')
        check(page.locator('#placeOrderBtn').inner_text().strip() == 'Choose delivery time',
              'Pay button clearly requests the missing scheduled time')
        check(page.locator('#biteSchedulePick').is_visible(), 'Preferred date/time selection is accessible')
        page.locator('#biteSchedulePick').click()
        check(page.locator('#biteScheduleOverlay [role="dialog"]').is_visible(),
              'Preferred-time picker opens as accessible bottom sheet')
        check(page.locator('#biteScheduleDays [role="tab"]').count() >= 1,
              'Date tabs derive from actual scheduling horizon')
        count=page.locator('#biteScheduleSlots button[data-bite-slot]').count()
        check(count>0, 'Available 30-minute slots appear from published hours')
        page.locator('#biteScheduleSlots button[data-bite-slot]').first.click()
        check(page.locator('#biteScheduleConfirm').is_enabled(), 'Confirm becomes active only after slot selection')
        page.locator('#biteScheduleConfirm').click()
        check(page.evaluate("() => !!BiteSchedule.getSelectedFor(activeRestaurant.id)"),
              'Chosen preferred slot is retained in checkout without creating payment')
        check(page.locator('#placeOrderBtn').inner_text().strip() != 'Choose delivery time',
              'Selecting a future time refreshes the payment button state')
        check('Subject to restaurant acceptance' in page.locator('#biteScheduleSelection').inner_text(),
              'Selected time is clearly labelled preferred, not guaranteed')
        page.evaluate("""() => {
           activeRestaurant.is_temporarily_closed=true;
           activeRestaurant.temporary_closure_until=new Date(Date.now()+60*60000).toISOString();
           BiteSchedule.sync();
        }""")
        check(page.locator('#biteScheduleAsap').is_disabled(),
              'ASAP is disabled while restaurant is currently closed')
        check(page.evaluate("() => !!BiteSchedule.getSelectedFor(activeRestaurant.id)"),
              'Future selected slot remains available when temporary closure ends before slot')
    finally:
        page.evaluate("""() => {
            if(window.BiteSchedule?.closeJump)window.BiteSchedule.closeJump();
            if(window.__qaScheduleOriginal)activeRestaurant=window.__qaScheduleOriginal;
            const modal=document.getElementById('checkoutModal');
            const panel=document.getElementById('checkoutFormPanel');
            if(modal && window.__qaScheduleModalClass!==undefined)modal.className=window.__qaScheduleModalClass;
            if(panel && window.__qaSchedulePanelClass!==undefined)panel.className=window.__qaSchedulePanelClass;
            const radio=document.querySelector('input[name="deliveryMode"][value="'+(window.__qaScheduleDeliveryMode||'delivery')+'"]');
            if(radio)radio.checked=true;
            window.BiteSchedule?.reset?.();
            const pay=document.getElementById('placeOrderBtn');
            if(pay&&window.__qaSchedulePayButton){
              pay.textContent=window.__qaSchedulePayButton.text;
              pay.disabled=window.__qaSchedulePayButton.disabled;
              const aria=window.__qaSchedulePayButton.aria;
              if(aria===null)pay.removeAttribute('aria-disabled');
              else pay.setAttribute('aria-disabled',aria);
            }
            const note=document.getElementById('checkoutPaymentNote');
            if(note&&window.__qaScheduleNote!==undefined)note.textContent=window.__qaScheduleNote;
            delete window.__qaSchedulePayButton;
            delete window.__qaScheduleNote;
            document.body.classList.remove('bite-schedule-open');
            document.getElementById('biteScheduleOverlay')?.setAttribute('hidden','');
            delete window.__qaScheduleOriginal;
        }""")

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1365, "height": 900})
        page.on('pageerror', lambda err: print('CUSTOMER PAGE ERROR:', str(err)))
        page.goto("http://127.0.0.1:4173/customer.html", wait_until="domcontentloaded")
        page.locator("#resultCount").wait_for(state="visible", timeout=30000)
        page.wait_for_function(
            "() => !/loading|finding/i.test(document.querySelector('#resultCount').textContent)",
            timeout=30000,
        )
        check("Bite" in page.title(), "Customer storefront title and document loaded")
        cards = page.locator("#restaurantGrid .restaurant")
        cards.first.wait_for(state="visible", timeout=20000)
        check(cards.count() > 0, "Public approved restaurants are discoverable from live Supabase data")
        availability_fields = page.evaluate("""() => restaurants.length > 0 && restaurants.every(r =>
            ['is_temporarily_closed','temporary_closure_until','delivery_paused','opening_time','closing_time'].every(k => Object.prototype.hasOwnProperty.call(r,k)))""")
        check(availability_fields, "Public restaurant listing returns the new availability fields from Supabase")
        check_premium_ui(page)

        # Exercise the customer-visible closure state using the live restaurant record.
        original = page.evaluate("() => ({id:restaurants[0].id,closed:restaurants[0].is_temporarily_closed,until:restaurants[0].temporary_closure_until})")
        page.evaluate("id => {const r=restaurants.find(r=>r.id===id);r.is_temporarily_closed=true;r.temporary_closure_until=null;renderRestaurants()}", original['id'])
        closed_card = page.locator('.restaurant[data-id="' + original['id'] + '"]')
        check("temporarily closed" in closed_card.inner_text().lower(),
              "Customer restaurant card displays temporary closure state")
        page.evaluate("o => {const r=restaurants.find(r=>r.id===o.id);r.is_temporarily_closed=o.closed;r.temporary_closure_until=o.until;renderRestaurants()}", original)

        page.locator('#homeSearchInput').fill('BITE-NO-MATCH-ZZ-123')
        check(page.locator('#restaurantGrid .restaurant').count() == 0, 'Unmatched search shows an actionable empty state')
        page.get_by_role('button', name='Reset search & filters', exact=True).click()
        check(page.locator('#restaurantGrid .restaurant').count() > 0, 'Reset restores public restaurant discovery')
        
        # Schedule discovery must use owner-published capability, not fake future availability.
        page.locator('#biteFilterOpen').click()
        page.locator('#biteFilterTabTime').click()
        page.locator('#biteFilterScheduleOnly').check()
        check(page.locator('#biteFilterApply').is_enabled(), 'Schedule filter can be applied without changing payment')
        page.locator('#biteFilterApply').click()
        check(page.evaluate("() => window.BiteScheduleDiscoveryOnly === true && window.restaurantServiceFilter === 'delivery'"),
              'Schedule-only discovery selects delivery and preserves the choice')
        check(page.evaluate("""() => Array.from(document.querySelectorAll('#restaurantGrid .restaurant')).every(el => {
            const r=restaurants.find(x=>x.id===el.dataset.id);
            return !!r && r.accepts_scheduled_delivery===true && r.accepts_delivery===true &&
               r.delivery_paused!==true && !!r.opening_time && !!r.closing_time &&
               (!currentDiscoveryPin || r.serviceable===true);
        })"""), 'Scheduled restaurant results require real owner opt-in and PIN serviceability')
        page.evaluate("resetDiscovery()")
        check(page.evaluate("() => window.BiteScheduleDiscoveryOnly !== true"),
              'Reset search and filters clears scheduled-only discovery')
        check(page.locator('#restaurantGrid .restaurant').count() > 0,
              'Normal restaurants return after scheduled-only filter is cleared')


        # Browse a restaurant and confirm its menu is reachable without login.
        cards.first.click()
        page.locator("#menuView:not(.hidden)").wait_for(state="visible", timeout=20000)
        page.locator("#restaurantName").wait_for(state="visible")
        check(bool(page.locator("#restaurantName").inner_text().strip()), "Customer can open a restaurant menu without login")
        try:
            page.locator('#menuItems [data-add]').first.wait_for(state='visible', timeout=20000)
        except Exception:
            print('MENU DIAGNOSTIC:', page.evaluate("""() => ({
               menu: document.querySelector('#menuItems')?.innerText?.slice(0,700),
               suggestions: document.querySelector('#biteMenuRecommendations')?.innerText?.slice(0,250),
               restaurant: typeof activeRestaurant !== 'undefined' ? activeRestaurant?.name : null,
               dishes: typeof menuItems !== 'undefined' ? menuItems.length : null,
               kidsOnly: document.querySelector('#biteKidsChoiceOnly')?.checked,
               tags: typeof menuItems !== 'undefined' ? menuItems[0]?.is_kids_choice : null,
               categories: document.querySelectorAll('#categoryBar [data-cat]').length,
               cards: document.querySelectorAll('#menuItems .menuitem').length
            })"""))
            raise
        check_scheduled_picker_no_charge(page)
        page.locator('#menuSearchInput').fill('BITE-NO-DISH-ZZ-123')
        page.locator('#menuItems .food-empty').wait_for(state='visible', timeout=4000)
        check(page.locator('#menuItems .menuitem').count() == 0, 'Menu search filters actual dishes after the short typing debounce')
        page.locator('#menuSearchInput').fill('')
        page.locator('#menuVegToggle').check()
        check(page.locator('#menuItems .menuitem').count() == page.locator('#menuItems .food-type.veg').count(), 'Veg only excludes non-vegetarian and unclassified dishes')
        page.locator('#menuVegToggle').uncheck()
        add = page.locator('#menuItems [data-add]').first
        item_id = add.get_attribute('data-add')
        add.click()
        page.locator('[data-add="' + item_id + '"]').click()
        check(page.locator('#cartCount').inner_text() == '(2)', 'Menu quantity changes update the cart')
        page.locator('[data-menu-dec="' + item_id + '"]').click()
        check(page.locator('#cartCount').inner_text() == '(1)', 'Removing one item updates both menu and cart')
        # A closed restaurant still permits cart inspection; checkout remains blocked.
        if page.locator('#continueBtn').is_disabled():
            check('closed' in page.locator('#continueBtn').inner_text().lower(), 'Closed restaurant blocks the Continue action')
            page.locator('#floatingViewCart').click()
        else:
            page.locator('#continueBtn').click()
        check(page.locator('#cartModal.show').is_visible(), 'Cart detail opens with the selected dish')
        check(page.evaluate("document.activeElement?.id === 'closeCartModal'"),
              'Opening cart moves focus into the dialog')
        # Cart add-ons use real menu items; no fake rating or discount data.
        alternative_count = page.evaluate("""() => menuItems.filter(i =>
            !cart[i.id] && Number.isFinite(Number(i.price)) && Number(i.price) >= 0).length""")
        if alternative_count:
            add_on = page.locator('#biteCartAddOnList [data-bite-add-on]').first
            check(add_on.is_visible(), 'Another real restaurant dish is visible in cart add-ons')
            add_on_id = add_on.get_attribute('data-bite-add-on')
            add_on.click()
            check(page.locator('#cartCount').inner_text() == '(2)',
                  'Adding a dish inside the cart updates the existing cart state')
            check('added to cart' in page.locator('#biteCartAddOnStatus').inner_text().lower(),
                  'Add-on action gives clear confirmation')
            check(page.locator('#cartModalLines [data-cart-dec="' + add_on_id + '"]').count() == 1,
                  'Newly added dish appears immediately in the editable cart')
            add_on_total = page.evaluate("""() => money(cartEntries().reduce((n,[id,q]) =>
                n + Number(menuItems.find(i => i.id === id).price) * q, 0))""")
            check(add_on_total in page.locator('#cartModalTotal').inner_text(),
                  'Cart uses existing real menu prices after an add-on')
            page.locator('#cartModalLines [data-cart-dec="' + add_on_id + '"]').click()
            check(page.locator('#cartCount').inner_text() == '(1)',
                  'Removing the added dish restores the original cart')

        page.locator('#cartModalLines [data-cart-inc="' + item_id + '"]').click()
        check(page.evaluate("(id) => document.activeElement?.getAttribute('data-cart-inc') === id", item_id),
              'Cart quantity update preserves focus on the increment button')
        # Per-dish cooking requests remain local until a real, authenticated order.
        page.locator('#cartModalLines [data-cart-note-toggle="' + item_id + '"]').click()
        less_spicy = page.locator('#cartModalLines [data-cart-note-id="' + item_id + '"][data-cart-note-preset="less-spicy"]')
        less_spicy.click()
        check(less_spicy.get_attribute('aria-pressed') == 'true',
              'Quick cooking request preset is selected and accessible')
        less_spicy.click()
        check(less_spicy.get_attribute('aria-pressed') == 'false',
              'Quick cooking request preset toggles off')
        page.locator('#cartModalLines [data-cart-item-note="' + item_id + '"]').fill('Less spicy, no onion')
        check(page.locator('#cartModalLines .cart-item-note-preview').inner_text() == 'Less spicy, no onion',
              'Dish cooking request previews without affecting the item price')
        check(page.evaluate("(id) => JSON.parse(localStorage.getItem('restaurantos_customer_cart_v1')).itemNotes[id]", item_id) == 'Less spicy, no onion',
              'Dish cooking request persists in the restaurant-scoped saved cart')
        page.locator('#emptyCartBtn').click()
        check(page.locator('#cartCount').inner_text() == '(0)' and page.locator('#undoClearCartBtn').is_visible(),
              'Clear cart offers an immediate Undo without losing the order')
        page.locator('#undoClearCartBtn').click()
        check(page.locator('#cartCount').inner_text() == '(2)', 'Undo restores both cart items')
        check(page.locator('#cartModalLines .cart-item-note-preview').inner_text() == 'Less spicy, no onion',
              'Clear-cart Undo restores cooking instructions too')
        page.locator('#cartModalLines [data-cart-dec="' + item_id + '"]').click()
        page.locator('#cartModalLines [data-cart-dec="' + item_id + '"]').click()
        check(page.locator('#cartCount').inner_text() == '(0)' and page.locator('#undoClearCartBtn').is_visible(),
              'Removing the final dish unit offers Undo')
        page.locator('#undoClearCartBtn').click()
        check(page.locator('#cartCount').inner_text() == '(1)' and page.locator('#cartModalLines .cart-item-note-preview').inner_text() == 'Less spicy, no onion',
              'Single-dish Undo restores its cooking request')
        page.keyboard.press('Escape')
        check(not page.locator('#cartModal.show').is_visible(), 'Escape closes the cart without clearing it')
        page.locator('#floatingViewCart').click()
        page.locator('#closeCartModal').click()
        page.locator('#backBtn').click()
        check(not page.locator('#cartFloating').is_visible(), 'Floating cart is hidden outside the restaurant menu')

        # Payment stays locked until the signed-in checkout checks server readiness.
        button = page.locator("#placeOrderBtn")
        check(button.is_disabled(), "Checkout stays disabled before authenticated payment readiness is checked")
        check("checking online payment" in button.inner_text().lower(), "Checkout shows a readiness check instead of the obsolete setup-pending lock")
        check("cash on delivery" not in page.locator("body").inner_text().lower(), "No cash-on-delivery option is offered")

        # Password reset must have its own email-only request screen, with no real email sent by QA.
        page.locator("#loginBtn").click()
        page.locator("#authModal.show").wait_for(state="visible", timeout=5000)
        check(page.locator("#forgotPasswordBtn").is_visible(), "Customer login exposes a forgot-password action")
        page.locator("#forgotPasswordBtn").click()
        check(page.locator("#authTitle").inner_text() == "Reset your password"
              and page.locator("#customerEmail").is_visible()
              and page.locator("#customerPassword").is_hidden()
              and page.locator("#passwordLabel").is_hidden()
              and page.locator("#customerPasswordConfirm").is_hidden()
              and page.locator("#authBackToLogin").is_visible(),
              "Forgot password opens an email-only screen without password fields")
        page.locator("#authSubmit").click()
        check("sahi email" in page.locator("#authError").inner_text().lower(),
              "Email-only reset screen validates address before calling Supabase")
        page.evaluate("""() => {
          window.__biteQaResetCalls=[];
          sb.auth.resetPasswordForEmail=async (email,opts)=>{
            window.__biteQaResetCalls.push({email,redirectTo:opts.redirectTo});
            return {error:null};
          };
        }""")
        page.locator("#customerEmail").fill("qa-reset@example.com")
        page.locator("#authSubmit").click()
        page.wait_for_function("() => window.__biteQaResetCalls.length===1")
        check("reset link" in page.locator("#authError").inner_text().lower()
              and page.evaluate("window.__biteQaResetCalls[0].email") == "qa-reset@example.com",
              "Email reset link request uses the intended address in a mocked provider flow")
        page.locator("#authBackToLogin").click()
        check(page.locator("#authTitle").inner_text() == "Login karein"
              and page.locator("#customerPassword").is_visible(),
              "Back to login restores the regular login form")
        page.locator('#closeAuth').click()
        check_history_filters(page)
        check_account_layout(page, 1365)

        # Android-sized viewport smoke check.
        mobile = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        mobile.goto("http://127.0.0.1:4173/customer.html", wait_until="domcontentloaded")
        mobile.locator("#resultCount").wait_for(state="visible", timeout=30000)
        mobile.wait_for_function(
            "() => !/loading|finding/i.test(document.querySelector('#resultCount').textContent)",
            timeout=30000,
        )
        overflow = mobile.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(overflow <= 1, f"Customer page has no horizontal overflow at 390px (overflow={overflow}px)")
        check(mobile.locator("#restaurantGrid").is_visible(), "Customer restaurant discovery is visible on mobile")
        check(mobile.locator("#discoveryLocationForm").is_hidden(),
              "PIN is selected in mobile header, not repeated in a body card")
        check(mobile.locator(".bite-language-row").count() == 0,
              "Language selection buttons are absent from mobile customer pages")
        check(mobile.locator(".customer-brand .bite-premium-icon").is_visible(),
              "Compact Bite brand is visible on mobile")
        check_history_filters(mobile)
        check_account_layout(mobile, 390)
        mobile.set_viewport_size({'width':340,'height':780})
        check_account_layout(mobile, 340)

        # Owner / Super Admin sign-in entrypoint must fit an Android viewport.
        owner = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        owner.goto("http://127.0.0.1:4173/index.html", wait_until="domcontentloaded")
        owner.locator("#authScreen").wait_for(state="visible", timeout=20000)
        check(owner.locator("#authScreen").is_visible(), "Owner / Super Admin sign-in screen loads before authentication")
        check(not owner.locator("#mainApp").is_visible(), "Owner / Admin dashboards stay protected before authentication")
        owner_overflow = owner.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(owner_overflow <= 1, f"Owner sign-in page has no horizontal overflow at 390px (overflow={owner_overflow}px)")
        browser.close()
finally:
    server.shutdown()
    server.server_close()
