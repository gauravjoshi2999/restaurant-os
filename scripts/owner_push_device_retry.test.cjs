'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const policy=import(pathToFileURL(resolve('supabase/functions/bite-owner-push-dispatch/device-retry-policy.mjs')).href);
const NOW=Date.parse('2026-11-16T00:00:00Z');
const minutesAgo=m=>new Date(NOW-m*60000).toISOString();

test('missing Partner device has a bounded, fail-closed retry window',async()=>{
 const {awaitingOwnerDevicePolicy,MAX_MISSING_DEVICE_AGE_MS,MAX_MISSING_DEVICE_ATTEMPTS}=await policy;
 assert.equal(MAX_MISSING_DEVICE_ATTEMPTS,15);
 assert.equal(MAX_MISSING_DEVICE_AGE_MS,25*60*1000);
 for(const attempts of [1,2,4,14])assert.deepEqual(awaitingOwnerDevicePolicy(attempts,minutesAgo(10),NOW),
  {status:'retry',reason:'Awaiting Owner Partner device'});
 for(const [attempts,mins] of [[1,25],[1,26],[15,1],[30,1]])
  assert.deepEqual(awaitingOwnerDevicePolicy(attempts,minutesAgo(mins),NOW),
   {status:'failed',reason:'No Owner device within notification window'});
});
test('bad retry metadata does not create unbounded or future notifications',async()=>{
 const {awaitingOwnerDevicePolicy}=await policy;
 for(const attempts of [0,-1,NaN,Infinity,1.5,'2',null])
  assert.equal(awaitingOwnerDevicePolicy(attempts,minutesAgo(1),NOW).status,'failed');
 for(const at of [null,undefined,42,'invalid',new Date(NOW+120000).toISOString()])
  assert.equal(awaitingOwnerDevicePolicy(1,at,NOW).status,'failed');
});
test('new paid order and cancellation paths retry only after owner, order and payment validation',()=>{
 const order=fs.readFileSync('supabase/functions/bite-owner-push-dispatch/index.ts','utf8');
 const cancel=fs.readFileSync('supabase/functions/bite-owner-push-dispatch/cancellation-push.mjs','utf8');
 assert.match(order,/awaitingOwnerDevicePolicy\(claimed\.attempts,ev\.created_at\)/);
 assert.match(order,/order\.status!=="Received"/);
 assert.match(order,/finance\?\.payment_status!=="paid"/);
 assert.match(order,/\.eq\("restaurant_id",ev\.restaurant_id\)\.eq\("enabled",true\)/);
 assert.match(cancel,/awaitingOwnerDevicePolicy\(claimed\.data\.attempts,ev\.created_at,clock\(\)\.getTime\(\)\)/);
 assert.match(cancel,/request\.status!=="Pending"/);
 assert.match(cancel,/order\.customer_id!==request\.customer_id/);
 assert.match(cancel,/ledger\.data\?\.payment_status!=="paid"/);
 assert.doesNotMatch(order+cancel,/\.insert\(\{.*(?:orders|bite_refund_jobs)|execute_refund|create_transfer/);
});
