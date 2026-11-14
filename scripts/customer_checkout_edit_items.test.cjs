'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-checkout-polish.css','utf8');

test('checkout can be edited without creating new orders or changing provider integration',()=>{
 assert.equal((html.match(/id="checkoutEditItems"/g)||[]).length,1);
 assert.match(html,/id="checkoutEditItems" aria-label="Edit items in your cart"/);
 assert.match(html,/\$\('checkoutEditItems'\)\.addEventListener\('click'/);
 const at=html.indexOf("$('checkoutEditItems').addEventListener('click'");
 const end=html.indexOf("$('closeCheckout').addEventListener",at);
 assert.ok(at!==-1&&end>at);
 const handler=html.slice(at,end);
 assert.match(handler,/if\(checkoutPaymentBusy\)/);
 assert.match(handler,/if\(!activeRestaurant\|\|!cartEntries\(\)\.length\)/);
 assert.match(handler,/closeCheckoutAndReturnToMenu\(\)/);
 assert.match(handler,/openCartModal\(\)/);
 assert.doesNotMatch(handler,/sb\.|Cashfree|payment_|create_order|submitCustomerOrder|placeOrderBtn|fetch\(/i);
});

test('checkout step marker and delivery choice are accessible',()=>{
 assert.match(html,/<nav class="bite-checkout-steps" aria-label="Order progress"/);
 assert.match(html,/<strong aria-current="step">Details<\/strong>/);
 assert.match(html,/name="deliveryMode" value="delivery"/);
 assert.match(html,/name="deliveryMode" value="pickup"/);
 assert.match(html,/assets\/customer-checkout-polish\.css\?v=20261114-checkout1/);
 assert.match(css,/#checkoutEditItems/);
 assert.match(css,/checkoutmode label:has\(input:checked\)/);
 assert.match(css,/input:focus-visible/);
 assert.match(css,/@media\(max-width:350px\)/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

test('original checkout payment safety and price verification remain present',()=>{
 assert.match(html,/sb\.rpc\('check_restaurant_delivery_area'/);
 assert.match(html,/refreshCheckoutPaymentReadiness\(\)/);
 assert.match(html,/data\?\.ready!==true/);
 assert.match(html,/id="placeOrderBtn" disabled aria-disabled="true"/);
 assert.match(html,/id="checkoutPendingPanel"/);
 assert.match(html,/id="checkoutOutcomePanel"/);
 assert.match(html,/id="cartModalLines"/);
 const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(x=>x[1]).filter(x=>x.trim());
 for(const js of inline)assert.doesNotThrow(()=>new vm.Script(js));
});
