'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-orders-signature-20261116.css','utf8');
const start=html.indexOf('function biteOrderFriendlyStatus(status){');
const end=html.indexOf('async function biteRenderLoadedOrders(',start);
assert.ok(start>0&&end>start);
const source=html.slice(start,end);
const context=vm.createContext({
 safe:v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
 statusClass:v=>['Cancelled','Rejected'].includes(v)?'cancelled':String(v||'').toLowerCase().replace(/[^a-z]+/g,'-'),
 formatOrderDate:()=> '16 Nov 2026, 11:20 am',
 money:v=>'₹'+v,
 biteOrderAvatar:()=>'<div class="bite-order-avatar"><img src="assets/food/meal-1100.jpg" alt="food"></div>',
 biteOrderItemPreview:()=>'<div class="bite-history-items">1 × Rasgulla</div>',
 biteRefundByOrder:new Map(),biteCancellationByOrder:new Map(),biteRefundLookupUnavailable:false,
 orderActionsMarkup:()=>'<div class="orderactions"><button data-order-detail="test">Order details</button></div>',
 expandedOrderId:null,
 window:{BiteRefundTracker:{summary:()=>''}},
 Date,Number,String,Math
});
vm.runInContext(source+';globalThis.draw=biteOrderCardMarkup;globalThis.status=biteOrderFriendlyStatus;',context);
const sample={id:'id1',restaurant_name:'Hotel Maharani Palace',order_code:'BITE-TEST',amount:567,order_date:'2026-11-16',delivery_type:'delivery',status:'Completed'};
test('status names are friendly while preserving actual source data',()=>{
 assert.equal(context.status('Completed'),'Delivered');
 assert.equal(context.status('Rejected'),'Not accepted');
 assert.equal(context.status('Preparing'),'Preparing');
 const displayed=context.draw(sample);
 assert.match(displayed,/Delivered/);
 assert.doesNotMatch(displayed,/>Completed</);
 assert.match(displayed,/₹567/);
 assert.match(displayed,/Hotel Maharani Palace/);
 assert.match(displayed,/1 × Rasgulla/);
 assert.match(displayed,/data-bite-status="completed"/);
});
test('no fabricated refund or vegetarian claim from an ordinary cancelled order',()=>{
 const rendered=context.draw({...sample,status:'Cancelled',amount:1});
 assert.match(rendered,/Cancelled/);
 assert.doesNotMatch(rendered,/refund pending|refund initiated|refund processed|bite-detail-veg-mark/i);
});
test('untrusted restaurant names are escaped in the compact cards',()=>{
 const rendered=context.draw({...sample,restaurant_name:'<img src=x onerror=alert(1)>'});
 assert.match(rendered,/&lt;img/);
 assert.doesNotMatch(rendered,/<img src=x onerror/);
});
test('premium design stays scoped, responsive, accessible and reduced-motion safe',()=>{
 assert.match(html,/assets\/customer-orders-signature-20261116\.css\?v=1/);
 assert.match(css,/body\[data-bite-app="customer"\] #ordersView \.ordercard/);
 assert.match(css,/body\[data-bite-app="customer"\] #orderDetailsView \.bite-detail-status/);
 assert.match(css,/\.bite-detail-support-footer/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/:focus-visible/);
 assert.match(html,/data-bite-detail-invoice/);
 assert.match(html,/data-bite-copy-order/);
 assert.match(html,/data-customer-order-action="cancel"/);
 assert.match(html,/data-bite-detail-help/);
});
