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
test('customer details are expanded without reloading entire order list',async()=>{
 const start=html.indexOf("document.querySelectorAll('[data-order-detail]').forEach(b=>b.addEventListener('click',()=>{");
 const end=html.indexOf('if(expandedOrderId)await loadOrderDetail(expandedOrderId);',start);
 assert.ok(start>0&&end>start);
 const snippet=html.slice(start,end);
 assert.doesNotMatch(snippet,/await loadMyOrders\(/);
 const events={},nodes=new Map(),calls=[];
 const button={dataset:{orderDetail:'order1'},textContent:'Order details',
  addEventListener(type,cb){events[type]=cb},setAttribute(){},closest(){return card}};
 const card={insertBefore(el){calls.push('append');nodes.set(el.id,el)},querySelector(){return null},classList:{add(){},remove(){}}};
 const document={
  querySelectorAll(selector){return selector==='[data-order-detail]'?[button]:[]},
  createElement(){return {setAttribute(){},remove(){nodes.delete(this.id)}}}
 };
 let expandedOrderId=null,biteOrderDetailSequence=0;
 const ctx=vm.createContext({document,expandedOrderId,biteOrderDetailSequence,
  $:id=>nodes.get(id),loadOrderDetail:async()=>{calls.push('detail-fetch')},loadMyOrders:async()=>{throw Error('should not reload list')}});
 vm.runInContext(snippet,ctx);
 events.click();
 assert.equal(ctx.expandedOrderId,'order1');
 assert.equal(button.textContent,'Close details');
 assert.match(nodes.get('detail-order1').innerHTML,/bite-order-detail-skeleton/);
 assert.deepEqual(calls,['append','detail-fetch']);
 events.click();
 assert.equal(ctx.expandedOrderId,null);
 assert.equal(button.textContent,'Order details');
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
