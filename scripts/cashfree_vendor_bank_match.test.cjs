'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const helper=import(pathToFileURL(resolve('supabase/functions/bite-cashfree-operations/vendor-bank-match.mjs')).href);
const provider=()=>({
 vendor_id:'venue_a',status:'IN_BENE_CREATION',
 email:'secret@example.com',phone:'9999999999',name:'Private Person',
 bank:{account_number:'001234567890',account_holder:'PERSON',ifsc:'HDFC0001234'},
 related_docs:[{doc_type:'PAN_NUMBER',doc_value:'CONFIDENTIAL'}]
});
const profile=()=>({restaurant_id:'rest_a',approval_status:'Approved',
 account_number:'001234567890',ifsc_code:'hdfc0001234',account_holder_name:'PRIVATE'});
test('matches exact bank + IFSC only and never equates matching settings with payout',async()=>{
 const {compareProviderVendorBank}=await helper;
 const result=compareProviderVendorBank(provider(),profile(),'venue_a');
 assert.equal(result.bank_details_comparison,'MATCH');
 assert.equal(result.comparison_reason,'BANK_DETAILS_MATCH_ONLY');
 assert.equal(result.provider_vendor_status,'IN_BENE_CREATION');
 assert.equal(result.restaurant_mapping,'NOT_APPROVED');
 assert.equal(result.vendor_kyc,'NOT_VERIFIED');
 assert.equal(result.vendor_payout,'NOT_VERIFIED');
 assert.equal(result.bank_credit,'NOT_VERIFIED');
 const printed=JSON.stringify(result);
 for(const secret of ['001234567890','HDFC0001234','PAN_NUMBER','CONFIDENTIAL',
  'secret@example.com','9999999999','PRIVATE'])
  assert.equal(printed.includes(secret),false,'must not leak private identity/bank fields');
});
test('wrong account or wrong IFSC must not become a positive vendor bank match',async()=>{
 const {compareProviderVendorBank}=await helper;
 const wrong=provider();wrong.bank.account_number='001234567891';
 assert.equal(compareProviderVendorBank(wrong,profile(),'venue_a').bank_details_comparison,'MISMATCH');
 const p=profile();p.ifsc_code='ICIC0001234';
 assert.equal(compareProviderVendorBank(provider(),p,'venue_a').bank_details_comparison,'MISMATCH');
});
test('unknown vendor, absent profile, missing provider bank, invalid fields fail closed',async()=>{
 const {compareProviderVendorBank}=await helper;
 assert.throws(()=>compareProviderVendorBank(provider(),profile(),'venue_b'),/mismatch/);
 assert.equal(compareProviderVendorBank(provider(),null,'venue_a').bank_details_comparison,'NOT_COMPARABLE');
 const withoutBank=provider();delete withoutBank.bank;
 assert.equal(compareProviderVendorBank(withoutBank,profile(),'venue_a').bank_details_comparison,'NOT_COMPARABLE');
 const imprecise=provider();imprecise.bank.account_number=12345678901234567890;
 assert.equal(compareProviderVendorBank(imprecise,profile(),'venue_a').bank_details_comparison,'NOT_COMPARABLE',
  'unsafe JS numeric bank fields must never be rounded into a positive match');
 const malformed=provider();malformed.status='<script>';
 assert.equal(compareProviderVendorBank(malformed,profile(),'venue_a').provider_vendor_status,'UNKNOWN');
 const invalid=profile();invalid.account_number='****1234';
 assert.equal(compareProviderVendorBank(provider(),invalid,'venue_a').bank_details_comparison,'NOT_COMPARABLE');
});
test('documented Cashfree numeric bank accounts can be safely compared only at exact precision',async()=>{
 const {compareProviderVendorBank}=await helper;
 const v=provider();v.bank.account_number=11219276360;v.bank.ifsc='YESB0000262';
 const p=profile();p.account_number='11219276360';p.ifsc_code='YESB0000262';
 assert.equal(compareProviderVendorBank(v,p,'venue_a').bank_details_comparison,'MATCH');
});
test('inspect_vendor Edge Function revalidates the paid Bite order and provider split before bank GET',()=>{
 const code=fs.readFileSync('supabase/functions/bite-cashfree-operations/index.ts','utf8');
 const start=code.indexOf('if(body.action==="inspect_vendor"){');
 const end=code.indexOf('if(body.action==="inspect_vendor_recon"){',start);
 assert(start>0&&end>start);
 const block=code.slice(start,end);
 assert.match(block,/order_status!=="PAID"/);
 assert.match(block,/splitEvidence\.vendors\.some/);
 assert.match(block,/\/easy-split\/vendors\//);
 assert.match(block,/provider\("\/orders\/"\+cfId\)/);
 assert.match(block,/\.eq\("restaurant_id",order\.restaurant_id\)/);
 assert.match(block,/compareProviderVendorBank/);
 assert.match(block,/restaurant_payout:"NOT_VERIFIED"/);
 assert.match(block,/bank_credit:"NOT_VERIFIED"/);
 assert.ok(!block.includes('.insert(')&&!block.includes('.update(')&&!block.includes('.delete('));
 assert.ok(!block.includes('method:"POST"'));
 assert.ok(!block.includes('bank.account_number'));
 assert.ok(!block.includes('account_holder_name'));
 assert.match(code,/client\.rpc\("is_platform_admin"\)/);
 assert.match(code,/client\.auth\.getUser\(\)/);
 assert.match(code,/CASHFREE_SECRET_KEY/);
 assert.match(code,/BITE_PROVIDER_REFUNDS_ENABLED/);
});
