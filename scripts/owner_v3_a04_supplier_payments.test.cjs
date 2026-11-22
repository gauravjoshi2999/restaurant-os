'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const due=require('../assets/owner-supplier-dues.js');
const index=fs.readFileSync('index.html','utf8');
const sql=fs.readFileSync('docs/sql/owner_a04_supplier_payment_staging.sql','utf8');
const css=fs.readFileSync('assets/owner-supplier-dues.css','utf8');
const purchase={id:'bill-1',restaurant_id:'owner-restaurant',purchase_date:'2026-11-01',total_amount:1000,paid_amount:100,supplier_name_snapshot:'Test supplier'};
const pays=[
 {id:'payment-1',purchase_id:'bill-1',restaurant_id:'owner-restaurant',payment_date:'2026-11-10',amount:250,method:'Cash'},
 {id:'payment-2',purchase_id:'bill-1',restaurant_id:'owner-restaurant',payment_date:'2026-11-15',amount:100,method:'UPI'},
 {id:'payment-3',purchase_id:'bill-1',restaurant_id:'other-business',payment_date:'2026-11-15',amount:999,method:'UPI'},
 {id:'payment-4',purchase_id:'bill-2',restaurant_id:'owner-restaurant',payment_date:'2026-11-10',amount:999,method:'Cash'}
];
test('A04 initial paid amount remains on purchase day; later payments reduce due only once',()=>{
 assert.equal(due.laterTotal(purchase,pays),35000);
 assert.equal(due.paid(purchase,pays),450);
 assert.equal(due.outstanding(purchase,pays),550);
 assert.equal(due.outstanding({...purchase,total_amount:150},pays),null);
 assert.equal(due.summary([purchase],pays).total,550);
 assert.equal(due.summary([purchase],pays).count,1);
});
test('A04 actual payment date and amount validated before any RPC call',()=>{
 const base={purchase,payments:pays,today:'2026-11-19',amount:100,date:'2026-11-19',method:'Cash',reference:'42'};
 assert.deepEqual(due.validate(base),{amount:100,date:'2026-11-19',method:'Cash',reference:'42'});
 for(const variant of [
  {amount:551},{amount:0},{amount:-1},{amount:'oops'},{amount:1.001},
  {date:'2026-11-20'},{date:'2026-10-31'},{date:'2026-02-30'},{method:'Cashfree'},
  {reference:'a'.repeat(101)}
 ])assert.throws(()=>due.validate({...base,...variant}));
});
test('A04 supplier due summary is grounded, owner-only and HTML-safe',()=>{
 const target={innerHTML:'',onclick:null};
 due.renderSummary(target,{purchases:[{...purchase,supplier_name_snapshot:'<script>bad</script>'}],payments:pays,available:true,owner:true,onOpen:()=>{}});
 assert.match(target.innerHTML,/550\.00/);
 assert.match(target.innerHTML,/data-bsp-pay/);
 assert.doesNotMatch(target.innerHTML,/<script>/);
 due.renderSummary(target,{purchases:[purchase],payments:pays,available:true,owner:false});
 assert.doesNotMatch(target.innerHTML,/data-bsp-pay/);
 due.renderSummary(target,{purchases:[purchase],payments:[],available:false,owner:true});
 assert.match(target.innerHTML,/service unavailable/);
 assert.doesNotMatch(target.innerHTML,/data-bsp-pay/);
});
test('A04 same canonical Purchases screen uses only verified append-only server RPC',()=>{
 assert.match(index,/id="supplierDueSummary"/);
 assert.match(index,/BiteSupplierDues\.open/);
 assert.match(index,/record_restaurant_supplier_payment/);
 assert.match(index,/supplierPaymentAvailable&&helper&&access\.role==='owner'/);
 assert.match(index,/p_payment_date:date,p_method:method,p_request_id:requestId/);
 assert.match(index,/p_purchase_id:purchaseId,p_amount:amount/);
 assert.match(index,/version!==purchaseRequestVersion/);
 assert.match(index,/purchasePaid'\)\.readOnly=hasLaterPayment/);
 assert.match(index,/supplierPaymentRecords\.some\(x=>x\.purchase_id===id\)/);
 assert.match(index,/owner-supplier-dues\.js\?v=20261122-a04-retry1/);
 assert.match(index,/owner-supplier-dues\.css\?v=20261119-a04-dues1/);
 assert.doesNotMatch(fs.readFileSync('assets/owner-supplier-dues.js','utf8'),/\.(?:insert|upsert|update|delete|rpc)\(/);
});
test('A04 SQL protects cashbook dates, RLS, idempotency and closed shifts',()=>{
 assert.match(sql,/create table if not exists public\.restaurant_supplier_payments/);
 assert.match(sql,/request_id uuid not null unique/);
 assert.match(sql,/foreign key \(restaurant_id,purchase_id\)/);
 assert.match(sql,/returns trigger language plpgsql security definer set search_path=''/);
 assert.match(sql,/revoke all on function public\.bite_guard_supplier_paid_purchase\(\)/);
 assert.match(index,/balance===null\?'Unverified':money\(balance\)/);
 assert.match(sql,/alter table public\.restaurant_supplier_payments enable row level security/);
 assert.match(sql,/revoke all on public\.restaurant_supplier_payments/);
 assert.match(sql,/security definer set search_path=''/);
 assert.match(sql,/public\.has_restaurant_role\(p_restaurant_id,array\['owner'\]\)/);
 assert.match(sql,/for update/);
 assert.match(sql,/return prior\.id/);
 assert.match(sql,/prior\.created_by<>auth\.uid\(\)/);
 assert.match(sql,/restaurant_cashbook_closings/);
 assert.match(sql,/bite_property_shift_closings/);
 assert.match(sql,/purchase_row\.total_amount-purchase_row\.paid_amount-prior_total/);
 assert.match(sql,/create or replace view public\.restaurant_cashbook_entries with \(security_invoker=true\)/);
 assert.match(sql,/''supplier_payment''::text/);
 assert.match(sql,/original purchase date|purchase day|purchase_date/i);
 assert.match(css,/@media\(max-width:430px\)/);
});

test('A04 canonical migration file exactly matches the SQL verified in PG17 and applied to live Supabase',()=>{
 const applied=fs.readFileSync('supabase/migrations/20261119041054_owner_a04_supplier_payment_date_ledger.sql','utf8');
 assert.equal(applied,sql);
});

test('A04 supplier balances reject duplicate receipts, unknown money and impossible dates',()=>{
 assert.equal(due.outstanding(purchase,[...pays,pays[0]]),null);
 for(const amount of [null,'',true,'oops',1.001,-1,Infinity]){
  assert.equal(due.outstanding(purchase,[{...pays[0],amount}]),null);
 }
 assert.equal(due.outstanding(purchase,[{...pays[0],payment_date:'2026-02-30'}]),null);
 assert.ok(due.summary([purchase,purchase],pays).error);
 assert.throws(()=>due.validate({purchase,payments:[...pays,pays[0]],amount:1,date:'2026-11-19',today:'2026-11-19',method:'Cash'}));
 assert.match(index,/pay.count===pay.data.length/);
 assert.match(index,/count!==data.length/);
});

test('Supplier payment cannot coerce boolean inputs or use an invalid today date',()=>{
 const base={purchase,payments:pays,today:'2026-11-19',amount:100,date:'2026-11-19',method:'Cash',reference:'42'};
 for(const amount of [true,false,[],{},null,' ',Infinity,'1.001'])assert.throws(()=>due.validate({...base,amount}));
 assert.throws(()=>due.validate({...base,today:'2026-02-30'}));
});
test('Supplier payment retry preserves the exact first submitted payload',()=>{
 const js=fs.readFileSync('assets/owner-supplier-dues.js','utf8');
 assert.match(js,/attempt=Object\.freeze\(\{purchaseId:purchase.id,\.\.\.data,requestId\}\)/);
 assert.match(js,/await onSave\(\{\.\.\.attempt\}\)/);
 assert.match(js,/if\(!attempt\)form.elements.confirmed.checked=false/);
});
