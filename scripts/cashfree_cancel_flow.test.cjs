'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');

const raw=fs.readFileSync('supabase/functions/bite-live-cancel-checkout/index.ts','utf8').replace(/^import .*;\s*$/gm,'');
const script=stripTypeScriptTypes(raw,{mode:'strip'});
const id='4f6d750d-740d-4abc-a3de-8c705971205f';
const providerRef='bite_live_'+id.replaceAll('-','');

async function run({getStatuses=['ACTIVE'],patchStatus='TERMINATION_REQUESTED',storedStatus='awaiting_payment',owner='test-user',mismatch=false}={}){
 const getQueue=[...getStatuses];let lastStatus=getQueue[0]||'ACTIVE',getCount=0,patchCount=0,finalize=0,expire=0,verified=0;
 let handle;
 const intent={id,customer_id:owner,status:storedStatus,provider_order_id:providerRef,provider_attempted_at:'2026-11-12T02:00:00Z',activated_order_id:null,created_at:'2026-11-12T02:00:00Z',amount:150,currency:'INR'};
 function builder(){
  let data=null;
  const chain={select(){return chain;},eq(){return chain;},is(){return chain;},lt(){return chain;},
   update(value){data=value;return chain;},
   async maybeSingle(){
    if(data){
     if(data.status==='expired'){expire++;intent.status='expired';}
     if(data.status==='payment_verified'){verified++;intent.status='payment_verified';}
     return{data:{id},error:null};
    }
    return{data:intent,error:null};
   }};
  return chain;
 }
 const client={auth:{getUser:async()=>({data:{user:{id:'test-user'}},error:null})},
  from:()=>builder(),rpc:async()=>{finalize++;return{data:'paid-order',error:null}}};
 const ctx={
  Deno:{env:{get:key=>({'SUPABASE_URL':'https://testing.supabase.co','SUPABASE_ANON_KEY':'public','SUPABASE_SERVICE_ROLE_KEY':'secret','CASHFREE_APP_ID':'app','CASHFREE_SECRET_KEY':'secret'})[key]},serve:fn=>handle=fn},
  createClient:()=>client,Response,Request,AbortSignal,Promise,Date,JSON,Number,String,Math,console,
  setTimeout:(fn)=>fn(),fetch:async (_url,opts={})=>{
   const method=opts.method||'GET';let status;
   if(method==='PATCH'){patchCount++;status=patchStatus;}
   else {getCount++;status=getQueue.length?getQueue.shift():lastStatus;lastStatus=status;}
   const payload={order_id:mismatch?'other':providerRef,order_currency:'INR',order_amount:150,order_status:status};
   return Response.json(payload);
  }
 };
 vm.createContext(ctx);vm.runInContext(script,ctx);
 const req=new Request('https://testing.supabase.co/functions/v1/bite-live-cancel-checkout',{method:'POST',headers:{authorization:'Bearer test-user', 'content-type':'application/json'},body:JSON.stringify({intent_id:id})});
 const res=await handle(req);
 return {status:res.status,body:await res.json(),getCount,patchCount,finalize,expire,verified};
}
test('one click follows Cashfree TERMINATION_REQUESTED to confirmed TERMINATED before cancelling locally',async()=>{
 const r=await run({getStatuses:['ACTIVE','TERMINATION_REQUESTED','TERMINATED']});
 assert.equal(r.status,200);assert.equal(r.body.cancelled,true);
 assert.equal(r.body.status,'expired');assert.equal(r.expire,1);
 assert.equal(r.patchCount,1);assert.ok(r.getCount>=3);
});
test('initial TERMINATION_REQUESTED is polled, not re-terminated',async()=>{
 const r=await run({getStatuses:['TERMINATION_REQUESTED','TERMINATED']});
 assert.equal(r.body.cancelled,true);assert.equal(r.patchCount,0);
});
test('a provider PAID status during cancellation never marks an order expired',async()=>{
 const r=await run({getStatuses:['ACTIVE','TERMINATION_REQUESTED','PAID']});
 assert.equal(r.body.status,'activated');assert.equal(r.body.cancelled,false);
 assert.equal(r.expire,0);assert.equal(r.finalize,1);
});
test('provider stays ACTIVE: payment stays blocked and no false cancelled response',async()=>{
 const r=await run({getStatuses:['ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE']});
 assert.equal(r.status,200);assert.equal(r.body.status,'cancellation_processing');
 assert.equal(r.body.cancelled,false);assert.equal(r.expire,0);
 assert.equal(r.finalize,0);
});
test('provider mismatch never cancels checkout',async()=>{
 const r=await run({getStatuses:['ACTIVE'],mismatch:true});
 assert.equal(r.status,409);assert.equal(r.body.cancelled,undefined);
 assert.equal(r.expire,0);
});
test('another user cannot cancel a checkout',async()=>{
 const r=await run({owner:'other'});
 assert.equal(r.status,404);assert.equal(r.expire,0);assert.equal(r.patchCount,0);
});
