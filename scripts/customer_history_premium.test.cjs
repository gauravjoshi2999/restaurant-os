'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const script=fs.readFileSync('assets/customer-history-premium.js','utf8');
const css=fs.readFileSync('assets/customer-history-premium.css','utf8');

function setup(){
 const handlers={};
 const makeButton=(filter)=>({
   dataset:{biteHistoryFilter:filter},attributes:{},setAttribute(k,v){this.attributes[k]=v;}
 });
 const buttons=['all','active','completed','cancelled'].map(makeButton);
 const resetButton={};
 const cards=[
   {code:'BITE-101',restaurant:'Hotel Maharani Palace',status:'Received'},
   {code:'BITE-102',restaurant:'Royal Thali House',status:'Completed'},
   {code:'BITE-103',restaurant:'Bajrang Food Court',status:'Cancelled'},
   {code:'BITE-104',restaurant:'Madhuli',status:'Unknown status'}
 ].map(data=>({
   hidden:false,
   querySelector(selector){
     const value=selector==='.ordercode'?data.code:selector==='.orderrestaurant'?data.restaurant:selector==='.orderstatus'?data.status:null;
     return value===null?null:{textContent:value};
   }
 }));
 const toolbar={
   addEventListener(name,callback){handlers['toolbar:'+name]=callback;},
   querySelectorAll(){return buttons;}
 };
 const input={
   value:'',
   addEventListener(name,callback){handlers['input:'+name]=callback;},
   focus(){this.focused=true;}
 };
 const elements={
   biteHistoryToolbar:toolbar,
   biteHistorySearch:input,
   ordersList:{querySelectorAll(){return cards;}},
   biteHistoryCount:{textContent:''},
   biteHistoryNoMatches:{
     hidden:true,
     querySelector(){return {
       addEventListener(name,callback){handlers['reset:'+name]=callback;}
     };}
   }
 };
 const context={
   document:{getElementById(id){return elements[id]||null;}},
   window:{},
   Set,Array,String
 };
 vm.runInNewContext(script,context);
 return {api:context.window.BiteHistoryPremium,elements,buttons,cards,handlers,input};
}
test('history controls, scope and preserved order actions are wired',()=>{
 for(const id of ['biteHistoryToolbar','biteHistorySearch','biteHistoryCount','biteHistoryNoMatches'])
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
 assert.match(html,/window\.BiteHistoryPremium\?\.applyFilters\(\)/);
 assert.match(html,/assets\/customer-history-premium\.js\?v=20261114-history1/);
 assert.match(html,/assets\/customer-history-premium\.css\?v=20261114-history1/);
 assert.match(html,/data-reorder=/);
 assert.match(html,/data-invoice=/);
});
test('status groups distinguish real active, completed, cancelled and unknown values',()=>{
 const {api}=setup();
 assert.equal(api.groupFor('Received'),'active');
 assert.equal(api.groupFor('Handed Over'),'active');
 assert.equal(api.groupFor('Preparing'),'active');
 assert.equal(api.groupFor('Completed'),'completed');
 assert.equal(api.groupFor('Delivered'),'completed');
 assert.equal(api.groupFor('Rejected'),'cancelled');
 assert.equal(api.groupFor('Unknown status'),'other');
});
test('filters and search are instant, non-destructive, resettable',()=>{
 const {api,elements,cards,handlers,input,buttons}=setup();
 assert.equal(api.applyFilters().visible,4);
 handlers['toolbar:click']({target:{closest(){return buttons[1];}}});
 assert.deepEqual(cards.map(c=>c.hidden),[false,true,true,true]);
 assert.equal(buttons[1].attributes['aria-pressed'],'true');
 handlers['toolbar:click']({target:{closest(){return buttons[2];}}});
 assert.deepEqual(cards.map(c=>c.hidden),[true,false,true,true]);
 input.value='no match';
 handlers['input:input']();
 assert.equal(elements.biteHistoryNoMatches.hidden,false);
 assert.equal(elements.biteHistoryCount.textContent,'Showing 0 of 4 orders');
 handlers['reset:click']();
 assert.equal(input.value,'');
 assert.equal(input.focused,true);
 assert.equal(api.applyFilters().visible,4);
 input.value='BITE-103';handlers['input:input']();
 assert.deepEqual(cards.map(c=>c.hidden),[true,true,false,true]);
});
test('history script never queries another tenant, changes order status, or touches checkout',()=>{
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.doesNotMatch(script,/sb\.|fetch\(|localStorage|sessionStorage|payment_|Cashfree|createOrder|updateOrder/i);
 assert.match(css,/\.ordercard\[hidden\]/);
 assert.match(css,/min-height:44px/);
});
test('customer food cards reserve layout space while remaining lazy and async',()=>{
 assert.match(html,/<div class="cover"><img loading="lazy" decoding="async" width="640" height="400" src=/);
 assert.match(html,/<img class="menuphoto" loading="lazy" decoding="async" width="120" height="104"/);
 assert.match(html,/id="biteRestaurantHeroImage"[^>]*loading="lazy"/);
 assert.match(html,/src="assets\/food\/meal-1100\.jpg"[^>]*fetchpriority="high"/);
});
