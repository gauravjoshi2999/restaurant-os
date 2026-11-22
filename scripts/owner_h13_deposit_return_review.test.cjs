'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
require('../assets/owner-hotel-billing.js');
const {depositReturnPayload}=globalThis.BiteHotelBilling;
const folio={id:'room-folio',status:'open',totals:{charges:1000,paid:500,balance:500,deposit_held:'200.10',pending:0}};
const data={amount:'100.05',method:'UPI',reference:' UTR123 '};
test('Deposit return validates exact amount, held balance and reference',()=>{
 assert.deepEqual(depositReturnPayload(folio,'200.10',data),{folio_id:'room-folio',amount:100.05,method:'UPI',reference:'UTR123',description:'Security deposit returned at checkout'});
 assert.equal(depositReturnPayload(folio,'200.10',{amount:'200.10',method:'Cash',reference:''}).amount,200.10);
 for(const v of [{amount:'200.11'},{amount:'0.001'},{amount:0},{amount:true},{method:'Other'},{reference:' '},{reference:'x'.repeat(101)}])assert.throws(()=>depositReturnPayload(folio,'200.10',{...data,...v}));
 for(const f of [null,{...folio,status:'settled'},{...folio,totals:{...folio.totals,deposit_held:100}},{...folio,totals:{...folio.totals,balance:400}}])assert.throws(()=>depositReturnPayload(f,'200.10',data),/Deposit balance changed/);
});
test('Deposit return rechecks fresh workspace and reviewed fields before command',()=>{
 const source=fs.readFileSync('assets/owner-hotel-billing.js','utf8'),start=source.indexOf("if(type==='deposit'){"),end=source.indexOf("if(type==='checkout'){",start),body=source.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(body,/await H\(\)\.reload\(false\)/);
 assert.match(body,/!form\.isConnected/);
 assert.match(body,/depositReturnPayload\(getFolio\(id\),cap,values\)/);
 assert.match(body,/command\('deposit_return',payload\)/);
});
