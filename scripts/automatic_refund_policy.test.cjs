'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const sql=fs.readFileSync('supabase/patch_20261115_trusted_auto_refunds.sql','utf8');
const signedCron=fs.readFileSync('supabase/patch_20261115_auto_refund_signed_cron.sql','utf8');
const customer=fs.readFileSync('customer.html','utf8');
const edge=fs.readFileSync('supabase/functions/bite-auto-refund/index.ts','utf8');
const oid='22222222-2222-4222-8222-222222222222';
const intentId='11111111-1111-4111-8111-111111111111';
const jid='33333333-3333-4333-8333-333333333333';
const providerOrder='bite_live_'+intentId.replaceAll('-','');
const jobBase={id:jid,order_id:oid,status:'approved',auto_authorized_at:'2026-11-15T10:00:00Z',
 auto_rule:'CUSTOMER_BEFORE_ACCEPTANCE',amount:174,provider_refund_id:'bite_rf_'+jid.replaceAll('-',''),
 attempts:0,customer_id:'customer',restaurant_id:'restaurant'};
const orderBase={id:oid,customer_id:'customer',restaurant_id:'restaurant',status:'Cancelled',
 channel:'Own Platform',is_demo:false,amount:174};
const intentBase={id:intentId,customer_id:'customer',restaurant_id:'restaurant',status:'activated',
 provider_order_id:providerOrder,amount:174,currency:'INR'};
const ledgerBase={payment_status:'paid',currency:'INR',customer_payable_amount:174,refund_amount_actual:0};
function setup(o={}){
 const calls=[],rpc=[],rows=[];
 const job={...jobBase,...o.job},order={...orderBase,...o.order},intent={...intentBase,...o.intent},
  ledger={...ledgerBase,...o.ledger},config={auto_refunds_enabled:o.enabled??true,auto_refund_max_amount:2000};
 const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
 const provider=async(url,request={})=>{
  calls.push({url,method:request.method||'GET',headers:request.headers});
  if(url.endsWith('/refunds')&&request.method==='POST')return response({refund_id:job.provider_refund_id});
  if(url.endsWith('/refunds'))return response(o.otherRefund?[{refund_id:'something_else'}]:[]);
  if(url.includes('/refunds/')){
   if(o.existingRefund||calls.filter(c=>c.url.includes('/refunds/')&&c.method==='GET').length>1){
    return response({order_id:providerOrder,refund_id:job.provider_refund_id,refund_currency:'INR',
     refund_amount:174,refund_status:o.refundStatus||'PENDING'});
   }
   return response({},404);
  }
  return response({order_id:providerOrder,order_status:'PAID',order_currency:'INR',order_amount:o.providerAmount??174});
 };
 const service={from(name){
  let isList=false;
  const q={select:()=>q,eq:()=>q,not:()=>q,in:()=>q,order:()=>q,
   maybeSingle:async()=>({data:({bite_operations_config:config,orders:order,bite_refund_jobs:job,
    bite_live_checkout_intents:intent,order_financials:ledger})[name],error:null}),
   limit:async()=>({data:name==='bite_refund_jobs'?(o.list??[job]):[],error:null})};
  rows.push(name);return q;
 },rpc:async(name,args)=>{
  rpc.push({name,args});if(name==='bite_verify_auto_refund_dispatch')return{data:o.validSignature===true,error:null};
  if(name==='bite_claim_auto_refund')return{data:o.claimLost?false:true,error:null};
  if(name==='bite_record_provider_refund')return{data:o.refundStatus==='SUCCESS'?'succeeded':'submitted',error:null};
  return {data:null,error:new Error('Unexpected rpc')};
 }};
 let handler;
 const context={Deno:{serve:fn=>handler=fn,env:{get:name=>({
  SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',
  CASHFREE_APP_ID:'app',CASHFREE_SECRET_KEY:'secret',BITE_MAINTENANCE_SECRET:'maintenance'
 })[name]}},createClient:(url,key)=>key==='anon'?
  {auth:{getUser:async()=>({data:{user:o.invalidSession?null:{id:'customer'}},error:null})}}:service,
  fetch:provider,Response,Request,AbortSignal,URL,Date,JSON,Number,String,Math,Object,Array,RegExp,console,Set};
 vm.createContext(context);
 vm.runInContext(stripTypeScriptTypes(edge.replace(/^import .*;\n/gm,''),{mode:'strip'}),context);
 const run=async(action='run',key='Bearer session',extraHeaders={},extraBody={})=>{
  const res=await handler(new Request('https://project.supabase.co/functions/v1/bite-auto-refund',{
   method:'POST',headers:{authorization:key,'content-type':'application/json',...extraHeaders},
   body:JSON.stringify({...((action==='run')?{action,order_id:oid}:{action}),...extraBody})}));
  return{status:res.status,data:await res.json()};
 };
 return {run,calls,rpc,rows};
}
test('trusted SQL cancellation eligibility is narrow and new-only',()=>{
 assert.match(sql,/auto_refunds_enabled boolean not null default false/);
 assert.match(sql,/auto_authorized_at timestamptz/);
 assert.match(sql,/old.status='Received' and new.status='Cancelled'/);
 assert.match(sql,/Cancelled by customer before restaurant acceptance/);
 assert.match(sql,/new.status='Rejected'/);
 assert.match(sql,/OWNER_ACCEPTED_CANCELLATION/);
 assert.match(sql,/on conflict\(order_id\) do nothing/);
 assert.match(sql,/auto_refund_max_amount/);
 assert.match(sql,/auth.jwt\(\)->>'role',''\)<>'service_role'/);
 assert.match(sql,/j.status<>'approved'/);
 assert.match(sql,/j.attempts<>0/);
 assert.match(sql,/if j.status='succeeded' then return 'succeeded'/);
 assert.match(sql,/v_new_refund>f.customer_payable_amount/);
});
test('customer cancellation invokes separate auto worker only AFTER cancellation RPC succeeds',()=>{
 const mark="if(action==='cancel'){const {error}=await sb.rpc('customer_cancel_order'";
 assert.ok(customer.includes(mark));
 const section=customer.slice(customer.indexOf(mark),customer.indexOf("if(action==='review')",customer.indexOf(mark)));
 assert.match(section,/if\(error\)throw error/);
 assert.match(section,/functions.invoke\('bite-auto-refund'/);
 assert.match(section,/Cashfree confirmation/);
 assert.doesNotMatch(section,/Refund successful|refunded successfully/);
});
test('feature defaults off and does not call Cashfree',async()=>{
 const t=setup({enabled:false});
 const r=await t.run();assert.equal(r.data.status,'not_enabled');
 assert.equal(r.data.refund_sent,false);assert.equal(t.calls.length,0);
});
test('legacy manually approved refund without trusted auto evidence can never trigger POST',async()=>{
 const t=setup({job:{auto_authorized_at:null,auto_rule:null}});
 const r=await t.run();assert.equal(r.data.status,'review_required');
 assert.equal(t.calls.length,0);assert.equal(t.rpc.length,0);
});
test('completed paid order cannot be auto refunded',async()=>{
 const t=setup({order:{status:'Completed'}});
 const r=await t.run();assert.equal(r.data.status,'review_required');
 assert.equal(t.calls.length,0);
});
test('non-owner customer cannot trigger another customer refund',async()=>{
 const t=setup({order:{customer_id:'other-customer'}});
 const r=await t.run();assert.equal(r.status,404);
 assert.equal(t.calls.length,0);
});
test('provider amount mismatch stops before any refund POST',async()=>{
 const t=setup({providerAmount:173});
 const r=await t.run();assert.equal(r.data.status,'review_required');
 assert.equal(t.calls.filter(c=>c.method==='POST').length,0);
});
test('existing other provider refund prevents a second cash movement',async()=>{
 const t=setup({otherRefund:true});
 const r=await t.run();assert.equal(r.data.status,'review_required');
 assert.equal(t.calls.filter(c=>c.method==='POST').length,0);
});
test('only an atomic claim permits one idempotent Cashfree refund POST',async()=>{
 const t=setup();
 const r=await t.run();assert.equal(r.data.status,'processing');
 const posts=t.calls.filter(c=>c.method==='POST');
 assert.equal(posts.length,1);assert.equal(posts[0].headers['x-idempotency-key'],jid);
 assert.equal(t.rpc[0].name,'bite_claim_auto_refund');
 assert.equal(t.rpc.at(-1).name,'bite_record_provider_refund');
});
test('concurrent claim loser never sends refund',async()=>{
 const t=setup({claimLost:true});
 const r=await t.run();assert.equal(r.data.status,'already_processing');
 assert.equal(t.calls.filter(c=>c.method==='POST').length,0);
});
test('existing refund uses only GET and provider status recording',async()=>{
 const t=setup({existingRefund:true,job:{status:'submitted',attempts:1}});
 const r=await t.run();assert.equal(r.data.status,'processing');
 assert.equal(t.calls.filter(c=>c.method==='POST').length,0);
 assert.equal(t.rpc.length,1);assert.equal(t.rpc[0].name,'bite_record_provider_refund');
});
test('unauthenticated and fake cron requests cannot access refunds',async()=>{
 const t=setup({invalidSession:true});
 assert.equal((await t.run()).status,401);
 assert.equal((await t.run('drain','Bearer fake')).status,401);
 assert.equal(t.calls.length,0);
});

test('cron worker accepts only a private Vault-signed request and checks rollout flag',async()=>{
 const t=setup({validSignature:true,enabled:false});
 const response=await t.run('drain','',{
  'x-bite-auto-refund-ts':'1794731234',
  'x-bite-auto-refund-signature':'a'.repeat(64)});
 assert.equal(response.status,200);
 assert.equal(response.data.status,'not_enabled');
 assert.equal(t.calls.length,0);
 assert.equal(t.rpc.length,1);
 assert.equal(t.rpc[0].name,'bite_verify_auto_refund_dispatch');
});
test('forged cron headers are rejected before Cashfree and before reading refund jobs',async()=>{
 const t=setup({validSignature:false});
 const response=await t.run('drain','',{
  'x-bite-auto-refund-ts':'1794731234',
  'x-bite-auto-refund-signature':'f'.repeat(64)});
 assert.equal(response.status,401);
 assert.equal(t.calls.length,0);
 assert.equal(t.rpc.length,1);
});
test('Vault scheduler is server signed, service-only and feature-gated',()=>{
 assert.match(signedCron,/vault\.create_secret/);
 assert.match(signedCron,/extensions\.gen_random_bytes\(32\)/);
 assert.match(signedCron,/extensions\.hmac\(/);
 assert.match(signedCron,/abs\(extract\(epoch from clock_timestamp\(\)\)::bigint-p_timestamp\)>90/);
 assert.match(signedCron,/service_role/);
 assert.match(signedCron,/auto_refunds_enabled=true/);
 assert.match(signedCron,/cron\.schedule\(/);
 assert.match(signedCron,/bite_private\.dispatch_auto_refund_queue\(\)/);
 assert.match(edge,/bite_verify_auto_refund_dispatch/);
 assert.match(edge,/x-bite-auto-refund-signature/);
 assert.doesNotMatch(signedCron,/CASHFREE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test('signed preflight checks existing Cashfree PAID and refunds with GET only while rollout OFF',async()=>{
 const t=setup({enabled:false,validSignature:true});
 const result=await t.run('drain','',{
  'x-bite-auto-refund-ts':'1794731234',
  'x-bite-auto-refund-signature':'a'.repeat(64)},
  {mode:'preflight',order_id:oid});
 assert.equal(result.status,200);
 assert.equal(result.data.result,'PAID_MATCHES_NO_REFUND');
 assert.equal(result.data.live_refunds_enabled,false);
 assert.equal(result.data.refund_sent,false);
 assert.deepEqual(t.calls.map(c=>c.method),['GET','GET']);
 assert.equal(t.rpc[0].name,'bite_verify_auto_refund_dispatch');
 assert.ok(!t.rpc.some(x=>x.name==='bite_claim_auto_refund'||x.name==='bite_record_provider_refund'));
});
test('preflight refuses mismatched provider paid amount and never issues refunds',async()=>{
 const t=setup({enabled:false,validSignature:true,providerAmount:173});
 const result=await t.run('drain','',{
  'x-bite-auto-refund-ts':'1794731234','x-bite-auto-refund-signature':'a'.repeat(64)},
  {mode:'preflight',order_id:oid});
 assert.equal(result.data.result,'CASHFREE_PAYMENT_MISMATCH');
 assert.equal(result.data.refund_sent,false);
 assert.equal(t.calls.length,1);
 assert.equal(t.calls[0].method,'GET');
});
test('preflight rejects forged signature and customer mode override without provider access',async()=>{
 const invalid=setup({enabled:false,validSignature:false});
 const h={'x-bite-auto-refund-ts':'1794731234',
  'x-bite-auto-refund-signature':'f'.repeat(64)};
 assert.equal((await invalid.run('drain','',h,{mode:'preflight',order_id:oid})).status,401);
 assert.equal(invalid.calls.length,0);
 const customer=setup({enabled:false});
 assert.equal((await customer.run('run','Bearer session',{}, {mode:'preflight',order_id:oid})).status,400);
 assert.equal(customer.calls.length,0);
});
test('signed preflight of completed or corrupted financial order stops without provider requests',async()=>{
 const t=setup({enabled:false,validSignature:true,order:{status:'Completed'}});
 const result=await t.run('drain','',{
 'x-bite-auto-refund-ts':'1794731234',
 'x-bite-auto-refund-signature':'a'.repeat(64)},{mode:'preflight',order_id:oid});
 assert.equal(result.data.result,'INTERNAL_MISMATCH_OR_INELIGIBLE');
 assert.equal(t.calls.length,0);
});
