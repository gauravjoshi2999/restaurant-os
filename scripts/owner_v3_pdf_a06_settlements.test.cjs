'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const api=require('../assets/owner-v3-settlements.js');
const source=fs.readFileSync('assets/owner-v3-settlements.js','utf8');
const css=fs.readFileSync('assets/owner-v3-settlements.css','utf8');
const html=fs.readFileSync('index.html','utf8');
const nav=fs.readFileSync('assets/owner-mobile-navigation.js','utf8');
const caps=fs.readFileSync('assets/owner-capabilities.js','utf8');
const rid='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const orderId='33333333-3333-4333-8333-333333333333';
const finId='44444444-4444-4444-8444-444444444444';
const refId='55555555-5555-4555-8555-555555555555';
const providerId='66666666-6666-4666-8666-666666666666';
const settlementId='77777777-7777-4777-8777-777777777777';
const f={id:finId,order_id:orderId,restaurant_id:rid,channel:'Own Platform',is_demo:false,
 payment_status:'paid',settlement_status:'not_ready',customer_payable_amount:'174.00',commission_amount:'17.40',
 provider_fee_actual:null,created_at:'2026-11-18T10:00:00Z'};
const r={id:refId,order_id:orderId,restaurant_id:rid,amount:174,status:'approved',provider_status:null,
 provider_refund_id:null,provider_checked_at:null,created_at:'2026-11-19T09:00:00Z'};
const p={id:providerId,order_id:orderId,restaurant_id:rid,collection_status:'PAID',collection_amount:174,checked_at:'2026-11-19T09:00:00Z'};
const s={id:settlementId,restaurant_id:rid,period_start:'2026-11-16',period_end:'2026-11-22',
 status:'draft',net_payable:156.6,amount_paid:0,provider_reference:null};
const fixture={financials:[f],settlements:[],refunds:[r],checks:[]};
const summarize=(data=fixture)=>api.reconcile(data,rid,[{id:orderId,restaurant:rid,code:'BITE-174',isDemo:false}]);
test('A06: paid in Bite is not verified with Cashfree and not bank-settled',()=>{
 const x=summarize();
 assert.equal(x.payments.length,1);assert.equal(x.recordedPaid,17400);assert.equal(x.providerChecked,0);
 assert.equal(x.reviewNeeded,1);assert.equal(x.pendingRefunds,1);
 assert.equal(x.payments[0].providerChecked,false);
 assert.match(api.refundLabel(r),/provider refund unverified/i);
 const host={innerHTML:''};api.render(host,x,'payments');
 assert.match(host.innerHTML,/Not independently verified/);
 assert.match(host.innerHTML,/Owner bank arrival/);
 assert.match(host.innerHTML,/Customer paid ≠ Cashfree settlement ≠ owner bank credited/);
 assert.match(host.innerHTML,/Commission/);
 assert.doesNotMatch(host.innerHTML,/Transfer now|Send refund|Approve refund/);
});
test('A06: only independently matching provider check gives recorded evidence, still not bank arrival',()=>{
 const checked=summarize({...fixture,checks:[p]});
 assert.equal(checked.providerChecked,17400);assert.equal(checked.reviewNeeded,0);
 const wrong=summarize({...fixture,checks:[{...p,collection_amount:173}]});
 assert.equal(wrong.providerChecked,0);
 const unconfirmed=summarize({...fixture,checks:[{...p,checked_at:null}]});
 assert.equal(unconfirmed.providerChecked,0);
 const invalid=summarize({...fixture,checks:[{...p,collection_status:'NOT_PAID'}]});
 assert.equal(invalid.providerChecked,0);
 const host={innerHTML:''};api.render(host,checked,'payments');
 assert.match(host.innerHTML,/Matching recorded Cashfree check/);
 assert.match(host.innerHTML,/Owner bank arrival.*?Not independently verified/s);
});
test('A06: approved internal refund is not a completed provider refund',()=>{
 assert.match(api.refundLabel(r),/Approved in Bite/);
 assert.match(api.refundLabel({...r,provider_status:'SUCCESS'}),/unverified/i);
 assert.match(api.refundLabel({...r,provider_status:'SUCCESS',provider_refund_id:'ref-ok',provider_checked_at:'2026-11-19'}),/provider reports refund processed/i);
 assert.match(api.refundLabel({...r,provider_status:'FAILED'}),/failure/i);
 const host={innerHTML:''};api.render(host,summarize(),'refunds');
 assert.match(host.innerHTML,/Refunds/);
 assert.match(host.innerHTML,/Awaiting|Approved in Bite/);
});
test('A06: POS, demo and unrelated restaurant rows never inflate online payment metrics',()=>{
 const demo={...f,id:'88888888-8888-4888-8888-888888888888',order_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',is_demo:true,customer_payable_amount:999};
 const pos={...f,id:'99999999-9999-4999-8999-999999999999',order_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',channel:'POS - Counter',customer_payable_amount:900};
 assert.equal(summarize({...fixture,financials:[f,demo,pos]}).recordedPaid,17400);
 assert.throws(()=>summarize({...fixture,financials:[{...f,restaurant_id:other}]}),/unrelated/i);
 assert.throws(()=>summarize({...fixture,financials:[f,{...f,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]}),/Duplicate/);
 assert.throws(()=>summarize({...fixture,refunds:[{...r,restaurant_id:other}]}),/unrelated/i);
});
test('A06: money math and missing fee remain precise and visibly unknown',()=>{
 assert.equal(api.cents('174.00'),17400);assert.equal(api.cents('0'),0);
 assert.equal(api.cents(null),null);assert.equal(api.cents('NaN'),null);assert.equal(api.cents('-1'),null);
 assert.equal(api.cents('1.001'),null);
 const host={innerHTML:''};api.render(host,summarize({...fixture,settlements:[s]}),'settlements');
 assert.match(host.innerHTML,/₹156.60/);
 assert.match(host.innerHTML,/Bank credit not independently verified/);
 assert.match(host.innerHTML,/Bite status: Draft/);
 assert.doesNotMatch(host.innerHTML,/Bank received|Confirmed bank/);
});
test('A06: owner-only authenticated reader scopes EVERY financial source to tenant',async()=>{
 const calls=[];
 const rows={
  order_financials:[f],restaurant_settlements:[s],bite_refund_jobs:[r],bite_provider_checks:[p]
 };
 const db={from(table){
  calls.push(['table',table]);let filter={};
  const builder={
   select(){return this},eq(k,v){calls.push(['eq',table,k,v]);filter[k]=v;return this},
   order(){return this},range(from,to){calls.push(['range',table,from,to]);return Promise.resolve({data:rows[table].slice(from,to+1),error:null});}
  };return builder;
 }};
 const data=await api.load(db,rid,()=>true);
 assert.equal(data.financials.length,1);assert.equal(data.refunds.length,1);
 assert.equal(calls.filter(x=>x[0]==='eq'&&x[2]==='restaurant_id'&&x[3]===rid).length,4);
 assert.equal(calls.filter(x=>x[0]==='range').length,4);
 assert.equal(api.validSession({restaurantId:rid,userId:'u1',getSession:()=>({role:'owner',userId:'u1',restaurantId:rid})}),true);
 assert.equal(api.validSession({restaurantId:rid,userId:'u1',getSession:()=>({role:'super_admin',userId:'u1',restaurantId:rid})}),false);
 assert.equal(api.validSession({restaurantId:rid,userId:'u1',getSession:()=>({role:'owner',userId:'u2',restaurantId:rid})}),false);
 assert.equal(api.validSession({restaurantId:rid,userId:'u1',getSession:()=>({role:'owner',userId:'u1',restaurantId:other})}),false);
});
test('A06: explicit loading failure does not quietly show zero/paid or corrupt state',async()=>{
 const bad={from(){return {select(){return this},eq(){return this},order(){return this},range(){return Promise.resolve({data:null,error:{message:'RLS denied'}})}}}};
 await assert.rejects(api.load(bad,rid,()=>true),/RLS denied/);
 await assert.rejects(api.load(bad,rid,()=>false),/unavailable/);
});
test('A06: existing Owner V3 shell, More, responsive layout and Super Admin separation',()=>{
 assert.match(html,/id="owner-settlements"/);
 assert.match(html,/assets\/owner-v3-settlements\.js\?v=20261119-a06-1/);
 assert.match(html,/assets\/owner-v3-settlements\.css\?v=20261119-a06-1/);
 assert.match(nav,/\['owner-settlements','Settlements & Refunds'/);
 assert.match(caps,/\['owner-settlements','Settlements & Refunds','online_food_orders'\]/);
 assert.match(html,/window\.BiteOwnerA06\.open/);
 assert.match(html,/window\.BiteOwnerA06\?\.clear/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/@media\(max-width:390px\)/);
 assert.doesNotMatch(source,/\.(insert|update|upsert|delete|rpc|functions\.invoke)\s*\(/);
 assert.doesNotMatch(source,/service_role|secret_key|BANK_ACCOUNT|Cashfree.*POST/);
});
test('A06: HTML-escape untrusted provider text and order titles',()=>{
 const nasty=summarize({...fixture,financials:[{...f,payment_status:'<img src=x onerror=alert(1)>'}]});
 const host={innerHTML:''};api.render(host,nasty,'payments');
 assert.doesNotMatch(host.innerHTML,/<img src=x/);
 assert.match(host.innerHTML,/&lt;img/);
});
