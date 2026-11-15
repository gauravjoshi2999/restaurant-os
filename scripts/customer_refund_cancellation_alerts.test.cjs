'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const refund=require('../assets/customer-refund-tracker.js');
const ownerAlerts=require('../assets/owner-cancellation-alerts.js');
const customer=fs.readFileSync('customer.html','utf8');
const owner=fs.readFileSync('index.html','utf8');
const old=ref=>({id:'a',amount:1,status:'Cancelled',payment_status:'paid',...ref});
test('new paid cancellation approved by Owner shows refund recorded, not paid or bank credited',()=>{
 const job={amount:1,status:'pending_approval',provider_status:null,provider_checked_at:null};
 const view=refund.classify(old(),job,{status:'Approved'});
 assert.equal(view.kind,'waiting');
 assert.match(view.title,/waiting for processing/);
 assert.match(view.note,/NOT been sent/);
 const details=refund.details(old(),job,{status:'Approved'});
 assert.match(details,/Refund authorisation/);
 assert.match(details,/Awaiting review/);
 assert.match(details,/Cashfree refund status/);
 assert.match(details,/Not verified/);
 assert.match(details,/does NOT start from cancellation approval/);
 assert.doesNotMatch(details,/Refund successful at Cashfree/);
});
test('pending cancellation request is distinct from refund initiation',()=>{
 const view=refund.classify({id:'a',status:'Accepted'},null,{status:'Pending'});
 assert.match(view.title,/Cancellation request pending/);
 assert.match(view.note,/not been refunded/);
 assert.equal(refund.classify({id:'a',status:'Accepted'},null,null),null);
});
test('submitted and processing are never misrepresented as bank credit',()=>{
 for(const status of ['processing','submitted']){
  const job={amount:1,status,provider_status:'PENDING',provider_checked_at:'2026-11-15T11:39:00Z'};
  const html=refund.details(old(),job,{status:'Approved'});
  assert.match(html,/Bank .* credit/);
  assert.match(html,/Not independently confirmed by Bite/);
  assert.doesNotMatch(html,/Bank credited|Money arrived|Bank confirmed/);
 }
});
test('only trusted Cashfree SUCCESS with checked timestamp can show provider success',()=>{
 const base={amount:1,status:'succeeded',provider_status:'SUCCESS',provider_checked_at:'2026-11-15T12:00:00Z'};
 assert.match(refund.classify(old(),base).title,/Refund successful at Cashfree/);
 assert.doesNotMatch(refund.classify(old(),{...base,provider_checked_at:null}).title,/successful/);
 assert.doesNotMatch(refund.classify(old(),{...base,provider_status:'PENDING'}).title,/successful/);
 assert.match(refund.details(old(),base),/Bank .* credit/);
});
test('provider reference is never displayed without provider confirmation or mislabeled as bank UTR',()=>{
 const ref={amount:1,status:'approved',provider_refund_id:'bite_rf_abc<script>',provider_checked_at:null};
 assert.doesNotMatch(refund.details(old(),ref),/bite_rf_abc/);
 const verified={...ref,status:'submitted',provider_status:'PENDING',provider_checked_at:'2026-11-15T12:00:00Z'};
 const html=refund.details(old(),verified);
 assert.match(html,/Cashfree refund ID \(not bank UTR\)/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/&lt;script&gt;/);
});
test('customer status is read with existing customer RLS plus customer session scope, never a platform-wide query',()=>{
 assert.match(customer,/sb\.from\('bite_refund_jobs'\)/);
 assert.match(customer,/\.eq\('customer_id',requestedCustomerId\)\.in\('order_id',ids\)/);
 assert.match(customer,/biteCurrentOrderRequest\(orderRequestId,requestedCustomerId\)/);
 assert.match(customer,/biteRefundByOrder\.clear\(\);biteCancellationByOrder\.clear\(\)/);
 assert.match(customer,/BiteRefundTracker\?\.details/);
 assert.match(customer,/data-refresh-refund-id/);
 assert.match(customer,/customer-refund-tracker\.css/);
});
test('owner notification is bound to one signed-in restaurant and has one-tap cancellation review',()=>{
 assert.match(owner,/startOwnerCancellationAlerts\(\)/);
 assert.match(owner,/stopOwnerCancellationAlerts\(\)/);
 assert.match(owner,/showPage\('orders'\)/);
 assert.match(owner,/loadCustomerOrderRequestsWorkspace\(\)/);
 assert.match(owner,/BiteOwnerCancellationAlerts\.create/);
 assert.match(owner,/orderId:String\(request.order_id\)/);
});
function fakeDoc(){
 const nodes=new Map();
 const el=()=>({
  hidden:false,textContent:'',children:[],removed:false,
  setAttribute(){},remove(){this.removed=true},
  addEventListener(event,fn){this.events??={};this.events[event]=fn},
  querySelector(sel){return this.nodes?.[sel]||null},
  prepend(child){this.children.unshift(child)}
 });
 const container=el();
 const doc={visibilityState:'visible',createElement(){
  const n=el();const copy=el(),button=el();
  n.nodes={'.bite-cancel-alert-copy':copy,button};
  nodes.set('copy',copy);nodes.set('notice',n);nodes.set('button',button);return n;
 },getElementById(){return container},addEventListener(){},removeEventListener(){}};
 return {doc,nodes,container};
}
test('owner alert shows pending requests on login but notifies only new IDs, once, within its restaurant',async()=>{
 const f=fakeDoc();let rows=[{id:'old',order_id:'A',restaurant_id:'R1',request_type:'cancel_request',status:'Pending'}];
 let ctx={userId:'u1',role:'owner',restaurantId:'R1'};
 const notices=[];let opens=0;const queried=[];
 const client={from(name){
  assert.equal(name,'restaurant_customer_order_requests');
  const q={where:{},select(){return q},eq(field,value){q.where[field]=value;return q},
   order(){return q},limit(){queried.push({...q.where});
    return Promise.resolve({data:rows.filter(r=>Object.entries(q.where).every(([key,val])=>r[key]===val)),error:null})}};
  return q;
 }};
 const ctrl=ownerAlerts.create({client,doc:f.doc,getContext:()=>ctx,onNotify:r=>notices.push(r.id),onOpen:()=>{opens++},intervalMs:60000});
 ctrl.start();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ctrl.pendingCount(),1);
 assert.deepEqual(notices,[],'initially pending requests should not ring repeatedly at login');
 rows.push({id:'new',order_id:'B',restaurant_id:'R1',request_type:'cancel_request',status:'Pending'});
 await ctrl.refresh();
 assert.deepEqual(notices,['new']);
 await ctrl.refresh();assert.deepEqual(notices,['new']);
 f.nodes.get('button').events.click();assert.equal(opens,1);
 assert.equal(queried[0].restaurant_id,'R1');
 ctx={userId:'u2',role:'owner',restaurantId:'R2'};rows=[];
 await ctrl.refresh();assert.equal(ctrl.pendingCount(),0);
 ctrl.stop();assert.equal(f.nodes.get('notice').removed,true);
});
