'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-orders-reference-20261115.css','utf8');
const begin=html.indexOf('function biteMaskOrderPhone(');
const end=html.indexOf('async function biteShareRestaurant(',begin);
assert.ok(begin>0&&end>begin);
const snippet=html.slice(begin,end);
const context=vm.createContext({
 safe:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 money:n=>'₹'+Number(n||0).toFixed(2),
 formatOrderDate:()=> '15 Nov 2026',
 biteOrderAvatar:()=>'<div class="bite-detail-avatar"></div>',
 biteCancellationByOrder:new Map(),
 window:{BiteRefundTracker:{details:(order,job)=>job?'<p>Refund under review</p>':''}},
 Array,Number,String,Map
});
vm.runInContext(snippet+';globalThis.renderOrder=biteBuildFullOrderMarkup;globalThis.mask=biteMaskOrderPhone;',context);
const order={id:'own-id',order_code:'BITE-REF-TEST',restaurant_name:'Hotel Maharani Palace',
 amount:567,delivery_type:'delivery',status:'Cancelled',order_date:'2026-11-15',customer_name:''};
test('detail screen uses real order amount, line items, and customer-owned address without invented paid status',()=>{
 const rendered=context.renderOrder(order,[
  {item_name:'Dal Tadka',quantity:1,line_total:160},
  {item_name:'Paneer Butter Masala',quantity:1,line_total:219}
 ],[],{customer_name:'Customer',customer_phone:'9876543210',
 delivery_address_snapshot:{address_line:'Rajsamand',city:'Rajsamand',state:'Rajasthan',postal_code:'313324'}},null);
 assert.match(rendered,/Order was cancelled/);
 assert.match(rendered,/Hotel Maharani Palace/);
 assert.match(rendered,/₹567.00/);
 assert.match(rendered,/₹379.00/);
 assert.match(rendered,/Rajsamand/);
 assert.match(rendered,/•••• ••3210/);
 assert.doesNotMatch(rendered,/9876543210|Refund under review|You saved|GST \(govt\. taxes\)|<span>Paid<\/span>/);
 assert.match(rendered,/individual amounts are not available/);
});
test('untrusted item and address text is encoded',()=>{
 const rendered=context.renderOrder({...order,amount:200},[
  {item_name:'<script>bad</script>',quantity:1,line_total:200}
 ],[],{delivery_address_snapshot:{address_line:'<img src=x onerror=alert(1)>'}},null);
 assert.doesNotMatch(rendered,/<script>|<img src=x onerror=/);
 assert.match(rendered,/&lt;script&gt;/);
 assert.match(rendered,/&lt;img src=x onerror=/);
});
test('payment/refund claims only derive from existing trusted job',()=>{
 const noRefund=context.renderOrder(order,[],[],{delivery_address_snapshot:null},null);
 const withRefund=context.renderOrder(order,[],[],{delivery_address_snapshot:null},{amount:567,status:'pending_approval'});
 assert.doesNotMatch(noRefund,/Refund under review/);
 assert.match(withRefund,/Refund under review/);
});
test('customer detail query checks both order ID and signed-in customer identity, and guards late responses',()=>{
 assert.match(html,/\.from\('orders'\)\.select\('id,customer_id,customer_name,customer_phone,delivery_address_snapshot,delivery_type'\)/);
 assert.match(html,/\.eq\('id',orderId\)\.eq\('customer_id',customerId\)\.maybeSingle\(\)/);
 assert.match(html,/orderResult\.data\.customer_id!==customerId/);
 assert.match(html,/biteFullOrderRequest&&biteFullOrderId===orderId&&activeCustomerId===customerId/);
 assert.match(html,/if\(!current\(\)\)return/);
 assert.match(html,/biteFullOrderId=null/);
 assert.match(css,/body\[data-view="order-details"\] #homeBottomNav/);
});
test('history uses real restaurant covers when published and safe Bite fallback otherwise',()=>{
 assert.match(html,/BiteRestaurantCovers\?\.choose\(restaurant,\[\],SUPABASE_URL\)/);
 assert.match(html,/assets\/food\/meal-1100\.jpg/);
 assert.match(html,/data-bite-share-restaurant/);
 assert.doesNotMatch(html,/Delete this order/);
});
