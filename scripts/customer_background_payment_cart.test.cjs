'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

const customer=fs.readFileSync('customer.html','utf8');
const start=customer.indexOf('async function finishVerifiedCheckout(result,options={}){');
const end=customer.indexOf('\nasync function verifyPendingLiveCheckout()',start);
assert.ok(start>0&&end>start,'The actual production checkout completion function must be present');
const code=customer.slice(start,end);

function fixture(config={}){
 const restaurant=config.restaurant||'restaurant-a';
 const cart={dish_a:2};
 const notes={dish_a:'less spicy'};
 const elements={};
 const element=(key)=>{
  if(elements[key])return elements[key];
  const classes=new Set(key==='checkoutFormPanel'?
   (config.checkoutOpen===false?['hidden']:[]):key==='checkoutModal'?
   (config.checkoutOpen===false?['hidden']:['show']):[]);
  elements[key]={
   value:'',
   classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)},
   remove:()=>{elements[key].removed=true}
  };
  return elements[key];
 };
 let updatedCart=0,refreshed=0,notices=0,navigation='',ordersLoaded=0,saved=0;
 const ux={freshCartRequested:config.fresh===true,resetResult:()=>{ux.resets=(ux.resets||0)+1}};
 const extras={
  savePendingCheckout:()=>{saved++},
  showPaymentVerifiedNotice:()=>{notices++}
 };
 const context={
  window:{BiteCheckoutUX:ux,BiteCustomerExtras:extras},
  pendingLiveCheckout:{
   id:'old-intent',restaurantId:config.oldRestaurant||'restaurant-a',
   cartSignature:config.oldSignature||'matching-cart'
  },
  checkoutRequestKey:'old-key',
  activeRestaurant:{id:restaurant},
  cart,itemNotes:notes,
  $:element,
  cartEntries:()=>Object.entries(context.cart),
  biteCheckoutCartSignature:()=>config.cartSignature||'matching-cart',
  renderCart:()=>{updatedCart++},
  syncCheckoutPaymentButton:()=>{},
  refreshCheckoutPaymentReadiness:()=>{refreshed++;return Promise.resolve(true)},
  showCustomerView:view=>{navigation=view},
  loadMyOrders:async()=>{ordersLoaded++}
 };
 vm.createContext(context);
 vm.runInContext(code,context);
 return {context,elements,ux,stats:()=>({updatedCart,refreshed,notices,navigation,ordersLoaded,saved}),
  finish:(options)=>context.finishVerifiedCheckout({status:'activated',order_id:'paid-old-order'},options)};
}

test('late payment success NEVER clears an identical newly edited cart while new checkout is open',async()=>{
 const x=fixture({fresh:true,checkoutOpen:true});
 await x.finish({background:true});
 assert.deepEqual({...x.context.cart},{dish_a:2});
 assert.deepEqual({...x.context.itemNotes},{dish_a:'less spicy'});
 assert.equal(x.context.pendingLiveCheckout,null);
 assert.equal(x.context.checkoutRequestKey,null);
 assert.equal(x.ux.freshCartRequested,false);
 assert.equal(x.elements.checkoutModal.classList.contains('show'),true,'do not hide new checkout form');
 assert.equal(x.stats().updatedCart,0,'no accidental cart reset');
 assert.equal(x.stats().refreshed,1,'new cart payment readiness is rechecked');
 assert.equal(x.stats().notices,1);
 assert.equal(x.stats().navigation,'');
});

test('late payment success also preserves fresh identical cart while user browses menu',async()=>{
 const x=fixture({fresh:true,checkoutOpen:false});
 await x.finish({background:true});
 assert.deepEqual({...x.context.cart},{dish_a:2});
 assert.deepEqual({...x.context.itemNotes},{dish_a:'less spicy'});
 assert.equal(x.stats().updatedCart,0);
 assert.equal(x.stats().notices,1);
 assert.equal(x.stats().navigation,'');
});

test('normal verified payment still clears the completed, unmodified old cart',async()=>{
 const x=fixture({fresh:false,checkoutOpen:true});
 await x.finish();
 assert.deepEqual({...x.context.cart},{});
 assert.deepEqual({...x.context.itemNotes},{});
 assert.equal(x.stats().updatedCart,1);
 assert.equal(x.stats().navigation,'orders');
 assert.equal(x.stats().ordersLoaded,1);
 assert.equal(x.elements.checkoutModal.classList.contains('hidden'),true);
});

test('verified order from a different restaurant never clears current restaurant cart',async()=>{
 const x=fixture({fresh:false,oldRestaurant:'restaurant-b',checkoutOpen:false});
 await x.finish({background:true});
 assert.deepEqual({...x.context.cart},{dish_a:2});
 assert.deepEqual({...x.context.itemNotes},{dish_a:'less spicy'});
 assert.equal(x.stats().updatedCart,0);
});

test('unverified checkout cannot clear cart, complete order or navigate to orders',async()=>{
 const x=fixture({fresh:true});
 await assert.rejects(()=>x.context.finishVerifiedCheckout({status:'awaiting_payment',order_id:'x'},
  {background:true}),/Payment verification pending/);
 assert.deepEqual({...x.context.cart},{dish_a:2});
 assert.equal(x.context.pendingLiveCheckout.id,'old-intent');
 assert.equal(x.stats().ordersLoaded,0);
});
