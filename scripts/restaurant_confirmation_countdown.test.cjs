'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const customer=fs.readFileSync('assets/customer-order-confirmation.js','utf8');
const owner=fs.readFileSync('assets/owner-order-confirmations.js','utf8');
const checkout=fs.readFileSync('customer.html','utf8');
const migration=fs.readFileSync('supabase/migrations/20261117070000_confirm_intent_payment_gate.sql','utf8');
const now=()=>new Date().toISOString();
const minutesBefore=n=>new Date(Date.now()-n*60000).toISOString();
const minutesAfter=n=>new Date(Date.now()+n*60000).toISOString();
function fixture(state='pending',intentMinutesAgo=1){
 const events=[],channels=[],timers=[];
 const row={intent_id:'test-intent',state,expires_at:minutesAfter(3),reviewed_at:state==='approved'?now():null};
 const db={
  from(name){assert.equal(name,'bite_order_confirmations');
   const q={select(){return q},eq(){return q},async maybeSingle(){return{data:{...row},error:null}}};return q;
  },
  channel(name){channels.push(name);return{on(){return this},subscribe(){return this}};},
  removeChannel(){},
  async rpc(name){assert.equal(name,'bite_request_order_confirmation');return{data:{...row},error:null}}
 };
 const context=vm.createContext({window:{},Date,console,setInterval:callback=>{timers.push(callback);return timers.length},clearInterval(){}});
 vm.runInContext(customer,context);
 const api=context.window.BiteOrderConfirmation;
 const watch=()=>api.watch(db,'test-intent',value=>events.push(value),
  minutesBefore(intentMinutesAgo));
 return{api,db,row,events,timers,watch,channels};
}
test('customer countdown progresses through pending, approved, rejected without paying',async()=>{
 const t=fixture();await t.api.request(t.db,'test-intent',v=>t.events.push(v));
 t.watch();assert.equal(t.api.view().state,'pending');
 assert.ok(t.api.view().seconds>0&&t.api.view().seconds<=180);
 t.row.state='approved';t.row.reviewed_at=now();await t.api.refresh();
 assert.equal(t.api.view().state,'approved');
 t.row.state='rejected';await t.api.refresh();
 assert.equal(t.api.view().state,'rejected');
 t.api.stop();assert.equal(t.api.view().state,'loading');
});
test('customer payment countdown respects original 15-minute checkout deadline',async()=>{
 const t=fixture('approved',16);t.watch();await t.api.refresh();
 assert.equal(t.api.view().state,'payment_expired');
 t.api.stop();
});
test('owner inbox ignores expired approval rows server-side and never labels them paid',()=>{
 assert.match(owner,/\.gte\('expires_at',new Date\(\)\.toISOString\(\)\)/);
 assert.match(owner,/data-bite-confirm="approved">Approve for payment/);
 assert.match(owner,/Payment: Waiting for your approval/);
 assert.doesNotMatch(owner,/\bPAID \(ONLINE\)/);
});
test('customer reopening matching pending cart never cancels or creates duplicate checkout',()=>{
 assert.match(checkout,/pendingLiveCheckout\.cartSignature===checkoutCartSignature/);
 assert.match(checkout,/window\.BiteCustomerConfirmationOpen\?\.\(\);return;/);
 assert.match(checkout,/window\.BiteOrderConfirmation\.assertApproved\(sb,pending\.id\)/);
 assert.match(checkout,/if\(pendingLiveCheckout\?\.confirmationRequired&&!pendingLiveCheckout\.started\)/);
});
test('backend marks confirmation gate before inserting approval snapshot',()=>{
 assert.match(migration,/SET confirmation_required = true/);
 assert.ok(migration.indexOf('SET confirmation_required = true')<
           migration.indexOf('INSERT INTO public.bite_order_confirmations'));
 assert.match(migration,/provider_order_id IS NULL AND provider_attempted_at IS NULL/);
});
