'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createStore}=require('../assets/customer-notification-center.js');
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
 assert.match(html,/assets\/customer-notification-center\.js\?v=20261119-feed1/);
 assert.match(html,/assets\/customer-notification-center\.css\?v=20261119-feed1/);
 assert.match(html,/not saved notification history or phone push/i);
 assert.match(center,/bite:verified-order-update/);
 assert.match(styles,/body\[data-bite-app="customer"\]/);
 assert.match(styles,/@media\(max-width:360px\)/);
});
