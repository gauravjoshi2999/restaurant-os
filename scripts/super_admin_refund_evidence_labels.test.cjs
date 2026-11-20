'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/super-admin-workspace.js','utf8');
const start=source.indexOf('function renderOrder(){'),end=source.indexOf('async function review(',start);
assert.ok(start>=0&&end>start,'Existing Super Admin financial detail renderers should exist');

function render(data){
  const node={innerHTML:''};
  const sandbox={
    detail:data,current:'financials',
    host:()=>node,
    heading:(...xs)=>xs.join(' '),
    button:(...xs)=>xs.join(' '),
    status:()=>'',restaurantName:()=> 'QA Restaurant',
    esc:value=>String(value??''),
    field:(label,value)=>'<dt>'+label+'</dt><dd>'+String(value??'')+'</dd>',
    when:x=>x||'Not recorded',
    money:x=>x==null?'Awaiting confirmation':'₹'+x,
    Number,Array
  };
  vm.runInNewContext(source.slice(start,end)+'\nthis.renderOrderDetail=renderOrder;this.renderSettlementDetail=renderSettlement;',sandbox);
  return {html:()=>node.innerHTML,drawOrder:sandbox.renderOrderDetail,drawSettlement:sandbox.renderSettlementDetail};
}
test('refunded internal status is not represented as provider-confirmed bank credit',()=>{
 const ui=render({o:{order_code:'BITE-TEST',restaurant_id:'synthetic',status:'Cancelled'},f:null,items:[],history:[],
   job:{status:'refunded',created_at:'2026-11-20',provider_status:null,amount:3}});
 ui.drawOrder();
 assert.match(ui.html(),/Marked refunded in Bite/);
 assert.match(ui.html(),/Cashfree and customer bank credit require independent verification/);
 assert.doesNotMatch(ui.html(),/Provider-confirmed refund/);
});
test('refund processing and errors retain truthful timelines',()=>{
 for(const status of ['pending_approval','approved','processing','failed']){
  const ui=render({o:{order_code:'BITE-TEST'},f:null,items:[],history:[],
   job:{status,provider_status:'PENDING',created_at:'2026-11-20',amount:1}});
  ui.drawOrder();
  assert.match(ui.html(),/Cashfree and customer bank credit require independent verification/);
  assert.doesNotMatch(ui.html(),/Provider-confirmed refund/);
 }
});
test('settlement details distinguish internal ledger refunds and payment status from actual bank credit',()=>{
 const ui=render({r:{restaurant_id:'synthetic',status:'paid',period_start:'2026-11-01',period_end:'2026-11-20',
   refunds_actual:3,amount_paid:30,paid_at:'2026-11-20',net_payable:27}});
 ui.drawSettlement();
 assert.match(ui.html(),/Ledger-recorded refunds/);
 assert.match(ui.html(),/Recorded paid at/);
 assert.match(ui.html(),/does not independently confirm restaurant bank credit/);
 assert.doesNotMatch(ui.html(),/Confirmed refunds/);
});
