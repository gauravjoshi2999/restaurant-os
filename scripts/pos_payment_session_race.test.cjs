'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/bite-pos-payment-ui.js','utf8');
const page=fs.readFileSync('index.html','utf8');

function deferred(){
 let resolve,reject;
 const promise=new Promise((ok,no)=>{resolve=ok;reject=no});
 return {promise,resolve,reject};
}
function setup(method){
 const gate=deferred(),alerts=[],counts={closed:0,loaded:0},elements={};
 for(const id of ['paymentOrderId','paymentMessage','paymentSaveBtn','paymentCheckBtn',
   'paymentAmount','paymentMethod','paymentDate','paymentReference','paymentNotes']){
  elements[id]={value:'',textContent:'',disabled:false,style:{}};
 }
 elements.paymentOrderId.value='order-a';
 elements.paymentAmount.value='50.00';
 elements.paymentMethod.value='UPI';
 elements.paymentDate.value='2026-11-14';
 elements.paymentReference.value='ref-1';
 elements.paymentNotes.value='note';
 const root={BitePOSPayment:{
  getPending:()=>null,
  save:()=>method==='save'?gate.promise:Promise.reject(Error('unexpected save')),
  reconcile:()=>method==='check'?gate.promise:Promise.reject(Error('unexpected reconcile'))
 }};
 const context={window:root,document:{getElementById(id){return elements[id]}},
  localStorage:{},crypto:{randomUUID(){return '12345678-1234-4123-8123-123456789abc'}},
  console:{warn(){}},alert(text){alerts.push(text)}};
 vm.runInNewContext(source,context);
 let isCurrent=true;
 const ctx={
  sb:{},userId:'owner-a',restaurantId:'rest-a',role:'owner',orderId:'order-a',
  order:{id:'order-a',restaurant:'rest-a',channel:'POS - Counter',status:'Received',amount:100,code:'POS-1'},
  paymentSummaryFor:()=>({paid_amount:0,balance_amount:100}),
  isCurrent:()=>isCurrent,
  closeModal:()=>{counts.closed++},
  loadCloudData:async()=>{counts.loaded++}
 };
 return {api:root.BitePOSPaymentUI,ctx,gate,counts,elements,alerts,switchOwner:()=>{isCurrent=false}};
}
test('owner POS async UI uses current-account guard and versioned script',()=>{
 assert.doesNotThrow(()=>new vm.Script(source));
 assert.match(page,/isCurrent:\(\)=>!!userId&&currentUser\?\.id===userId/);
 assert.match(page,/access\.restaurantId===restaurantId&&access\.role===role/);
 assert.match(page,/bite-pos-payment-ui\.js\?v=20261114-session2/);
});
test('old payment success cannot close modal or refresh a new owner session',async()=>{
 const h=setup('save');
 const work=h.api.save(h.ctx);
 assert.equal(h.elements.paymentSaveBtn.disabled,true);
 h.switchOwner();
 h.gate.resolve({status:'confirmed',recovered:false});
 await work;
 assert.equal(h.counts.closed,0);
 assert.equal(h.counts.loaded,0);
 assert.equal(h.elements.paymentSaveBtn.disabled,false);
});
test('old payment check result cannot show old receipt status in new session',async()=>{
 const h=setup('check');
 const work=h.api.check(h.ctx);
 h.switchOwner();
 h.gate.resolve({status:'not_found'});
 await work;
 assert.equal(h.elements.paymentMessage.textContent,'');
 assert.equal(h.counts.closed,0);
});
test('current owner still confirms receipt without duplicate UI handling',async()=>{
 const h=setup('save');
 const work=h.api.save(h.ctx);
 h.gate.resolve({status:'confirmed',recovered:true});
 await work;
 assert.equal(h.counts.closed,1);
 assert.equal(h.counts.loaded,1);
});
test('stale payment errors never appear in a different owner session',async()=>{
 const h=setup('save');
 const work=h.api.save(h.ctx);
 h.switchOwner();
 h.gate.reject(Error('old account network error'));
 await work;
 assert.equal(h.elements.paymentMessage.textContent,'');
});

test('R04 impossible receipt dates are rejected before new insert',()=>{
 const payments=require('../assets/bite-pos-payment-safety.js');
 for(const date of ['2026-02-30','2026-04-31','2026-13-01','2026-00-10','2025-02-29'])
  assert.throws(()=>payments.normalize({amount:50,method:'Cash',date}),/Valid payment date/);
 assert.equal(payments.normalize({amount:50,method:'Cash',date:'2024-02-29'}).date,'2024-02-29');
});
test('R04 receipt recovery requires matching creator and notes',async()=>{
 const payments=require('../assets/bite-pos-payment-safety.js');
 const m=new Map(),storage={getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
 const identity={uid:'owner-a',restaurantId:'rest-a',orderId:'order-a'};
 const details={amount:50,method:'UPI',date:'2026-11-14',notes:'counter',reference:'ref'};
 const id='12345678-1234-4123-8123-123456789abc';
 payments.begin(storage,identity,details,()=>id);
 let row={id,order_id:identity.orderId,restaurant_id:identity.restaurantId,amount:50,payment_method:'UPI',payment_date:details.date,reference:'ref',notes:'wrong',created_by:identity.uid};
 const sb={from(){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:row,error:null})};return q;}};
 assert.equal((await payments.reconcile({sb,storage,identity})).status,'conflict');
 row={...row,notes:'counter',created_by:'other'};
 assert.equal((await payments.reconcile({sb,storage,identity})).status,'conflict');
 row={...row,created_by:identity.uid};
 assert.equal((await payments.reconcile({sb,storage,identity})).status,'confirmed');
 assert.equal(payments.getPending(storage,identity),null);
});
test('R04 unknown balance, future date and room-linked order cannot submit a new receipt',async()=>{
 const h=setup('save');
 h.ctx.paymentSummaryFor=()=>({balance_amount:null});
 await h.api.save(h.ctx);
 assert.match(h.elements.paymentMessage.textContent,/balance unavailable/);
 assert.equal(h.elements.paymentSaveBtn.disabled,false);
 h.ctx.paymentSummaryFor=()=>({balance_amount:100});
 h.ctx.today=()=> '2026-11-13';
 await h.api.save(h.ctx);
 assert.match(h.elements.paymentMessage.textContent,/Future payment date/);
 h.ctx.today=()=> '2026-11-21';
 h.ctx.order.roomLinked=true;
 await h.api.save(h.ctx);
 assert.equal(h.elements.paymentSaveBtn.disabled,false);
 assert.equal(h.counts.closed,0);
});
