'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync('assets/customer-premium.js','utf8');
test('location picker saved addresses are scoped to signed-in customer',()=>{
  assert.match(script,/const customerId=session\.data\.session\.user\?\.id/);
  assert.match(script,/\.eq\('customer_id',customerId\)/);
  assert.match(script,/sb\.auth\.getUser\(\)/);
  assert.match(script,/active\.data\?\.user\?\.id!==customerId/);
});
test('account transitions invalidate pending location address responses',()=>{
  assert.match(script,/sb\.auth\.onAuthStateChange/);
  assert.match(script,/\+\+requestNumber/);
  assert.match(script,/serial!==requestNumber\|\|locationSheet\.hidden/);
  assert.match(script,/savedList\.replaceChildren\(\)/);
});
test('location picker remains script-valid and does not change checkout or payments',()=>{
  assert.doesNotThrow(()=>new vm.Script(script));
  assert.doesNotMatch(script,/Cashfree|payment_intent|refund|update\('orders'\)/i);
});
