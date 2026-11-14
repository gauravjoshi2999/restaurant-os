'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const js=fs.readFileSync('assets/customer-menu-cart-premium.js','utf8');
const css=fs.readFileSync('assets/customer-premium.css','utf8');

test('restaurant cart exposes real-data add-ons in the existing cart modal',()=>{
  for(const id of ['biteCartAddOns','biteCartAddOnList','biteCartAddOnStatus']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
  }
  assert.match(html,/window\.BiteMenuCartPremium\?\.renderAddOns\(\)/);
  assert.match(html,/assets\/customer-menu-cart-premium\.js\?v=20261114-menu-cart2/);
});
test('add-ons derive from current restaurant published menu, never fake discounts',()=>{
  assert.match(js,/BiteMenuSearch\.selectAddOns\(currentItems,currentCart,6\)/);
  assert.match(html,/assets\/customer-menu-search\.js\?v=20261114-search1/);
  assert.match(js,/BiteDiscovery\.safeImage/);
  assert.doesNotMatch(js,/40% OFF|50% OFF|highly reordered|rating:|cashfree/i);
  assert.doesNotMatch(js,/\.innerHTML\s*=/);
});
test('adding an add-on preserves existing cart/checkout functions and price authority',()=>{
  assert.match(js,/hideCartUndo\(\)/);
  assert.match(js,/cart\[id\]=Math\.min\(99,/);
  assert.match(js,/renderCart\(\)/);
  assert.match(js,/refreshMenuQuantityControl\(id\)/);
  assert.match(js,/pendingLiveCheckout/);
  assert.doesNotMatch(js,/sb\.from|sb\.rpc|fetch\(|payment_|placeOrder|create_order/);
  assert.doesNotThrow(()=>new vm.Script(js));
});
test('add-on row is scrollable, reachable by keyboard, and does not clip page',()=>{
  assert.match(css,/\.bite-cart-add-on-list\{/);
  assert.match(css,/overflow-x:auto/);
  assert.match(css,/\.bite-cart-add-on button\{/);
  assert.match(css,/min-height:44px/);
  assert.match(html,/id="biteCartAddOnStatus"[^>]*role="status"/);
});
