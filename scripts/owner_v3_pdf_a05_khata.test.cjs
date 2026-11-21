'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
globalThis.BiteV3Period=require('../assets/owner-v3-period.js');
const khata=require('../assets/owner-v3-khata.js');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/owner-v3-khata.css','utf8');
const today='2026-11-19';
const cid='customer-1';
const entries=[
 {entry_id:'a',customer_id:cid,source_type:'manual',entry_type:'debit',entry_date:'2026-11-01',created_at:'2026-11-01T10:00:00Z',amount:100,description:'Opening balance'},
 {entry_id:'b',customer_id:cid,source_type:'manual',entry_type:'credit',entry_date:'2026-11-18',created_at:'2026-11-18T10:00:00Z',amount:40,payment_method:'Cash',description:'Receipt'},
];
test('A05 PDF: opening ₹100 minus receipt ₹40 is ₹60 due, never an extra sale',()=>{
 const p=khata.statement({entries,customerId:cid,balance:60,from:'2026-11-01',to:'2026-11-19'});
 assert.equal(p.verified,true);
 assert.equal(p.openingCents,0);
 assert.equal(p.chargeCents,10000);
 assert.equal(p.receiptCents,4000);
 assert.equal(p.closingCents,6000);
 assert.deepEqual(p.rows.map(x=>x.balanceAfterCents),[6000,10000]);
 assert.equal(khata.sourceLabel(entries[0]),'Manual due / opening');
 assert.equal(khata.sourceLabel(entries[1]),'Receipt · Khata');
});
test('A05 report date is independent: as-of Nov 10 has ₹100 due, Nov 15..19 opens at ₹100',()=>{
 const early=khata.statement({entries,customerId:cid,balance:60,from:'2026-11-01',to:'2026-11-10'});
 assert.equal(early.closingCents,10000);
 assert.equal(early.openingCents,0);
 assert.equal(early.rows.length,1);
 const late=khata.statement({entries,customerId:cid,balance:60,from:'2026-11-15',to:'2026-11-19'});
 assert.equal(late.openingCents,10000);
 assert.equal(late.receiptCents,4000);
 assert.equal(late.closingCents,6000);
});
test('A05 canonical linked POS bill, partial receipt and refund maintain exact balance',()=>{
 const rows=[
  {entry_id:'1',customer_id:cid,source_type:'pos_order',entry_type:'debit',entry_date:'2026-10-01',created_at:'2026-10-01T01:00:00Z',amount:200},
  {entry_id:'2',customer_id:cid,source_type:'pos_payment',entry_type:'credit',entry_date:'2026-10-01',created_at:'2026-10-01T01:10:00Z',amount:80},
  {entry_id:'3',customer_id:cid,source_type:'pos_refund',entry_type:'debit',entry_date:'2026-10-02',created_at:'2026-10-02T01:20:00Z',amount:20},
  {entry_id:'4',customer_id:cid,source_type:'manual',entry_type:'credit',entry_date:'2026-10-05',created_at:'2026-10-05T10:00:00Z',amount:40},
  {entry_id:'5',customer_id:'customer-2',source_type:'manual',entry_type:'debit',entry_date:'2026-10-01',amount:5000}
 ];
 const a=khata.statement({entries:rows,customerId:cid,balance:100,from:'2026-10-01',to:'2026-10-31'});
 assert.equal(a.verified,true);
 assert.equal(a.closingCents,10000);
 assert.equal(a.chargeCents,22000);
 assert.equal(a.receiptCents,12000);
 assert.equal(a.rows.length,4);
 assert.equal(khata.sourceLabel(rows[1]),'Linked POS payment');
 assert.equal(khata.sourceLabel(rows[2]),'Linked POS refund');
});
test('A05 missing, corrupt or truncated history never renders invented running balances',()=>{
 assert.equal(khata.statement({entries,customerId:cid,balance:60,from:'2026-11-01',to:'2026-11-19',complete:false}).verified,false);
 assert.equal(khata.statement({entries:[{...entries[0],amount:'NaN'}],customerId:cid,balance:100,from:'2026-11-01',to:'2026-11-19'}).verified,false);
 assert.equal(khata.statement({entries,customerId:cid,balance:NaN,from:'2026-11-01',to:'2026-11-19'}).verified,false);
 assert.equal(khata.statement({entries,customerId:cid,balance:60,from:'2026-11-19',to:'2026-11-01'}).verified,false);
});
test('A05 customer search and Due/Advance/Clear are restaurant-local and case insensitive',()=>{
 const customers=[
  {id:'a',full_name:'Shree Ram',phone:'9876543210'},
  {id:'b',full_name:'Ali',phone:'1234567890'},
  {id:'c',full_name:'John',phone:''}
 ];
 const balances=[{customer_id:'a',balance:40},{customer_id:'b',balance:-10},{customer_id:'c',balance:0}];
 assert.deepEqual(khata.filterCustomers(customers,balances,'ram','all').map(c=>c.id),['a']);
 assert.deepEqual(khata.filterCustomers(customers,balances,'54321','due').map(c=>c.id),['a']);
 assert.deepEqual(khata.filterCustomers(customers,balances,'','advance').map(c=>c.id),['b']);
 assert.deepEqual(khata.filterCustomers(customers,balances,'','clear').map(c=>c.id),['c']);
});
test('A05 keeps canonical ledger as source and does not duplicate POS payments',()=>{
 assert.match(html,/id="khataV3Search"/);
 assert.match(html,/id="khataV3Cards"/);
 assert.match(html,/id="khataV3Statement"/);
 assert.match(html,/BiteV3Khata\?\.filterCustomers/);
 assert.match(html,/BiteV3Khata\?\.renderStatement/);
 assert.match(html,/function collectKhataDue\(customerId\)/);
 assert.match(html,/khataCollectDueCustomerId===customer/);
 assert.match(html,/if\(khataEntrySaving\)return/);
 assert.match(html,/restaurant_customer_balances/);
 assert.match(html,/restaurant_customer_ledger'\)\.select\('\*'\)/);
 assert.match(html,/\.range\(start,start\+pageSize-1\)/);
 assert.match(html,/pageSize=500,maxPages=40/);
 assert.match(html,/owner-v3-khata\.css\?v=20261119-a05-1/);
 assert.match(html,/owner-v3-khata\.js\?v=20261119-a05-1/);
 assert.doesNotMatch(fs.readFileSync('assets/owner-v3-khata.js','utf8'),/\.(?:insert|upsert|update|delete|rpc)\(/);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.match(css,/@media print/);
});
test('A05 period picker is shared with Daily Book but never changes new receipt input',()=>{
 const selected=khata.periodFor('owner-1:restaurant-1',today);
 assert.equal(selected.mode,'month');
 assert.equal(selected.from,'2026-11-01');
 assert.equal(selected.to,today);
 assert.match(html,/document\.getElementById\('khataEntryDate'\)\.value=localDateInput\(\)/);
});

test('A05 receipt RPC is request-idempotent, tenant/role guarded and original-ledger only',()=>{
 const sql=fs.readFileSync('docs/sql/owner_a05_customer_receipts_staging.sql','utf8');
 assert.match(sql,/alter table public\.restaurant_customer_ledger_entries/);
 assert.match(sql,/add column if not exists receipt_request_id uuid/);
 assert.match(sql,/create unique index if not exists restaurant_customer_receipt_request_unique/);
 assert.match(sql,/security definer set search_path=''/);
 assert.match(sql,/public\.has_restaurant_role\(p_restaurant_id,array\['owner','manager','staff'\]\)/);
 assert.match(sql,/private\.bite_restaurant_staff_can\(p_restaurant_id,'payment_entry'\)/);
 assert.match(sql,/from public\.restaurant_customers\s+where id=p_customer_id and restaurant_id=p_restaurant_id for update/);
 assert.match(sql,/return prior\.id/);
 assert.match(sql,/restaurant_cashbook_closings/);
 assert.match(sql,/bite_property_shift_closings/);
 assert.match(sql,/receipt exceeds current customer due|Receipt exceeds current customer due/);
 assert.match(sql,/revoke all on function public\.record_restaurant_khata_receipt/);
 assert.match(html,/sb\.rpc\('record_restaurant_khata_receipt'/);
 assert.match(html,/p_request_id:khataReceiptRequestId/);
 assert.match(html,/khataReceiptSignature!==signature/);
 assert.match(html,/p_allow_advance:allowAdvance/);
 assert.match(html,/recorded\. Cashbook reflects receipt only/);
 assert.match(html,/function collectKhataDue\(customerId\)/);
 assert.doesNotMatch(sql,/create table.*customer.*khata.*ledger/i);
});

test('A05 unverified customer never appears as Clear or collectible due',()=>{
 const list=[{id:'missing',full_name:'Unknown',status:'Active'},{id:'null',full_name:'Null',status:'Active'}];
 const balances=[{customer_id:'null',balance:null}];
 assert.equal(khata.filterCustomers(list,balances,'','all').length,2);
 assert.equal(khata.filterCustomers(list,balances,'','clear').length,0);
 assert.equal(khata.filterCustomers(list,balances,'','due').length,0);
 assert.equal(khata.filterCustomers(list,balances,'','advance').length,0);
});

test('A05 canonical database migration archive matches the isolated PG17 tested SQL and live Supabase version',()=>{
 const staged=fs.readFileSync('docs/sql/owner_a05_customer_receipts_staging.sql','utf8');
 const applied=fs.readFileSync('supabase/migrations/20261119045445_owner_a05_customer_khata_idempotent_receipts.sql','utf8');
 assert.equal(applied,staged);
 assert.match(applied,/receipt_request_id uuid/);
 assert.match(applied,/record_restaurant_khata_receipt/);
 assert.match(applied,/receipt_request_id=p_request_id/);
});

test('A05 exact balance and unique source identity required for statement',()=>{
 for(const balance of [null,'',' ',true,[],1.001,Number.MAX_SAFE_INTEGER])assert.equal(khata.statement({entries,customerId:cid,balance,from:'2026-11-01',to:today}).verified,false);
 assert.equal(khata.statement({entries:[...entries,entries[0]],customerId:cid,balance:60,from:'2026-11-01',to:today}).verified,false);
 const customers=[{id:cid,full_name:'Test'}];
 assert.equal(khata.filterCustomers(customers,[{customer_id:cid,balance:40},{customer_id:cid,balance:40}],'','due').length,0);
 assert.equal(khata.cents(null),null);
});
