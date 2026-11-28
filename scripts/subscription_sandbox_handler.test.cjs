const {test} = require('node:test');
const assert = require('node:assert/strict');

const property = '10000000-0000-4000-8000-000000000001';
const requestId = '10000000-0000-4000-8000-000000000002';
const actor = '10000000-0000-4000-8000-000000000003';
const attemptId = '10000000-0000-4000-8000-000000000004';
const instant = Date.parse('2026-11-28T12:00:00Z');
const expiry = '2026-11-28T12:20:00.000Z';
const orderId = 'bite_st_' + attemptId.replaceAll('-', '');
const endpoint = 'https://sandbox.cashfree.com/pg/orders';
const providerOrder = {
 order_id: orderId, order_amount: 1499, order_currency: 'INR',
 order_status: 'ACTIVE', order_expiry_time: expiry, payment_session_id: 'sandbox-fixture'
};
const attempt = {attempt_id: attemptId, amount_paise: 149900, currency: 'INR', expires_at: expiry};

async function handler(overrides={}) {
 const {createSandboxHandler}=await import('../supabase/functions/bite-subscription-sandbox/handler.mjs');
 return createSandboxHandler({
  env: key => ({
   BITE_SUBSCRIPTION_SANDBOX_ENABLED: 'true',
   BITE_SUBSCRIPTION_CASHFREE_TEST_APP_ID: 'fixture-test-id',
   BITE_SUBSCRIPTION_CASHFREE_TEST_SECRET_KEY: 'fixture-test-secret'
  })[key],
  authenticate: async () => actor,
  prepare: async () => ({data:attempt}),
  fetchProvider: async () => assert.fail('Unexpected provider call'),
  now: () => instant,
  ...overrides
 });
}

function request(overrides={}, authorization='Bearer owner-fixture') {
 return new Request('http://localhost/subscription-sandbox', {
  method:'POST', headers:{authorization},
  body:JSON.stringify({property_id:property,request_id:requestId,catalog_version:1,offer_code:'starter_year',...overrides})
 });
}

test('sandbox authenticates owner and sends the server price with a stable provider request',async()=>{
 const calls=[];
 const edge=await handler({
  prepare: async input => {
   assert.deepEqual(input,{p_property:property,p_request:requestId,p_actor:actor,p_catalog_version:1,p_offer_code:'starter_year'});
   return {data:attempt};
  },
  fetchProvider: async (url, options) => {
   assert.equal(url,endpoint);
   assert.equal(options.headers['x-idempotency-key'],attemptId);
   assert.equal(options.redirect,'error');
   calls.push(JSON.parse(options.body));
   return Response.json(providerOrder);
  }
 });
 for(let i=0;i<2;i++){
  const response=await edge(request({price:1,actor_id:'untrusted'}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).environment,'sandbox');
 }
 assert.equal(calls[0].order_amount,1499);
 assert.equal(calls[0].order_id,orderId);
 assert.deepEqual(calls[0],calls[1]);
});

test('disabled, expired and unauthorized attempts cannot request a provider order',async()=>{
 assert.equal((await (await handler({env:()=>undefined}))(request())).status,503);
 assert.equal((await (await handler())(request({},''))).status,401);
 assert.equal((await (await handler({authenticate:async()=>null}))(request())).status,401);
 assert.equal((await (await handler({prepare:async()=>({error:{code:'42501'}})}))(request())).status,403);
 assert.equal((await (await handler({prepare:async()=>({error:{code:'22023'}})}))(request())).status,409);
 const expired=await handler({now:()=>Date.parse(expiry)});
 const result=await expired(request());
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{environment:'sandbox',status:'check_payment',attempt_id:attemptId});
});

test('provider conflict reuses the same order and withholds unverified sessions',async()=>{
 let urls=[];
 const retry=await handler({fetchProvider:async(url)=>{
  urls.push(url);
  return urls.length===1?new Response(null,{status:409}):Response.json(providerOrder);
 }});
 assert.equal((await retry(request())).status,200);
 assert.deepEqual(urls,[endpoint,endpoint+'/'+orderId]);
 const incorrect=await handler({fetchProvider:async()=>Response.json({...providerOrder,order_amount:1})});
 assert.equal((await incorrect(request())).status,503);
 for(const order_status of ['PAID','EXPIRED','TERMINATED']){
  const closed=await handler({fetchProvider:async()=>Response.json({...providerOrder,order_status})});
  const result=await closed(request());
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{environment:'sandbox',status:'check_payment',attempt_id:attemptId});
 }
});

const verifyRequest = () => request({action:'verify',attempt_id:attemptId,cf_payment_id:'0000'});
const verifiedPayment = {
 cf_payment_id:'100200300',order_id:orderId,payment_status:'SUCCESS',payment_currency:'INR',payment_amount:1499
};
const receipt = {offer:{offer_code:'starter_year',pos_bill_limit:1000},verified_at:expiry};

test('paid sandbox order records a single provider-confirmed receipt, then reuses it',async()=>{
 let recorded=null, calls=0, writes=0;
 const edge=await handler({
  receipt: async args=>{
   assert.equal(args.p_actor,actor);
   assert.equal(args.p_property,property);
   assert.equal(args.p_attempt,attemptId);
   if(args.p_payment_id){
    assert.equal(args.p_payment_id,verifiedPayment.cf_payment_id);
    assert.equal(args.p_amount_paise,149900);
    assert.equal(args.p_currency,'INR');
    recorded=receipt;
    writes++;
   }
   return {data:{...attempt,receipt:recorded}};
  },
  fetchProvider:async url=>{
   calls++;
   if(url===endpoint+'/'+orderId)return Response.json({...providerOrder,order_status:'PAID'});
   assert.equal(url,endpoint+'/'+orderId+'/payments');
   return Response.json([verifiedPayment]);
  }
 });
 const first=await edge(verifyRequest());
 const retry=await edge(verifyRequest());
 assert.equal(first.status,200);
 assert.deepEqual(await first.json(),{environment:'sandbox',status:'verified',receipt});
 assert.deepEqual(await retry.json(),{environment:'sandbox',status:'verified',receipt});
 assert.equal(calls,2);
 assert.equal(writes,1);
});

test('pending, ambiguous, insufficient and unauthorized sandbox payments create no receipt',async()=>{
 const getReceipt=async args=>{
  assert.equal(args.p_payment_id,undefined);
  return {data:{...attempt,receipt:null}};
 };
 const pending=await handler({
  receipt:getReceipt,fetchProvider:async url=>{
   assert.equal(url,endpoint+'/'+orderId);
   return Response.json(providerOrder);
  }
 });
 assert.deepEqual(await (await pending(verifyRequest())).json(),{environment:'sandbox',status:'awaiting_payment'});
 for(const payments of [
  [{...verifiedPayment,payment_status:'FAILED'}],
  [{...verifiedPayment,payment_amount:1}],
  [verifiedPayment,{...verifiedPayment,cf_payment_id:'222'}],
  [{...verifiedPayment,order_id:'another_order'}]
 ]){
  const edge=await handler({
   receipt:getReceipt,
   fetchProvider:async url=>Response.json(url.endsWith('/payments')?payments:{...providerOrder,order_status:'PAID'})
  });
  assert.equal((await edge(verifyRequest())).status,409);
 }
 const denied=await handler({receipt:async()=>({error:{code:'42501'}})});
 assert.equal((await denied(verifyRequest())).status,403);
});

test('an expired order allows replacement only when no payment still needs reconciliation',async()=>{
 for(const [payments,status] of [
  [[{payment_status:'FAILED'}],'expired'],
  [[{payment_status:'PENDING'}],'awaiting_payment'],
  [[{payment_status:'SUCCESS'}],'awaiting_payment']
 ]){
  const edge=await handler({
   receipt:async args=>{
    assert.equal(args.p_payment_id,undefined);
    return {data:{...attempt,receipt:null}};
   },
   fetchProvider:async url=>Response.json(url.endsWith('/payments')?payments:{...providerOrder,order_status:'EXPIRED'})
  });
  assert.deepEqual(await (await edge(verifyRequest())).json(),{environment:'sandbox',status});
 }
});
