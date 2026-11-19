'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
globalThis.BiteV3Period=require('../assets/owner-v3-period.js');
const khata=require('../assets/owner-v3-khata.js');
const html=fs.readFileSync('index.html','utf8');
const js=fs.readFileSync('assets/owner-v3-khata.js','utf8');
const css=fs.readFileSync('assets/owner-v3-khata.css','utf8');
const entries=[
 {entry_id:'debit-1',restaurant_id:'r1',customer_id:'c1',source_type:'manual',entry_date:'2026-11-01',entry_type:'debit',amount:100,created_at:'2026-11-01T10:00:00Z'},
 {entry_id:'pos-1',restaurant_id:'r1',customer_id:'c1',source_type:'pos_order',entry_date:'2026-11-04',entry_type:'debit',amount:200,created_at:'2026-11-04T11:00:00Z'},
 {entry_id:'credit-1',restaurant_id:'r1',customer_id:'c1',source_type:'manual',entry_date:'2026-11-18',entry_type:'credit',amount:40,created_at:'2026-11-18T08:00:00Z'},
 {entry_id:'paid-1',restaurant_id:'r1',customer_id:'c1',source_type:'pos_payment',entry_date:'2026-11-19',entry_type:'credit',amount:50,created_at:'2026-11-19T13:00:00Z'},
 {entry_id:'other',restaurant_id:'r1',customer_id:'c2',source_type:'manual',entry_date:'2026-11-17',entry_type:'debit',amount:999,created_at:'2026-11-17T08:00:00Z'}
];
test('A05 real linked POS bills and receipts compute current due without treating collections as new sales',()=>{
 const r=khata.statement({entries,customerId:'c1',balance:210,from:'2026-11-01',to:'2026-11-19'});
 assert.equal(r.verified,true);
 assert.equal(r.openingCents,0);
 assert.equal(r.chargeCents,30000);
 assert.equal(r.receiptCents,9000);
 assert.equal(r.closingCents,21000);
 assert.deepEqual(r.rows.map(x=>[x.entry_id,x.balanceAfterCents]),[
  ['paid-1',21000],['credit-1',26000],['pos-1',30000],['debit-1',10000]
 ]);
 assert.equal(khata.sourceLabel(entries[1]),'Linked POS bill');
 assert.equal(khata.sourceLabel(entries[3]),'Linked POS payment');
});
test('A05 partial 40 receipt against historical opening 100 leaves exactly due 60',()=>{
 const history=[entries[0],entries[2]];
 const report=khata.statement({entries:history,customerId:'c1',balance:60,from:'2026-11-01',to:'2026-11-19'});
 assert.equal(report.openingCents,0);
 assert.equal(report.chargeCents,10000);
 assert.equal(report.receiptCents,4000);
 assert.equal(report.closingCents,6000);
});
test('A05 period is a filter only; opening/closing as of selected dates differs from current due',()=>{
 const r=khata.statement({entries,customerId:'c1',balance:210,from:'2026-11-10',to:'2026-11-18'});
 assert.equal(r.verified,true);assert.equal(r.openingCents,30000);
 assert.equal(r.closingCents,26000);assert.equal(r.receiptCents,4000);
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].entry_id,'credit-1');
});
test('A05 refuses fabricated complete statement when history is truncated or corrupt',()=>{
 assert.equal(khata.statement({entries,customerId:'c1',balance:210,from:'2026-11-01',to:'2026-11-19',complete:false}).verified,false);
 assert.equal(khata.statement({entries,customerId:'c1',balance:NaN,from:'2026-11-01',to:'2026-11-19'}).verified,false);
 assert.equal(khata.statement({entries:[{...entries[0],amount:'not-money'}],customerId:'c1',balance:210,from:'2026-11-01',to:'2026-11-19'}).verified,false);
 assert.equal(khata.statement({entries,customerId:'c1',balance:210,from:'2026-11-20',to:'2026-11-01'}).verified,false);
});
test('A05 customer finder separates due, advance and clear with search, never crosses filter',()=>{
 const people=[
  {id:'c1',full_name:'Rama',phone:'9876543210'},
  {id:'c2',full_name:'Ramesh',phone:'9123456789'},
  {id:'c3',full_name:'Uma',phone:'9222222222'}
 ];
 const balances=[
  {customer_id:'c1',balance:60},
  {customer_id:'c2',balance:-100},
  {customer_id:'c3',balance:0}
 ];
 assert.deepEqual(khata.filterCustomers(people,balances,'9876','all').map(c=>c.id),['c1']);
 assert.deepEqual(khata.filterCustomers(people,balances,'','due').map(c=>c.id),['c1']);
 assert.deepEqual(khata.filterCustomers(people,balances,'','advance').map(c=>c.id),['c2']);
 assert.deepEqual(khata.filterCustomers(people,balances,'','clear').map(c=>c.id),['c3']);
});
test('A05 mobile customer cards are escaped and Collect Due only appears for active positive due',()=>{
 const host={innerHTML:'',onclick:null};
 const people=[{id:'c1',full_name:'<script>alert(1)</script>',phone:'9876543210',status:'Active'}];
 khata.customerCards(host,{customers:people,balances:[{customer_id:'c1',balance:60}],selectedId:'c1'});
 assert.match(host.innerHTML,/data-v3-khata-collect/);
 assert.doesNotMatch(host.innerHTML,/<script>/);
 khata.customerCards(host,{customers:[{...people[0],status:'Inactive'}],balances:[{customer_id:'c1',balance:60}]});
 assert.doesNotMatch(host.innerHTML,/data-v3-khata-collect/);
 khata.customerCards(host,{customers:people,balances:[{customer_id:'c1',balance:null}]});
 assert.match(host.innerHTML,/Balance unavailable/);
 assert.doesNotMatch(host.innerHTML,/data-v3-khata-collect/);
});
test('A05 same existing one-ledger view and RLS write endpoints, no new accounting side-table',()=>{
 assert.match(html,/assets\/owner-v3-khata\.js\?v=20261119-a05-1/);
 assert.match(html,/assets\/owner-v3-khata\.css\?v=20261119-a05-1/);
 assert.match(html,/id="khataV3Cards"/);
 assert.match(html,/id="khataV3Statement"/);
 assert.match(html,/id="khataV3Toolbar"/);
 assert.match(html,/id="khataReceiptConfirm"/);
 assert.match(html,/id="khataOpeningConfirm"/);
 assert.match(html,/select\('\*'\)\.eq\('restaurant_id',rid\)/);
 assert.match(html,/from\('restaurant_customer_balances'\)/);
 assert.match(html,/from\('restaurant_customer_ledger'\)/);
 assert.match(html,/\.limit\(1001\)/);
 assert.match(html,/khataHistoryComplete=\(entries\.data\|\|\[\]\)\.length<=1000/);
 assert.match(html,/request!==khataLoadVersion/);
 assert.match(html,/khataRestaurantId\(\)!==rid/);
 assert.match(html,/from\('restaurant_customer_ledger_entries'\)\.insert/);
 assert.match(html,/khataReceiptConfirm'\)\.checked/);
 assert.match(html,/khataOpeningConfirm'\)\.checked/);
 assert.match(html,/khataEntrySaving=true;button\.disabled=true/);
 assert.match(html,/window\.BiteV3Khata\?\.renderStatement/);
 assert.doesNotMatch(js,/\.(?:insert|upsert|update|delete|rpc)\(/);
});
test('A05 Day/Month/Range shared picker and 320/360/390/430 responsive layout retained',()=>{
 assert.match(js,/root\.BiteV3Period\.mount/);
 assert.match(js,/basis:'Khata: transaction date/);
 assert.match(js,/Copy statement/);
 assert.match(js,/Print statement/);
 assert.match(js,/data-v3-khata-collect-due/);
 assert.match(js,/data-v3-khata-opening/);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/@media print/);
});
