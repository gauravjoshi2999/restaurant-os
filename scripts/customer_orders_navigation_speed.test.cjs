'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-orders-20261115.css','utf8');
const a=html.indexOf('async function loadMyOrders(){');
const b=html.indexOf('function biteBindRefundRefresh(',a);
assert.ok(a>0&&b>a);
const helpers=html.slice(html.indexOf('function biteOrderAvatar('),a);
const loader=html.slice(a,b);
const orderId='11111111-1111-4111-8111-111111111111';
const row={id:orderId,order_code:'BITE-QA-1',restaurant_id:'restaurant-1',
 restaurant_name:'Hotel Maharani Palace',status:'Completed',
 order_date:'2026-11-15T09:00:00Z',amount:150,delivery_type:'delivery'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup({existingMarkup='',slowOrders=false}={}){
 const calls=[],nodes={},deferred={};
 for(const name of ['orders','refunds','requests','items','payments']){
  let resolve;
  const promise=new Promise(r=>resolve=r);
  deferred[name]={promise,resolve};
 }
 nodes.ordersList={
  innerHTML:existingMarkup,
  querySelector(selector){
   if(selector.includes('.ordercard')&&this.innerHTML.includes('class="ordercard'))return {};
   if(selector.includes('.orders-empty')&&this.innerHTML.includes('class="orders-empty'))return {};
   if(selector.includes('.bite-orders-skeleton')&&this.innerHTML.includes('bite-orders-skeleton'))return {};
   return null;
  }
 };
 nodes.ordersSubtitle={textContent:''};
 nodes.refreshOrdersBtn={classList:{add(c){calls.push('loading '+c)},remove(c){calls.push('done '+c)}}};
 const $=id=>nodes[id]??(nodes[id]={textContent:'',innerHTML:''});
 const dbQuery={select(){return this},eq(){return this},in(){return this},order(){return this},
  limit(){return deferred[this.table==='bite_refund_jobs'?'refunds':this.table==='order_items'?'items':this.table==='bite_live_checkout_intents'?'payments':'requests'].promise}};
 const ctx={
  $,
  document:{querySelectorAll:()=>[]},
  window:{BiteHistoryPremium:{applyFilters(){}}},
  restaurants:[],SUPABASE_URL:'https://project.supabase.co',biteOrderItemsPreview:new Map(),
  BITE_SANDBOX_CHECKOUT:false,BITE_DIRECT_MODE:false,BITE_DIRECT_RESTAURANT_ID:null,
  activeCustomerId:'customer1',customerOrderViewSequence:0,customerOrders:[],
  biteRefundByOrder:new Map(),biteCancellationByOrder:new Map(),
  biteRefundLookupUnavailable:false,biteOrderDetailCache:new Map(),
  customerPaymentByOrder:new Map(),customerPaymentLookupUnavailable:false,customerPaymentResolved:false,
  biteOrderCardsFingerprint:null,biteOrderCardsCustomer:null,
  expandedOrderId:null,biteOrderDetailSequence:0,
  sb:{auth:{getSession:async()=>{calls.push('session');return {data:{session:{user:{id:'customer1'}}}}}},
      rpc:()=>{calls.push('rpc');return deferred.orders.promise},
      from(table){const q=Object.create(dbQuery);q.table=table;return q}},
  biteCurrentOrderRequest:(id,user)=>!!user&&id===ctx.customerOrderViewSequence&&ctx.activeCustomerId===user,
  orderActionsMarkup:()=>'<div class="orderactions"></div>',
  statusClass:()=>'',formatOrderDate:()=>'',money:n=>'₹'+n,
  safe:v=>String(v??''),
  showCustomerView(){},showAuth(){},loadOrderDetail(){},
  console,Date,JSON,Number,Map,Promise
 };
 vm.createContext(ctx);
 vm.runInContext(helpers+loader+';globalThis.loadFast=loadMyOrders;',ctx);
 return{ctx,nodes,calls,deferred,load:()=>ctx.loadFast()};
}
test('My Orders renders real cards before slower refund and cancellation queries resolve',async()=>{
 const t=setup();
 const loading=t.load();
 t.deferred.orders.resolve({data:[row],error:null});
 await tick();await tick();
 assert.match(t.nodes.ordersList.innerHTML,/Hotel Maharani Palace/);
 assert.doesNotMatch(t.nodes.ordersList.innerHTML,/Orders load ho rahe hain/);
 assert.equal(t.calls[0],'rpc','start order API concurrently with local session read');
 assert.ok(t.calls.includes('session'));
 t.deferred.refunds.resolve({data:[],error:null});
 t.deferred.requests.resolve({data:[],error:null});
 t.deferred.payments.resolve({data:[],error:null});
 t.deferred.items.resolve({data:[],error:null});
 await loading;
 assert.equal(t.ctx.customerOrders.length,1);
});
test('revisiting orders keeps the same-user cards visible while fetching latest changes',async()=>{
 const t=setup({existingMarkup:'<article class="ordercard">Cached same-user order</article>'});
 t.ctx.biteOrderCardsCustomer='customer1';
 const job=t.load();
 await tick();
 assert.match(t.nodes.ordersList.innerHTML,/Cached same-user order/);
 t.deferred.orders.resolve({data:[row],error:null});
 t.deferred.refunds.resolve({data:[],error:null});
 t.deferred.requests.resolve({data:[],error:null});
 t.deferred.payments.resolve({data:[],error:null});
 t.deferred.items.resolve({data:[],error:null});
 await job;
 assert.match(t.nodes.ordersList.innerHTML,/Hotel Maharani Palace/);
});
test('verified activated payment becomes visible only after independent customer-scoped lookup',async()=>{
 const t=setup();
 const job=t.load();
 t.deferred.orders.resolve({data:[row],error:null});
 await tick();await tick();
 assert.doesNotMatch(t.nodes.ordersList.innerHTML,/Payment recorded/);
 t.ctx.window.BiteCustomerPaymentTracker={
  summary:(order,receipt)=>receipt&&receipt.status==='activated'&&receipt.amount===order.amount?'Payment recorded by Bite':'Payment not verified'
 };
 t.deferred.refunds.resolve({data:[],error:null});
 t.deferred.requests.resolve({data:[],error:null});
 t.deferred.items.resolve({data:[],error:null});
 t.deferred.payments.resolve({data:[{
  activated_order_id:orderId,customer_id:'customer1',restaurant_id:'restaurant-1',
  amount:150,currency:'INR',status:'activated'
 }],error:null});
 await job;
 assert.match(t.nodes.ordersList.innerHTML,/Payment recorded by Bite/);
 assert.equal(t.ctx.customerPaymentByOrder.size,1);
});
test('history uses compact cards, separate details and discreet overflow actions',()=>{
 assert.match(html,/class="secondary bite-order-detail-action"/);
 assert.match(html,/Order details/);
 assert.match(html,/bite-order-ellipsis/);
 assert.match(html,/id="orderDetailsView"/);
 assert.match(css,/\.order-more\{display:none/);
 assert.match(html,/data-bite-share-restaurant/);
 assert.match(html,/if\(b\.dataset\.nav==='orders'\)[\s\S]{0,180}showCustomerView\('orders'\);void loadMyOrders\(\)/);
 assert.doesNotMatch(html,/showCustomerView\('orders'\);\$\('ordersList'\)\.innerHTML/);
 assert.match(html,/biteOrdersSkeletonMarkup|bite-orders-skeleton/);
});
test('visible completed orders also refresh when an external refund arrives',()=>{
 const start=html.indexOf('function biteRefreshVisibleFinancialStatus()');
 const end=html.indexOf('function setupOrderRealtime(',start);
 const poll=html.slice(start,end);
 assert.match(poll,/setInterval\(biteRefreshVisibleFinancialStatus,30000\)/);
 assert.match(poll,/document\.visibilityState==='visible'/);
 assert.match(poll,/Date\.now\(\)-lastBiteFinancialRefreshAt<8000/);
 assert.match(poll,/void loadMyOrders\(\)/);
 assert.doesNotMatch(poll,/customerOrders\.some\(/);
});
