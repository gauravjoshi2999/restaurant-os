'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const burst=require('../assets/owner-order-burst.js');
const owner=fs.readFileSync('index.html','utf8');
function batch(n){
 return Array.from({length:n},(_,i)=>({
  id:'order-'+String(i+1).padStart(3,'0'),restaurant_id:'r1',channel:'Own Platform',
  is_demo:false,status:'Received',order_date:new Date(Date.UTC(2026,10,15,11,0,i)).toISOString()
 }));
}
for(const n of [2,5,20]){
 test('30s backup discovers all '+n+' dropped realtime INSERT events without duplicates',()=>{
  const rows=batch(n);
  assert.deepEqual(burst.unseenReceivedIds([...rows].reverse(),new Set(),'r1'),rows.map(o=>o.id));
  assert.deepEqual(burst.unseenReceivedIds(rows,new Set(rows.map(o=>o.id)),'r1'),[]);
  const known=new Set(rows.slice(0,2).map(o=>o.id));
  assert.deepEqual(burst.unseenReceivedIds(rows,known,'r1'),rows.slice(2).map(o=>o.id));
 });
}
test('Only this Owner restaurant, Received, real Bite website orders pass discovery',()=>{
 const rows=batch(6);
 rows[1].restaurant_id='r2';
 rows[2].status='Accepted';
 rows[3].is_demo=true;
 rows[4].channel='Swiggy';
 rows[5].channel='POS - Counter';
 assert.deepEqual(burst.unseenReceivedIds(rows,new Set(),'r1'),[rows[0].id]);
});
test('Stale rows, duplicate IDs and blank IDs never generate another alert',()=>{
 const rows=batch(3);
 rows.push({...rows[1]});
 rows.push({...rows[1],id:''});
 rows.push(null);
 assert.deepEqual(burst.unseenReceivedIds(rows,new Set([rows[0].id]),'r1'),[rows[1].id,rows[2].id]);
});
test('Missed order watch is a scoped foreground SELECT and never mutates live payments',()=>{
 const watch=owner.slice(owner.indexOf('async function checkOwnerMissedOrders(){'),
  owner.indexOf('window.setInterval(()=>{void checkOwnerMissedOrders();}',owner.indexOf('async function checkOwnerMissedOrders(){')));
 assert.ok(watch.startsWith('async function checkOwnerMissedOrders(){'));
 assert.match(watch,/ownerOrderWatchdogBusy/);
 assert.match(watch,/ownerOrderRefreshActive/);
 assert.match(watch,/ownerResumeRefreshActive/);
 assert.match(watch,/document\.visibilityState!=='visible'/);
 assert.match(watch,/access\.role!=='owner'/);
 assert.match(watch,/\.from\('orders'\)/);
 assert.match(watch,/\.select\('id,restaurant_id,channel,status,is_demo,order_date'\)/);
 assert.match(watch,/\.eq\('restaurant_id',restaurantId\)/);
 assert.match(watch,/\.eq\('channel','Own Platform'\)/);
 assert.match(watch,/\.eq\('status','Received'\)/);
 assert.match(watch,/\.eq\('is_demo',false\)/);
 assert.match(watch,/\.limit\(200\)/);
 assert.match(watch,/BiteOwnerOrderBurst\.unseenReceivedIds\(data,knownIds,restaurantId\)/);
 assert.match(watch,/currentUser\?\.id!==userId\|\|access\.restaurantId!==restaurantId/);
 assert.match(watch,/for\(const id of missing\)ownerOrderBurstTracker\.queue\(id\)/);
 assert.match(watch,/if\(missing\.length\|\|ownerOrderBurstTracker\.pendingCount\(\)\)scheduleOwnerOrderRefresh\(150\)/);
 assert.doesNotMatch(watch,/\.update\(|\.insert\(|\.delete\(|\.rpc\(|sb\.functions/);
 assert.match(owner,/window\.setInterval\(\(\)=>\{void checkOwnerMissedOrders\(\);\},30000\)/);
});
test('Full snapshot retains independent verified-paid gate before notifying',()=>{
 const p=owner.indexOf('async function refreshOwnerOrderSnapshot(){');
 const s=owner.slice(p,owner.indexOf('let ownerCancelAlertController=null;',p));
 assert.match(s,/loadCloudData\(\{silent:true,throwOnError:true\}\)/);
 assert.match(s,/BiteOwnerOrderBurst\.paidOrderIds\(state\.financials,restaurantId\)/);
 assert.match(s,/ownerOrderBurstTracker\.reconcile\([\s\S]*?order=>paid\.has\(String\(order\.id\)\)\)/);
 assert.equal(burst.paidOrderIds([{restaurant_id:'r1',order_id:'one',channel:'Own Platform',payment_status:'unpaid'}],'r1').has('one'),false);
});
