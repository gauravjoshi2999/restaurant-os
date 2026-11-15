'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');

const policy=import(pathToFileURL(resolve('supabase/functions/bite-owner-push-dispatch/payment-retry-policy.mjs')).href);
const NOW=Date.parse('2026-11-15T12:00:00Z');
const ago=minutes=>new Date(NOW-minutes*60_000).toISOString();

test('payment can become verified after four generic FCM attempts without losing the new-order alert',async()=>{
 const {pendingPaymentRetryPolicy}=await policy;
 for(let attempts=1;attempts<15;attempts++)
  assert.deepEqual(pendingPaymentRetryPolicy(attempts,ago(10),NOW),{
   status:'retry',reason:'Awaiting verified payment'
  });
 assert.deepEqual(pendingPaymentRetryPolicy(15,ago(10),NOW),{
  status:'failed',reason:'Payment verification window expired'
 });
});

test('payment wait is bounded by age as well as attempt count',async()=>{
 const {pendingPaymentRetryPolicy,MAX_PENDING_PAYMENT_AGE_MS}=await policy;
 assert.equal(MAX_PENDING_PAYMENT_AGE_MS,25*60*1000);
 assert.equal(pendingPaymentRetryPolicy(1,ago(24),NOW).status,'retry');
 assert.equal(pendingPaymentRetryPolicy(1,ago(25),NOW).status,'failed');
 assert.equal(pendingPaymentRetryPolicy(5,ago(26),NOW).status,'failed');
});

test('invalid or future queue timestamps and retry counters fail closed',async()=>{
 const {pendingPaymentRetryPolicy}=await policy;
 for(const attempts of [0,-1,NaN,Infinity,1.5,'3',null])
  assert.equal(pendingPaymentRetryPolicy(attempts,ago(1),NOW).status,'failed');
 for(const createdAt of [null,undefined,'bad timestamp',42,new Date(NOW+120000).toISOString()])
  assert.equal(pendingPaymentRetryPolicy(2,createdAt,NOW).status,'failed');
});

test('dispatcher revalidates PAID status each attempt; only payment-pending retry budget changes',()=>{
 const code=fs.readFileSync('supabase/functions/bite-owner-push-dispatch/index.ts','utf8');
 assert.match(code,/from "\.\/payment-retry-policy\.mjs"/);
 assert.match(code,/\.select\("order_id,restaurant_id,delivery_status,attempts,created_at"\)/);
 assert.match(code,/finance\?\.payment_status!=="paid"/);
 assert.match(code,/pendingPaymentRetryPolicy\(claimed\.attempts,ev\.created_at\)/);
 assert.match(code,/order\.status!=="Received"/);
 assert.match(code,/String\(order\.channel\|\|""\)\.toLowerCase\(\)!=="own platform"/);
 assert.match(code,/order\.is_demo===true/);
 // Four attempts still bound unrelated FCM failure cases; no mass send or test order.
 assert.match(code,/errors===0\)\{state="sent";sent\+\+\}/);
 assert.match(code,/else \{state=ev\.attempts>=4\?"failed":"retry"/);
 assert.doesNotMatch(code,/partner_push_test.*create_order|\.insert\(\{.*order_id/);
});
