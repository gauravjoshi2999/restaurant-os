'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const start=html.indexOf('async function biteOpenFullOrderDetails(');
const end=html.indexOf("$('biteDetailBack')",start);
assert.ok(start>0&&end>start);
const source=html.slice(start,end);
const ID='11111111-1111-4111-8111-111111111111';
function setup(){
 const dom={innerHTML:'Previous order screen'};
 const order={id:ID,restaurant_id:'r',status:'Received',amount:150,order_date:'2026-11-16'};
 const hits={scroll:0,view:0,queries:[]};
 let actualStatus='Preparing',actualAmount=150,ownerId='customer-a',refundState='pending_approval';
 let orderDeferred=null;
 const dataFor=name=>name==='order_items'?{data:[],error:null}:
  name==='order_status_history'?{data:[],error:null}:
  name==='orders'?{data:{id:ID,customer_id:'customer-a',status:actualStatus,amount:actualAmount,order_date:'2026-11-16',
   customer_name:'',customer_phone:null,delivery_type:'delivery',delivery_address_snapshot:null},error:null}:
  name==='bite_refund_jobs'?{data:{order_id:ID,status:refundState,amount:150},error:null}:
  name==='bite_live_checkout_intents'?{data:[],error:null}:{data:[],error:null};
 const sb={from(name){
  hits.queries.push(name);
  const q={select(){return q},eq(){return q},order(){return q},
   limit(){return Promise.resolve(dataFor(name))},
   maybeSingle(){return name==='orders'&&orderDeferred?orderDeferred:Promise.resolve(dataFor(name))},
   then(resolve,reject){return Promise.resolve(dataFor(name)).then(resolve,reject)}
  };return q;
 }};
 const ctx={
  activeCustomerId:ownerId,customerOrders:[order],biteFullOrderId:ID,
  biteFullOrderRequest:0,biteFullOrderLastMarkup:'Previous order screen',
  document:{body:{dataset:{view:'order-details'}}},
  $:()=>dom,window:{scrollTo(){hits.scroll++}},
  showCustomerView(){hits.view++},
  sb,console:{warn(){}},Promise,Date,
  biteBuildFullOrderMarkup:(o,items,history,details,refund,payment)=>
   'Status: '+o.status+'; total: '+o.amount+'; refund: '+(refund?.status||'unknown')
 };
 vm.createContext(ctx);
 vm.runInContext(source+';globalThis.refresh=biteOpenFullOrderDetails;',ctx);
 return {ctx,dom,order,hits,setActualStatus:x=>actualStatus=x,setAmount:x=>actualAmount=x,
  setRefund:x=>refundState=x,setCustomer:x=>{ctx.activeCustomerId=x;},
  setDeferred:x=>{orderDeferred=x},refresh:(quiet=true)=>ctx.refresh(ID,quiet)};
}
test('quiet refresh displays current customer-owned order status without re-navigation or skeleton',async()=>{
 const f=setup();
 await f.refresh(true);
 assert.match(f.dom.innerHTML,/Status: Preparing/);
 assert.equal(f.order.status,'Preparing');
 assert.equal(f.hits.scroll,0);
 assert.equal(f.hits.view,0);
 assert.ok(f.hits.queries.includes('orders'));
 const previous=f.dom.innerHTML;
 await f.refresh(true);
 assert.equal(f.dom.innerHTML,previous);
 f.setActualStatus('Completed');f.setRefund('succeeded');
 await f.refresh(true);
 assert.match(f.dom.innerHTML,/Status: Completed/);
 assert.match(f.dom.innerHTML,/refund: succeeded/);
});
test('a late response from a different login cannot replace displayed order details',async()=>{
 const f=setup();let finish;
 const pending=new Promise(resolve=>{finish=resolve});
 f.setDeferred(pending);
 const task=f.refresh(true);
 f.setCustomer('customer-b');
 finish({data:{id:ID,customer_id:'customer-a',status:'Completed',amount:150,order_date:'2026-11-16'},error:null});
 await task;
 assert.equal(f.dom.innerHTML,'Previous order screen');
 assert.equal(f.order.status,'Received');
});
test('details polling and realtime are only active for own visible order, not other accounts',()=>{
 assert.match(html,/document\.body\.dataset\.view==='order-details'&&biteFullOrderId/);
 assert.match(html,/void biteOpenFullOrderDetails\(biteFullOrderId,true\)/);
 assert.match(html,/payload\?\.new\?\.id===biteFullOrderId/);
 assert.match(html,/\.eq\('id',orderId\)\.eq\('customer_id',customerId\)\.maybeSingle\(\)/);
 assert.match(html,/if\(!current\(\)\)return;/);
 assert.match(html,/if\(quiet&&\(biteFullOrderId!==orderId\|\|document\.body\.dataset\.view!=='order-details'\)\)return/);
 assert.match(html,/biteFullOrderLastMarkup=null/);
 assert.match(html,/void loadMyOrders\(\)/);
});
