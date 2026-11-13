const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const calendar=require('../assets/owner-order-calendar.js');
const ownerHtml=fs.readFileSync('index.html','utf8');
const nav=fs.readFileSync('assets/owner-mobile-navigation.js','utf8');
const css=fs.readFileSync('assets/owner-orders-calendar.css','utf8');

test('Calendar groups real website orders by India local day, not UTC day',()=>{
  const list=[
    {createdAt:'2026-11-12T21:15:00Z'}, // Nov 13 02:45 India
    {createdAt:'2026-11-13T02:00:00Z'}, // Nov 13 07:30 India
    {createdAt:'2026-11-13T20:00:00Z'}, // Nov 14 01:30 India
    {createdAt:'2026-11-13T20:00:00Z',isDemo:true},
    {createdAt:'2026-11-13T20:00:00Z',is_demo:true},
    {createdAt:'invalid date'}
  ];
  assert.equal(calendar.dateKey(list[0].createdAt),'2026-11-13');
  assert.equal(calendar.dateKey(list[2].createdAt),'2026-11-14');
  assert.deepEqual({...calendar.dayCounts(list)},{'2026-11-13':2,'2026-11-14':1});
  assert.equal(calendar.dateKey('invalid date'),'');
  assert.equal(calendar.labelForDay('2026-11-14'),'14 November 2026');
});
test('Calendar changes months across year without adding imaginary counts',()=>{
  assert.equal(calendar.monthShift('2026-12',1),'2027-01');
  assert.equal(calendar.monthShift('2027-01',-1),'2026-12');
  assert.equal(calendar.choose('not-a-day'),undefined);
  assert.equal(calendar.getSelected(),null);
});
test('Owner orders are grouped by date with all statuses selectable; admin unchanged',()=>{
  assert.match(ownerHtml,/BiteOwnerCalendar\.update\(document,channelOrders/);
  assert.match(ownerHtml,/activeOrderStatus='all';\s*\/\/ choosing a date/);
  assert.match(ownerHtml,/BiteOwnerCalendar\.getSelected\(\)/);
  assert.match(ownerHtml,/BiteOwnerCalendar\.labelForDay\(orderDay\)/);
  assert.match(ownerHtml,/return dateHeading\+'<article class="order-card"/);
  assert.match(ownerHtml,/assets\/owner-order-calendar\.js\?v=/);
  assert.match(ownerHtml,/assets\/owner-orders-calendar\.css\?v=/);
  assert.match(css,/\.bite-order-cal-day\.has-orders/);
  assert.match(css,/body\[data-role="owner"\]/);
});
test('One prominent explicit accept-and-cook action uses existing two guarded transitions',()=>{
  assert.match(ownerHtml,/async function acceptAndStartOrder\(id\)/);
  assert.match(ownerHtml,/o\.status==='Received'/);
  assert.match(ownerHtml,/Accept &amp; start cooking/);
  assert.match(ownerHtml,/\.eq\('status','Received'\)\.select\('id'\)\.maybeSingle\(\)/);
  assert.match(ownerHtml,/\.eq\('status','Accepted'\)\.select\('id'\)\.maybeSingle\(\)/);
  assert.match(ownerHtml,/ownerOrderActionsPending\.add\(id\)/);
  assert.match(ownerHtml,/shareAndHandOverDelivery\(/);
  assert.match(ownerHtml,/async function shareDeliveryHandoff\(id,commitHandover=false\)/);
  assert.match(ownerHtml,/create_delivery_handoff/);
  assert.match(ownerHtml,/confirm_delivery_handoff/);
});
test('Khata Open scrolls to ledger, preserves payment data and clearly reports no entries',()=>{
  assert.match(ownerHtml,/function selectKhataCustomer\(id\)/);
  assert.match(ownerHtml,/ledger\.scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/);
  assert.match(ownerHtml,/heading\.focus\(\{preventScroll:true\}\)/);
  assert.match(ownerHtml,/Is customer ke Khata mein abhi koi entry nahi hai/);
  assert.match(ownerHtml,/onclick="selectKhataCustomer/);
});
test('Back from a More section returns to in-page More, not Home',()=>{
  assert.match(nav,/returnToMoreFrom=page;/);
  assert.match(nav,/if\(mobile\(\)&&returnToMoreFrom===currentPage\(\)\)/);
  assert.match(nav,/openMore\(\); \/\/ Back from a More child/);
  assert.match(nav,/returnToMoreFrom=null; \/\/ direct bottom navigation/);
});
