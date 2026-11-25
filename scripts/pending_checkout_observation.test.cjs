'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const helper=import('../supabase/functions/bite-auto-refund/checkout-observation.mjs');
const iid='11111111-1111-4111-8111-111111111111',
 customer='22222222-2222-4222-8222-222222222222',restaurant='33333333-3333-4333-8333-333333333333';
const cfId='bite_live_'+iid.replaceAll('-','');
const old='2026-11-09T03:37:06.520Z',now=Date.parse('2026-11-24T15:30:00Z');
const base={id:iid,customer_id:customer,restaurant_id:restaurant,amount:'174.00',currency:'INR',
 status:'awaiting_payment',provider_order_id:cfId,activated_order_id:null,created_at:old};
function fixture(o={}){
 const rows=o.rows??[{...base,...o.intent}],calls=[],reads=[];
 const db={from(table){
  assert.equal(table,'bite_live_checkout_intents','Observation must never read or mutate refund/financial/config tables');
  const state={table,filters:[],sort:[]};reads.push(state);
  const q={select(v){state.fields=v;return q;},eq(k,v){state.filters.push([k,v]);return q;},
   lt(k,v){state.before=[k,v];return q;},order(k,v){state.sort.push([k,v]);return q;},
   async range(a,b){state.range=[a,b];return {data:rows.slice(a,b+1),error:o.dbError?{}:null};},
   async maybeSingle(){const id=state.filters.find(([k])=>k==='id')?.[1];
    return {data:rows.find(r=>r.id===id)?{...rows.find(r=>r.id===id),...o.fresh}:null,error:null};}
  };
  return q;
 },rpc(){throw Error('Observation cannot call an RPC');}};
 const providerFetch=async(url,options)=>{
  calls.push({url,options});
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  if(o.networkError)throw Error('Provider timeout with private raw payload');
  const id=decodeURIComponent(url.split('/orders/')[1].split('/')[0]);
  const local=rows.find(r=>'bite_live_'+r.id.replaceAll('-','')===id)||base;
  const data=url.endsWith('/payments')?(o.payments??[]):{
   order_id:id,order_amount:local.amount,order_currency:'INR',order_status:'EXPIRED',
   customer_details:{customer_id:local.customer_id,customer_phone:'PRIVATE_PHONE'},
   payment_session_id:'PRIVATE_SESSION',...o.providerOrder};
  return new Response(JSON.stringify(data),{status:url.endsWith('/payments')?(o.paymentHttp??200):(o.orderHttp??200)});
 };
 return {db,providerFetch,calls,reads,run:async(offset=0)=>(await helper).observePendingCheckouts({
  db,providerFetch,appId:'PRIVATE_APP',secret:'PRIVATE_SECRET',offset,now})};
}
const success={cf_payment_id:'12345',order_id:cfId,payment_amount:174,payment_currency:'INR',payment_status:'SUCCESS'};

test('stale pending checkouts are selected oldest-first, six per batch, without any write API',async()=>{
 const rows=Array.from({length:7},(_,i)=>({...base,id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),provider_order_id:null}));
 const f=fixture({rows}),a=await f.run(),b=await f.run(6);
 assert.equal(a.examined,6);assert.equal(b.examined,1);assert.equal(f.calls.length,14);
 const query=f.reads[0];
 assert.deepEqual(query.filters,[['status','awaiting_payment']]);
 assert.deepEqual(query.sort,[['created_at',{ascending:true}],['id',{ascending:true}]]);
 assert.deepEqual(query.range,[0,5]);
 assert.deepEqual(query.before,['created_at',new Date(now-30*60000).toISOString()]);
 assert.ok(f.calls.every(c=>/^https:\/\/api\.cashfree\.com\/pg\/orders\/bite_live_[0-9a-f]{32}(\/payments)?$/.test(c.url)));
});
test('missing stored reference probes the existing canonical ID and only returns aggregate evidence',async()=>{
 const f=fixture({intent:{provider_order_id:null}}),r=await f.run();
 assert.equal(r.reference_missing,1);assert.equal(r.order_statuses.EXPIRED,1);
 assert.equal(r.orders_with_no_payment_attempts,1);assert.equal(r.payment_attempts,0);
 const output=JSON.stringify(r);
 for(const privateValue of [iid,customer,restaurant,cfId,'PRIVATE_PHONE','PRIVATE_SESSION','PRIVATE_APP','PRIVATE_SECRET'])
  assert.equal(output.includes(privateValue),false);
 assert.equal(r.no_action_taken,true);assert.equal(r.order_activated,false);
 assert.equal(r.charge_sent,false);assert.equal(r.refund_sent,false);
 assert.equal(r.bank_credit_independently_verified,false);
});
test('provider PAID plus one matching SUCCESS is observed without activating, charging or refunding',async()=>{
 const f=fixture({providerOrder:{order_status:'PAID'},payments:[success]}),r=await f.run();
 assert.equal(r.order_statuses.PAID,1);assert.equal(r.payment_statuses.SUCCESS,1);
 assert.equal(r.paid_without_matching_success,0);assert.equal(r.order_activated,false);
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.options.method==='GET'));
});
test('contradictory, duplicate-success and missing-success evidence is flagged for investigation',async()=>{
 const active=await fixture({providerOrder:{order_status:'ACTIVE'},payments:[success]}).run();
 assert.equal(active.success_without_paid_order,1);
 const duplicate=await fixture({providerOrder:{order_status:'PAID'},payments:[success,{...success,cf_payment_id:'12346'}]}).run();
 assert.equal(duplicate.multiple_successes,1);assert.equal(duplicate.paid_without_matching_success,1);
 const absent=await fixture({providerOrder:{order_status:'PAID'}}).run();
 assert.equal(absent.paid_without_matching_success,1);
});
test('404, provider failures and network timeouts never become an unpaid or successful verdict',async()=>{
 const f=fixture({orderHttp:404}),r=await f.run();
 assert.equal(r.provider_not_found,1);assert.equal(f.calls.length,1);
 assert.equal(Object.values(r.order_statuses).reduce((a,b)=>a+b,0),0);
 assert.equal(r.payment_statuses.SUCCESS,0);assert.equal('unpaid' in r,false);
 assert.equal((await fixture({orderHttp:503}).run()).provider_unavailable,1);
 assert.equal((await fixture({networkError:true}).run()).provider_unavailable,1);
});
test('provider identity, amount, customer, currency and unknown status mismatches fail closed',async()=>{
 for(const providerOrder of [{order_id:'other'},{order_amount:173},{order_currency:'USD'},
  {customer_details:{customer_id:'foreign'}},{customer_details:null},{order_status:'ARBITRARY_STATUS'}]){
  const f=fixture({providerOrder}),r=await f.run();
  assert.equal(r.provider_mismatch,1);assert.equal(f.calls.length,1);
  assert.equal(Object.values(r.order_statuses).reduce((a,b)=>a+b,0),0);
 }
});
test('malformed, activated, recent, foreign-reference and invalid-money intents never contact Cashfree',async()=>{
 for(const intent of [{id:'bad'},{customer_id:'bad'},{restaurant_id:'bad'},
  {status:'activated'},{activated_order_id:iid},{currency:'USD'},{amount:0},{amount:-1},
  {amount:'174.001'},{amount:true},{provider_order_id:'../other'},
  {created_at:new Date(now).toISOString()}]){
  const f=fixture({intent}),r=await f.run();assert.equal(r.invalid_intent,1);assert.equal(f.calls.length,0);
 }
});
test('changed tenant, customer, amount or checkout state invalidates an in-flight observation',async()=>{
 for(const fresh of [{restaurant_id:customer},{customer_id:restaurant},{amount:175},
  {status:'activated'},{provider_order_id:null},{activated_order_id:iid}]){
  const r=await fixture({fresh}).run();assert.equal(r.changed_during_check,1);
  assert.equal(Object.values(r.order_statuses).reduce((a,b)=>a+b,0),0);
 }
});
test('unavailable payments remain unknown while a matched order status is retained separately',async()=>{
 const r=await fixture({paymentHttp:503}).run();
 assert.equal(r.order_statuses.EXPIRED,1);assert.equal(r.payment_lookup_unavailable,1);
 assert.equal(r.orders_with_no_payment_attempts,0);assert.equal(r.payment_attempts,0);
});
test('malformed payments, duplicate IDs and foreign payment evidence cannot establish success',async()=>{
 for(const payments of [{data:[success]},[{...success,order_id:'other'}],
  [{...success,payment_amount:173}],[{...success,payment_currency:'USD'}],
  [{...success,cf_payment_id:'bad'}],[{...success,payment_status:'MYSTERY'}],[success,success]]){
  const r=await fixture({payments}).run();assert.equal(r.payment_response_mismatch,1);
  assert.equal(r.payment_statuses.SUCCESS,0);assert.equal(r.payment_attempts,0);
 }
});
test('each documented unsuccessful or pending payment status stays distinct',async()=>{
 const statuses=['NOT_ATTEMPTED','FAILED','USER_DROPPED','VOID','CANCELLED','PENDING'];
 const r=await fixture({payments:statuses.map((s,i)=>({...success,cf_payment_id:String(i+1),payment_status:s}))}).run();
 for(const status of statuses)assert.equal(r.payment_statuses[status],1);
 assert.equal(r.payment_statuses.SUCCESS,0);assert.equal(r.payment_attempts,6);
});
test('invalid offsets, credentials and failed database reads stop before provider requests',async()=>{
 for(const offset of [-1,0.5,'0',10001]){
  const f=fixture();await assert.rejects(f.run(offset),/offset/);assert.equal(f.calls.length,0);
 }
 const f=fixture({dbError:true});await assert.rejects(f.run(),/unavailable/);assert.equal(f.calls.length,0);
 await assert.rejects((await helper).observePendingCheckouts({db:f.db,providerFetch:f.providerFetch,appId:'',secret:''}),/unavailable/);
});

async function handlerFixture({validSignature=true,action='drain',mode='checkout_inspect',offset=0,header=true,source}={}){
 let handle;const f=fixture(),authCalls=[];
 const service={...f.db,async rpc(name,args){authCalls.push({name,args});
  assert.equal(name,'bite_verify_auto_refund_dispatch');return {data:validSignature,error:null};}};
 const context={Deno:{serve:fn=>handle=fn,env:{get:key=>({
  SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',
  CASHFREE_APP_ID:'PRIVATE_APP',CASHFREE_SECRET_KEY:'PRIVATE_SECRET'
 })[key]}},createClient:(_url,key)=>{assert.equal(key,'service');return service;},
 observePendingCheckouts:(await helper).observePendingCheckouts,fetch:f.providerFetch,Request,Response,AbortSignal,console};
 vm.createContext(context);
 vm.runInContext(stripTypeScriptTypes((source??fs.readFileSync('supabase/functions/bite-auto-refund/index.ts','utf8')).replace(/^import .*;\n/gm,''),{mode:'strip'}),context);
 const req=new Request('https://test.supabase.co/functions/v1/bite-auto-refund',{method:'POST',
  headers:{'content-type':'application/json',...(header?{
   'x-bite-auto-refund-ts':'1795534200','x-bite-auto-refund-signature':'a'.repeat(64)}:{})},
  body:JSON.stringify({action,mode,offset})});
 const response=await handle(req);return {status:response.status,data:await response.json(),authCalls,...f};
}
test('signed internal diagnostic works without reading or enabling refund policy and cannot reach a money action',async()=>{
 const r=await handlerFixture();assert.equal(r.status,200);assert.equal(r.data.status,'checkout_observation');
 assert.equal(r.authCalls.length,1);assert.equal(r.calls.length,2);
 assert.ok(r.reads.every(q=>q.table==='bite_live_checkout_intents'));
});
test('forged, missing, customer-mode and invalid-offset requests cannot inspect pending checkouts',async()=>{
 for(const [options,status] of [[{validSignature:false},401],[{header:false},401],
  [{action:'run'},400],[{action:'preflight'},400],[{offset:-1},400]]){
  const r=await handlerFixture(options);assert.equal(r.status,status);assert.equal(r.calls.length,0);
 }
});
test('manual dispatch keeps the existing Vault signer private and adds no grants, schedules or switches',()=>{
 const sql=fs.readFileSync('supabase/readonly_checkout_observation_dispatch.sql','utf8').replace(/--[^\n]*/g,'');
 assert.match(sql,/vault\.decrypted_secrets/);assert.match(sql,/'checkout_inspect'/);
 assert.match(sql,/':drain'/);assert.match(sql,/'offset',0/);
 assert.doesNotMatch(sql,/\b(create|grant|update|delete|insert|alter|drop)\b|cron\.schedule/i);
});
