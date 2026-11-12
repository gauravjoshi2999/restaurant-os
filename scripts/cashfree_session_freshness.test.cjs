'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const src=stripTypeScriptTypes(fs.readFileSync('supabase/functions/bite-live-create-session/index.ts','utf8').replace(/^import .*;\s*$/gm,''),{mode:'strip'});
const id='c8b86ab2-1da4-4f47-a9d4-11ea56b8c311',ref='bite_live_'+id.replaceAll('-','');
async function run({attemptAge=null,providerRef=null,createdAge=null,providerAge=0,orderExpiryMinutes=20,collision=false,owner='customer-1',cfStatus='ACTIVE'}={}){
 let handler,providerCalls=0,submitted=null,updates=[];
 const intent={id,customer_id:owner,restaurant_id:'restaurant-1',amount:100,currency:'INR',status:'awaiting_payment',provider_order_id:providerRef,provider_attempted_at:attemptAge===null?null:new Date(Date.now()-attemptAge*1000).toISOString(),priced_items:[{quantity:1,unit_price:100}],food_subtotal:100,delivery_fee:0,discount_amount:0,customer_snapshot:{full_name:'QA',phone:'9999999999'},created_at:new Date(Date.now()-(createdAge||0)*1000).toISOString()};
 const query=(table)=>{let lastUpdate=null;
  const q={select(){return q;},eq(){return q;},lt(){return q;},is(){return q;},update(v){lastUpdate=v;updates.push(v);return q;},
   async maybeSingle(){return{data:lastUpdate?{id}:table==='customer_contact_profiles'?null:intent,error:null}}};
  return q;
 };
 const client={auth:{getUser:async()=>({data:{user:{id:'customer-1',email:'qa@example.invalid'}},error:null})},from:query};
 const ctx={Deno:{serve:fn=>handler=fn,env:{get:k=>({SUPABASE_URL:'https://qa.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',BITE_LIVE_CHECKOUT_ENABLED:'true',CASHFREE_APP_ID:'app',CASHFREE_SECRET_KEY:'secret'})[k]}},createClient:()=>client,Response,Request,AbortSignal,console,JSON,Date,Math,Number,String,encodeURIComponent,
 fetch:async(url,opts={})=>{
  providerCalls++;
  if((opts.method||'GET')==='POST'){
   submitted=JSON.parse(opts.body);if(collision)return Response.json({message:'exists'},{status:409});
  }
  return Response.json({order_id:ref,order_currency:'INR',order_amount:100,order_status:cfStatus,payment_session_id:'session_quick_fresh',created_at:new Date(Date.now()-providerAge*1000).toISOString(),order_expiry_time:new Date(Date.now()+orderExpiryMinutes*60*1000).toISOString()});
 }};
 vm.createContext(ctx);vm.runInContext(src,ctx);
 const request=new Request('https://qa.supabase.co/functions/v1/bite-live-create-session',{method:'POST',headers:{Authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify({intent_id:id})});
 const result=await handler(request);return{status:result.status,payload:await result.json(),providerCalls,submitted,updates};
}
test('a new Cashfree session has explicit order expiry and is delivered only when fresh',async()=>{
 const r=await run();assert.equal(r.status,200);assert.equal(r.payload.payment_session_id,'session_quick_fresh');
 assert.ok(Number.isFinite(Date.parse(r.payload.issued_at)));
 assert.ok(Date.parse(r.payload.expires_at)-Date.now()>10*60*1000);
 assert.ok(Date.parse(r.submitted.order_expiry_time)-Date.now()>10*60*1000);
 assert.ok(r.providerCalls===1);
});
test('a Cashfree provider order attempted minutes ago cannot reopen its session',async()=>{
 const r=await run({attemptAge:300,providerRef:ref});
 assert.equal(r.status,409);assert.equal(r.payload.status,'session_stale');assert.equal(r.providerCalls,0);
});
test('a Cashfree 409 GET returning an old ACTIVE session is not payable',async()=>{
 const r=await run({collision:true,providerAge:300,attemptAge:4});
 assert.equal(r.status,409);assert.equal(r.payload.status,'session_stale');assert.equal(r.providerCalls,2);
});
test('idempotent HTTP 200 response cannot revive an already expired Cashfree order session',async()=>{
 const r=await run({providerAge:240,attemptAge:5});
 assert.equal(r.status,409);assert.equal(r.payload.status,'session_stale');
 assert.equal(r.payload.payment_session_id,undefined);
});
test('a fast idempotent retry remains allowed when provider session is only seconds old',async()=>{
 const r=await run({collision:true,providerAge:5,attemptAge:3});
 assert.equal(r.status,200);assert.equal(r.payload.payment_session_id,'session_quick_fresh');
});
test('session nearing provider expiry cannot launch checkout',async()=>{
 const r=await run({orderExpiryMinutes:2});
 assert.equal(r.status,409);assert.equal(r.payload.status,'session_expiring');
});
test('a customer cannot request another customers fresh session',async()=>{
 const r=await run({owner:'someone-else'});
 assert.equal(r.status,404);assert.equal(r.providerCalls,0);
});
