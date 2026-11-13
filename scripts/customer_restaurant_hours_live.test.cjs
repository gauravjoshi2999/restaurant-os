'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const BiteDiscovery=require('../assets/customer-discovery.js');
const html=fs.readFileSync('customer.html','utf8');
const owner=fs.readFileSync('index.html','utf8');
const restaurantId='262aaba7-f48b-4fa5-9ff6-b334ededca84';
const at2351=Date.UTC(2026,10,12,18,21,0); // IST 2026-11-12 23:51
const at0001=Date.UTC(2026,10,12,18,31,0); // IST 2026-11-13 00:01

test('10 AM to 12 AM (00:00) is OPEN at 11:51 PM IST, unlike 12 PM noon',()=>{
 const r={opening_time:'10:00:00',closing_time:'00:00:00'};
 assert.equal(BiteDiscovery.isClosed(r,at2351),false);
 assert.equal(BiteDiscovery.isClosed(r,at0001),true);
 assert.equal(BiteDiscovery.isClosed({...r,closing_time:'12:00:00'},at2351),true);
});
test('owner setting explicitly distinguishes midnight from noon',()=>{
 assert.match(owner,/12:00 AM \(00:00\) select karein\. 12:00 PM dopahar hai/);
});
function hoursHarness(options={}){
 const original={id:restaurantId,opening_time:'10:00:00',closing_time:'12:00:00',is_temporarily_closed:false};
 const rpcCalls=[],screens=[];
 const ctx={
  activeRestaurant:original,restaurants:[original],
  sb:{rpc:async name=>{
   rpcCalls.push(name);
   return options.error?{error:new Error('Offline')}:{data:[{
    id:restaurantId,opening_time:'10:00:00',closing_time:'00:00:00',
    is_temporarily_closed:false,temporary_closure_until:null,
    accepts_delivery:true,accepts_pickup:true,delivery_paused:false
   }]};
  }},
  $:id=>({classList:{contains:()=>false}}),
  renderCartModal:()=>{screens.push('render');},console
 };
 const start=html.indexOf('let biteCartHoursRequest=null');
 const end=html.indexOf('function cartEntries()',start);
 assert.ok(start>0&&end>start,'Live-hours code must exist before cart rendering');
 vm.createContext(ctx);
 vm.runInContext(html.slice(start,end),ctx);
 return {ctx,original,rpcCalls,screens};
}
test('cart refreshes stale 12 PM closing time from latest approved restaurant hours',async()=>{
 const t=hoursHarness();
 assert.equal(BiteDiscovery.isClosed(t.original,at2351),true);
 assert.equal(await t.ctx.refreshActiveRestaurantHoursForCart(),true);
 assert.equal(t.original.closing_time,'00:00:00');
 assert.equal(BiteDiscovery.isClosed(t.original,at2351),false);
 assert.deepEqual(t.rpcCalls,['list_public_restaurants']);
});
test('failed live-hours refresh cannot quietly authorize checkout with stale times',async()=>{
 const t=hoursHarness({error:true});
 assert.equal(await t.ctx.refreshActiveRestaurantHoursForCart(),false);
 assert.equal(t.original.closing_time,'12:00:00');
 assert.match(vm.runInContext('biteCartHoursError',t.ctx),/Dobara try karein/);
 assert.match(html,/if\(!await refreshActiveRestaurantHoursForCart\(\)\)return;/);
 assert.match(html,/if\(!cartEntries\(\)\.length\|\|biteCartHoursBusy\)return;/);
});
test('cart opening and checkout each check server hours, while payment continues behind a closed restaurant guard',()=>{
 const openCart=html.slice(html.indexOf('function openCartModal(){'),html.indexOf('function closeCartModal(){'));
 assert.match(openCart,/void refreshActiveRestaurantHoursForCart\(\)/);
 assert.match(html,/async function openCheckout\(\)\{\s*if\(activeRestaurant&&BiteDiscovery\.isClosed\(activeRestaurant\)\)/);
 assert.match(html,/\$\('cartCheckoutBtn'\)\.disabled=!entries\.length\|\|biteCartHoursBusy/);
});
