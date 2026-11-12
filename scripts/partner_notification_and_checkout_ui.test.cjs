'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const owner=fs.readFileSync('index.html','utf8');
const customer=fs.readFileSync('customer.html','utf8');

function nativeOrderAction(action='Accepted',restaurantId='22222222-2222-4222-8222-222222222222'){
 const orderId='11111111-1111-4111-8111-111111111111';
 const orders=[{id:orderId,restaurant:restaurantId,status:'Received',code:'BITE-TEST'}];
 const operations=[],tabs=[],prompts=[];
 const ctx={
  window:{Capacitor:{Plugins:{BiteOwnerPush:{consumeOrderAction:async()=>({
   order_id:orderId,restaurant_id:restaurantId,action
  })}}}},
  access:{role:'owner',restaurantId},
  currentUser:{id:'33333333-3333-4333-8333-333333333333'},state:{orders},
  loadCloudData:async()=>{},
  sb:{rpc:async(name,args)=>{operations.push({name,args});orders[0].status=action;return{data:{ok:true,status:action}}}},
  showOrderLiveToast:()=>{},showPage:()=>{},setOrderStatus:tab=>tabs.push(tab),
  confirm:()=>{throw Error('Accept action must not require a second confirmation');},
  prompt:message=>{prompts.push(message);return 'Not available';},console
 };
 const start=owner.indexOf('let ownerNativeActionBusy=false;');
 const end=owner.indexOf("window.addEventListener('focus'",start);
 assert(start>=0&&end>start);
 vm.createContext(ctx);
 vm.runInContext(owner.slice(start,end),ctx);
 return {ctx,operations,tabs,prompts,orderId};
}

test('one Android Accept action calls the authenticated server exactly once and opens Accepted orders',async()=>{
 const t=nativeOrderAction();
 await t.ctx.handlePendingNativeOwnerAction();
 assert.equal(t.operations.length,1);
 assert.equal(t.operations[0].name,'bite_owner_notification_order_action');
 assert.equal(t.operations[0].args.p_action,'Accepted');
 assert.equal(t.operations[0].args.p_reason,null);
 assert.deepEqual(t.tabs,['Accepted']);
 assert.equal(t.prompts.length,0);
});
test('Android Reject still requires a reason and never silently rejects',async()=>{
 const t=nativeOrderAction('Rejected');
 await t.ctx.handlePendingNativeOwnerAction();
 assert.equal(t.prompts.length,1);
 assert.equal(t.operations.length,1);
 assert.equal(t.operations[0].args.p_reason,'Not available');
});
test('notification remains restaurant scoped and never bypasses owner RPC authorization',()=>{
 assert.match(owner,/pending.restaurant_id!==access.restaurantId/);
 assert.match(owner,/bite_owner_notification_order_action/);
 assert.match(owner,/payment_not_verified/);
 assert.match(owner,/id="ownerNotificationSoundSettings"/);
 assert.match(owner,/openNotificationSettings/);
});

function paymentControls(){
 const nodes=new Map();
 const get=id=>{
  if(!nodes.has(id)){
   const classes=new Set(['hidden']);
   nodes.set(id,{
    disabled:false,textContent:'',dataset:{},
    setAttribute(){},
    classList:{
     toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name);},
     contains:name=>classes.has(name)
    }
   });
  }
  return nodes.get(id);
 };
 const code=customer.slice(
  customer.indexOf('function syncCheckoutPaymentButton(){'),
  customer.indexOf('async function refreshCheckoutPaymentReadiness()')
 );
 const ctx={
  pendingLiveCheckout:{id:'checkout-new',started:false,verifyOnly:false},
  checkoutPaymentBusy:true,checkoutPaymentReady:true,
  BITE_SANDBOX_CHECKOUT:false,window:{BiteCheckoutUX:{}},
  $:get,document:{querySelectorAll:()=>[]}
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {ctx,get};
}
test('new Cashfree checkout hides old-checkout cancellation during gateway handoff',()=>{
 const t=paymentControls();
 t.ctx.syncCheckoutPaymentButton();
 assert.equal(t.get('quickCancelCheckout').classList.contains('hidden'),true);
 assert.equal(t.get('checkPendingPaymentBtn').classList.contains('hidden'),true);
 assert.equal(t.get('placeOrderBtn').textContent,'Opening secure payment…');
 t.ctx.checkoutPaymentBusy=false;
 t.ctx.pendingLiveCheckout.started=true;
 t.ctx.syncCheckoutPaymentButton();
 assert.equal(t.get('quickCancelCheckout').classList.contains('hidden'),false,
  'Recovery actions remain available if the provider returns without a confirmed payment');
});
