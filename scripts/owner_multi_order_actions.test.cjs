'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const queue=require('../assets/owner-orders-workspace.js');
const html=fs.readFileSync('index.html','utf8');
function order(id,status,minute){
 return {id,status,createdAt:new Date(Date.UTC(2026,10,15,10,minute)).toISOString()};
}
test('Owner All puts unanswered orders first, oldest first, then newest handled orders',()=>{
 const input=[order('done','Completed',29),order('new3','Received',13),
  order('preparing','Preparing',28),order('new1','Received',11),order('new2','Received',12)];
 const expected=['new1','new2','new3','done','preparing'];
 assert.deepEqual(queue.sortQueue(input,'all','owner').map(x=>x.id),expected);
 assert.equal(input[0].id,'done','render sorting must never mutate persisted input records');
});
test('Owner New is FIFO, handled stages remain newest-first, Admin view unchanged',()=>{
 const input=[order('new3','Received',13),order('new1','Received',11),order('new2','Received',12)];
 assert.deepEqual(queue.sortQueue(input,'new','owner').map(x=>x.id),['new1','new2','new3']);
 assert.deepEqual(queue.sortQueue(input,'all','super_admin').map(x=>x.id),['new3','new2','new1']);
 assert.deepEqual(queue.sortQueue(input,'preparing','owner').map(x=>x.id),['new3','new2','new1']);
});
test('Owner Order board reuses shared FIFO queue and existing independent per-order action lock',()=>{
 const board=html.slice(html.indexOf('function renderOrderBoard(){'),html.indexOf('function ',html.indexOf('function renderOrderBoard(){')+30));
 assert.match(board,/BiteOwnerOrders\.sortQueue\(/);
 assert.match(html,/const active=BiteOwnerOrders\.sortQueue\(ownerOrders\.filter/);
 assert.match(html,/const ownerOrderActionsPending=new Set\(\)/);
 assert.match(html,/ownerOrderActionsPending\.has\(id\)/);
 assert.match(html,/ownerOrderActionsPending\.delete\(id\)/);
});
test('Each acceptance transition is scoped to restaurant and expected source status',()=>{
 const accept=html.slice(html.indexOf('async function acceptAndStartOrder(id){'),html.indexOf('async function advanceOrder(id,next){'));
 assert.match(accept,/\.eq\('id',id\)\.eq\('restaurant_id',access\.restaurantId\)\.eq\('status',from\)\.select\('id,status'\)\.maybeSingle\(\)/);
 assert.match(accept,/if\(!data\|\|data\.status!==to\)throw/);
});
test('Every other Owner status action uses atomic compare-and-set; stale devices refresh',()=>{
 const action=html.slice(html.indexOf('async function advanceOrder(id,next){'),html.indexOf('function paymentSummaryFor(orderId)',html.indexOf('async function advanceOrder(id,next){')));
 assert.match(action,/\.eq\('id',id\)\.eq\('restaurant_id',access\.restaurantId\)\.eq\('status',o\.status\)/);
 assert.match(action,/\.select\('id,status'\)\.maybeSingle\(\)/);
 assert.match(action,/if\(!changed\)\{alert\('Ye order kisi aur device se update ho chuka hai/);
 assert.match(action,/await loadCloudData\(\)/);
 assert.doesNotMatch(action,/\.update\(\{status:next,status_note:note\}\)\.eq\('id',id\);/);
});
