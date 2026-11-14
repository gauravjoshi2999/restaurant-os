'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Discovery=require('../assets/customer-discovery.js');
const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-premium.css','utf8');
const js=fs.readFileSync('assets/customer-premium.js','utf8');

test('premium assets are linked only by the customer storefront',()=>{
  assert.match(html,/assets\/customer-premium\.css\?v=20261114-premium1/);
  assert.match(html,/assets\/customer-premium\.js\?v=20261114-premium1/);
  assert.match(css,/body\[data-bite-app="customer"\]/);
  assert.doesNotMatch(css,/body\[data-bite-app="workspace"\]/);
});
test('location picker preserves existing PIN form and can be dismissed',()=>{
  for(const id of ['biteLocationOpen','biteLocationSheet','biteSheetClose','biteSheetPinForm','biteSavedAddressList','biteSheetGeo']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
  }
  assert.match(js,/byId\('discoveryLocationForm'\)\.requestSubmit\(\)/);
  assert.match(js,/sb\.from\('customer_addresses'\)/);
  assert.match(js,/locationSheet\.addEventListener\('keydown'/);
  assert.match(html,/aria-modal="true" aria-labelledby="biteSheetTitle"/);
});
test('search suggestions use existing serviceability-aware public discovery',()=>{
  assert.match(js,/BiteDiscovery\.selectRestaurants/);
  assert.match(js,/pin:typeof currentDiscoveryPin/);
  assert.match(js,/document\.createElement\('button'\)/);
  assert.doesNotMatch(js,/innerHTML\s*=/);
  const restaurants=[
    {id:'eligible',name:'Paneer House',serviceable:true,accepts_delivery:true,cuisine_tags:['North Indian']},
    {id:'out',name:'Paneer Corner',serviceable:false,accepts_delivery:true,cuisine_tags:['North Indian']}
  ];
  assert.deepEqual(
    Discovery.selectRestaurants(restaurants,[],{query:'paneer',pin:'313324',service:'delivery'}).map(x=>x.restaurant.id),
    ['eligible']
  );
});
test('progressive enhancement parses and does not modify payments',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.doesNotMatch(js,/Cashfree|create_order|checkoutPayment|placeOrderBtn|service_role/i);
});
test('keyboard navigation and reduced motion are present',()=>{
  assert.match(css,/:focus-visible/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(js,/event\.key==='Escape'/);
  assert.match(js,/event\.key==='ArrowDown'/);
});
