'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const burst=require('../assets/owner-order-burst.js');

const restaurant='r-A';
const order=(id,status='Received')=>({
 id,restaurant,channel:'Own Platform',status,isDemo:false,createdAt:'2026-11-15T11:00:00Z'
});
const money=(id,status='paid',rest=restaurant,channel='Own Platform')=>({
 order_id:id,restaurant_id:rest,channel,payment_status:status
});
test('Financial evidence must be paid, Own Platform, and the exact restaurant',()=>{
 const snapshots=[
  money('paid-A'),money('pending-A','pending'),
  money('wrong-restaurant','paid','r-B'),money('other-channel','paid',restaurant,'POS - Counter'),
  money('unpaid-A','unpaid')
 ];
 assert.deepEqual([...burst.paidOrderIds(snapshots,restaurant)],['paid-A']);
});
test('Simultaneous orders retain unpaid IDs and alert each order once after verified payment',()=>{
 const t=burst.createTracker(),batch=Array.from({length:20},(_,i)=>order('id-'+i));
 const paid=new Set(batch.slice(0,10).map(o=>o.id));
 batch.forEach(o=>t.queue(o.id));
 assert.equal(t.take(batch,restaurant,o=>paid.has(o.id)).length,10);
 assert.equal(t.pendingCount(),10);
 assert.deepEqual(t.pendingIds(),batch.slice(10).map(o=>o.id));
 const later=new Set(batch.map(o=>o.id));
 assert.deepEqual(t.take(batch,restaurant,o=>later.has(o.id)).map(o=>o.id),
  batch.slice(10).map(o=>o.id));
 assert.equal(t.pendingCount(),0);
 assert.deepEqual(t.take(batch,restaurant,o=>later.has(o.id)),[]);
});
test('Reconnect can recover missed paid orders while keeping unpaid ones pending',()=>{
 const t=burst.createTracker(),before=[order('existing')];
 const after=[...before,order('received-1'),order('received-2')];
 const paid=new Set(['received-2']);
 assert.deepEqual(t.reconcile(before,after,restaurant,o=>paid.has(o.id)).map(o=>o.id),['received-2']);
 assert.deepEqual(t.pendingIds(),['received-1']);
 paid.add('received-1');
 assert.deepEqual(t.reconcile(after,after,restaurant,o=>paid.has(o.id)).map(o=>o.id),['received-1']);
});
test('Cancelled/unowned/demo rows must never trigger late notifications',()=>{
 const t=burst.createTracker(),orders=[order('cancelled','Cancelled'),order('other'),order('demo')];
 orders[1].restaurant='r-B';orders[2].isDemo=true;
 orders.forEach(o=>t.queue(o.id));
 assert.deepEqual(t.take(orders,restaurant,()=>true),[]);
 assert.equal(t.pendingCount(),0);
});
test('Unverified alert is bounded; no abandoned order can chime hours later',()=>{
 let clock=0;
 const t=burst.createTracker({now:()=>clock}),o=order('late');
 assert.equal(burst.MAX_PENDING_AGE_MS,25*60*1000);
 t.queue(o.id);
 clock=burst.MAX_PENDING_AGE_MS-1;
 assert.deepEqual(t.take([o],restaurant,()=>false),[]);
 assert.equal(t.pendingCount(),1);
 clock=burst.MAX_PENDING_AGE_MS;
 assert.equal(t.pendingCount(),0);
 assert.deepEqual(t.take([o],restaurant,()=>true),[]);
});
test('A failed cloud refresh must propagate for alert safety and avoid repeated modal alerts',()=>{
 const page=fs.readFileSync('index.html','utf8');
 assert.match(page,/async function loadCloudData\(options=\{\}\)/);
 assert.match(page,/if\(!options\.silent\)alert\('Cloud data load nahi hua/);
 assert.match(page,/if\(options\.throwOnError\)throw err/);
 const refresh=page.slice(page.indexOf('async function refreshOwnerOrderSnapshot(){'),
  page.indexOf('let ownerCancelAlertController=null;'));
 assert.match(refresh,/await loadCloudData\(\{silent:true,throwOnError:true\}\)/);
 assert.match(refresh,/BiteOwnerOrderBurst\.paidOrderIds\(state\.financials,restaurantId\)/);
 assert.match(refresh,/order=>paid\.has\(String\(order\.id\)\)/);
 assert.match(refresh,/ownerOrderBurstTracker\.pendingCount\(\)/);
});
test('Subscribed/network reconnect refreshes order snapshot without re-subscribing forever',()=>{
 const page=fs.readFileSync('index.html','utf8');
 const realtime=page.slice(page.indexOf('function startRealtimeOrderUpdates(){'),
  page.indexOf('/* Android/WebView can suspend Realtime'));
 const catchup=page.slice(page.indexOf('async function catchUpOwnerLiveOrders(){'),
  page.indexOf("document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')",page.indexOf('async function catchUpOwnerLiveOrders(){')));
 assert.match(realtime,/status==='SUBSCRIBED'/);
 assert.match(realtime,/void catchUpOwnerLiveOrders\(\)/);
 assert.match(realtime,/ownerRealtimeDisconnected=false/);
 assert.match(catchup,/if\(ownerRealtimeDisconnected\|\|!orderRealtimeChannel\)startRealtimeOrderUpdates\(\)/);
 assert.match(catchup,/order=>paid\.has\(String\(order\.id\)\)/);
 assert.match(page,/window\.addEventListener\('online'/);
 assert.match(page,/window\.addEventListener\('offline'/);
 assert.match(page,/window\.setInterval\(/);
});
