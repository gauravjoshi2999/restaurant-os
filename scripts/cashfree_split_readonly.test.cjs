'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const imported=import(pathToFileURL(resolve('supabase/functions/bite-cashfree-operations/split-evidence.mjs')).href);
const expected={orderId:'bite_live_1234567890abcdef',orderAmount:'174.00',currency:'INR'};
const response=()=>({
 settlement:{order_id:expected.orderId,order_amount:174,order_currency:'INR',
  cf_settlement_id:4301319325,transfer_utr:null},
 vendors:[{vendor_id:'restaurant_vendor_1',settlement_id:87168,
  settlement_amount:150,settlement_eligibility_date:'2026-11-14 11:00:00'}]
});
test('reads strict Easy Split order and vendor records, without bank settlement certification',async()=>{
 const {parseCashfreeSplit}=await imported;
 const result=parseCashfreeSplit(response(),expected);
 assert.equal(result.status,'PROVIDER_VENDOR_SPLIT_RECORDS');
 assert.equal(result.vendor_count,1);
 assert.equal(result.vendors[0].amount,150);
 assert.equal(result.vendors[0].settlement_reference,'87168');
 assert.equal(result.vendor_mapping,'NOT_VERIFIED');
 assert.equal(result.bank_payout,'NOT_VERIFIED');
 assert.equal(result.vendors[0].account_number,undefined);
 assert.match(result.disclaimer,/not bank-credit evidence/i);
});
test('empty vendor list must never be interpreted as payout or split created',async()=>{
 const {parseCashfreeSplit}=await imported;
 const r=response();r.vendors=[];
 const result=parseCashfreeSplit(r,expected);
 assert.equal(result.status,'NO_VENDOR_SPLIT_RECORDS');
 assert.equal(result.vendor_count,0);
 assert.equal(result.bank_payout,'NOT_VERIFIED');
});
test('rejects cross-order and currency mismatches before displaying provider evidence',async()=>{
 const {parseCashfreeSplit}=await imported;
 for(const mutation of [r=>r.settlement.order_id='unrelated-order',
  r=>r.settlement.order_currency='USD',r=>r.settlement.order_amount=173]){
  const r=response();mutation(r);
  assert.throws(()=>parseCashfreeSplit(r,expected),/mismatch|match/i);
 }
});
test('rejects missing list, duplicate vendor IDs and invalid financial amounts',async()=>{
 const {parseCashfreeSplit}=await imported;
 for(const mutate of [
  r=>{delete r.vendors},
  r=>{r.vendors.push({...r.vendors[0]})},
  r=>{r.vendors[0].settlement_amount=-1},
  r=>{r.vendors[0].settlement_amount='1.234'},
  r=>{r.vendors[0].settlement_amount='999.00'},
  r=>{r.vendors[0].vendor_id='<script>alert(1)</script>'}
 ]){
  const r=response();mutate(r);
  assert.throws(()=>parseCashfreeSplit(r,expected));
 }
});
test('Edge Function read-only branch uses trusted paid order; no client vendor or payment transfer',()=>{
 const code=fs.readFileSync('supabase/functions/bite-cashfree-operations/index.ts','utf8');
 const start=code.indexOf('if(body.action==="inspect_split"){');
 const end=code.indexOf('if(body.action==="inspect_vendor"){',start);
 assert(start>0&&end>start);
 const branch=code.slice(start,end);
 assert.match(branch,/collection\.data\?\.order_id!==intent\.provider_order_id/);
 assert.match(branch,/order_status!=="PAID"/);
 assert.match(branch,/\/easy-split\/orders\//);
 assert.match(branch,/x-api-version":"2026-01-01"/);
 assert.match(branch,/parseCashfreeSplit/);
 assert.ok(!branch.includes(".insert(")&&!branch.includes(".update("));
 assert.doesNotMatch(branch,/method:"POST"|execute_refund|create_vendor|create_transfer/);
 assert.match(code,/client\.rpc\("is_platform_admin"\)/);
 assert.match(code,/CASHFREE_SECRET_KEY/);
 assert.match(code,/provider_order_id!=="bite_live_"/);
});
