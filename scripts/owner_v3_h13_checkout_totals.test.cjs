const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../assets/owner-hotel-billing.js');
const {checkoutTotalsReady}=globalThis.BiteHotelBilling;
const valid=totals=>({folio:{totals:{deposit_held:0,pending:0,...totals}}});
test('H13 checkout rejects missing or invalid financial totals, including one linked room',()=>{
 const good={charges:1500,paid:500,balance:1000};
 assert.equal(checkoutTotalsReady([]),false,'No room cannot be checked out');
 assert.equal(checkoutTotalsReady(null),false);
 assert.equal(checkoutTotalsReady([valid(good)]),true);
 assert.equal(checkoutTotalsReady([valid(good),valid({charges:500,paid:0,balance:500})]),true);
 for(const field of ['charges','paid','balance','deposit_held','pending'])for(const bad of [null,undefined,'','  ','bad',Infinity,-Infinity,true,false,{},[],1.001,'0x10']){
  assert.equal(checkoutTotalsReady([valid({...good,[field]:bad})]),false,field+' must be known');
  assert.equal(checkoutTotalsReady([valid(good),valid({...good,[field]:bad})]),false,'group: '+field+' must be known');
 }
 assert.equal(checkoutTotalsReady([valid({charges:0,paid:0,balance:0})]),true,'True zero remains valid');
 assert.equal(checkoutTotalsReady([{}]),false);
});

test('H13 security deposit and pending receipt totals must be known, nonnegative and safely summable',()=>{
 assert.equal(checkoutTotalsReady([{folio:{totals:{charges:1500,paid:500,balance:1000}}}]),false);
 for(const field of ['deposit_held','pending']){
  assert.equal(checkoutTotalsReady([valid({charges:1500,paid:500,balance:1000,[field]:-1})]),false);
  assert.equal(checkoutTotalsReady([valid({charges:1500,paid:500,balance:1000,[field]:'0.00'})]),true);
 }
 const large=valid({charges:50000000000000,paid:0,balance:50000000000000});
 assert.equal(checkoutTotalsReady([large]),true);
 assert.equal(checkoutTotalsReady([large,large]),false);
 assert.equal(checkoutTotalsReady([valid({charges:'1500.25',paid:'500.25',balance:'1000.00'})]),true);
});


test('H13 selection includes only open in-house rooms in the exact booking',()=>{
 const B=globalThis.BiteHotelBilling,stay={id:'s1',group_id:'g',status:'in_house',room_id:'r1'};
 const snapshot={stays:[stay,{id:'s2',group_id:'g',status:'in_house',room_id:'r2'},{id:'s3',group_id:'g',status:'checked_out'},{id:'s4',group_id:'other',status:'in_house'}],folios:[{id:'f1',stay_id:'s1',status:'open'},{id:'f2',stay_id:'s2',status:'open'},{id:'f3',stay_id:'s3',status:'settled'},{id:'f4',stay_id:'s4',status:'open'}],rooms:[]};
 const original=JSON.stringify(snapshot);assert.deepEqual(B.availableCheckoutRooms(stay,snapshot).map(x=>x.folio.id),['f1','f2']);assert.equal(JSON.stringify(snapshot),original);
 assert.throws(()=>B.availableCheckoutRooms(stay,{...snapshot,folios:[snapshot.folios[0]]}),/missing or duplicated/);
});


test('H13 selected checkout excludes unselected rooms and rejects duplicate or stale IDs',()=>{
 const B=globalThis.BiteHotelBilling,stay={id:'s1',group_id:'g',status:'in_house'},workspace={stays:[stay,{id:'s2',group_id:'g',status:'in_house'},{id:'s3',group_id:'g',status:'in_house'}],folios:[1,2,3].map(n=>({id:'f'+n,stay_id:'s'+n,status:'open'})),rooms:[]};
 assert.deepEqual(B.selectedCheckoutRows(stay,workspace,['f1','f3']).map(r=>r.folio.id),['f1','f3']);
 for(const ids of [[],['f1','f1'],['f1','foreign']])assert.throws(()=>B.selectedCheckoutRows(stay,workspace,ids));
});
