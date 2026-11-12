'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/cashfree-sandbox-verify-draft/index.ts','utf8').replace(/^import .*;\n/gm,''),{mode:'strip'});
const draftId='11111111-1111-4111-8111-111111111111',cfId='bite_draft_'+draftId.replaceAll('-','');
async function attempt({paymentStatus='sandbox_unpaid',fulfillment='Awaiting Payment',provider='PAID',otherUser=false}={}){
 const draft={id:draftId,customer_id:otherUser?'different-user':'test-user',payable_amount:150,payment_status:paymentStatus,fulfillment_status:fulfillment};
 const calls=[];let handler;
 const query=()=>{
  let payload=null,filters=[];
  const qb={
   select(){return qb},eq(k,v){filters.push([k,v]);return qb},
   update(x){payload=x;return qb},
   async maybeSingle(){return {data:{...draft},error:null}},
   then(resolve){if(payload){
     calls.push({payload,filters});
     if(filters.every(([k,v])=>draft[k]===v))Object.assign(draft,payload);
    }
    return resolve({error:null});
   }
  };
  return qb;
 };
 const createClient=(_url,key)=>key==='anon'?{
  auth:{getUser:async()=>({data:{user:{id:'test-user'}}})}
 }:{from:()=>query()};
 const Deno={env:{get:k=>({SUPABASE_URL:'url',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',CASHFREE_TEST_APP_ID:'app',CASHFREE_TEST_SECRET_KEY:'secret'})[k]},serve:x=>{handler=x}};
 const fetch=async()=>({status:provider==='NOT_CREATED'?404:200,ok:true,json:async()=>({order_id:cfId,order_currency:'INR',order_amount:150,order_status:provider})});
 vm.runInNewContext(source,{Deno,createClient,fetch,Request,Response,JSON,Math,Number,String,Date,console});
 const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{authorization:'Bearer test-token'},body:JSON.stringify({draft_id:draftId})}));
 return{http:response.status,data:await response.json(),draft,calls};
}
test('Cashfree PAID makes fresh sandbox draft actionable for restaurant owner',async()=>{
 const x=await attempt();assert.equal(x.http,200);assert.equal(x.data.verified,true);
 assert.equal(x.draft.payment_status,'sandbox_paid');assert.equal(x.draft.fulfillment_status,'Received');
 assert.equal(x.calls.length,2);
});
test('verification never rewinds an already-processed sandbox order',async()=>{
 const x=await attempt({paymentStatus:'sandbox_paid',fulfillment:'Completed'});
 assert.equal(x.data.verified,true);assert.equal(x.draft.fulfillment_status,'Completed');
 assert.equal(x.calls.length,1);
});
test('unpaid Cashfree cannot become received or paid',async()=>{
 const x=await attempt({provider:'ACTIVE'});
 assert.equal(x.data.verified,false);assert.equal(x.draft.payment_status,'sandbox_unpaid');
 assert.equal(x.draft.fulfillment_status,'Awaiting Payment');assert.equal(x.calls.length,0);
});
test('another customer cannot confirm someone else sandbox draft',async()=>{
 const x=await attempt({otherUser:true});
 assert.equal(x.http,404);assert.equal(x.calls.length,0);
});
