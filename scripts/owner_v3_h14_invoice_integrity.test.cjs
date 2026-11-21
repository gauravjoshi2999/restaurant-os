const {test}=require('node:test');const assert=require('node:assert/strict');
global.BiteOwner=require('../assets/owner-core.js');
const A=require('../assets/owner-hotel-accounts.js');
const statement=(charges,paid,balance)=>({number:'DRAFT',property:{name:'Synthetic hotel'},guest:{name:'Synthetic guest'},room:{number:'101'},stay:{},entries:[],totals:{charges,paid,balance}});
test('H14 print/share reject malformed money and unreconciled invoice balances',()=>{
 const good=statement('1575.00','600.00','975.00');assert.equal(A.billTotalsReady(good),true);
 assert.equal(A.billTotalsReady(statement(0.3,0.1,0.2)),true);
 assert.equal(A.billTotalsReady(statement(100,150,-50)),true,'Overpayment remains a valid credit');
 for(const value of [true,false,[],{},'0x10','1e3',null,undefined,'',' ',Infinity,1.001,Number.MAX_SAFE_INTEGER]){
  for(const field of ['charges','paid','balance']){
   const bad={...good,totals:{...good.totals,[field]:value}};
   assert.equal(A.billTotalsReady(bad),false,field+': '+String(value));
   assert.throws(()=>A.billHTML(bad),/totals unavailable/);
  }
 }
 const mismatch=statement(1000,200,799.99);assert.equal(A.billTotalsReady(mismatch),false);
 assert.throws(()=>A.printStatement(mismatch),/totals unavailable/);
 assert.throws(()=>A.combinedBillHTML([good,mismatch]),/totals unavailable/);
});
test('H14 combined invoice uses exact paise and rejects unsafe aggregate',()=>{
 const html=A.combinedBillHTML([statement(0.1,0,0.1),statement(0.2,0,0.2)]);
 assert.match(html,/Combined total<\/th><th>₹0\.30/);
 const large=statement(50000000000000,0,50000000000000);
 assert.equal(A.billTotalsReady(large),true);
 assert.throws(()=>A.combinedBillHTML([large,large]),/totals unavailable/);
});
