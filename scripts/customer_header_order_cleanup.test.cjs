'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-ui-cleanup.css','utf8');
const completion=fs.readFileSync('assets/customer-completion.js','utf8');
const mark=fs.readFileSync('assets/bite-premium-mark.svg','utf8');

test('the customer language toggle is removed at its actual injection source',()=>{
  assert.doesNotMatch(html,/<script[^>]+src="assets\/bite-language\.js/);
  assert.doesNotMatch(html,/data-bite-language="(?:hi|en)"/);
  assert.match(html,/<html lang="en">/);
});

test('only the header location selector is shown; legacy validated form remains for PIN serviceability',()=>{
  assert.match(html,/<button[^>]+id="biteLocationOpen"/);
  assert.match(html,/<form id="discoveryLocationForm"[^>]*\bhidden\b[^>]*>/);
  assert.match(css,/#discoveryLocationForm\[hidden\]\{[^}]*display:none!important/s);
  assert.match(completion,/currentDiscoveryPin=pin/);
  assert.match(completion,/loadRestaurants\(\)/);
  assert.doesNotMatch(completion,/customerLocationLabel'\)\.textContent='Delivery PIN '/);
  assert.match(html,/id="biteLocationSheet"/);
  assert.match(html,/id="biteSheetPinForm"/);
});

test('customer header and footer show original theme-matched Bite wordmark',()=>{
  assert.match(html,/<a[^>]*class="customer-brand bite-brand-refined"/);
  assert.match(html,/<span class="bite-brand-copy"><strong>Bite<\/strong><small>Eat\. Repeat\.<\/small><\/span>/);
  assert.match(html,/class="bite-footer-brand"/);
  assert.match(html,/assets\/bite-premium-mark\.svg/);
  assert.match(mark,/<svg[\s\S]*viewBox="0 0 72 72"/);
  assert.match(mark,/fill="#087B4D"/);
  assert.doesNotMatch(html,/<a[^>]+class="customer-brand"[^>]*><img src="assets\/bite-selected-wordmark\.webp"/);
});

test('delivery and pickup mode render next to order status, outside action buttons',()=>{
  const start=html.indexOf("box.innerHTML=customerOrders.map(o=>");
  const end=html.indexOf("window.BiteHistoryPremium?.applyFilters()",start);
  assert.ok(start>=0 && end>start);
  const renderer=html.slice(start,end);
  const badges=renderer.indexOf('class="order-badges"');
  const fulfilment=renderer.indexOf('class="order-mode ');
  const actions=renderer.indexOf('class="orderactions"');
  assert.ok(badges>=0&&fulfilment>badges&&actions>fulfilment);
  assert.match(renderer,/o\.delivery_type==='pickup'\?'Pickup':o\.delivery_type==='delivery'\?'Delivery':'Method unavailable'/);
  assert.doesNotMatch(renderer,/<span class="muted">'\+\(o\.delivery_type/);
  assert.match(renderer,/data-reorder=/);
  assert.match(renderer,/data-invoice=/);
  assert.match(renderer,/data-order-detail=/);
  assert.match(renderer,/data-customer-order-action=/);
  assert.match(css,/\.order-badges/);
  assert.match(css,/\.order-mode\.pickup/);
  assert.match(css,/min-height:44px/);
});

test('fix stays scoped to customer UI and never changes server payment/role logic',()=>{
  assert.match(css,/body\[data-bite-app="customer"\]/);
  assert.doesNotMatch(css,/body\[data-role="owner"\]/);
  assert.match(html,/sb\.rpc\('list_my_customer_orders'\)/);
  assert.match(html,/sb\.rpc\('check_restaurant_delivery_area'/);
  assert.doesNotMatch(css,/Cashfree|service_role|payments/);
});
