'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const burst=require('../assets/owner-order-burst.js');

function orders(n,restaurant='restaurant-A'){
 return Array.from({length:n},(_,i)=>({
  id:'order-'+String(i+1).padStart(3,'0'),
  restaurant,channel:'Own Platform',status:'Received',isDemo:false,
  createdAt:new Date(Date.UTC(2026,10,15,11,0,i)).toISOString()
 }));
}
for(const n of [2,5,20]){
 test(n+' simultaneous INSERT events each survive one debounced snapshot',()=>{
  const tracker=burst.createTracker(),batch=orders(n);
  for(const order of [...batch].reverse())assert.equal(tracker.queue(order.id),true);
  assert.equal(tracker.pendingCount(),n);
  assert.deepEqual(tracker.take(batch,'restaurant-A').map(o=>o.id),batch.map(o=>o.id));
  assert.equal(tracker.pendingCount(),0);
  assert.deepEqual(tracker.take(batch,'restaurant-A'),[]);
 });
}
test('Repeated INSERT, reconnect and redraw never duplicate an already announced order',()=>{
 const tracker=burst.createTracker(),batch=orders(2);
 tracker.queue(batch[0].id);tracker.queue(batch[0].id);tracker.queue(batch[1].id);
 assert.equal(tracker.take(batch,'restaurant-A').length,2);
 tracker.queue(batch[0].id);
 assert.deepEqual(tracker.reconcile([],batch,'restaurant-A'),[]);
 assert.equal(tracker.pendingCount(),0);
});
test('Reconnect recovers all missed orders exactly once, even if event was already queued',()=>{
 const tracker=burst.createTracker(),before=orders(1),after=orders(5);
 tracker.queue(after[2].id);
 const missed=tracker.reconcile(before,after,'restaurant-A');
 assert.deepEqual(missed.map(o=>o.id),after.slice(1).map(o=>o.id));
 assert.deepEqual(tracker.reconcile(before,after,'restaurant-A'),[]);
});
test('Only authenticated owner restaurant non-demo website Received records can alert',()=>{
 const tracker=burst.createTracker(),batch=orders(6);
 batch[1].restaurant='restaurant-B';
 batch[2].status='Preparing';
 batch[3].isDemo=true;
 batch[4].channel='Swiggy';
 batch[5].channel='POS - Counter';
 for(const order of batch)tracker.queue(order.id);
 assert.deepEqual(tracker.take(batch,'restaurant-A').map(o=>o.id),[batch[0].id]);
 assert.equal(tracker.pendingCount(),0);
});
test('Keep an order event when its DB row is temporarily absent, then resolve it later',()=>{
 const tracker=burst.createTracker(),batch=orders(2);
 tracker.queue(batch[1].id);
 assert.deepEqual(tracker.take(batch.slice(0,1),'restaurant-A'),[]);
 assert.equal(tracker.pendingCount(),1);
 assert.deepEqual(tracker.take(batch,'restaurant-A').map(o=>o.id),[batch[1].id]);
});
test('FIFO stays deterministic even when incoming events are received out of order',()=>{
 const tracker=burst.createTracker(),batch=orders(3);
 for(const i of [2,0,1])tracker.queue(batch[i].id);
 assert.deepEqual(tracker.take([batch[2],batch[0],batch[1]],'restaurant-A').map(o=>o.id),
  [batch[0].id,batch[1].id,batch[2].id]);
});
test('Owner HTML wires per-order tracker to both realtime and resume; no timestamp field mismatch',()=>{
 const page=fs.readFileSync('index.html','utf8');
 const realtime=page.slice(page.indexOf('function startRealtimeOrderUpdates(){'),
  page.indexOf('/* Android/WebView can suspend Realtime'));
 const catchup=page.slice(page.indexOf('async function catchUpOwnerLiveOrders(){'),
  page.indexOf("document.addEventListener('visibilitychange'",page.indexOf('async function catchUpOwnerLiveOrders(){')));
 assert.match(page,/assets\/owner-order-burst\.js\?v=/);
 assert.match(realtime,/ownerOrderBurstTracker\.queue\(row\.id\)/);
 assert.match(page,/BiteOwnerOrderBurst\.paidOrderIds\(state\.financials,restaurantId\)/);
 assert.match(page,/function announceOwnerOrderBurst\(orders\)/);
 assert.doesNotMatch(realtime,/const isNew=payload\.eventType/);
 assert.match(catchup,/ownerOrderBurstTracker\.reconcile\([\s\S]*?before,state\.orders,restaurantId,order=>paid\.has\(String\(order\.id\)\)\)/);
 assert.doesNotMatch(catchup,/Date\.parse\(order\.created_at/);
 assert.match(page,/ownerOrderBurstTracker\.reset\(\)/);
});
