'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const payment=require('../assets/customer-payment-status.js');
const html=fs.readFileSync('customer.html','utf8');
const id='11111111-1111-4111-8111-111111111111';
const order={id,restaurant_id:'r1',amount:174,status:'Completed'};
const receipt={activated_order_id:id,restaurant_id:'r1',status:'activated',amount:174,currency:'INR',updated_at:'2026-11-16T02:00:00Z'};
test('only exact activated, matching currency, order, amount, and restaurant count as received',()=>{
 const yes=payment.classify(order,receipt);
 assert.equal(yes.kind,'recorded');
 assert.match(yes.title,/Payment recorded by Bite/);
 for(const bad of [
  {...receipt,status:'awaiting_payment'},{...receipt,activated_order_id:'other'},
  {...receipt,restaurant_id:'other'},{...receipt,currency:'USD'},
  {...receipt,amount:175},{...receipt,amount:null}
 ])assert.notEqual(payment.classify(order,bad).kind,'recorded');
 assert.notEqual(payment.classify({...order,status:'Completed',amount:175},receipt).kind,'recorded');
});
test('missing or failed lookup never claims charge, unpaid balance, or bank credit',()=>{
 for(const [receiptValue,unavailable] of [[null,false],[null,true]]){
  const state=payment.classify(order,receiptValue,unavailable);
  assert.equal(state.kind,'unknown');
  assert.doesNotMatch(state.title,/received|paid|refunded|credited/i);
  assert.match(state.note,/contact.*support/i);
  assert.doesNotMatch(payment.summary(order,receiptValue,unavailable),/Payment recorded by Bite/);
 }
 assert.doesNotMatch(payment.details(order,receipt),/bank credited|restaurant bank paid|refunded/i);
 assert.match(payment.details(order,receipt),/Cashfree merchant settlement and restaurant bank payout are separate/);
});
test('cancelled confirmed payment without refund job prompts support, not invented refund',()=>{
 const marked=payment.details({...order,status:'Cancelled'},receipt,false,null,false);
 assert.match(marked,/No refund record is available yet/);
 assert.doesNotMatch(marked,/Refund processed|Refund initiated/);
 const fetching=payment.details({...order,status:'Cancelled'},receipt,false,null,true);
 assert.doesNotMatch(fetching,/No refund record is available yet/);
 const refundExists=payment.details({...order,status:'Cancelled'},receipt,false,{status:'pending_approval'},false);
 assert.doesNotMatch(refundExists,/No refund record is available yet/);
});
test('HTML is escaped and refresh is an intentional customer action',()=>{
 const a=payment.details({...order,amount:0}, {...receipt,amount:'<img src=x>'});
 assert.doesNotMatch(a,/<img/);
 assert.match(a,/data-bite-refresh-payment/);
 assert.match(html,/data-bite-refresh-payment/);
 assert.match(html,/assets\/customer-payment-status\.js\?v=20261116-1/);
 assert.match(html,/assets\/customer-payment-status\.css\?v=20261116-1/);
});
test('customer payment status reads only own activated intent through existing RLS and clears on account switch',()=>{
 assert.match(html,/sb\.from\('bite_live_checkout_intents'\)/);
 assert.match(html,/\.eq\('customer_id',requestedCustomerId\)\.eq\('status','activated'\)/);
 assert.match(html,/\.in\('activated_order_id',ids\)/);
 assert.match(html,/\.eq\('customer_id',customerId\)\.eq\('activated_order_id',orderId\)/);
 assert.match(html,/customerPaymentByOrder\.clear\(\)/);
 assert.match(html,/customerPaymentResolved=false/);
 assert.match(html,/customerPaymentLookupUnavailable/);
 assert.match(html,/biteCurrentOrderRequest\(orderRequestId,requestedCustomerId\)/);
 assert.doesNotMatch(html,/from\('order_financials'\)/);
});
