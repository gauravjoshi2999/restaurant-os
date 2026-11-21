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

require('../assets/owner-hospitality.js');
const linked=globalThis.BiteHospitality.linkedPOSSource;
test('H12 original POS must match current folio, linked order and active restaurant',()=>{
 const entry={kind:'charge',folio_id:'f',source_order_id:'o'},order={id:'o',restaurant_id:'r',channel:'POS - Counter',is_demo:false};
 assert.equal(linked(entry,'f','r',order),true);
 for(const [e,f,r,o] of [[entry,'other','r',order],[entry,'f','other',order],[entry,'f','r',{...order,id:'other'}],[entry,'f','r',{...order,is_demo:true}],[entry,'f','r',{...order,channel:'Website'}],[{...entry,kind:'payment'},'f','r',order],[entry,'f','r',null]])assert.equal(linked(e,f,r,o),false);
});
