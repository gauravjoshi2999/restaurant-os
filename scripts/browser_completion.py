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
 # Owner mobile: primary bottom tabs and in-content More cards, never sidebar.
 # Super Admin continues to use the existing sidebar navigation.
 bottom=page.locator('#biteOwnerBottomNav [data-bite-page="'+target+'"]')
 if bottom.count() and bottom.is_visible():
  bottom.click()
  return
 more=page.locator('#biteOwnerBottomNav [data-bite-page="more"]')
 if more.count() and more.is_visible():
  more.click()
  card=page.locator('#biteOwnerMoreScreen [data-owner-route="'+target+'"]')
  card.wait_for(state='visible')
  card.click()
  return
 button=page.locator('.nav [data-page="'+target+'"]')
 toggle=page.locator('.sidebar-toggle')
 if toggle.is_visible() and toggle.get_attribute('aria-expanded')!='true':
  toggle.click()
 button.click()
server=ThreadingHTTPServer(('127.0.0.1',4174),SimpleHTTPRequestHandler);Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch()
  customer=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);observe(customer)
  # Mock owner-uploaded photo bytes; no production data, Supabase, or external photos used.
  cover_bytes=(ROOT/'assets/food/meal-1100.jpg').read_bytes()
  customer.route('**/storage/v1/object/public/bite-menu/**',
    lambda route:route.fulfill(status=200,content_type='image/jpeg',body=cover_bytes))
  customer.goto('http://127.0.0.1:4174/dist/qa/customer-flow.html',wait_until='domcontentloaded')
  customer.locator('#restaurantGrid .restaurant').wait_for(state='visible')
  check(customer.evaluate("""() => {
    const photos=[...document.querySelectorAll('#restaurantGrid .restaurant .cover img')];
    return photos.length>0 && photos.every(img=>img.getAttribute('src') && img.getAttribute('alt'));
  }"""),'Every restaurant card includes an accessible automatically suggested or Owner cover photo')
  check('QA FIXTURE' in customer.locator('body').inner_text(),'Preview is explicitly synthetic and cannot charge or sign in real users')
  updated=customer.evaluate("""async () => {
    const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    window.__BITE_QA_SERVER_RESTAURANT.cover_image_path=id+'/covers/12345678-1234-4234-8234-123456789012.webp';
    window.__BITE_QA_SERVER_RESTAURANT.cover_image_updated_at='2026-11-13T12:40:00Z';
    return await refreshCustomerCoverPhotos(true);
  }""")
  check(updated==['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        'Customer listing fetches the newly published Owner cover without a page reload')
  customer.wait_for_timeout(650)
  cover_info=customer.evaluate("""() => {
    const img=document.querySelector('#restaurantGrid .restaurant .cover img');
    return {src:img?.src,currentSrc:img?.currentSrc,complete:img?.complete,width:img?.naturalWidth,
     label:document.querySelector('#restaurantGrid .restaurant .bite-cover-origin')?.textContent,
     savedCover:restaurants[0]?.cover_image_path,origin:SUPABASE_URL,
     chosen:BiteRestaurantCovers.choose(restaurants[0],publicMenuSearch,SUPABASE_URL),
     validated:BiteRestaurantCovers.ownCoverPath(restaurants[0]),
     selected:BiteDiscovery.selectRestaurants(restaurants,publicMenuSearch,{}).map(x=>({id:x.restaurant.id,cover:x.restaurant.cover_image_path}))
    };
  }""")
  print('QA COVER IMAGE DEBUG:',cover_info)
  check(bool(cover_info['src'] and '/storage/v1/object/public/bite-menu/' in cover_info['src'] and cover_info['width']>0),
    'Browser loads exact saved Owner restaurant cover image from scoped storage URL')
  check(customer.locator('#restaurantGrid .restaurant .bite-cover-origin').text_content()=='Restaurant photo',
        'Restaurant listing shows Owner photo and correct photo-source label')
  customer.locator('#restaurantGrid .restaurant').first.click()
  customer.locator('#biteRestaurantHeroImage').wait_for(state='visible')
  check(customer.evaluate("""() => {
    const hero=document.getElementById('biteRestaurantHeroImage');
    const card=document.querySelector('#restaurantGrid .restaurant .cover img');
    return hero.src===card.src && document.getElementById('biteRestaurantCoverLabel').textContent==='Restaurant photo';
  }"""),'Customer restaurant hero shows exactly the same Owner photo as listing card')
  customer.evaluate("""async () => {
    window.__BITE_QA_SERVER_RESTAURANT.cover_image_path=null;
    window.__BITE_QA_SERVER_RESTAURANT.cover_image_updated_at='2026-11-13T12:42:00Z';
    await refreshCustomerCoverPhotos(true);
  }""")
  customer.wait_for_function("""() => {
    const hero=document.getElementById('biteRestaurantHeroImage');
    const chosen=BiteRestaurantCovers.choose(activeRestaurant,publicMenuSearch,SUPABASE_URL);
    const label=document.getElementById('biteRestaurantCoverLabel').textContent;
    const possible=[chosen.src,chosen.fallback].map(src=>new URL(src,document.baseURI).href);
    return chosen.source!=='owner'
      && !activeRestaurant.cover_image_path
      && hero?.complete && hero?.naturalWidth>0
      && possible.includes(hero.src)
      && (label==='Menu photo'||label==='Bite suggested photo');
  }""",timeout=10000)
  customer.locator('#menuItems .menuitem').first.wait_for(state='visible',timeout=12000)
  check(True,'Removing Owner cover restores restaurant menu photo or curated Bite fallback without losing items')
  customer.evaluate("showCustomerView('home')")
  # Direct Restaurant Ordering: WhatsApp source link must open only one restaurant,
  # with no discovery or escape into another restaurant catalogue.
  direct=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);observe(direct)
  direct.route('**/storage/v1/object/public/bite-menu/**',
    lambda route:route.fulfill(status=200,content_type='image/jpeg',body=cover_bytes))
  direct.goto('http://127.0.0.1:4174/dist/qa/customer-flow.html?direct=1&restaurant=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',wait_until='domcontentloaded')
  direct.locator('#menuItems [data-menu-item-id]').first.wait_for(state='visible')
  check(direct.locator('#restaurantName').inner_text()=='QA Rajsamand Kitchen','Restaurant link opens only the linked restaurant menu')
  # Mobile direct-link visitors have a single obvious menu action;
  # the older fixed red banner should never cover food content.
  check(direct.evaluate("""() => {
    const first=document.querySelector('#menuItems .menuitem');
    const cover=document.getElementById('biteRestaurantHeroImage');
    const header=document.querySelector('.header');
    return first && cover && header
      && cover.getBoundingClientRect().height<=160
      && getComputedStyle(header).position==='sticky'
      && document.getElementById('biteMenuQuickNav')===null;
  }"""),'Mobile direct menu uses compact cover without duplicate floating Menu button')
  inline=direct.locator('#biteMenuInlineCTA')
  check(inline.is_visible() and 'Menu देखें' in inline.inner_text()
    and inline.get_attribute('aria-controls')=='biteMenuBrowseStart',
    'Only inline restaurant Menu dekhein button remains visible')
  inline.click()
  direct.wait_for_function("""() => {
    const b=document.getElementById('biteMenuBrowseStart');
    return window.scrollY>0 && b.getBoundingClientRect().top>=35
      && b.getBoundingClientRect().top<=200;
  }""",timeout=8000)
  check(direct.locator('#menuSearchInput').is_visible() and direct.locator('#categoryBar').is_visible(),
        'Single Menu button scrolls to menu search and dishes without obscuring content')
  explore=direct.locator('#biteExploreCityLink')
  check(explore.is_visible() and 'Explore food in your city' in explore.inner_text()
    and 'direct=' not in explore.get_attribute('href'),
    'Direct restaurant page offers an explicit, small escape link to the Bite city marketplace')
  check(direct.locator('#biteRestaurantHeroImage').is_visible() and bool(direct.locator('#biteRestaurantHeroImage').get_attribute('src')),
        'Direct restaurant page displays a full-width food hero image')
  direct.evaluate("""async () => {
    const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    window.__BITE_QA_SERVER_RESTAURANT.cover_image_path=id+'/covers/12345678-1234-4234-8234-123456789012.webp';
    window.__BITE_QA_SERVER_RESTAURANT.cover_image_updated_at='2026-11-13T12:45:00Z';
    await refreshCustomerCoverPhotos(true);
  }""")
  direct.wait_for_function("""() => {
    const hero=document.getElementById('biteRestaurantHeroImage');
    return hero?.complete && hero.naturalWidth>0 && hero.src.includes('/storage/v1/object/public/bite-menu/');
  }""")
  check(direct.locator('#biteRestaurantCoverLabel').text_content()=='Restaurant photo',
        'Restaurant-only direct ordering page updates to same newly published Owner cover')
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
  # Delivery PIN changes through the visible header sheet; the legacy form is intentionally hidden.
  customer.locator('#biteLocationOpen').click()
  customer.locator('#biteSheetPin').fill('313399')
  customer.locator('#biteSheetPinForm button[type=submit]').click()
  check(customer.locator('#biteLocationOpen').inner_text().strip()=='PIN 313399'
    and customer.locator('#discoveryLocationForm').is_hidden(),
    'Customer changes location in header without a duplicate PIN card')
  customer.wait_for_function("document.querySelector('#resultCount').textContent.startsWith('0 ')")
  check(customer.locator('#restaurantGrid .restaurant').count()==0,'Out-of-area PIN removes delivery restaurants')
  check('313399' in customer.locator('#restaurantGrid .food-empty').inner_text()
    and customer.locator('#restaurantGrid [data-discovery-pickup]').count()==1,
    'Out-of-area PIN explains unavailable delivery and offers a pickup action')
  customer.locator('#restaurantGrid [data-discovery-pin]').click()
  check(customer.locator('#biteLocationSheet').is_visible()
    and customer.locator('#biteSheetPin').input_value()=='313399',
    'Change PIN from delivery-unavailable state opens the visible location picker')
  customer.keyboard.press('Escape')
  check(customer.locator('#biteLocationSheet').is_hidden()
    and customer.locator('#discoveryLocationForm').is_hidden(),
    'Closing the location picker never focuses or exposes the obsolete hidden PIN form')
  customer.locator('#restaurantGrid [data-discovery-pickup]').click()
  check(customer.locator('#restaurantGrid .restaurant').count()==1
    and customer.locator('[data-service-filter="pickup"]').get_attribute('aria-pressed')=='true'
    and customer.evaluate("currentDiscoveryPin")=='313399',
    'Pickup recovery shows restaurants without changing the saved delivery PIN')
  check(customer.locator('#restaurantGrid .restaurant-service').inner_text().endswith('Pickup')
    and 'Check PIN' in customer.locator('#restaurantGrid .restaurant .meta').inner_text(),
    'Out-of-zone pickup card does not misleadingly advertise available delivery or a verified fee')
  customer.evaluate("""() => {
    activeFilter='North Indian';
    document.getElementById('homeSearchInput').value='impossible search';
    document.getElementById('searchInput').value='impossible search';
    document.getElementById('filterOpenNow').setAttribute('aria-pressed','true');
    document.getElementById('filterOpenNow').classList.add('active');
    document.getElementById('filterFavourites').setAttribute('aria-pressed','true');
    document.getElementById('filterFavourites').classList.add('active');
    document.getElementById('discoveryDiet').value='nonveg';
    document.getElementById('discoveryRating').value='4.5';
    document.getElementById('discoverySort').value='price';
    window.restaurantSortFast=true;
    document.getElementById('sortFastBtn').classList.add('active');
    document.getElementById('sortFastBtn').setAttribute('aria-pressed','true');
    renderRestaurants();
  }""")
  customer.locator('#clearDiscoveryBtn').click()
  check(customer.evaluate("""() => {
    const el=id=>document.getElementById(id);
    return activeFilter==='all' && window.restaurantServiceFilter==='all'
      && !window.restaurantSortFast && el('homeSearchInput').value===''
      && el('searchInput').value==='' && el('discoveryDiet').value==='all'
      && el('discoveryRating').value==='0' && el('discoverySort').value==='recommended'
      && ['filterOpenNow','filterFavourites','sortFastBtn'].every(id=>el(id).getAttribute('aria-pressed')==='false'&&!el(id).classList.contains('active'))
      && [...document.querySelectorAll('[data-home-filter]')].every(b=>(b.getAttribute('aria-pressed')==='true')===(b.dataset.homeFilter==='all'))
      && [...document.querySelectorAll('[data-service-filter]')].every(b=>(b.getAttribute('aria-pressed')==='true')===(b.dataset.serviceFilter==='all'))
      && currentDiscoveryPin==='313399' && el('discoveryPinInput').value==='313399';
  }"""),'Reset filters clears every discovery control while retaining delivery PIN')
  customer.locator('#biteLocationOpen').click()
  customer.locator('#biteSheetPin').fill('313324')
  customer.locator('#biteSheetPinForm button[type=submit]').click()
  check(customer.locator('#biteLocationOpen').inner_text().strip()=='PIN 313324',
    'Header location picker restores serviceable delivery PIN')
  customer.wait_for_function("document.querySelector('#resultCount').textContent.startsWith('1 ')")
  customer.locator('#homeSearchInput').fill('dish that does not exist')
  check(customer.locator('#restaurantGrid [data-discovery-reset]').count()==1,
    'Unmatched food search provides a clear reset action')
  customer.locator('#restaurantGrid [data-discovery-reset]').click()
  check(customer.locator('#restaurantGrid .restaurant').count()==1
    and customer.locator('#homeSearchInput').input_value()=='',
    'Empty-search reset restores available restaurants')
  customer.locator('[data-service-filter="delivery"]').click()
  customer.locator('#restaurantGrid .restaurant').click()
  customer.locator('#menuItems [data-menu-item-id]').wait_for(state='visible')
  # Menu category QA uses only the isolated fixture DOM; no restaurant data writes.
  customer.evaluate("""() => {
    window.__biteQAOriginalMenu=menuItems.slice();
    menuItems=[...menuItems,{
      ...menuItems[0],
      id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      category_id:'qa-breakfast',
      name:'QA Breakfast Idli',
      price:60
    }];
    renderMenu([{id:'qa-breakfast',name:'Breakfast'}]);
    window.scrollTo({top:0,behavior:'instant'});
  }""")
  category=customer.locator('#categoryBar [data-cat="qa-breakfast"]')
  check(category.get_attribute('aria-controls')=='menuItems',
    'Category chip is semantically connected to dish results')
  category.click()
  customer.wait_for_function("""() => {
    const heading=document.getElementById('menuCategoryHeading');
    const list=document.getElementById('menuItems');
    const rail=document.getElementById('categoryBar');
    const cards=[...list.querySelectorAll('.menuitem')];
    return heading.textContent==='Breakfast'
      && cards.length===1 && cards[0].textContent.includes('QA Breakfast Idli')
      && window.scrollY>0
      && list.getBoundingClientRect().top>=rail.getBoundingClientRect().bottom-8
      && list.getBoundingClientRect().top<window.innerHeight-55;
  }""",timeout=9000)
  check(category.get_attribute('aria-pressed')=='true',
    'Selecting Breakfast filters real loaded dishes and reveals them below sticky categories')
  customer.evaluate("""() => {
    menuItems=window.__biteQAOriginalMenu;
    renderMenu([]);
    window.scrollTo({top:0,behavior:'instant'});
  }""")
  check(customer.locator('#menuCategoryHeading').inner_text()=='All dishes'
    and customer.locator('#menuItems .menuitem').count()==1,
    'Restoring all menu data also restores the category label and original dish')
  customer.evaluate("window.__biteQaDishImage=document.querySelector('#menuItems .menuphoto')")
  customer.locator('#menuItems [data-add]').first.click()
  check(customer.evaluate("document.querySelector('#menuItems .menuphoto')===window.__biteQaDishImage"), 'ADD leaves existing dish image and menu DOM mounted')
  check(customer.locator('#menuItems .item-quantity span').first.inner_text()=='1', 'ADD updates the dish quantity inline')
  check('150' in customer.locator('#floatingCartTotal').inner_text(), 'ADD updates cart total without rebuilding menu')
  customer.locator('#menuItems [data-menu-dec]').first.click()
  check(customer.locator('#menuItems [data-add]').count()==1, 'Minus returns dish quantity to ADD inline')
  check(customer.evaluate("document.querySelector('#menuItems .menuphoto')===window.__biteQaDishImage"), 'Minus also preserves the loaded image node')
  customer.locator('#menuSearchInput').fill('not-a-real-dish-987')
  customer.wait_for_function("document.querySelector('#menuResultCount').textContent.startsWith('0 of ')")
  check(customer.locator('#menuItems [data-reset-menu]').is_visible() and customer.locator('#menuResetFilters').is_visible(),
    'Unmatched dish search offers an obvious Show all dishes recovery')
  customer.locator('#menuItems [data-reset-menu]').click()
  check(customer.locator('#menuSearchInput').input_value()=='' and customer.locator('#menuItems [data-add]').count()==1
    and customer.locator('#menuResetFilters').is_hidden(),
    'Show all dishes clears the search and restores menu items')
  customer.locator('#menuVegToggle').check()
  check(customer.locator('#menuResetFilters').is_visible(), 'Veg-only mode exposes Clear filters even with matching dishes')
  customer.locator('#menuResetFilters').click()
  check(not customer.locator('#menuVegToggle').is_checked() and customer.locator('#categoryBar [data-cat="all"]').get_attribute('aria-pressed')=='true',
    'Clear filters resets veg and category controls to All items')
  # Synthetic menu search and suggestions: fixtures live only in this browser's memory.
  customer.evaluate("""() => {
    window.__biteSearchOriginalMenu=menuItems;
    const base=menuItems[0];
    menuItems=[...menuItems,
      {...base,id:'11111111-1111-4111-8111-111111111111',
        name:'QA Veg Thali Special',description:'A full plate',
        category_id:'breakfast',price:190,is_vegetarian:true},
      {...base,id:'22222222-2222-4222-8222-222222222222',
        name:'Seasonal Bowl',description:'Contains QA Veg Thali ingredients',
        category_id:'sides',price:80,is_vegetarian:true},
      {...base,id:'33333333-3333-4333-8333-333333333333',
        name:'QA Chicken Special',description:'Nonvegetarian dish',
        category_id:'sides',price:210,is_vegetarian:false}
    ];
    renderMenu([]);
  }""")
  customer.locator('#menuSearchInput').fill('QA Veg Thali')
  customer.wait_for_function("""() => {
    const names=[...document.querySelectorAll('#menuItems .itemname')].map(el=>el.textContent.trim());
    return names.length===3 && names[0]==='QA Veg Thali'
      && names[1]==='QA Veg Thali Special' && names[2]==='Seasonal Bowl';
  }""",timeout=8000)
  check(customer.locator('#menuResultCount').inner_text().startswith('3 of '),
    'Menu search shows actual name-first matches ahead of description-only matches')
  customer.locator('#menuClearSearch').click()
  customer.evaluate("""() => {
    cart={[menuItems[0].id]:1};
    renderCart();
    openCartModal();
  }""")
  add_ons=customer.locator('#biteCartAddOnList [data-bite-add-on]')
  add_ons.first.wait_for(state='visible')
  check(add_ons.count()==3
    and add_ons.first.get_attribute('data-bite-add-on')=='11111111-1111-4111-8111-111111111111'
    and add_ons.last.get_attribute('data-bite-add-on')=='33333333-3333-4333-8333-333333333333',
    'Real menu suggestions prefer vegetarian and category-varied items without fake popularity')
  add_ons.first.click()
  check(customer.locator('#cartModalLines .cart-product').count()==2,
    'Choosing a suggestion updates the actual cart and editable items')
  customer.evaluate("""() => {
    closeCartModal();
    cart={};
    menuItems=window.__biteSearchOriginalMenu;
    renderCart();
    renderMenu([]);
  }""")
  check(customer.locator('#menuItems .menuitem').count()==1
    and customer.locator('#cartCount').inner_text()=='(0)',
    'Synthetic search and cart fixture resets before real customer journey tests')
  customer.locator('#restaurantFavourite').click()
  customer.wait_for_function("document.querySelector('#restaurantFavourite').getAttribute('aria-pressed')==='true'")
  check('Saved' in customer.locator('#restaurantFavourite').inner_text(),'Favourite button persists through the Customer transport')
  customer.locator('#homeBottomNav [data-nav="orders"]').click()
  order_card=customer.locator('#ordersList > .ordercard').first
  order_card.wait_for(state='visible')
  check(order_card.locator('.orderactions > button').count()==2
    and order_card.locator('.order-badges .order-mode').is_visible(),
    'Order History shows two primary actions plus real status and fulfilment badges')
  check(order_card.locator('.order-more summary').is_visible()
    and order_card.locator('[data-invoice]').is_hidden(),
    'Secondary order actions are available through a collapsed accessible disclosure')
  order_card.locator('.order-more summary').click()
  check(order_card.locator('[data-invoice]').is_visible()
    and order_card.locator('.order-more').get_attribute('open') is not None,
    'More options reveals Download bill without navigating away')
  customer.screenshot(path=str(OUT/'ui-orders-compact.png'),full_page=False)
  with customer.expect_download(timeout=20000) as download:order_card.locator('[data-invoice]').click()
  receipt=OUT/'receipt.pdf';download.value.save_as(receipt)
  check(receipt.read_bytes().startswith(b'%PDF-1.4'),'Customer bill downloads as an actual PDF file')
  customer.locator('[data-reorder]').click();customer.locator('#cartModal.show').wait_for(state='visible')
  check('QA Veg Thali' in customer.locator('#cartModalLines').inner_text(),'Reorder opens a reviewable cart with current available items')
  check(customer.locator('#cartModalLines [data-cart-inc]').first.get_attribute('aria-label').startswith('Add one')
    and customer.locator('#cartModalLines [data-cart-dec]').first.get_attribute('aria-label').startswith('Remove one'),
    'Cart quantity controls have accessible dish-specific names')
  customer.locator('#cartModalLines [data-cart-inc]').first.click()
  check(customer.evaluate("document.activeElement?.hasAttribute('data-cart-inc')"),
    'Cart plus keeps keyboard focus after quantity re-render')
  customer.locator('#cartModalLines [data-cart-dec]').first.click()
  check(customer.evaluate("document.activeElement?.hasAttribute('data-cart-dec')"),
    'Cart minus restores focus and original quantity')
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
  customer.locator('#cartCheckoutBtn').click()
  customer.locator('#checkoutFormPanel').wait_for(state='visible')
  check(customer.locator('#checkoutEditItems').is_visible()
    and customer.locator('.bite-checkout-steps [aria-current="step"]').inner_text()=='Details',
    'Checkout shows an Edit items path and accessible ordering progress')
  check(customer.locator('input[name="deliveryMode"][value="delivery"]').is_checked(),
    'Checkout retains selected delivery when it is available')
  customer.locator('#checkoutEditItems').click()
  check(customer.locator('#cartModal.show').is_visible() and not customer.locator('#checkoutModal.show').is_visible(),
    'Edit items returns to the cart without reopening checkout or payment')
  check('QA Veg Thali' in customer.locator('#cartModalLines').inner_text()
    and customer.locator('#cartModalLines [data-cart-inc]').count()>0,
    'Cart retains the real selected dish and its editable quantity')
  check(customer.evaluate('cartEntries().length===1 && cartEntries()[0][1]===1'),
    'Editing checkout preserves the quantity and does not duplicate the dish')
  customer.locator('#cartCheckoutBtn').click()
  customer.locator('#checkoutFormPanel').wait_for(state='visible')
  customer.locator('#checkoutCoupon').fill('QA10');customer.locator('#applyCheckoutCoupon').click()
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
  check(customer.locator('[data-bite-language]').count()==0
    and customer.locator('.bite-language-row').count()==0
    and customer.evaluate("document.documentElement.lang")=='en',
    'Customer UI no longer has the unwanted Hindi/English language strip')
  check(customer.locator('#editProfilePhone').input_value()=='9999999999',
    'Removing the language switch preserves the customer profile input')
  owner=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);observe(owner)
  owner.goto('http://127.0.0.1:4174/dist/qa/owner-flow.html?bite_page=pos&v=qa-pos',wait_until='domcontentloaded');owner.locator('#mainApp').wait_for(state='visible');
  check(not owner.locator('#authScreen').is_visible() and
    not owner.evaluate("document.body.classList.contains('bite-session-check')"),
    'Saved Owner session opens workspace without leaving login overlay or boot splash')
  owner.locator('#posNewSaleBtn').wait_for(state='visible')
  check(owner.evaluate("""() => document.querySelector('#pos.page')?.classList.contains('active') && document.getElementById('pageTitle')?.textContent==='POS & Billing'"""),
        'Direct POS URL opens authenticated Owner POS & Billing without navigating the sidebar')
  nav(owner,'orders')
  owner.locator('#biteOwnerOrderStages').wait_for(state='visible')
  stage_names=owner.locator('#biteOwnerOrderStages [data-bite-stage]').evaluate_all(
    "(nodes)=>nodes.map(node=>node.dataset.biteStage)")
  check(stage_names==['new','preparing','ready','delivery','completed','cancelled','all'],
        'Owner Orders has one grouped stage bar backed by real status values')
  owner.locator('#biteOwnerOrderCalendar').wait_for(state='visible')
  owner.locator('#biteOwnerOrderCalendar [data-date-calendar-toggle]').click()
  check(owner.locator('#biteOwnerOrderCalendar .bite-date-grid button[data-date-select]').count()>=28,
    'Owner date calendar offers individual days and day-wise order count badges')
  check(owner.locator('#biteOwnerOrderCalendar [data-date-select="all"]').is_visible(),
    'Order calendar has an obvious All dates reset without losing old bills')
  owner.locator('#biteOwnerOrderCalendar [data-date-select="all"]').click()
  check(owner.evaluate('BiteOwnerOrders.selectedDay()===null'),
    'All dates reset restores full order history, regardless of status filter')
  check(owner.locator('#orders .order-inbox').is_hidden()
        and owner.locator('#orders #orderStatusTabs').is_hidden(),
        'Owner Orders does not repeat actionable orders in inbox and old bar')
  check(owner.locator('#orders .bite-owner-order-disclosure').count()==2,
        'Secondary request/review and payment-verification panels remain accessible')
  check(owner.locator('#biteOwnerOrderStages [data-bite-stage="all"]').get_attribute('aria-pressed')=='true',
        'Owner Orders opens All by default so historic bills are visible without another filter')
  # Reproduce user bug: a completed historical order exists for a day while New=0.
  # No backend write is made; the fixture stays in the browser's in-memory state.
  owner.evaluate("""() => {
    window.__qaCalendarOrderId='00000000-0000-4000-8000-000000000547';
    state.orders.push({
      id:window.__qaCalendarOrderId,restaurant:access.restaurantId,
      channel:'Own Platform',status:'Completed',
      createdAt:new Date().toISOString(),amount:174,
      code:'BITE-QA-CALENDAR',customerName:'Date QA',deliveryType:'delivery',
      isDemo:false
    });
    renderOrderBoard();
  }""")
  owner.locator('#biteOwnerOrderStages [data-bite-stage="new"]').click()
  check('BITE-QA-CALENDAR' not in owner.locator('#orderBoard').inner_text(),
    'New 0 filter excludes a completed historical order, reproducing the bug')
  owner.locator('#biteOwnerOrderCalendar [data-date-calendar-toggle]').click()
  today=owner.evaluate("BiteOwnerOrders.dayKey(new Date())")
  owner.locator(f'#biteOwnerOrderCalendar .bite-date-cell[data-date-select="{today}"]').click()
  check(owner.locator('#biteOwnerOrderStages [data-bite-stage="all"]').get_attribute('aria-pressed')=='true'
        and 'BITE-QA-CALENDAR' in owner.locator('#orderBoard').inner_text(),
        'Tap on a date overrides stale New filter and opens all bills for that day')
  check(owner.locator('#biteOwnerOrderCalendar .bite-orders-calendar-body').count()==0,
        'Calendar collapses after selecting a day to make room for order cards')
  check(owner.locator('#biteOwnerOrderStages [data-bite-stage="all"] [data-bite-stage-count]').inner_text()!='0',
        'Stage counts reflect selected day instead of misleading all-date badges')
  owner.evaluate("""() => {
    state.orders=state.orders.filter(o=>o.id!==window.__qaCalendarOrderId);
    renderOrderBoard();
  }""")
  owner.locator('#biteOwnerOrderCalendar [data-date-select="all"]').click()
  owner.locator('#biteOwnerOrderStages [data-bite-stage="preparing"]').click()
  check(owner.locator('#biteOwnerOrderStages [data-bite-stage="preparing"]').get_attribute('aria-pressed')=='true',
        'Accepted and Preparing orders share a canonical Preparing stage')
  owner.locator('#biteOwnerOrderStages [data-bite-stage="all"]').click()
  owner.evaluate("""() => { window.__qaReason='pending';
     BiteOwnerOrders.requestReason(document,'Rejected').then(value=>window.__qaReason=value); }""")
  owner.locator('.bite-order-reason-modal select').select_option('Out of stock')
  owner.locator('.bite-order-reason-modal button[type=submit]').click()
  owner.wait_for_function("window.__qaReason==='Out of stock'")
  check(not owner.locator('.bite-order-reason-overlay').count(),
        'Owner Reject requires a reason and closes confirmation cleanly')
  owner.evaluate("""() => { window.__qaCancel='pending';
     BiteOwnerOrders.requestReason(document,'Cancelled').then(value=>window.__qaCancel=value); }""")
  owner.keyboard.press('Escape')
  owner.wait_for_function("window.__qaCancel===null")
  check(not owner.locator('.bite-order-reason-overlay').count(),
        'Owner Cancel modal supports Escape without sending an order update')
  owner.screenshot(path=str(OUT/'ui-owner-orders.png'),full_page=False)
  check(owner.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),
        'Owner Orders has no horizontal overflow at 390px')
  nav(owner,'overview')
  owner.locator('#ownerQuickPosBtn').wait_for(state='visible')
  check(owner.locator('#overview .od-owner-priority').is_visible()
    and owner.locator('#overview .od-owner-priority .od-stages').count()==1
    and owner.locator('#overview .od-live').is_hidden(),
    'Mobile Home shows exactly one Live Orders panel with stage shortcuts inside')
  check(owner.locator('.bite-language-row').is_hidden()
    and owner.locator('.side').is_hidden()
    and owner.locator('#mainApp>.main>.top').evaluate(
       "(el)=>getComputedStyle(el).backgroundColor==='rgb(53, 22, 110)' && el.getBoundingClientRect().height<=60"),
    'Owner mobile header is compact, readable purple; no language strip or sidebar')
  owner.screenshot(path=str(OUT/'ui-owner-home.png'),full_page=False)
  check(owner.locator('#ownerQuickPosBtn').is_visible(),'Mobile owner overview has persistent New POS Bill shortcut')
  owner.locator('#ownerQuickPosBtn').click()
  owner.locator('#orderModal.show').wait_for(state='visible')
  check(owner.locator('#posNewSaleBtn').is_visible() and owner.locator('#orderModal.show').is_visible(),
        'Owner overview quick button opens the actual POS bill on the first tap')
  owner.locator('#orderModal .modal-head .close').click()
  nav(owner,'pos')
  owner.locator('#posNewSaleBtn').wait_for(state='visible')
  check(not owner.locator('.side').evaluate("(el) => el.classList.contains('sidebar-open')") and owner.locator('#posNewSaleBtn').is_visible(),
        'POS & Billing is reachable from canonical mobile POS tab and the drawer stays closed')
  owner.locator('#posNewSaleBtn').click()
  owner.locator('#orderModal.show').wait_for(state='visible')
  check(owner.locator('#posPaymentSection').is_visible() and owner.locator('#orderRestaurant').input_value()=='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'New POS Bill opens the real restaurant-scoped payment form')
  check(owner.locator('#posWhatsAppConsent').count()==1,
        'POS form has explicit WhatsApp bill consent before any customer share')
  check(owner.locator('#posPaidAmount').input_value()=='' and owner.locator('#posPaidAmount').get_attribute('placeholder')=='0.00',
        'Received Amount shows placeholder only and no pre-filled real zero')
  check(owner.locator('#posAddItemTrigger').count()==0 and owner.locator('#posItemEntry').is_visible(),
        'POS item form is always ready and there is no redundant Add item button')
  owner.locator('#posPickerItemName').fill('QA Veg Thali')
  owner.locator('#posPickerQuantity').fill('2')
  owner.locator('#posPickerPrice').fill('150')
  owner.get_by_role('button',name='＋ Add to bill').click()
  check('₹300' in owner.locator('#orderGrandTotal').inner_text(),
        'Mobile POS item picker totals two ₹150 dishes without saving a real bill')
  check(owner.locator('#posItemEntry').is_visible()
    and owner.locator('#posPickerItemName').input_value()==''
    and owner.locator('#posPickerPrice').input_value()==''
    and owner.locator('#posPickerQuantity').input_value()=='1',
    'After Add to bill, the item form remains visible with clean inputs ready for the next dish')
  owner.locator('#posPickerItemName').fill('QA Roti')
  owner.locator('#posPickerQuantity').fill('2')
  owner.locator('#posPickerPrice').fill('20')
  owner.get_by_role('button',name='＋ Add to bill').click()
  check(owner.locator('#posItemSummary .pos-item-chip').count()==2
    and '₹340' in owner.locator('#orderGrandTotal').inner_text(),
    'Two items can be added consecutively without clicking Add item again')
  owner.get_by_role('button',name='Increase QA Roti quantity').click()
  check(owner.locator('#posItemSummary .pos-item-chip').nth(1).locator('.pos-qty-value').inner_text()=='3'
    and '₹360' in owner.locator('#orderGrandTotal').inner_text(),
    'Bill item plus button increases existing Roti quantity and recalculates total')
  owner.get_by_role('button',name='Decrease QA Roti quantity').click()
  check(owner.locator('#posItemSummary .pos-item-chip').nth(1).locator('.pos-qty-value').inner_text()=='2'
    and '₹340' in owner.locator('#orderGrandTotal').inner_text(),
    'Bill item minus button reduces quantity and total without removing the row')
  owner.locator('#posPickerItemName').fill('QA Roti')
  owner.locator('#posPickerPrice').fill('20')
  owner.get_by_role('button',name='＋ Add to bill').click()
  check(owner.locator('#posItemSummary .pos-item-chip').count()==2
    and owner.locator('#posItemSummary .pos-item-chip').nth(1).locator('.pos-qty-value').inner_text()=='3'
    and '₹360' in owner.locator('#orderGrandTotal').inner_text(),
    'Adding the same item again merges its quantity rather than duplicating the bill line')
  owner.get_by_role('button',name='Decrease QA Roti quantity').click()
  owner.get_by_role('button',name='Decrease QA Roti quantity').click()
  check(owner.get_by_role('button',name='Decrease QA Roti quantity').is_disabled()
    and '₹320' in owner.locator('#orderGrandTotal').inner_text(),
    'Minus cannot silently delete the final item; separate remove action stays available')
  owner.get_by_role('button',name='Increase QA Roti quantity').click()
  check(owner.locator('#posPaidAmount').input_value()=='' and '₹340' in owner.locator('#posBalanceDue').input_value(),
        'Adding items updates due amount but never auto-fills received payment')
  owner.locator('#posPaidAmount').fill('250')
  check(owner.locator('#posPaidAmount').input_value()=='250' and '₹90' in owner.locator('#posBalanceDue').input_value(),
        'Typing payment starts with the entered digits and recalculates balance')
  owner.locator('#orderModal button.close').click()
  owner.locator('#posNewSaleBtn').click()
  owner.locator('#orderModal.show').wait_for(state='visible')
  check(owner.locator('#posPaidAmount').input_value()=='' and owner.locator('#posPaidAmount').get_attribute('placeholder')=='0.00',
        'Reopening a new POS bill clears previously entered received payment')
  # Inject synthetic available menu items; never query or mutate production restaurant data.
  owner.evaluate("""() => {posMenuItems=[
    {id:'qa-water',name:'Water Bottle',price:20},
    {id:'qa-paneer',name:'Paneer Peshawari',price:259},
    {id:'qa-roti',name:'Tawa Plain Roti',price:15},
    {id:'qa-butter',name:'Tawa Butter Roti',price:20}
  ]}""")
  owner.locator('#posPickerItemName').fill('water')
  check(owner.locator('#posMenuSuggestions .pos-search-option').count()==1
    and 'Water Bottle' in owner.locator('#posMenuSuggestions').inner_text()
    and 'Paneer' not in owner.locator('#posMenuSuggestions').inner_text(),
    'Typing Water filters menu to only relevant items instead of an unrelated native dropdown')
  owner.locator('#posMenuSuggestions .pos-search-option').click()
  check(owner.locator('#posPickerItemName').input_value()=='Water Bottle'
    and owner.locator('#posPickerPrice').input_value()=='20.00'
    and owner.locator('#posPickerItemName').get_attribute('aria-expanded')=='false',
    'Selecting a menu search result fills exact item name and price and closes suggestions')
  owner.get_by_role('button',name='＋ Add to bill').click()
  check('₹20' in owner.locator('#orderGrandTotal').inner_text(),
    'Search-selected item can be added to the bill at the menu price')
  owner.locator('#posPickerItemName').fill('plain ro')
  check(owner.locator('#posMenuSuggestions .pos-search-option').count()==1
    and 'Tawa Plain Roti' in owner.locator('#posMenuSuggestions').inner_text(),
    'Multiword partial search finds Tawa Plain Roti without needing the full name')
  owner.locator('#posPickerItemName').press('ArrowDown')
  owner.locator('#posPickerItemName').press('Enter')
  check(owner.locator('#posPickerItemName').input_value()=='Tawa Plain Roti'
    and owner.locator('#posPickerPrice').input_value()=='15.00',
    'Keyboard arrow and Enter choose the matching menu item and its price')
  owner.get_by_role('button',name='＋ Add to bill').click()
  check(owner.locator('#posItemSummary .pos-item-chip').count()==2
    and '₹35' in owner.locator('#orderGrandTotal').inner_text(),
    'Search-picked menu items produce the correct two-item total')
  owner.locator('#posPickerItemName').fill('zzzz no match')
  check(owner.locator('#posMenuSuggestions .pos-search-empty').is_visible()
    and owner.locator('#posMenuSuggestions .pos-search-option').count()==0
    and owner.locator('#posPickerPrice').input_value()=='',
    'No-match search explains manual item entry and clears stale menu pricing')
  owner.locator('#orderModal button.close').click()
  # Verify the exact customer's wa.me destination and full bill message.
  # Never actually contact WhatsApp or send any real message in synthetic QA.
  owner.evaluate("""() => {
    showPosWhatsAppBillDialog({
      restaurantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      restaurantName:'QA Rajsamand Kitchen',restaurantAddress:'QA fixture address',
      customerName:'QA Customer',phone:'9468456669',orderCode:'POS-QA-123',
      date:new Date().toISOString(),
      items:[{name:'QA Veg Thali',quantity:2,unit_price:150}],
      total:300,paid:300,due:0,waived:0
    });
  }""")
  owner.locator('#bitePosWhatsAppDialog').wait_for(state='visible')
  bill=owner.evaluate("""() => {
    const modal=document.getElementById('bitePosWhatsAppDialog');
    const share=modal.querySelector('a'),url=new URL(share.href),text=url.searchParams.get('text');
    return {links:modal.querySelectorAll('a').length,buttons:modal.querySelectorAll('button').length,
      number:url.pathname,host:url.host,content:text,
      preview:modal.querySelector('pre').textContent,
      shareLabel:share.textContent,hasNativeShare:modal.outerHTML.includes('PDF bill + link')};
  }""")
  check(bill['links']==1 and bill['buttons']==1 and bill['host']=='wa.me' and bill['number']=='/919468456669',
        'Exactly one WhatsApp bill action opens the intended saved customer number')
  check('QA Veg Thali × 2' in bill['content'] and 'Total: ₹300.00' in bill['content']
        and 'Received: ₹300.00' in bill['content']
        and 'direct=1&restaurant=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' in bill['content'],
        'Single addressed WhatsApp message contains itemized bill and this restaurant menu link')
  check(bill['preview']==bill['content'] and 'sirf QA Rajsamand Kitchen' not in bill['content']
        and not bill['hasNativeShare'],
        'Bill message preview and customer chat match without confusing technical marketing copy or extra actions')
  owner.locator('#bitePosWhatsAppDialog button[aria-label="Close bill preview"]').click()
  nav(owner,'menu')
  owner.locator('#menuItemRows [data-menu-options]').first.wait_for(state='visible',timeout=12000)
  owner.locator('#menuItemRows [data-menu-options]').first.click()
  owner.locator('#menuOptionsModal.show').wait_for(state='visible')
  check('QA Veg Thali' in owner.locator('#menuOptionsItemName').inner_text(),
        'Sizes & Add-ons opens for the correct restaurant menu item')
  owner.locator('#menuOptionsGroupForm [name="name"]').fill('Size')
  owner.locator('#menuOptionsDraftChoices [name="option_name"]').first.fill('Half')
  owner.locator('#menuOptionsDraftChoices [name="option_price"]').first.fill('0')
  owner.locator('#menuOptionsAddDraftChoice').click()
  owner.locator('#menuOptionsDraftChoices .bite-option-draft-row').nth(1).locator('[name="option_name"]').fill('Full')
  owner.locator('#menuOptionsDraftChoices .bite-option-draft-row').nth(1).locator('[name="option_price"]').fill('40')
  owner.locator('#menuOptionsGroupForm button[type="submit"]').click()
  owner.locator('#menuOptionsGroupList .bite-option-group-card').first.wait_for(state='visible',timeout=10000)
  check(owner.locator('#menuOptionsGroupList .bite-option-choice-row').nth(1).locator('[name="name"]').input_value()=='Full'
        and 'Paused' in owner.locator('#menuOptionsGroupList .bite-option-group-card .pill').inner_text(),
        'Owner saves two choices with different charges as a paused group')
  owner.locator('#menuOptionsGroupList [data-options-action="link-toggle"]').click()
  owner.wait_for_function("document.querySelector('#menuOptionsGroupList .bite-option-group-card .pill')?.textContent==='Configured'")
  check('Configured' in owner.locator('#menuOptionsGroupList').inner_text(),
        'Owner can enable a validated Size group for one menu item')
  owner.locator('#menuOptionsGroupList .bite-option-choice-row').nth(1).locator('[name="price_delta"]').fill('50')
  owner.locator('#menuOptionsGroupList .bite-option-choice-row').nth(1).locator('button[type="submit"]').click()
  owner.wait_for_function("document.querySelectorAll('#menuOptionsGroupList .bite-option-choice-row [name=price_delta]')[1]?.value==='50.00'")
  check('50.00'==owner.locator('#menuOptionsGroupList .bite-option-choice-row').nth(1).locator('[name="price_delta"]').input_value(),
        'Owner can safely edit an extra charge without affecting POS bills')
  owner.locator('#menuOptionsCloseBtn').click()
  check(not owner.locator('#menuOptionsModal').is_visible()
        and owner.locator('#menuItemRows [data-menu-options]').count()==1,
        'Mobile option manager closes back to original Menu & Prices')
  owner.locator('#biteCouponWorkspace summary').click();owner.locator('#biteCouponForm').wait_for(state='visible')
  owner.locator('#biteCouponForm [name=code]').fill('QATEST10');owner.locator('#biteCouponForm [name=title]').fill('QA ten percent');owner.locator('#biteCouponForm [name=discount_value]').fill('10');owner.locator('#biteCouponForm button[type=submit]').click()
  check('QATEST10' in owner.locator('#biteCouponList').inner_text(),'Owner coupon form creates a scoped offer')
  owner.locator('#biteCouponList [data-coupon-toggle]').click()
  check('Enable' in owner.locator('#biteCouponList').inner_text(),'Owner can pause an existing offer')
  owner.locator('#addMenuItemBtn').click();owner.locator('#biteMenuPhoto').set_input_files({'name':'unsupported.svg','mimeType':'image/svg+xml','buffer':b'<svg/>'});owner.locator('#biteUploadMenuPhoto').click()
  check('only' in owner.locator('#biteMenuUploadStatus').inner_text(),'Unsupported SVG uploads fail before any Storage request')
  owner.locator('#menuItemModal button.close').click();nav(owner,'settings')
  owner.locator('#ownerRestaurantCoverPreview').wait_for(state='visible')
  check(owner.locator('#ownerRestaurantCoverUpload').is_visible() and owner.locator('#ownerRestaurantCoverReset').count()==1,
        'Restaurant Owner settings show cover photo upload, preview and restore Bite suggestion')
  check(owner.locator('#ownerRestaurantCoverSource').inner_text()=='Bite suggested photo',
        'Missing Owner photo automatically shows Bite suggested restaurant cover')
  owner.locator('#biteDocumentForm').wait_for(state='visible')
  check(owner.locator('#biteDocumentForm input[type=file]').count()==1,'Owner private-document upload form is present')
  check(owner.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),'Owner has no horizontal overflow at 390px')
  # Verify the real Owner HTML with a phone viewport, without real server writes.
  nav(owner,'reports')
  owner.locator('#reports .grid.section').first.wait_for(state='visible')
  check(owner.locator('#reports .grid.section').nth(1).evaluate(
    "(el)=>getComputedStyle(el).gridTemplateColumns.split(' ').length===1"),
    'Owner Reports stacks channel and payment-mode cards, not two squeezed columns')
  check(owner.locator('#reports .grid.section').nth(1).locator('.card').first.evaluate(
    "(el)=>el.getBoundingClientRect().width>=innerWidth-70"),
    'Reports cards use nearly the entire phone width')
  nav(owner,'hr')
  owner.locator('#hr .bite-hr-tabs').wait_for(state='visible')
  check(owner.locator('#hrEmployeePanel').is_visible() and owner.locator('#hrAttendancePanel').is_hidden(),
    'Mobile Staff opens the Employee form alone, not split with Attendance')
  owner.locator('#hrEmployeeName').fill('QA unsaved employee')
  owner.locator('#hr [data-hr-tab="attendance"]').click()
  check(owner.locator('#hrAttendancePanel').is_visible() and owner.locator('#hrEmployeePanel').is_hidden(),
    'Owner can switch to the full-width Attendance form')
  check(owner.locator('#hrAttendancePanel .form-row').evaluate(
    "(el)=>getComputedStyle(el).gridTemplateColumns.split(' ').length===1"),
    'Attendance fields stack one per row on mobile')
  owner.locator('#hr [data-hr-tab="employee"]').click()
  check(owner.locator('#hrEmployeeName').input_value()=='QA unsaved employee',
    'Staff tabs preserve unsaved employee input')
  check(owner.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),
    'Staff layout does not overflow the phone')
  nav(owner,'khata')
  owner.locator('#khataCustomerRows').wait_for(state='attached')
  owner.evaluate("""() => {
    const rid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const cid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    khataCustomers=[{id:cid,restaurant_id:rid,full_name:'QA Sample Customer',phone:'9999999999',status:'Active'}];
    khataBalances=[{customer_id:cid,restaurant_id:rid,balance:0}];
    khataEntries=[];selectedKhataCustomerId=cid;renderKhata();
  }""")
  owner.locator('#khataCustomerRows button').first.click()
  check(owner.evaluate("document.activeElement?.id==='khataLedgerSection'")
     and owner.locator('#khataCustomerRows tr.is-selected').count()==1,
     'Khata Open focuses and highlights the selected customer ledger on mobile')
  check(owner.locator('#khataLedgerEmpty').inner_text()=='Is customer ke Khata mein abhi koi entry nahi hai.',
     'Empty customer ledger explains why no entries appear')
  nav(owner,'overview')
  check(owner.locator('#overview .od-accounts').is_hidden()
     and owner.locator('#overview .od-recent').is_hidden(),
     'Mobile Home no longer repeats account/order shortcuts already in More/Orders')
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
