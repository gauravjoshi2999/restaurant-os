'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/super-admin-workspace.js','utf8');

test('Super Admin Home and Reports label ledger totals without claiming provider or bank settlement',()=>{
 assert.match(source,/Recorded paid-order value/);
 assert.match(source,/Internal ledger snapshot; provider and bank confirmation separate/);
 assert.match(source,/\['Ledger-recorded collections',money\(d\.verified_collections\)\]/);
 assert.match(source,/\['Ledger-recorded refunds',money\(d\.provider_confirmed_refunds\)\]/);
 assert.match(source,/field\('Ledger-recorded refund',money\(f\?\.refund_amount_actual\)\)/);
 assert.match(source,/restaurant payouts need independent evidence/);
 assert.doesNotMatch(source,/Online payments received|\['Verified collections'|\['Confirmed refunds'/);
});

test('exported Super Admin CSV keeps source values and labels evidence limits explicitly',async()=>{
 const start=source.indexOf('function exportReport(){');
 const end=source.indexOf('\n async function advanced(',start);
 assert.ok(start>=0&&end>start,'Export function must be present');
 let exported=null,clicked=false;
 const context={
  report:{from:'2026-11-01',to:'2026-11-19',data:{
   verified_collections:174,
   provider_confirmed_refunds:3,
   commission_booked:12.5,
   payment_error:'=HYPERLINK("test")',
   tab_prefixed:'\t=1+1',
   space_prefixed:'  +SUM(2,3)',
   newline_prefixed:'\n@cmd'
  }},
  Blob,
  document:{createElement(tag){assert.equal(tag,'a');return{click(){clicked=true;}};}},
  URL:{createObjectURL(blob){exported=blob;return 'blob:synthetic';},revokeObjectURL(){}},
  setTimeout(){}
 };
 vm.runInNewContext(source.slice(start,end)+'\nexportReport();',context);
 assert.equal(clicked,true);
 assert.ok(exported);
 const csv=await exported.text();
 assert.match(csv,/Ledger-recorded collections \(provider\/bank verification separate\)/);
 assert.match(csv,/Ledger-recorded refunds \(customer bank credit not proven\)/);
 assert.match(csv,/bank credit and vendor payout are not certified/);
 assert.match(csv,/"174"/);
 assert.match(csv,/"3"/);
 assert.match(csv,/"commission_booked","12.5"/);
 assert.match(csv,/"'=HYPERLINK/,'spreadsheet formula values must stay escaped');
 assert.ok(csv.includes('"tab_prefixed","\'\t=1+1"'),'tab-prefixed formula must have a leading apostrophe');
 assert.ok(csv.includes('"space_prefixed","\'  +SUM(2,3)"'),'space-prefixed formula must have a leading apostrophe');
 assert.ok(csv.includes('"newline_prefixed","\'\n@cmd"'),'newline-prefixed formula must have a leading apostrophe');
});

test('Super Admin remains scoped to authenticated Super Admin and retains read-only provider inspection',()=>{
 assert.match(source,/ctx\.getAccess\(\)\?\.role==='super_admin'/);
 assert.match(source,/ctx\.getAccess\(\)\?\.isPlatformAdmin===true/);
 assert.match(source,/action:'inspect_refund'/);
 assert.match(source,/action:'reconcile'/);
 assert.match(source,/Provider confirmation pending/);
});
