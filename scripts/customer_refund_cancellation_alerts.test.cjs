'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const refund=require('../assets/customer-refund-tracker.js');
const ownerAlerts=require('../assets/owner-cancellation-alerts.js');
const customer=fs.readFileSync('customer.html','utf8');
const owner=fs.readFileSync('index.html','utf8');
const old=ref=>({id:'a',amount:1,status:'Cancelled',payment_status:'paid',...ref});
test('paid cancelled refund awaiting approval is compact and does not claim an initiation',()=>{
 const job={amount:1,status:'pending_approval',provider_status:null,provider_checked_at:null};
 const info=refund.classify(old(),job,{status:'Approved'});
 assert.equal(info.kind,'waiting');
 assert.equal(info.title,'Refund under review');
 assert.match(info.note,/received your refund request/);
 const card=refund.summary(old(),job,{status:'Approved'});
 assert.match(card,/Refund under review/);
 assert.match(card,/₹1/);
 assert.doesNotMatch(card,/View details for refund tracking|Bank.*not independently|Cashfree/);
 const details=refund.details(old(),job,{status:'Approved'});
 assert.match(details,/<ol class="bite-refund-steps"/);
 assert.equal((details.match(/class="bite-refund-step-marker"/g)||[]).length,3);
 assert.match(details,/<span>Requested<\/span>/);
 assert.match(details,/<span>Initiated<\/span>/);
 assert.match(details,/<span>Processed<\/span>/);
 assert.match(details,/timeframe starts after initiation/);
 assert.doesNotMatch(details,/5–7 working days of initiation/);
 assert.doesNotMatch(details,/Refund processed/);
});
test('pending customer cancellation is distinct from refund submission',()=>{
 const info=refund.classify({id:'a',status:'Accepted'},null,{status:'Pending'});
 assert.equal(info.title,'Cancellation requested');
 assert.match(info.note,/Waiting for the restaurant/);
 assert.equal(refund.classify({id:'a',status:'Accepted'},null,null),null);
});
test('approved but not initiated is still a waiting state',()=>{
 const info=refund.classify(old(),{amount:1,status:'approved',approved_at:'2026-11-15T11:39:00Z'});
 assert.equal(info.title,'Refund approved');
 assert.equal(info.stage,0);
 const detail=refund.details(old(),{amount:1,status:'approved'});
 assert.doesNotMatch(detail,/<li class="is-done"[^>]*>.*?<span>Initiated<\/span>/s);
});
test('processing/submitted are not misrepresented as bank credited',()=>{
 const cases=[
 {amount:1,status:'processing',provider_status:null,provider_checked_at:null},
 {amount:1,status:'submitted',provider_status:'PENDING',provider_checked_at:'2026-11-15T11:39:00Z'}
 ];
 for(const job of cases){
  const detail=refund.details(old(),job,{status:'Approved'});
  assert.match(detail,/original payment method|Original payment method/i);
  assert.doesNotMatch(detail,/Bank credited|Money arrived|Bank confirmed/);
  assert.doesNotMatch(detail,/Refund processed/);
 }
 assert.equal(refund.classify(old(),cases[1]).title,'Refund initiated');
 assert.equal(refund.classify(old(),cases[0]).title,'Refund processing');
});
test('only independently checked Cashfree SUCCESS can show provider success, not bank credit',()=>{
 const base={amount:1,status:'succeeded',provider_status:'SUCCESS',provider_checked_at:'2026-11-15T12:00:00Z'};
 assert.equal(refund.classify(old(),base).title,'Refund processed');
 assert.notEqual(refund.classify(old(),{...base,provider_checked_at:null}).title,'Refund processed');
 assert.notEqual(refund.classify(old(),{...base,provider_status:'PENDING'}).title,'Refund processed');
 const detail=refund.details(old(),base);
 assert.match(detail,/Cashfree has confirmed SUCCESS/);
 assert.match(detail,/credit may still take time/);
 assert.doesNotMatch(detail,/Bank credited/);
});
test('sensitive provider ID lives in collapsed help only, with HTML encoding',()=>{
 const job={amount:1,status:'submitted',provider_status:'PENDING',provider_checked_at:'2026-11-15T12:00:00Z',provider_refund_id:'bite_rf_abc<script>'};
 const card=refund.summary(old(),job);
 assert.doesNotMatch(card,/bite_rf_abc|Cashfree/);
 const detail=refund.details(old(),job);
 assert.match(detail,/<details class="bite-refund-help"><summary>Payment details &amp; help<\/summary>/);
 assert.match(detail,/Cashfree refund ID \(not bank UTR\)/);
 assert.doesNotMatch(detail,/<script>/);
 assert.match(detail,/&lt;script&gt;/);
 assert.doesNotMatch(refund.details(old(),{...job,provider_checked_at:null}),/bite_rf_abc/);
});
test('customer details put compact refund first, order items next, and full history collapsed',()=>{
 const from=customer.indexOf('async function loadOrderDetail(');
 const detail=customer.slice(from,from+5300);
 const refundAt=detail.indexOf('const refundCard=');
 const itemsAt=detail.indexOf('const itemCard=');
 const historyAt=detail.indexOf('const activity=');
 assert.ok(refundAt>0&&itemsAt>refundAt&&historyAt>itemsAt);
 assert.match(detail,/target\.innerHTML=refundCard\+itemCard\+activity/);
 assert.match(detail,/<details class="bite-order-activity">/);
 assert.doesNotMatch(detail,/Order cancelled\. Refund is not shown as completed/);
 assert.match(customer,/customer-refund-tracker\.js\?v=20261115-compact2/);
 assert.match(customer,/customer-refund-tracker\.css\?v=20261115-compact2/);
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
