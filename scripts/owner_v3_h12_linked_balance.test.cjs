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

test('H12 family summary uses explicit group only and source folio totals without double counting',()=>{
 const stay={id:'s1',group_id:'g',room_id:'r1',status:'in_house'};
 const workspace={stays:[stay,{id:'s2',group_id:'g',room_id:'r2',status:'in_house'},{id:'s3',group_id:'other',status:'in_house'},{id:'s4',group_id:'g',status:'cancelled'}],rooms:[{id:'r1',number:'101'},{id:'r2',number:'102'}],folios:[{id:'f1',stay_id:'s1',totals:{charges:2000,paid:1000,balance:1000,deposit_held:500,pending:0}},{id:'f2',stay_id:'s2',totals:{charges:1500,paid:0,balance:1500,deposit_held:0,pending:0}}],entries:[{id:'e1',folio_id:'f1',description:'Food',source_order_id:'pos',amount:500,status:'confirmed',kind:'charge'},{id:'e2',folio_id:'f2',description:'Room rent',amount:1500,kind:'charge',status:'confirmed'}]};
 const original=JSON.stringify(workspace),v=Billing.familyBillSummary(stay,workspace);
 assert.deepEqual(v.totals,{charges:3500,paid:1000,balance:2500,deposit_held:500,pending:0});
 assert.equal(v.rows.length,2);assert.equal(v.rows[0].entries.length,1);assert.equal(JSON.stringify(workspace),original);
 const markup=Billing.familyBillMarkup(v);assert.match(markup,/Family bill · 2 rooms/);assert.match(markup,/Linked original food sale/);assert.match(markup,/Room 102/);assert.match(markup,/2,500/);
 assert.equal(Billing.familyBillSummary({...stay,group_id:null},workspace),null);
 assert.equal(Billing.familyBillSummary(stay,{...workspace,folios:[workspace.folios[0]]}).totals,null);
 assert.equal(Billing.familyBillSummary(stay,{...workspace,entries:[...workspace.entries,workspace.entries[0]]}).totals,null);
});

test('Linked balance does not coerce blank, boolean or fractional-paise values to a verified balance',()=>{
 for(const balance of ['  ',true,false,[],{},'0x10',0.001])assert.equal(Billing.linkedBalanceLabel({totals:{balance}}),'Balance unavailable');
 const stay={id:'s1',group_id:'g',status:'in_house'};
 const workspace={stays:[stay,{id:'s2',group_id:'g',status:'in_house'}],folios:[{id:'f1',stay_id:'s1',totals:{charges:100,paid:40,balance:50,pending:0,deposit_held:0}},{id:'f2',stay_id:'s2',totals:{charges:10,paid:0,balance:10,pending:0,deposit_held:0}}]};
 assert.equal(Billing.familyBillSummary(stay,workspace).totals,null);
});
