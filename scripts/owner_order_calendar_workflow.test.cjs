const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const orders=require('../assets/owner-orders-workspace.js');
const navigation=require('../assets/owner-mobile-navigation.js');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/owner-orders-calendar.css','utf8');
const navSource=fs.readFileSync('assets/owner-mobile-navigation.js','utf8');
test('Calendar date counters use Asia/Kolkata day, not UTC, and filter locally',()=>{
 const rows=[
  {id:'a',createdAt:'2026-11-11T20:15:00Z'}, // 12 Nov 01:45 IST
  {id:'b',createdAt:'2026-11-12T17:00:00Z'}, // 12 Nov 22:30 IST
  {id:'c',createdAt:'2026-11-12T19:00:00Z'}, // 13 Nov 00:30 IST
  {id:'bad',createdAt:'bad date'}
 ];
 assert.equal(orders.dayKey(rows[0].createdAt),'2026-11-12');
 assert.equal(orders.dayKey(rows[2].createdAt),'2026-11-13');
 assert.equal(orders.dayKey(rows[3].createdAt),'');
 assert.deepEqual(orders.countByDay(rows),{'2026-11-12':2,'2026-11-13':1});
 assert.equal(orders.selectedDay(),null);
 assert.deepEqual(orders.dateFilter(rows),rows);
 assert.equal(orders.formatDay('2026-11-12').includes('Nov'),true);
 assert.match(css,/\.bite-date-cell\.has-orders/);
 assert.match(css,/#biteOwnerOrderCalendar|\.bite-owner-order-calendar/);
 assert.match(html,/bite-owner-order-date-change/);
});
test('One safe next step per order and handover/OTP remains explicit',()=>{
 assert.deepEqual(orders.nextStep({status:'Received'}),{key:'accept_and_prepare',label:'Accept & start cooking'});
 assert.deepEqual(orders.nextStep({status:'Accepted'}),{key:'Preparing',label:'Start cooking'});
 assert.deepEqual(orders.nextStep({status:'Preparing'}),{key:'Ready',label:'Food ready'});
 assert.equal(orders.nextStep({status:'Ready',deliveryType:'delivery'}).key,'share_handover');
 assert.equal(orders.nextStep({status:'Ready',deliveryType:'pickup'}).key,'Handed Over');
 assert.equal(orders.nextStep({status:'Handed Over',deliveryType:'delivery'}),null);
 assert.equal(orders.nextStep({status:'Handed Over',deliveryType:'pickup'}).key,'Completed');
 assert.equal(orders.nextStep({status:'Completed'}),null);
 assert.equal(orders.nextStep({status:'Rejected'}),null);
 assert.match(html,/async function acceptAndStartOrder\(id\)/);
 assert.match(html,/await change\('Received','Accepted'\)/);
 assert.match(html,/await change\('Accepted','Preparing'\)/);
 assert.match(html,/\.eq\('status',from\)\.select\('id,status'\)\.maybeSingle\(\)/);
 assert.match(html,/shareAndHandOverDelivery/);
 assert.match(html,/create_delivery_handoff/);
 assert.match(html,/confirm_delivery_handoff|Customer OTP verify hone par delivery complete hogi/);
});
test('Khata Open visibly navigates to chosen ledger and empty state is clear',()=>{
 assert.match(html,/id="khataLedgerSection" tabindex="-1"/);
 assert.match(html,/function selectKhataCustomer\(id\)/);
 assert.match(html,/ledger\.scrollIntoView\(/);
 assert.match(html,/ledger\.focus\(\{preventScroll:true\}\)/);
 assert.match(html,/data-khata-customer-id/);
 assert.match(html,/Is customer ke Khata mein abhi koi entry nahi hai/);
 assert.match(css,/#khataLedgerSection/);
});
test('More child Back returns to More before original tab, never routes to unrelated page',()=>{
 assert.equal(navigation.navigationState('owner','khata').active,'more');
 assert.match(navSource,/moreChildPage===currentPage\(\)/);
 assert.match(navSource,/openMore\(true\)/);
 assert.match(navSource,/moreEntryPage\|\|'overview'/);
 assert.match(navSource,/const target=history\.pop\(\)\|\|'overview'/);
 assert.match(html,/owner-mobile-navigation\.js\?v=20261114-more-back2/);
 assert.match(html,/owner-orders-workspace\.js\?v=20261114-calendar-openfix1/);
});

test('Choosing a marked calendar day opens its bills instead of trapping user in New (0)',()=>{
 const calendar=fs.readFileSync('assets/owner-orders-workspace.js','utf8');
 const dated=[
  {createdAt:'2026-11-06T12:00:00+05:30',status:'Completed'},
  {createdAt:'2026-11-12T12:00:00+05:30',status:'Completed'}
 ];
 assert.deepEqual(orders.countByDay(dated),{'2026-11-06':1,'2026-11-12':1});
 assert.equal(orders.counts(dated).new,0);
 assert.equal(orders.counts(dated).all,2);
 assert.match(calendar,/calendarOpened=false;\s*notifyDateChange\(doc\)/);
 assert.match(calendar,/board\.scrollIntoView\(/);
 assert.match(calendar,/const tally=counts\(dateFilter\(orders\)\)/);
 assert.match(html,/document\.addEventListener\('bite-owner-order-date-change',\(\)=>\{if\(access\.role==='owner'\)setOrderStatus\('all'\)\}\)/);
 assert.doesNotMatch(html,/if\(access\.role==='owner'&&typeof activeOrderStatus!=='undefined'&&activeOrderStatus==='all'\)activeOrderStatus='new'/);
 assert.match(html,/owner-orders-workspace\.js\?v=20261114-calendar-openfix1/);
 assert.match(html,/Sabhi orders dekhein/);
});
