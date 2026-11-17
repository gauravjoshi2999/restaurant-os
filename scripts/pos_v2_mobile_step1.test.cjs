'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const js=fs.readFileSync('assets/bite-pos-v2.js','utf8');
const css=fs.readFileSync('assets/bite-pos-v2.css','utf8');
const html=fs.readFileSync('index.html','utf8');
function service(){
 const root={document:null};root.window=root;
 vm.runInNewContext(js,{window:root,Date,Intl,console});
 return root.BitePOSV2;
}
function bill(overrides={}){
 return {
  id:'one',code:'POS-ONE',channel:'POS - Counter',
  createdAt:'2026-11-17T12:30:00+05:30',status:'Completed',
  amount:500,waivedOffAmount:0,receivedAmount:350,dueAmount:150,
  isDemo:false,roomLinked:false,customerName:'Walk-in',...overrides
 };
}
test('POS date handling uses Asia/Kolkata business day, not UTC date',()=>{
 const v=service();
 assert.equal(v.dateKey('2026-11-16T19:05:00Z'),'2026-11-17');
 assert.equal(v.dateKey('2026-11-17T18:20:00Z'),'2026-11-17');
 assert.equal(v.dateKey('nonsense'),'');
});
test('POS counters isolate void, demo and hotel room folio from restaurant bills',()=>{
 const v=service();
 const orders=[
  bill(),
  bill({id:'two',amount:200,receivedAmount:200,dueAmount:0,code:'POS-TWO'}),
  bill({id:'cancelled',status:'Cancelled',amount:900}),
  bill({id:'demo',isDemo:true,amount:400}),
  bill({id:'room',code:'POS-ROOM-001',amount:1500}),
  bill({id:'posted',roomLinked:true,amount:1000}),
  bill({id:'prior',createdAt:'2026-11-15T10:00:00+05:30',amount:300})
 ];
 const result=v.numbers({orders,date:'2026-11-17'});
 assert.equal(result.bills,2);
 assert.equal(result.billed,700);
 assert.equal(result.received,550);
 assert.equal(result.due,150);
 assert.equal(result.all.length,3);
});
test('Waived-off amounts do not inflate POS billed figure',()=>{
 const result=service().numbers({date:'2026-11-17',orders:[bill({amount:400,waivedOffAmount:60,receivedAmount:340,dueAmount:0})]});
 assert.equal(result.bills,1);assert.equal(result.billed,340);
});
test('Screenshot-based owner POS is additive and existing billing remains canonical',()=>{
 for(const marker of [
  'id="posNewSaleBtn"', 'id="posDraftWorkspace"',
  'id="posRows"','id="posOrderCount"','id="posSalesTotal"',
  'id="posCollectedTotal"','id="posDueTotal"',
  "bite_create_pos_bill_with_service_v1",
  "window.BitePOSV2?.render(", 'bite-pos-v2.js?v=', 'bite-pos-v2.css?v='
 ])assert.ok(html.includes(marker),'required POS integration: '+marker);
 assert.match(js,/data-bpv2-tab="today"/);
 assert.match(js,/data-bpv2-tab="bills"/);
 assert.match(js,/data-bpv2-tab="drafts"/);
 assert.match(js,/data-bpv2-print/);
 assert.match(js,/root\.printOwnerInvoice\(found\.id\)/);
 assert.match(css,/#pos\[data-bite-pos-view="today"\] >#posDraftWorkspace/);
 assert.match(css,/#pos\[data-bite-pos-view="bills"\] >\.section/);
 assert.match(css,/@media\(max-width:760px\)/);
});
test('No fabricated diner count, no payment processing changes and real bill meaning',()=>{
 assert.match(js,/People served/);
 assert.match(js,/earlier dine-in bill\(s\) have no recorded people count/);
 assert.match(js,/Bill amount is not cash received/);
 assert.doesNotMatch(js,/24,560|1,342|3,896|Rahul Verma|POS-2587/);
 assert.doesNotMatch(js,/supabase\.from|fetch\(|Cashfree|payment_intent|UPDATE public/);
});
