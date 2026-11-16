'use strict';
// Regression: a burst of independent customer orders must never bypass the
// authoritative per-order paid snapshot, or leak across restaurant tenants.
const test=require('node:test');
const assert=require('node:assert/strict');
const burst=require('../assets/owner-order-burst.js');

const RESTAURANT_A='restaurant-A';
const RESTAURANT_B='restaurant-B';
const order=(n,restaurant=RESTAURANT_A)=>({
 id:'paid-gate-order-'+n,restaurant,restaurant_id:restaurant,
 channel:'Own Platform',status:'Received',isDemo:false,
 createdAt:new Date(Date.UTC(2026,10,16,4,0,n)).toISOString()
});
const finance=(o,payment_status='paid',restaurant_id=o.restaurant)=>({
 order_id:o.id,restaurant_id,channel:'Own Platform',payment_status
});

test('five simultaneous new orders: only individually verified paid orders notify; the rest remain pending',()=>{
 const all=Array.from({length:5},(_,i)=>order(i+1));
 const tracker=burst.createTracker();
 for(const o of [...all].reverse())assert.equal(tracker.queue(o.id),true);
 const snapshots=all.map((o,i)=>finance(o,[0,2,4].includes(i)?'paid':'pending'));
 const initiallyPaid=burst.paidOrderIds(snapshots,RESTAURANT_A);
 assert.deepEqual(tracker.take(all,RESTAURANT_A,o=>initiallyPaid.has(o.id)).map(o=>o.id),
  [all[0].id,all[2].id,all[4].id]);
 assert.deepEqual(tracker.pendingIds().sort(),[all[1].id,all[3].id].sort());
 snapshots[1].payment_status='paid';
 const nextPaid=burst.paidOrderIds(snapshots,RESTAURANT_A);
 assert.deepEqual(tracker.take(all,RESTAURANT_A,o=>nextPaid.has(o.id)).map(o=>o.id),[all[1].id]);
 snapshots[3].payment_status='paid';
 const finalPaid=burst.paidOrderIds(snapshots,RESTAURANT_A);
 assert.deepEqual(tracker.take(all,RESTAURANT_A,o=>finalPaid.has(o.id)).map(o=>o.id),[all[3].id]);
 assert.equal(tracker.pendingCount(),0);
 assert.deepEqual(tracker.take(all,RESTAURANT_A,o=>finalPaid.has(o.id)),[]);
});

test('another restaurant paid row must never authorize the active restaurant notification',()=>{
 const one=order(1);
 const tracker=burst.createTracker();
 tracker.queue(one.id);
 const otherTenantPaid=burst.paidOrderIds([finance(one,'paid',RESTAURANT_B)],RESTAURANT_A);
 assert.equal(otherTenantPaid.has(one.id),false);
 assert.deepEqual(tracker.take([one],RESTAURANT_A,o=>otherTenantPaid.has(o.id)),[]);
 assert.equal(tracker.pendingCount(),1);
 const correctTenantPaid=burst.paidOrderIds([finance(one,'paid',RESTAURANT_A)],RESTAURANT_A);
 assert.deepEqual(tracker.take([one],RESTAURANT_A,o=>correctTenantPaid.has(o.id)).map(o=>o.id),[one.id]);
});

test('cancelled or demo order cannot announce when finance later changes to paid',()=>{
 const cancelled={...order(1),status:'Cancelled'};
 const demo={...order(2),is_demo:true};
 const otherTenant=order(3,RESTAURANT_B);
 const tracker=burst.createTracker();
 for(const o of [cancelled,demo,otherTenant])tracker.queue(o.id);
 const paid=burst.paidOrderIds([finance(cancelled),finance(demo),finance(otherTenant)],RESTAURANT_A);
 assert.deepEqual(tracker.take([otherTenant,demo,cancelled],RESTAURANT_A,o=>paid.has(o.id)),[]);
 assert.equal(tracker.pendingCount(),0,'ineligible IDs must be discarded rather than retried forever');
});

test('reconnect burst retains already-queued payment-pending IDs and announces only when paid',()=>{
 const before=[order(1)];
 const after=[order(1),order(2),order(3),order(4)];
 const tracker=burst.createTracker();
 tracker.queue(after[2].id);
 const partial=burst.paidOrderIds([finance(after[1]),finance(after[2],'pending'),finance(after[3])],RESTAURANT_A);
 const first=tracker.reconcile(before,after,RESTAURANT_A,o=>partial.has(o.id));
 assert.deepEqual(first.map(o=>o.id),[after[1].id,after[3].id]);
 assert.deepEqual(tracker.pendingIds(),[after[2].id]);
 const complete=burst.paidOrderIds([finance(after[1]),finance(after[2]),finance(after[3])],RESTAURANT_A);
 assert.deepEqual(tracker.reconcile(after,after,RESTAURANT_A,o=>complete.has(o.id)).map(o=>o.id),[after[2].id]);
 assert.deepEqual(tracker.reconcile(before,after,RESTAURANT_A,o=>complete.has(o.id)),[]);
});
