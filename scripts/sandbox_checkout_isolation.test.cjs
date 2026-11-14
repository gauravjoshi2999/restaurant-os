'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','customer.html'),'utf8');
const begin=html.indexOf('async function submitCustomerOrder(){');
const end=html.indexOf('// BITE CHECKOUT PAYMENT END',begin);
assert.ok(begin>=0 && end>begin,'Customer checkout function exists');
const source=html.slice(begin,end);

function harness({sandbox=true,loggedIn=true,livePending=false,verification=true}={}){
 const calls=[];
 const elements=new Map();
 const $=id=>{
  if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false});
  return elements.get(id);
 };
 $('checkoutName').value='Sandbox Tester';
 $('checkoutPhone').value='9999999999';
 $('customerNote').value='';
 const sb={
  auth:{getSession:async()=>({data:{session:loggedIn?{user:{id:'test-customer-id'}}:null}})},
  rpc:async(name,args)=>{calls.push({kind:'rpc',name,args});return {data:'synthetic-draft-1',error:null}},
  functions:{invoke:async(name,args)=>{
   calls.push({kind:'invoke',name,args});
   if(name==='cashfree-sandbox-draft-checkout')return {data:{payment_session_id:'synthetic-session'},error:null};
   if(name==='cashfree-sandbox-verify-draft')return {data:{verified:verification,status:verification?'SANDBOX_PAID':'ACTIVE'},error:null};
   throw Error('Unexpected function: '+name);
  }}
 };
 const ctx={
  BITE_SANDBOX_CHECKOUT:sandbox,checkoutPaymentBusy:false,bitePaymentAccountSequence:0,
  pendingLiveCheckout:livePending?{id:'synthetic-production-pending'}:null,
  window:{BiteCustomerExtras:{isRecovering:()=>false}},
  $,sb,activeRestaurant:{id:'restaurant-test-id'},cartEntries:()=>[['dish-test-id',2]],cartInstructionSnapshot:()=>({note:$('customerNote').value.trim(),tooLong:false}),
  checkoutMode:()=> 'pickup',refreshCheckoutPaymentReadiness:async()=>true,
  syncCheckoutPaymentButton:()=>{},
  Cashfree:({mode})=>{calls.push({kind:'sdk-mode',mode});return{checkout:async opts=>{calls.push({kind:'sdk-checkout',opts});return{}}}},
  localStorage:{setItem:(key,value)=>calls.push({kind:'storage',key,value})},
  biteRefreshSandboxStatus:()=>calls.push({kind:'refresh-status'}),
  getCheckoutDeliveryZone:async()=>{throw Error('Pickup must not need delivery zone')},
  crypto:{randomUUID:()=> 'synthetic-key'},
 };
 vm.createContext(ctx);
 vm.runInContext(source+';globalThis.runCheckout=submitCustomerOrder;',ctx);
 return {run:ctx.runCheckout,calls,el:$,ctx};
}

test('sandbox mode is opt-in, never default production checkout',()=>{
 assert.match(html,/get\('sandbox_checkout'\)==='1'/);
 assert.match(source,/BITE_SANDBOX_CHECKOUT\?'create_bite_sandbox_order_draft':'bite_prepare_checkout_v2'/);
 assert.match(source,/Cashfree\(\{mode:'sandbox'\}\)/);
 assert.match(source,/cashfree-sandbox-verify-draft/);
});

test('simulated sandbox checkout uses only test draft, test session and test verifier',async()=>{
 const h=harness();
 await h.run();
 assert.deepEqual(h.calls.filter(c=>c.kind==='rpc').map(c=>c.name),['create_bite_sandbox_order_draft']);
 assert.deepEqual(h.calls.filter(c=>c.kind==='invoke').map(c=>c.name),['cashfree-sandbox-draft-checkout','cashfree-sandbox-verify-draft']);
 assert.equal(h.calls.find(c=>c.kind==='sdk-mode').mode,'sandbox');
 assert.equal(h.calls.find(c=>c.kind==='sdk-checkout').opts.paymentSessionId,'synthetic-session');
 assert.ok(!h.calls.some(c=>String(c.name).includes('live')||c.mode==='production'));
 assert.match(h.el('checkoutError').textContent,/Test payment successful/);
});

test('sandbox unverified state does not claim paid or create a live order',async()=>{
 const h=harness({verification:false});
 await h.run();
 assert.doesNotMatch(h.el('checkoutError').textContent,/Test payment successful/);
 assert.match(h.el('checkoutError').textContent,/Test payment not confirmed yet/);
 assert.ok(!h.calls.some(c=>c.kind==='storage'));
});

test('a live pending payment cannot silently become sandbox payment',async()=>{
 const h=harness({livePending:true});
 await h.run();
 assert.match(h.el('checkoutError').textContent,/Sandbox mode mein live payment resume nahi hoga/);
 assert.equal(h.calls.filter(c=>c.kind==='rpc'||c.kind==='invoke'||c.kind==='sdk-mode').length,0);
});

test('no authentication never starts a test or production payment session',async()=>{
 const h=harness({loggedIn:false});
 await h.run();
 assert.match(h.el('checkoutError').textContent,/Please login again/);
 assert.equal(h.calls.filter(c=>['rpc','invoke','sdk-mode'].includes(c.kind)).length,0);
});
