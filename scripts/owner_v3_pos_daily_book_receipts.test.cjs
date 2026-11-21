'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const accounts=require('../assets/owner-hotel-accounts.js');
const html=fs.readFileSync('index.html','utf8');
const mobile=fs.readFileSync('assets/bite-pos-v2.js','utf8');
const css=fs.readFileSync('assets/bite-pos-v2.css','utf8');
const restaurant='11111111-1111-4111-8111-111111111111';
const otherRestaurant='22222222-2222-4222-8222-222222222222';
const oid='33333333-3333-4333-8333-333333333333';
const pid='44444444-4444-4444-8444-444444444444';
const normalOrder={id:oid,restaurant,channel:'POS - Counter',status:'Received',code:'POS-2026-001',isDemo:false};
const receipt={id:pid,restaurant_id:restaurant,order_id:oid,amount:100,payment_date:'2026-10-05'};
const fixture={orders:[normalOrder],orderPayments:[receipt]};
const match=(data=fixture,rid=restaurant,order=oid,payment=pid)=>accounts.findPosReceipt(data,rid,order,payment);

test('R02: POS bill dated 1 October links to actual receipt dated 5 October, with no extra transaction',()=>{
 const result=match();
 assert.ok(result);
 assert.equal(result.day,'2026-10-05');
 assert.equal(result.order.id,oid);
 assert.equal(result.payment.id,pid);
 assert.equal(fixture.orders.length,1);
 assert.equal(fixture.orderPayments.length,1);
});

test('R02: prevent cross-tenant, incorrect order/payment, zero amount, invalid dates and void/demo/room bills',()=>{
 assert.equal(match(fixture,otherRestaurant),null);
 assert.equal(match(fixture,restaurant,'55555555-5555-4555-8555-555555555555'),null);
 assert.equal(match(fixture,restaurant,oid,'66666666-6666-4666-8666-666666666666'),null);
 assert.equal(match({...fixture,orderPayments:[{...receipt,restaurant_id:otherRestaurant}]}),null);
 assert.equal(match({...fixture,orderPayments:[{...receipt,order_id:'77777777-7777-4777-8777-777777777777'}]}),null);
 assert.equal(match({...fixture,orderPayments:[{...receipt,amount:0}]}),null);
 assert.equal(match({...fixture,orderPayments:[{...receipt,payment_date:'2026-02-30'}]}),null);
 assert.equal(match({...fixture,orders:[{...normalOrder,isDemo:true}]}),null);
 assert.equal(match({...fixture,orders:[{...normalOrder,status:'Cancelled'}]}),null);
 assert.equal(match({...fixture,orders:[{...normalOrder,code:'POS-ROOM-ABC'}]}),null);
 assert.equal(match({...fixture,orders:[{...normalOrder,channel:'Website'}]}),null);
});

test('R02: source lookup is canonical and date-specific; no payment writes or new ledger',()=>{
 const source=fs.readFileSync('assets/owner-hotel-accounts.js','utf8');
 const a=source.indexOf('async function focusPosReceipt(');
 const b=source.indexOf(' // Open the matching source already present',a);
 assert.ok(a>=0&&b>a);
 const body=source.slice(a,b);
 assert.match(body,/viewPeriod=\{mode:'day',day:found.day\}/);
 assert.match(body,/await ctx.navigate\('daily-book'\)/);
 assert.match(body,/await renderDailyBook\(target\)/);
 assert.match(body,/source_type==='order_payment'/);
 assert.match(body,/x.id===paymentId&&x.day===found.day/);
 assert.match(body,/ctx\.getUser/);
 assert.doesNotMatch(body,/\.\s*(insert|update|delete|upsert|rpc)\s*\(/);
 assert.match(html,/function showPOSReceiptInDailyBook\(orderId,paymentId\)/);
 assert.match(html,/posDailyBookReceipts\(o.id,rid\)/);
 assert.match(html,/Daily Book · '\+receipts.length/);
});

test('R02: mobile recent bills expose only verified receipt link and a focusable 36px control',()=>{
 assert.match(mobile,/data-bpv2-receipt/);
 assert.match(mobile,/found\?\.receipt\?\.id===receipt.dataset.bpv2PaymentId/);
 assert.match(mobile,/showPOSReceiptInDailyBook/);
 assert.match(css,/min-height:36px/);
 assert.match(css,/\.bpv2-receipt-link:focus-visible/);
});

test('R06 rejects duplicate order/receipt IDs and malformed receipt money',()=>{
 assert.equal(match({...fixture,orders:[normalOrder,normalOrder]}),null);
 assert.equal(match({...fixture,orderPayments:[receipt,receipt]}),null);
 assert.equal(match({...fixture,orderPayments:[{...receipt,amount:100.001}]}),null);
 assert.equal(match({...fixture,orderPayments:[{...receipt,amount:Infinity}]}),null);
 assert.equal(match({...fixture,orders:[{...normalOrder,roomLinked:true}]}),null);
});
test('R05 R07 R08 guard room discount, historical completeness and in-flight draft refresh',()=>{
 const hospitality=fs.readFileSync('assets/owner-hospitality.js','utf8');
 const reports=fs.readFileSync('assets/bite-pos-reports.js','utf8');
 const drafts=fs.readFileSync('assets/bite-pos-drafts.js','utf8');
 assert.match(hospitality,/cents>Math.round\(total\*100\)/);
 assert.match(hospitality,/cents>0&&!reason/);
 assert.match(reports,/report.historyError\?' · Live bills only'/);
 const refresh=drafts.slice(drafts.indexOf('async function refreshDrafts()'),drafts.indexOf('function renderDrafts()'));
 assert.ok(refresh.indexOf('await ctx.sb.from')<refresh.indexOf('const list=readCache'));
 assert.match(refresh,/remote.restaurant_id!==ident.restaurantId/);
 assert.match(drafts,/Current bill pehle save ya close karein/);
});
