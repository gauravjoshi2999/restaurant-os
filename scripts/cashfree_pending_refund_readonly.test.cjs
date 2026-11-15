'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const backend=fs.readFileSync('supabase/functions/bite-cashfree-operations/index.ts','utf8');
const start=backend.indexOf('if(body.action==="inspect_refund"){');
const end=backend.indexOf('if(body.action==="inspect_split"){',start);
assert.ok(start>0&&end>start,'Expected distinct, narrowly-scoped preview action');
const preview=backend.slice(start,end);

test('pending refund inspection is independent of the approve-or-execute guard',()=>{
 assert.match(backend,/\["reconcile","inspect_split","inspect_vendor","inspect_vendor_recon","inspect_refund","execute_refund","check_refund"\]/);
 assert.match(backend,/if\(body\.action!=="inspect_refund"&&/);
 assert.match(backend,/!job\.approved_by\|\|!job\.approved_at/);
 assert.match(backend,/Deno\.env\.get\("BITE_PROVIDER_REFUNDS_ENABLED"\)!=="true"/);
 assert.match(backend,/body\.confirm!=="EXECUTE APPROVED REFUND"/);
});

test('refund preview never posts a refund, writes a ledger or changes an approval',()=>{
 assert.match(preview,/provider\("\/orders\/"\+cfId\)/);
 assert.match(preview,/provider\("\/orders\/"\+cfId\+"\/refunds\/"\+/);
 assert.match(preview,/record\.r\.status===404/);
 assert.match(preview,/no_action_taken:true/);
 for(const disallowed of ['method:"POST"','.insert(','.update(','.upsert(','.delete(',
  '.rpc("bite_record_provider_refund"','execute_refund','refund_speed'])
  assert.equal(preview.includes(disallowed),false,'Disallowed operation in refund preview: '+disallowed);
});

test('provider result is only accepted for exact paid order and refund amount',()=>{
 for(const required of [
  'job.restaurant_id!==order.restaurant_id',
  'job.customer_id!==order.customer_id',
  'job.provider_refund_id',
  'Number(job.amount)>Number(intent.amount)',
  'financial?.payment_status!=="paid"',
  'exactMoney(financial.customer_payable_amount,intent.amount)',
  'collection.data?.order_status!=="PAID"',
  'collection.data?.order_id!==intent.provider_order_id',
  'cf.order_id!==intent.provider_order_id',
  'cf.refund_id!==job.provider_refund_id',
  'cf.refund_currency!=="INR"',
  '!exactMoney(cf.refund_amount,job.amount)'
 ])assert.ok(preview.includes(required),'Missing strict evidence guard: '+required);
});

test('404 and matching refund record never mean a refund was created or verified bank credit',()=>{
 assert.match(preview,/status:"NO_PROVIDER_REFUND_RECORD"/);
 assert.match(preview,/status:"PROVIDER_REFUND_RECORD_FOUND"/);
 assert.match(preview,/No refund record was found. Do not infer approval/);
 assert.match(preview,/No refund is approved, created, retried or bank-confirmed/);
 assert.ok(!preview.includes('bank_credit:"VERIFIED"'));
 assert.ok(!preview.includes('refund_approved:true'));
});

test('only authenticated platform admins may read any refund provider status',()=>{
 const auth=backend.slice(0,backend.indexOf('  let body:any'));
 assert.match(auth,/client\.auth\.getUser\(\)/);
 assert.match(auth,/client\.rpc\("is_platform_admin"\)/);
 assert.match(auth,/admin!==true/);
 assert.match(backend,/if\(!uuid\(body\.refund_id\)\)/);
});


// Regression coverage for the live ₹1 pilot: a positive read-only provider
// preflight is a prerequisite, never evidence that a refund was executed.
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
async function runManualRefundProbe(overrides={}){
 const orderId='262b6281-b0a0-46ff-8fea-7e81ba4336b8';
 const intentId='11111111-1111-4111-8111-111111111111';
 const jobId='d0cd5580-1f10-4a6e-a10c-e599eb903601';
 const cfOrderId='bite_live_'+intentId.replaceAll('-','');
 const cfRefundId='bite_rf_'+jobId.replaceAll('-','');
 const order={id:orderId,restaurant_id:'restaurant-a',customer_id:'customer-a',amount:1,
  is_demo:false,channel:'Own Platform'};
 const intent={id:intentId,amount:1,currency:'INR',status:'activated',provider_order_id:cfOrderId};
 const finance={payment_status:'paid',currency:'INR',customer_payable_amount:1,refund_amount_actual:0};
 const job={id:jobId,order_id:orderId,status:'approved',amount:1,
  restaurant_id:'restaurant-a',customer_id:'customer-a',provider_refund_id:cfRefundId,
  approved_by:'admin-a',approved_at:'2026-11-15T06:56:46Z',attempts:0,
  updated_at:'2026-11-15T06:56:46Z',reason:'Customer cancelled before acceptance'};
 Object.assign(order,overrides.order||{});
 Object.assign(intent,overrides.intent||{});
 Object.assign(finance,overrides.finance||{});
 Object.assign(job,overrides.job||{});
 let handle,claimed=false,recorded=0;
 const providerCalls=[];
 const provider=async(url,opts={})=>{
  const method=opts.method||'GET';
  providerCalls.push({url,method});
  const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
  if(url.endsWith('/refunds/'+encodeURIComponent(cfRefundId))){
   if(overrides.existingExact||claimed)
    return response({order_id:cfOrderId,refund_id:cfRefundId,refund_currency:'INR',
     refund_amount:1,refund_status:'PENDING'});
   return response({},404);
  }
  if(url.endsWith('/refunds')){
   if(method==='POST')return response({refund_id:cfRefundId});
   return response(overrides.otherRefunds?[{refund_id:'different-refund'}]:[]);
  }
  if(url.endsWith('/orders/'+encodeURIComponent(cfOrderId)))
   return response({order_id:cfOrderId,order_status:overrides.providerStatus||'PAID',
    order_currency:'INR',order_amount:overrides.providerAmount??1});
  return response({},404);
 };
 const service={
  from(name){
   let updateValue=null;
   const q={select(){return q;},eq(){return q;},update(value){updateValue=value;return q;},
    async maybeSingle(){
     if(updateValue){claimed=true;return {data:{id:jobId},error:null};}
     return {data:({bite_refund_jobs:job,orders:order,bite_live_checkout_intents:intent,
      order_financials:finance})[name]||null,error:null};
    }};
   return q;
  },
  async rpc(name){if(name!=='bite_record_provider_refund')throw Error('Unexpected mutation '+name);
   recorded++;return {data:'submitted',error:null};}
 };
 const auth={auth:{getUser:async()=>({data:{user:{id:'admin-a'}},error:null})},
  rpc:async name=>({data:name==='is_platform_admin',error:null})};
 const original=fs.readFileSync('supabase/functions/bite-cashfree-operations/index.ts','utf8');
 const source=stripTypeScriptTypes(original.replace(/^import .*;\n/gm,'').replace(/\bexport function\b/g,'function'),{mode:'strip'});
 const context={Deno:{serve:fn=>handle=fn,env:{get:key=>({
  SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon',
  SUPABASE_SERVICE_ROLE_KEY:'service',CASHFREE_APP_ID:'app',
  CASHFREE_SECRET_KEY:'secret',BITE_PROVIDER_REFUNDS_ENABLED:'true'
 })[key]}},createClient:(_url,key)=>key==='anon'?auth:service,
  parseCashfreeSplit(){},compareProviderVendorBank(){},parseVendorSettlementRecon(){},
  fetch:provider,Request,Response,AbortSignal,Date,Math,JSON,Number,String,RegExp,console};
 vm.createContext(context);
 vm.runInContext(source,context);
 const response=await handle(new Request('https://test.supabase.co/functions/v1/bite-cashfree-operations',{
  method:'POST',headers:{authorization:'Bearer test-admin','content-type':'application/json'},
  body:JSON.stringify({action:'execute_refund',refund_id:jobId,confirm:'EXECUTE APPROVED REFUND'})}));
 return {httpStatus:response.status,body:await response.json(),providerCalls,claimed,recorded};
}
test('manual refund pilot refuses Cashfree mismatch before any refund lookup or POST',async()=>{
 const r=await runManualRefundProbe({providerAmount:2});
 assert.equal(r.httpStatus,409);
 assert.equal(r.providerCalls.filter(x=>x.method==='POST').length,0);
 assert.equal(r.claimed,false);
});
test('manual refund pilot refuses a competing Cashfree refund without an additional POST',async()=>{
 const r=await runManualRefundProbe({otherRefunds:true});
 assert.equal(r.httpStatus,409);
 assert.equal(r.providerCalls.filter(x=>x.method==='POST').length,0);
 assert.equal(r.claimed,false);
});
test('manual refund pilot cannot POST again after any prior attempt',async()=>{
 const r=await runManualRefundProbe({job:{status:'processing',attempts:1}});
 assert.equal(r.httpStatus,409);
 assert.equal(r.providerCalls.filter(x=>x.method==='POST').length,0);
 assert.equal(r.claimed,false);
});
test('manual refund pilot may create at most one provider refund for a fresh approved order',async()=>{
 const r=await runManualRefundProbe();
 assert.equal(r.httpStatus,200);
 assert.equal(r.providerCalls.filter(x=>x.method==='POST').length,1);
 assert.equal(r.providerCalls.filter(x=>x.method==='GET').length,4);
 assert.equal(r.claimed,true);
 assert.equal(r.recorded,1);
 assert.equal(r.body.status,'submitted');
});
