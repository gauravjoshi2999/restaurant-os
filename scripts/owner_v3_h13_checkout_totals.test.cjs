const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../assets/owner-hotel-billing.js');
const {checkoutTotalsReady}=globalThis.BiteHotelBilling;
const valid=totals=>({folio:{totals}});
test('H13 checkout rejects missing or invalid financial totals, including one linked room',()=>{
 const good={charges:1500,paid:500,balance:1000};
 assert.equal(checkoutTotalsReady([]),false,'No room cannot be checked out');
 assert.equal(checkoutTotalsReady(null),false);
 assert.equal(checkoutTotalsReady([valid(good)]),true);
 assert.equal(checkoutTotalsReady([valid(good),valid({charges:500,paid:0,balance:500})]),true);
 for(const field of ['charges','paid','balance'])for(const bad of [null,undefined,'','  ','bad',Infinity,-Infinity]){
  assert.equal(checkoutTotalsReady([valid({...good,[field]:bad})]),false,field+' must be known');
  assert.equal(checkoutTotalsReady([valid(good),valid({...good,[field]:bad})]),false,'group: '+field+' must be known');
 }
 assert.equal(checkoutTotalsReady([valid({charges:0,paid:0,balance:0})]),true,'True zero remains valid');
 assert.equal(checkoutTotalsReady([{}]),false);
});
