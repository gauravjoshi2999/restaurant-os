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

test('advanced Admin Finance totals paid website orders and distinguishes unknown fees from zero',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const start=html.indexOf('function renderFinancials(){');
 const end=html.indexOf('\nasync function saveReconciliation(',start);
 assert.ok(start>=0&&end>start,'Admin Finance renderer must be present');
 const elements=new Map();
 const output=id=>{if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id);};
 const context={
  BiteOwner:require('../assets/owner-core.js'),
  document:{getElementById:id=>id==='settlementRestaurantSelect'?null:output(id)},
  access:{isPlatformAdmin:true},
  state:{restaurants:[],settlements:[],orders:[
   {id:'paid',status:'Received',code:'PAID'},
   {id:'refund',status:'Refunded',code:'REFUND'},
   {id:'unpaid',status:'Received',code:'UNPAID'},
   {id:'demo',status:'Received',code:'DEMO',isDemo:true}
  ],financials:[
   {channel:'Own Platform',order_id:'paid',payment_status:'paid',food_subtotal:100,commission_amount:10,provider_fee_actual:null},
   {channel:'Own Platform',order_id:'refund',payment_status:'refunded',food_subtotal:45,commission_amount:4,refund_amount_actual:50,provider_fee_actual:0},
   {channel:'Own Platform',order_id:'unpaid',payment_status:'unpaid',food_subtotal:1000,commission_amount:100},
   {channel:'Own Platform',order_id:'demo',payment_status:'paid',food_subtotal:7000,commission_amount:700},
   {channel:'Other',order_id:'paid',payment_status:'paid',food_subtotal:5000,commission_amount:500}
  ]},
  esc:value=>String(value??''),money:value=>'₹'+Number(value||0).toFixed(2),
  pill:value=>String(value??'')
 };
 const run=()=>vm.runInNewContext(html.slice(start,end)+'\nrenderFinancials();',context);
 run();
 assert.equal(output('finFoodValue').textContent,'₹145.00');
 assert.equal(output('finCommission').textContent,'₹14.00');
 assert.equal(output('finRefunds').textContent,'₹50.00');
 assert.equal(output('finGateway').textContent,'Not reconciled');
 assert.equal(output('finSnapshotCount').textContent,'4 records · 2 paid');
 assert.match(output('financialRows').innerHTML,/UNPAID/);
 context.state.financials[0].provider_fee_actual=0;
 run();
 assert.equal(output('finGateway').textContent,'₹0.00');
});
