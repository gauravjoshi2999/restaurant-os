'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const helper=import(pathToFileURL(path.resolve(__dirname,'../supabase/functions/cashfree-webhook/refund-event-sync.mjs')).href);
const event={type:'REFUND_STATUS_WEBHOOK',data:{order:{order_id:'bite_live_40000000000000000000000000000001'},refund:{refund_id:'bite_rf_60000000000000000000000000000001'}}};
const jid='60000000-0000-0000-0000-000000000001',rid='20000000-0000-0000-0000-000000000001',
 cust='30000000-0000-0000-0000-000000000001',oid='10000000-0000-0000-0000-000000000001',
 iid='40000000-0000-0000-0000-000000000001',cfId='bite_live_40000000000000000000000000000001',refId='bite_rf_60000000000000000000000000000001';
function fixture(patch={}){
 const job={id:jid,order_id:oid,restaurant_id:rid,customer_id:cust,amount:174,status:'pending_approval',provider_refund_id:refId,...patch.job};
 const order={id:oid,restaurant_id:rid,customer_id:cust,amount:174,is_demo:false,channel:'Own Platform',...patch.order};
 const intent={id:iid,activated_order_id:oid,restaurant_id:rid,customer_id:cust,amount:174,currency:'INR',status:'activated',provider_order_id:cfId,...patch.intent};
 const fin={order_id:oid,restaurant_id:rid,currency:'INR',customer_payable_amount:174,payment_status:'paid',refund_amount_actual:0,...patch.fin};
 const providerOrder={order_id:cfId,order_amount:174,order_currency:'INR',order_status:'PAID',...patch.providerOrder};
 const providerRefund={order_id:cfId,refund_id:refId,refund_amount:174,refund_currency:'INR',refund_status:'SUCCESS',...patch.providerRefund};
 const calls=[],rpcCalls=[];
 const db={from(table){
  return {select(){return {eq(){return {limit:async()=>({data:table==='bite_refund_jobs'?[job]:[]}),
    maybeSingle:async()=>({data:({orders:order,bite_live_checkout_intents:intent,order_financials:fin})[table]})}}}}};
 },async rpc(name,args){rpcCalls.push({name,args});return {data:'succeeded',error:null}}};
 const providerFetch=async(url,opts)=>{
  calls.push({url,method:opts.method});
  return {ok:true,json:async()=>url.endsWith('/refunds/'+refId)?providerRefund:providerOrder};
 };
 return {db,providerFetch,calls,rpcCalls};
}
test('only known refund webhook types and safe references are accepted',async()=>{
 const {eventHint}=await helper;
 assert.deepEqual(eventHint(event),{refundId:refId,providerOrderId:cfId});
 assert.equal(eventHint({...event,type:'PAYMENT_SUCCESS_WEBHOOK'}),null);
 assert.equal(eventHint({type:'REFUND_STATUS_WEBHOOK',data:{refund:{refund_id:'../escape'}}}),null);
 assert.equal(eventHint({type:'AUTO_REFUND_STATUS_WEBHOOK',data:{refund:{refund_id:refId}}}).refundId,refId);
});
test('verified provider GET-only evidence records one refund state without initiating money movement',async()=>{
 const {syncVerifiedRefund}=await helper,f=fixture();
 const result=await syncVerifiedRefund({event,db:f.db,providerFetch:f.providerFetch,appId:'test-app',secret:'test-secret'});
 assert.equal(result.status,'succeeded');
 assert.equal(f.calls.length,2);
 assert.ok(f.calls.every(c=>c.method==='GET'&&c.url.startsWith('https://api.cashfree.com/pg/orders/')));
 assert.deepEqual(f.rpcCalls,[{name:'bite_record_verified_refund_observation',args:{
  p_job_id:jid,p_provider_refund_id:refId,p_status:'SUCCESS',p_amount:174,p_currency:'INR'}}]);
});
test('foreign restaurant, wrong amount, demo, or mismatched provider can never update a refund',async()=>{
 const {syncVerifiedRefund}=await helper;
 for(const patch of [{job:{restaurant_id:'20000000-0000-0000-0000-000000000002'}},
 {order:{is_demo:true}},{fin:{customer_payable_amount:173}},
 {providerOrder:{order_status:'ACTIVE'}},{providerRefund:{refund_amount:173}},
 {providerRefund:{refund_status:'BOGUS'}},{intent:{status:'awaiting_payment'}}]){
  const f=fixture(patch);
  await assert.rejects(syncVerifiedRefund({event,db:f.db,providerFetch:f.providerFetch,appId:'x',secret:'y'}),
    /mismatch|Invalid|Unknown|unavailable/);
  assert.equal(f.rpcCalls.length,0,'No ledger mutation after mismatch');
  assert.ok(f.calls.every(c=>c.method==='GET'),'Never POST to provider');
 }
});
test('webhook must validate signature before calling the refund sync helper',()=>{
 const source=fs.readFileSync('supabase/functions/cashfree-webhook/index.ts','utf8');
 assert.ok(source.indexOf('if(!safeEqual(expected,signature))')<source.indexOf('if(REFUND_EVENTS.has(event?.type))'));
 assert.match(source,/providerFetch:fetch,appId,secret/);
 assert.doesNotMatch(source.slice(source.indexOf('if(REFUND_EVENTS.has(event?.type))'),source.indexOf('if(event?.type!=="PAYMENT_SUCCESS_WEBHOOK")')),/method:\s*"POST"/);
});
