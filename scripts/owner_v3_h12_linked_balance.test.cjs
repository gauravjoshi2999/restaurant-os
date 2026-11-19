const {test}=require('node:test');const assert=require('node:assert/strict');
require('../assets/owner-hotel-billing.js');
const Billing=globalThis.BiteHotelBilling;
test('H12: linked family room balance never treats unknown as settled zero',()=>{
 const label=Billing.linkedBalanceLabel;
 for(const missing of [null,undefined,{}, {totals:null},{totals:{}},{totals:{balance:null}},{totals:{balance:''}},{totals:{balance:'bad'}}])
  assert.equal(label(missing),'Balance unavailable');
 assert.match(label({totals:{balance:250}}),/^Due ₹250/);
 assert.match(label({totals:{balance:-100}}),/^Credit to review ₹100/);
 assert.equal(label({totals:{balance:0}}),'No balance due');
});
