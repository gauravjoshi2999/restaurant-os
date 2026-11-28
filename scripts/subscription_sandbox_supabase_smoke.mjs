// Real local Supabase Auth and REST. The only Cashfree transport is the fixture below.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createSandboxHandler } from '../supabase/functions/bite-subscription-sandbox/handler.mjs';

const api = 'http://127.0.0.1:54321';
const provider = 'https://sandbox.cashfree.com';
const {anon, service} = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.ok(anon && service, 'Local Supabase API keys are required');
const {createClient} = createRequire(resolve(process.env.BITE_REHEARSAL_DEPENDENCIES, 'package.json'))('@supabase/supabase-js');

function localFetch(input, init) {
 assert.equal(new URL(input instanceof Request ? input.url : input).origin, api);
 return fetch(input, {...init, redirect: 'error', signal: AbortSignal.timeout(12_000)});
}
function localClient(url, key, config={}) {
 assert.equal(url, api);
 return createClient(url, key, {
  ...config, auth: {persistSession:false, autoRefreshToken:false},
  global: {...config.global, fetch:localFetch}
 });
}
const operator = localClient(api, service);
const property = 'f7130000-0000-4000-8000-000000000001';
const otherProperty = 'f7130000-0000-4000-8000-000000000002';

async function account(role, propertyId) {
 const email = `${role}-${randomUUID()}@example.com`, password = randomUUID();
 const admin = await operator.auth.admin.createUser({email,password,email_confirm:true});
 assert.ok(!admin.error, 'Synthetic Auth user creation failed');
 const client = localClient(api, anon);
 const auth = await client.auth.signInWithPassword({email,password});
 assert.ok(!auth.error && auth.data.session?.access_token, 'Synthetic Auth sign-in failed');
 const {error} = await operator.from('bite_property_members')
  .insert({property_id:propertyId,user_id:auth.data.user.id,role});
 assert.ok(!error, 'Synthetic membership fixture failed');
 return {client,id:auth.data.user.id,token:auth.data.session.access_token};
}

const owner = await account('owner',property);
const receptionist = await account('receptionist',property);
const otherOwner = await account('owner',otherProperty);
const orders = new Map();
let paymentSequence = 10000000;
let providerCalls = 0;

async function providerFetch(input, init) {
 const url = new URL(input);
 assert.equal(url.origin,provider);
 assert.equal(init.redirect,'error');
 providerCalls++;
 if (init.method === 'POST') {
  assert.equal(url.pathname,'/pg/orders');
  const order = JSON.parse(init.body);
  const key = new Headers(init.headers).get('x-idempotency-key');
  assert.equal(order.order_id,'bite_st_'+key.replaceAll('-',''));
  assert.equal(order.order_currency,'INR');
  assert.equal(order.customer_details.customer_phone,'9999999999');
  if (!orders.has(order.order_id)) {
   orders.set(order.order_id,{
    order_id:order.order_id,order_amount:order.order_amount,order_currency:order.order_currency,
    order_expiry_time:order.order_expiry_time,order_status:'ACTIVE',
    payment_session_id:'test-'+key,cf_payment_id:String(++paymentSequence)
   });
  }
  return Response.json(orders.get(order.order_id));
 }
 const match = url.pathname.match(/^\/pg\/orders\/(bite_st_[0-9a-f]{32})(\/payments)?$/);
 assert.ok(match,'Only sandbox order and payment evidence are available');
 const order = orders.get(match[1]);
 if (!order) return new Response(null,{status:404});
 if (!match[2]) return Response.json(order);
 return Response.json([{
  order_id:order.order_id,cf_payment_id:order.cf_payment_id,payment_currency:order.order_currency,
  payment_amount:order.payment_amount ?? order.order_amount,payment_status:'SUCCESS'
 }]);
}

const env = {
 SUPABASE_URL:api,SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,
 BITE_SUBSCRIPTION_SANDBOX_ENABLED:'true',
 BITE_SUBSCRIPTION_CASHFREE_TEST_APP_ID:'synthetic-app',
 BITE_SUBSCRIPTION_CASHFREE_TEST_SECRET_KEY:'synthetic-secret'
};
const edge = await readFile(new URL('../supabase/functions/bite-subscription-sandbox/index.ts',import.meta.url),'utf8');
let serve;
runInNewContext(stripTypeScriptTypes(edge.replace(/^import .*;$/gm,'')),{
 Deno:{env:{get:key=>env[key]},serve:handler=>{serve=handler;}},
 createClient:localClient,
 createSandboxHandler:options=>createSandboxHandler({...options,fetchProvider:providerFetch})
});
assert.equal(typeof serve,'function');

async function call(actor, body, expected=200) {
 const response = await serve(new Request(api,{
  method:'POST',headers:{authorization:'Bearer '+actor.token},
  body:JSON.stringify({property_id:property,...body})
 }));
 const data = await response.json();
 assert.equal(response.status,expected,`Expected ${expected}, got ${response.status} (${data.error ?? data.status ?? 'checkout'})`);
 return data;
}
const purchase = {request_id:randomUUID(),catalog_version:1,offer_code:'starter_year'};
await call(receptionist,purchase,403);
await call(otherOwner,purchase,403);
assert.equal(providerCalls,0);
const direct = await owner.client.rpc('bite_prepare_subscription_sandbox',{
 p_property:property,p_actor:owner.id,p_request:purchase.request_id,p_catalog_version:1,p_offer_code:'starter_year'
});
assert.ok(['42501','PGRST202'].includes(direct.error?.code),'Owner REST session must not call the service RPC directly');

const plan = await call(owner,{...purchase,amount:1});
assert.equal(plan.environment,'sandbox');
assert.equal(plan.amount,1499);
assert.deepEqual(await call(owner,purchase),plan);
const verifyPlan = {action:'verify',attempt_id:plan.attempt_id};
assert.equal((await call(owner,verifyPlan)).status,'awaiting_payment');
await call(receptionist,verifyPlan,403);
await call(otherOwner,verifyPlan,403);

const planOrder = orders.get(plan.order_id);
planOrder.order_status='PAID';
planOrder.payment_amount=1;
await call(owner,verifyPlan,409);
planOrder.payment_amount=1499;
const [first,retry] = await Promise.all([call(owner,verifyPlan),call(owner,verifyPlan)]);
assert.equal(first.status,'verified');
assert.equal(first.receipt.offer.pos_bill_limit,1000);
assert.deepEqual(retry,first);

const recharge = await call(owner,{...purchase,request_id:randomUUID(),offer_code:'pos_recharge_500'});
assert.equal(recharge.amount,199);
orders.get(recharge.order_id).order_status='PAID';
const grant = await call(owner,{action:'verify',attempt_id:recharge.attempt_id});
assert.equal(grant.receipt.offer.extra_pos_bills,500);
const state = await call(owner,{action:'status'});
assert.equal(state.subscription.status,'active');
assert.equal(state.subscription.tier,'starter');
assert.equal(state.subscription.pos_bills_remaining,1000);
assert.equal(state.subscription.recharge_bills_available,500);
await call(receptionist,{action:'status'},403);
const item = randomUUID();
for(let replay=0;replay<2;replay++){
 const billed=await operator.rpc('bite_meter_sandbox_subscription_bill',{p_property:property,p_bill:item});
 assert.equal(billed.data,'plan');
}
assert.equal((await call(owner,{action:'status'})).subscription.pos_bills_remaining,999);


const unpaid = await call(owner,{...purchase,request_id:randomUUID()});
assert.equal((await call(owner,{action:'verify',attempt_id:unpaid.attempt_id})).status,'awaiting_payment');
assert.equal(orders.size,3);
console.log('PASS: real Auth and REST plus simulated Cashfree validate owner scope, unpaid and amount checks, concurrent verified retries, and Starter and recharge receipts');
