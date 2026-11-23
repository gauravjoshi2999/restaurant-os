'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createStore,fetchVerifiedOrderHistory}=require('../assets/customer-notification-center.js');
const {createController}=require('../assets/customer-inapp-order-alerts.js');
const html=fs.readFileSync('customer.html','utf8');
const styles=fs.readFileSync('assets/customer-notification-center.css','utf8');
const center=fs.readFileSync('assets/customer-notification-center.js','utf8');

test('only owned, verified updates are retained for the active customer',()=>{
 const store=createStore();store.setUser('customer-A');
 assert.equal(store.record({userId:'customer-B',orderId:'o1',status:'Ready',label:'Ready'}),false);
 assert.equal(store.record({userId:'customer-A',orderId:'',status:'Ready',label:'Ready'}),false);
 assert.equal(store.record({userId:'customer-A',orderId:'o1',status:'Ready',label:'Order ready'}),true);
 assert.equal(store.snapshot().unread,1);
 assert.equal(store.snapshot().items[0].orderId,'o1');
});

test('mark seen is item-specific and mark-all does not invent notifications',()=>{
 const s=createStore();s.setUser('A');
 s.record({userId:'A',orderId:'o1',status:'Accepted',label:'Accepted'});
 s.record({userId:'A',orderId:'o2',status:'Preparing',label:'Preparing'});
 const id=s.snapshot().items[0].id;
 assert.equal(s.markSeen(id),true);assert.equal(s.snapshot().unread,1);
 assert.equal(s.markSeen(id),false);assert.equal(s.markAllSeen(),true);
 assert.equal(s.snapshot().unread,0);assert.equal(s.markAllSeen(),false);
});

test('sign-out and cross-account switches destroy old notifications',()=>{
 const s=createStore();s.setUser('A');
 s.record({userId:'A',orderId:'secret',status:'Ready',label:'Ready'});
 s.setUser('B');assert.equal(s.snapshot().unread,0);assert.deepEqual(s.snapshot().items,[]);
 assert.equal(s.record({userId:'A',orderId:'secret',status:'Delivered',label:'Delivered'}),false);
 s.setUser(null);assert.equal(s.snapshot().userId,null);
});

test('recent updates are bounded to 30 and never saved as persistent history',()=>{
 const s=createStore();s.setUser('A');
 for(let i=0;i<40;i++)s.record({userId:'A',orderId:'order-'+i,status:'Ready',label:'Ready'});
 assert.equal(s.snapshot().items.length,30);
 assert.equal(s.snapshot().items[0].orderId,'order-39');
 assert.doesNotMatch(center,/localStorage|sessionStorage|PushManager|Notification\.requestPermission/);
});

test('verified status changes populate center without requiring toast opt-in',()=>{
 const center=[];
 const c=createController(()=>{},row=>center.push(row));
 c.setUser('A');c.seed([{id:'o1',status:'Accepted'}],'A');
 c.setEnabled(false);
 assert.equal(c.onUpdate({new:{id:'o1',customer_id:'A',status:'Preparing'}},'A'),false);
 assert.equal(center.length,1);
 assert.equal(center[0].orderId,'o1');
 assert.equal(center[0].status,'Preparing');
 assert.equal(c.onUpdate({new:{id:'o1',customer_id:'A',status:'Preparing'}},'A'),false);
 assert.equal(center.length,1,'duplicate status cannot add notifications');
 assert.equal(c.onUpdate({new:{id:'o1',customer_id:'B',status:'Ready'}},'A'),false);
 assert.equal(center.length,1,'other customer does not add notifications');
});

test('unknown or first-seen statuses are not falsely reported as new events',()=>{
 const events=[];
 const c=createController(()=>{},event=>events.push(event));c.setUser('A');c.setEnabled(true);
 assert.equal(c.onUpdate({new:{id:'o1',customer_id:'A',status:'Ready'}},'A'),false);
 assert.equal(c.onUpdate({new:{id:'o1',customer_id:'A',status:'UNKNOWN_FUTURE_STATUS'}},'A'),true);
 assert.equal(events.length,0);
});

test('customer loads notification center and remains explicit about unsupported channels',()=>{
 assert.match(html,/id="biteNotificationFeed"/);
 assert.match(html,/id="biteNotificationEntries"/);
 assert.match(html,/id="biteNotificationMarkRead"/);
 assert.match(html,/id="biteNotificationBell"/);
 assert.match(html,/id="biteNotificationBadge" hidden/);
 assert.match(html,/openAccountView\('notifications'\)/);
 assert.match(html,/BiteAccountHub\?\.navigate\?\.\('notifications'\)/);
 assert.match(styles,/#biteNotificationBadge\[hidden\]/);
 assert.match(html,/id="biteNotificationAll"/);
 assert.match(html,/id="biteNotificationUnread"/);
 assert.match(styles,/\.bite-notification-tabs button\[aria-pressed="true"\]/);
 assert.match(html,/assets\/customer-notification-center\.js\?v=20261119-feed1/);
 assert.match(html,/assets\/customer-notification-center\.css\?v=20261119-feed1/);
 assert.match(html,/not saved notification history or phone push/i);
 assert.match(center,/bite:verified-order-update/);
 assert.match(styles,/body\[data-bite-app="customer"\]/);
 assert.match(styles,/@media\(max-width:360px\)/);
});

const historyOrderId='00000000-0000-4000-8000-000000000011';
const otherOrderId='00000000-0000-4000-8000-000000000099';
function historyFixture({orders=[{id:historyOrderId,customer_id:'customer-A',order_code:'BITE-TEST'}],events=[
 {id:'event-1',order_id:historyOrderId,to_status:'Ready',changed_at:'2026-11-19T00:00:00Z'}
],orderError=null,eventError=null}={}){
 const calls=[];
 const client={from(table){
  const request={table,where:[],selected:'',limit:0};
  const chain={
   select(fields){request.selected=fields;return chain;},
   eq(field,value){request.where.push([field,value]);return chain;},
   in(field,value){request.where.push([field,value]);return chain;},
   order(){return chain;},
   limit(limit){
    request.limit=limit;calls.push(request);
    if(table==='orders')return Promise.resolve({data:orders,error:orderError});
    if(table==='order_status_history')return Promise.resolve({data:events,error:eventError});
    throw Error('Unexpected table '+table);
   }
  };return chain;
 }};
 return {client,calls};
}
test('historical order updates are fetched read-only for only the signed-in customer',async()=>{
 const x=historyFixture({events:[
  {id:'owned',order_id:historyOrderId,to_status:'Ready',changed_at:'2026-11-19T00:00:00Z'}
 ]});
 const rows=await fetchVerifiedOrderHistory(x.client,'customer-A');
 assert.equal(rows.length,1);
 assert.equal(rows[0].orderCode,'BITE-TEST');
 assert.equal(rows[0].status,'Ready');
 assert.deepEqual(x.calls.map(x=>x.table),['orders','order_status_history']);
 assert.deepEqual(x.calls[0].where,[['customer_id','customer-A']]);
 assert.equal(x.calls[0].limit,30);
 assert.equal(x.calls[1].limit,60);
 assert.deepEqual(x.calls[1].where,[['order_id',[historyOrderId]]]);
});
test('history never makes a cross-account query without a customer ID',async()=>{
 const x=historyFixture();
 assert.deepEqual(await fetchVerifiedOrderHistory(x.client,null),[]);
 assert.equal(x.calls.length,0);
});
test('history without owned orders makes no broad order-status query',async()=>{
 const x=historyFixture({orders:[]});
 assert.deepEqual(await fetchVerifiedOrderHistory(x.client,'customer-A'),[]);
 assert.deepEqual(x.calls.map(x=>x.table),['orders']);
});
test('failed database reads cannot be displayed as verified history',async()=>{
 const x=historyFixture({eventError:new Error('Network failed')});
 await assert.rejects(fetchVerifiedOrderHistory(x.client,'customer-A'),/Network failed/);
 const y=historyFixture({orderError:new Error('Orders inaccessible')});
 await assert.rejects(fetchVerifiedOrderHistory(y.client,'customer-A'),/Orders inaccessible/);
 assert.equal(y.calls.length,1);
});
test('read-only historical activity stays separate from visit-only unread and resists account switching',()=>{
 assert.match(center,/historyPanel\.id='biteVerifiedOrderHistory'/);
 assert.match(center,/Past verified order activity/);
 assert.match(center,/read-only server history/i);
 assert.match(center,/\+\+historyRequest;historyList\.replaceChildren\(\)/);
 assert.match(center,/request!==historyRequest\|\|store\.snapshot\(\)\.userId!==userId/);
 assert.doesNotMatch(center,/\.from\('order_status_history'\)[\s\S]*?\.insert\(/);
 assert.doesNotMatch(center,/localStorage|sessionStorage|PushManager|Notification\.requestPermission/);
});


test('history assets are cache-versioned and every account switch clears old activity',()=>{
 const center=fs.readFileSync('assets/customer-notification-center.js','utf8');
 assert.match(html,/customer-notification-center\\.js\\?v=20261123-verified-scope1/);
 assert.match(html,/customer-notification-center\.css\?v=20261119-feed1-history2/);
 assert.match(center,/syncUser:id=>\{revision\+\+;useSession/);
 assert.match(center,/win\.setTimeout\(\(\)=>\{if\(store\.snapshot\(\)\.userId===next/);
});


test('saved history rejects mismatched customers and duplicated returned orders even when query was scoped',async()=>{
 for(const orders of [
  [{id:historyOrderId,customer_id:'customer-B',order_code:'PRIVATE'}],
  [{id:historyOrderId,customer_id:'customer-A',order_code:'OK'},{id:historyOrderId,customer_id:'customer-A',order_code:'DUP'}],
  null,
  [{id:historyOrderId,customer_id:'customer-A',order_code:''}]
 ]) {
  const x=historyFixture({orders});
  await assert.rejects(fetchVerifiedOrderHistory(x.client,'customer-A'),/could not be verified/);
  assert.deepEqual(x.calls.map(c=>c.table),['orders'],'do not query event history for unverified orders');
 }
});
test('saved history rejects cross-account, duplicate, missing and malformed event responses',async()=>{
 const base={id:'event-1',order_id:historyOrderId,to_status:'Ready',changed_at:'2026-11-19T00:00:00Z'};
 for(const events of [
  [{...base,order_id:otherOrderId}],
  [base,base],
  null,
  [{...base,to_status:''}],
  [{...base,changed_at:'invalid'}]
 ]) await assert.rejects(fetchVerifiedOrderHistory(historyFixture({events}).client,'customer-A'),/could not be verified/);
});
