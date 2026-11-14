'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
function between(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing '+start);
 return html.slice(a,b);
}
const state=between('let checkoutPaymentReady=false,checkoutPaymentBusy=false,pendingLiveCheckout=null;','function biteCheckoutCartSignature(');
const verify=between('async function verifyPendingLiveCheckout(){','async function continueLiveCheckout(){');
const readiness=between('async function refreshCheckoutPaymentReadiness(){','async function finishVerifiedCheckout(');
const continuation=between('async function continueLiveCheckout(){','// Authenticated server-side cancellation');
const cancel=between('async function cancelPendingCustomerCheckout(options={}){','async function submitCustomerOrder(){');
const session=between('function setCustomerSession(session){','async function sendCustomerPasswordResetLink(){');
function deferred(){
 let release,notify;
 const started=new Promise(resolve=>notify=resolve);
 const promise=new Promise(resolve=>release=resolve);
 return {started,promise,release,notify};
}
function makeContext(values={}){
 const ctx=vm.createContext({console,Date,Promise,clearTimeout(){},setTimeout(){},...values});
 vm.runInContext(state+
  'globalThis.setPending=p=>{pendingLiveCheckout=p;};'+
  'globalThis.pending=()=>pendingLiveCheckout;'+
  'globalThis.switchAccount=()=>{bitePaymentAccountSequence++;pendingLiveCheckout=null;};'+
  'globalThis.paymentState=()=>({ready:checkoutPaymentReady,sequence:bitePaymentAccountSequence});',ctx);
 return ctx;
}
function dom(){
 const entries=new Map();
 const get=id=>{
  if(!entries.has(id))entries.set(id,{
   value:'',textContent:'',innerHTML:'',disabled:false,
   classList:{add(){},remove(){},contains(){return false;}},
   remove(){},setAttribute(){}
  });
  return entries.get(id);
 };
 return get;
}
test('stale verification for account A never confirms a payment for account B',async()=>{
 const d=deferred();let saves=0;
 const ctx=makeContext({
  sb:{functions:{invoke:async()=>{d.notify();return d.promise;}}},
  window:{BiteCustomerExtras:{savePendingCheckout(){saves++;}}}
 });
 vm.runInContext(verify+'globalThis.verify=verifyPendingLiveCheckout;',ctx);
 ctx.setPending({id:'intent-a'});
 const check=ctx.verify();
 await d.started;
 ctx.switchAccount();
 d.release({data:{status:'activated',order_id:'order-a'},error:null});
 await assert.rejects(check,/Account changed during payment status check/);
 assert.equal(ctx.pending(),null);
 assert.equal(saves,0);
});
test('gateway readiness from an old account never unlocks Pay online',async()=>{
 const d=deferred();
 const ctx=makeContext({
  sb:{functions:{invoke:async()=>{d.notify();return d.promise;}}},
  BITE_SANDBOX_CHECKOUT:false,Cashfree:()=>({}),
  syncCheckoutPaymentButton(){}
 });
 vm.runInContext(readiness+'globalThis.readiness=refreshCheckoutPaymentReadiness;',ctx);
 const task=ctx.readiness();
 await d.started;
 ctx.switchAccount();
 d.release({data:{ready:true,provider:'cashfree',environment:'production'},error:null});
 assert.equal(await task,false);
 assert.equal(ctx.paymentState().ready,false);
});
test('late Cashfree session cannot open the SDK after account change',async()=>{
 const d=deferred();let opened=0;
 const ctx=makeContext({
  BITE_SANDBOX_CHECKOUT:false,
  sb:{functions:{invoke:async(name)=>{assert.equal(name,'bite-live-create-session');d.notify();return d.promise;}}},
  refreshCheckoutPaymentReadiness:async()=>true,
  Cashfree:()=>({checkout:async()=>{opened++;}}),
  window:{BiteCustomerExtras:{savePendingCheckout(){}}},
  $:()=>({textContent:''}),syncCheckoutPaymentButton(){}
 });
 vm.runInContext(continuation+'globalThis.resume=continueLiveCheckout;',ctx);
 ctx.setPending({id:'intent-a',intentCreatedAt:new Date().toISOString(),started:false,verifyOnly:false,session:null,expectedAmount:100});
 const task=ctx.resume();
 await d.started;
 ctx.switchAccount();
 d.release({data:{payment_session_id:'session-a',amount:100,currency:'INR',
   issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+1200000).toISOString()}});
 await task;
 assert.equal(opened,0);
});
test('late cancellation cannot activate the previous account order in a new session',async()=>{
 const d=deferred(),get=dom();let activated=0;
 const ctx=makeContext({
  sb:{functions:{invoke:async()=>{d.notify();return d.promise;}}},
  window:{BiteCheckoutUX:{cancelBusy:false},BiteCustomerExtras:{savePendingCheckout(){}}},
  $:get,finishVerifiedCheckout:async()=>{activated++;},
  syncCheckoutPaymentButton(){},renderCart(){}
 });
 vm.runInContext(cancel+'globalThis.cancel=cancelPendingCustomerCheckout;',ctx);
 ctx.setPending({id:'intent-a'});
 const task=ctx.cancel();
 await d.started;
 ctx.switchAccount();
 d.release({data:{status:'activated',order_id:'order-a'},error:null});
 await task;
 assert.equal(activated,0);
 assert.equal(ctx.pending(),null);
});
test('direct Account A to B transition clears private modal and pending intent',()=>{
 const get=dom();let cleared=0,restored=null;
 const ctx=makeContext({
  activeCustomerId:'customer-a',customerOrders:[{id:'order-a'}],expandedOrderId:'order-a',
  customerAccountViewSequence:1,customerOrderViewSequence:2,biteCheckoutOpenSequence:3,
  accountAddressRows:[{id:'address-a'}],checkoutAddresses:[{id:'address-a'}],
  checkoutRequestKey:'key-a',checkoutQuotedTotal:500,appliedCheckoutCoupon:{code:'OLD'},
  checkoutPaymentBusy:true,checkoutPaymentReady:true,biteCancelFollowupTimer:null,
  favouriteRestaurantIds:new Set(),orderChannel:null,
  $:get,resetAddrForm(){},setupOrderRealtime(){},showCustomerView(){},
  window:{BiteCheckoutUX:{freshCartRequested:true,cancelBusy:true,resetResult(){}},
   BiteCustomerExtras:{
    clearSensitiveState(){cleared++;},
    loadFavourites(){},
    restorePendingCheckout(id){restored=id;}
   }}
 });
 ctx.setPending({id:'private-intent-a'});
 get('checkoutName').value='Private A';get('checkoutPhone').value='secret number';
 get('checkoutSummary').textContent='Old order summary';
 vm.runInContext(session+'globalThis.applySession=setCustomerSession;',ctx);
 ctx.applySession({user:{id:'customer-b',email:'b@example.com',user_metadata:{}}});
 assert.equal(ctx.activeCustomerId,'customer-b');
 assert.equal(ctx.pending(),null);
 assert.equal(ctx.paymentState().sequence,1);
 assert.equal(ctx.checkoutRequestKey,null);
 assert.equal(get('checkoutName').value,'');
 assert.equal(get('checkoutPhone').value,'');
 assert.equal(get('checkoutSummary').textContent,'');
 assert.equal(cleared,1);
 assert.equal(restored,'customer-b');
 assert.equal(ctx.customerOrders.length,0);
 assert.equal(ctx.window.BiteCheckoutUX.freshCartRequested,false);
});
