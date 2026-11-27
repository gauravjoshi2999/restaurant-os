'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const src=stripTypeScriptTypes(fs.readFileSync('supabase/functions/bite-live-create-session/index.ts','utf8').replace(/^import .*;\s*$/gm,''),{mode:'strip'});
const id='c8b86ab2-1da4-4f47-a9d4-11ea56b8c311',ref='bite_live_'+id.replaceAll('-','');
async function run({attemptAge=null,providerRef=null,createdAge=null,providerAge=0,orderExpiryMinutes=20,collision=false,owner='customer-1',cfStatus='ACTIVE',confirmationRequired=false,confirmation=null,claimResult=null,claimError=false}={}){
 let handler,providerCalls=0,submitted=null,updates=[],claims=[];
 const intent={id,customer_id:owner,restaurant_id:'restaurant-1',amount:100,currency:'INR',status:'awaiting_payment',confirmation_required:confirmationRequired,provider_order_id:providerRef,provider_attempted_at:attemptAge===null?null:new Date(Date.now()-attemptAge*1000).toISOString(),priced_items:[{quantity:1,unit_price:100}],food_subtotal:100,delivery_fee:0,discount_amount:0,customer_snapshot:{full_name:'QA',phone:'9999999999'},created_at:new Date(Date.now()-(createdAge||0)*1000).toISOString()};
 const query=(table)=>{let lastUpdate=null;
  const q={select(){return q;},eq(){return q;},lt(){return q;},is(){return q;},update(v){lastUpdate=v;updates.push(v);return q;},
   async maybeSingle(){return{data:lastUpdate?{id}:table==='bite_order_confirmations'?confirmation:table==='customer_contact_profiles'?null:intent,error:null}}};
  return q;
 };
 const client={auth:{getUser:async()=>({data:{user:{id:'customer-1',email:'qa@example.invalid'}},error:null})},from:query,rpc:async(name,args)=>{assert.equal(name,'bite_claim_channel_payment_attempt');assert.equal(args.p_intent_id,id);assert.equal(args.p_customer_id,'customer-1');claims.push({name,args});if(claimError)return{data:null,error:{message:'Synthetic DB unavailable'}};const data=claimResult??(attemptAge!==null?'retry':providerRef?'reconcile':'claimed');if(data==='claimed')updates.push({provider_attempted_at:new Date().toISOString()});return{data,error:null}}};
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
 const result=await handler(request);return{status:result.status,payload:await result.json(),providerCalls,submitted,updates,claims};
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

test('payment request is blocked before restaurant owner approval without calling Cashfree',async()=>{
 const none=await run({confirmationRequired:true});
 assert.equal(none.status,409);assert.equal(none.payload.status,'confirmation_required');assert.equal(none.providerCalls,0);
 const pending=await run({confirmationRequired:true,confirmation:{state:'pending',expires_at:new Date(Date.now()+120000).toISOString()}});
 assert.equal(pending.status,409);assert.equal(pending.payload.status,'confirmation_pending');assert.equal(pending.providerCalls,0);
 const rejected=await run({confirmationRequired:true,confirmation:{state:'rejected'}});
 assert.equal(rejected.status,409);assert.equal(rejected.payload.status,'confirmation_rejected');assert.equal(rejected.providerCalls,0);
});
test('approved restaurant snapshot permits only fresh confirmed payments',async()=>{
 const approved={state:'approved',reviewed_at:new Date().toISOString()};
 const fresh=await run({confirmationRequired:true,confirmation:approved});
 assert.equal(fresh.status,200);
 assert.equal(fresh.providerCalls,1);
 const stale=await run({confirmationRequired:true,confirmation:{state:'approved',reviewed_at:new Date(Date.now()-9*60000).toISOString()}});
 assert.equal(stale.status,409);assert.equal(stale.payload.status,'confirmation_expired');assert.equal(stale.providerCalls,0);
});

test('new payment claim fails closed before any Cashfree call',async()=>{for(const [claimResult,status,body] of [['menu_changed',409,'menu_changed'],['not_payable',409,'payment_check_required'],['reconcile',409,'payment_check_required'],['unexpected',409,'payment_check_required']]){const r=await run({claimResult});assert.equal(r.status,status);assert.equal(r.payload.status,body);assert.equal(r.providerCalls,0);assert.equal(r.claims.length,1);assert.equal(r.updates.length,0)}const r=await run({claimError:true});assert.equal(r.status,503);assert.equal(r.providerCalls,0);assert.equal(r.claims.length,1)});
test('fresh retry does not overwrite original claim time',async()=>{const r=await run({attemptAge:3,collision:true});assert.equal(r.status,200);assert.equal(r.claims.length,1);assert.ok(!r.updates.some(x=>x.provider_attempted_at));});
