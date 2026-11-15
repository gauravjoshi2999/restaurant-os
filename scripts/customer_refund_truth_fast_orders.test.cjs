'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const refund=require('../assets/customer-refund-tracker.js');
const html=fs.readFileSync('customer.html','utf8');

test('cancelled unpaid legacy orders never invent refund status or amount',()=>{
 const order={id:'legacy-cancel',status:'Cancelled',amount:567};
 assert.equal(refund.classify(order,null,null),null);
 assert.equal(refund.summary(order,null,null),'');
 assert.equal(refund.details(order,null,null),'');
 assert.equal(refund.summary(order,null,null,true),'','failed lookup alone is not a refund');
 assert.equal(refund.details({...order,status:'Rejected'},null,null,true),'');
});
test('real cancellation requests remain distinct from actual refund jobs',()=>{
 const order={id:'sample',status:'Accepted',amount:567};
 assert.match(refund.summary(order,null,{status:'Pending'}),/Cancellation requested/);
 assert.equal(refund.details(order,null,{status:'Pending'}),'','no amount-based refund progress for an unpaid request');
 const paidJob={amount:567,status:'pending_approval',provider_status:null};
 assert.match(refund.summary({...order,status:'Cancelled'},paidJob,null),/Refund under review/);
 assert.match(refund.details({...order,status:'Cancelled'},paidJob,null),/₹567/);
});
test('Order details navigates to separate customer-owned view without reloading My Orders',()=>{
 const a=html.indexOf("document.querySelectorAll('[data-order-detail]').forEach(b=>b.addEventListener('click',()=>{");
 const b=html.indexOf("document.querySelectorAll('[data-bite-share-restaurant]')",a);
 assert.ok(a>0&&b>a);
 const snippet=html.slice(a,b);
 assert.doesNotMatch(snippet,/loadMyOrders/);
 assert.match(snippet,/biteOpenFullOrderDetails\(b\.dataset\.orderDetail\)/);
 assert.match(html,/showCustomerView\('order-details'\)/);
 assert.match(html,/function biteLeaveFullOrderDetails\(/);
 assert.match(html,/\.eq\('id',orderId\)\.eq\('customer_id',customerId\)\.maybeSingle\(\)/);
});
test('refresh keeps existing cards in place and skips unchanged render',()=>{
 assert.match(html,/!box\.querySelector\?\.\('\.ordercard'\)/);
 assert.match(html,/const unchanged=biteOrderCardsCustomer===requestedCustomerId&&biteOrderCardsFingerprint===nextFingerprint/);
 assert.match(html,/if\(unchanged&&box\.querySelector\?\.\('\.ordercard, \.orders-empty'\)\)/);
 assert.match(html,/const biteOrderDetailCache=new Map\(\)/);
 assert.match(html,/biteOrderDetailCache\.set\(key,\{html:target\.innerHTML,at:Date\.now\(\)\}\)/);
 assert.match(html,/biteOrderDetailCache\.clear\(\)/);
 assert.match(html,/if\(!force&&cached&&Date\.now\(\)-cached\.at<BITE_ORDER_DETAIL_CACHE_MS\)/);
});
