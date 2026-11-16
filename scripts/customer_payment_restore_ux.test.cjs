'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/customer-completion.js','utf8');
const html=fs.readFileSync('customer.html','utf8');
const start=source.indexOf(' async function restorePendingCheckout(userId){');
const end=source.indexOf(' async function loadFavourites(){',start);
assert.ok(start>=0&&end>start,'Source must contain real checkout recovery function');
const restore=source.slice(start,end);

function fixture(response,options={}){
 let requests=0,notices=0,banners=0,saves=0,autoChecks=0,warnings=0;
 const nodes=new Map();
 const get=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',
   removed:false,remove(){this.removed=true;},
   classList:{toggle(){},add(){},remove(){}}});
  return nodes.get(id);
 };
 const stored=options.saved||{customerId:'user-1',id:'intent-1',key:'key-1',
  restaurantId:'restaurant-1',intentCreatedAt:'2026-11-16T00:00:00Z',
  expectedAmount:174,started:true};
 const db={select(){return this;},eq(){return this;},async maybeSingle(){requests++;
  return typeof response==='function'?response():response;}};
 const ctx=vm.createContext({
  BITE_SANDBOX_CHECKOUT:false,
  activeCustomerId:'user-1',pendingLiveCheckout:null,checkoutRequestKey:null,
  restoreToken:0,lastRestoreAttemptKey:null,recoveryBusy:false,
  readPending:()=>stored,
  sb:{from(table){assert.equal(table,'bite_live_checkout_intents');return db;}},
  $:get,document:{querySelectorAll(){return[];}},
  restaurants:[{id:'restaurant-1',name:'Verified restaurant'}],
  safe:v=>String(v),money:v=>'₹'+Number(v),biteCheckoutCartSignature:()=>'<signature>',
  savePendingCheckout(){saves++;},
  renderPendingPaymentBanner(){banners++;},
  checkPendingCustomerPayment({background}){assert.equal(background,true);autoChecks++;},
  notice(){notices++;},
  console:{warn(){warnings++;}}
 });
 vm.runInContext(restore+'globalThis.restore=restorePendingCheckout;',ctx);
 return {ctx,stored,get,run:(user='user-1')=>ctx.restore(user),
  stats:()=>({requests,notices,banners,saves,autoChecks,warnings})};
}

test('failed background lookup never displays repeated toast, never deletes uncertain checkout',async()=>{
 const x=fixture({data:null,error:{message:'Temporary network issue'}});
 await x.run();await x.run();await x.run();
 assert.equal(x.stats().requests,1,'restore must be coalesced across duplicate login callbacks');
 assert.equal(x.stats().notices,0,'background error must not show an alarming toast');
 assert.equal(x.stats().banners,1,'show only a contextual reminder');
 assert.equal(x.stats().autoChecks,0,'do not chain verification on failed lookup');
 assert.equal(x.ctx.pendingLiveCheckout.id,'intent-1','pending intent remains recoverable');
 assert.equal(x.ctx.pendingLiveCheckout.verifyOnly,true,'prevent unsafe provider resubmission');
 assert.equal(x.ctx.pendingLiveCheckout.restoreUnavailable,true);
 assert.equal(x.ctx.checkoutRequestKey,'key-1');
 assert.equal(x.stats().saves,0,'failed lookup must not overwrite valid local recovery');
});
test('failed lookup with checkout key only never invents payment result or reminder',async()=>{
 const x=fixture({data:null,error:{message:'offline'}},
  {saved:{customerId:'user-1',key:'key-only'}});
 await x.run();await x.run();
 assert.equal(x.stats().notices,0);
 assert.equal(x.stats().banners,0);
 assert.equal(x.stats().requests,1);
 assert.equal(x.ctx.pendingLiveCheckout,null);
 assert.equal(x.ctx.checkoutRequestKey,'key-only');
});
test('server-confirmed terminal status can safely retire a stale local payment',async()=>{
 const x=fixture({data:{id:'intent-1',status:'expired'},error:null});
 await x.run();
 assert.equal(x.ctx.pendingLiveCheckout,null);
 assert.equal(x.ctx.checkoutRequestKey,null);
 assert.equal(x.stats().saves,1);
 assert.equal(x.stats().notices,0);
 assert.equal(x.stats().autoChecks,0);
});
test('valid unresolved intent is restored and verified once in background',async()=>{
 const x=fixture({data:{
   id:'intent-1',status:'awaiting_payment',provider_order_id:'cashfree-order-1',
   amount:174,restaurant_id:'restaurant-1',created_at:'2026-11-16T00:00:00Z',
   delivery_type:'delivery',priced_items:[{menu_item_id:'item-1',item_name:'Thali',
    unit_price:174,quantity:1}],delivery_fee:0,discount_amount:0,
   customer_snapshot:{full_name:'Test'},address_snapshot:{label:'Home'},
   customer_note:'No chillies'
  },error:null});
 await x.run();await x.run();
 assert.equal(x.stats().requests,1);
 assert.equal(x.stats().autoChecks,1);
 assert.equal(x.stats().banners,1);
 assert.equal(x.stats().notices,0);
 assert.equal(x.ctx.pendingLiveCheckout.id,'intent-1');
 assert.equal(x.ctx.pendingLiveCheckout.verifyOnly,true);
 assert.match(x.get('checkoutSummary').innerHTML,/Thali/);
});
test('late lookup must not show account A payment in account B session',async()=>{
 let resolve;
 const pending=new Promise(r=>{resolve=r;});
 const x=fixture(()=>pending);
 const task=x.run();
 x.ctx.activeCustomerId='user-2';
 x.ctx.restoreToken++;
 x.ctx.pendingLiveCheckout=null;
 resolve({data:{id:'intent-1',status:'awaiting_payment'},error:null});
 await task;
 assert.equal(x.ctx.pendingLiveCheckout,null);
 assert.equal(x.stats().banners,0);
 assert.equal(x.stats().autoChecks,0);
 assert.equal(x.stats().notices,0);
});
test('account switch clears attempt guard and mobile cache loads corrected script',()=>{
 assert.match(source,/lastRestoreAttemptKey=null;recoveryBusy=false/);
 assert.match(html,/assets\/customer-completion\.js\?v=20261116-payment-restore1/);
 assert.doesNotMatch(restore,/notice\('Could not check the previous payment/);
 assert.match(source,/restoreUnavailable\?'Previous payment status unavailable'/);
 assert.match(source,/lastRestoreAttemptKey=null;recoveryBusy=false;pendingLiveCheckout=null/);
});
