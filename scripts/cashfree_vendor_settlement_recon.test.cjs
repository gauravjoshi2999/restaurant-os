'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const imported=import(pathToFileURL(resolve('supabase/functions/bite-cashfree-operations/vendor-settlement-recon.mjs')).href);
const scope={orderId:'bite_live_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',vendorId:'vendor_1',splitAmount:'150.00'};
const records=()=>({cursor:null,data:[{
 merchant_order_id:scope.orderId,merchant_vendor_id:scope.vendorId,
 entity_type:'vendor_commission',currency:'INR',amount:'150.00',settled:'YES',
 vendor_settlement_id:'REF_54878',vendor_settlement_utr:'EXAMPLEUTR6789',
 past_settlements:[{settlement_id:'REF_54878',status:'SUCCESS'}],
 other_private_field:'MUST_NOT_BE_INCLUDED_IN_OUTPUT'
}]});
test('vendor settled response never confirms independent bank credit or returns full provider UTR',async()=>{
 const {parseVendorSettlementRecon}=await imported;
 const result=parseVendorSettlementRecon(records(),scope);
 assert.equal(result.status,'PROVIDER_REPORTS_SETTLED');
 assert.equal(result.provider_settled,true);
 assert.equal(result.vendor_settlement_utr_masked,'••••6789');
 assert.equal(result.bank_credit,'NOT_INDEPENDENTLY_VERIFIED');
 const txt=JSON.stringify(result);
 assert.ok(!txt.includes('EXAMPLEUTR6789'));
 assert.ok(!txt.includes('MUST_NOT_BE_INCLUDED_IN_OUTPUT'));
});
test('comparison with operator UTR is not a bank credit certification',async()=>{
 const {parseVendorSettlementRecon}=await imported;
 let result=parseVendorSettlementRecon(records(),{...scope,bankStatementUtr:'EXAMPLEUTR6789'});
 assert.equal(result.utr_check,'MATCHES_OPERATOR_INPUT');
 assert.equal(result.bank_credit,'NOT_INDEPENDENTLY_VERIFIED');
 result=parseVendorSettlementRecon(records(),{...scope,bankStatementUtr:'DIFFERENTUTR9'});
 assert.equal(result.utr_check,'DIFFERS_FROM_OPERATOR_INPUT');
 assert.throws(()=>parseVendorSettlementRecon(records(),{...scope,bankStatementUtr:'invalid value'}));
});
test('missing, incomplete and ambiguous provider records never imply bank paid',async()=>{
 const {parseVendorSettlementRecon}=await imported;
 let r=records();r.data=[];assert.equal(parseVendorSettlementRecon(r,scope).status,'NO_VENDOR_RECON_ROW');
 r=records();r.cursor='next';assert.equal(parseVendorSettlementRecon(r,scope).status,'PAGINATION_INCOMPLETE');
 r=records();r.data.push({...r.data[0]});assert.equal(parseVendorSettlementRecon(r,scope).status,'MULTIPLE_VENDOR_RECON_ROWS');
 r=records();r.data[0].settled='NO';assert.equal(parseVendorSettlementRecon(r,scope).status,'PROVIDER_NOT_SETTLED');
 r=records();r.data[0].vendor_settlement_utr=null;assert.equal(parseVendorSettlementRecon(r,scope).status,'PROVIDER_SETTLEMENT_EVIDENCE_INCOMPLETE');
 r=records();r.data[0].past_settlements[0].status='PENDING';assert.equal(parseVendorSettlementRecon(r,scope).status,'PROVIDER_SETTLEMENT_EVIDENCE_INCOMPLETE');
});
test('mismatched order, currency or vendor split amount is rejected',async()=>{
 const {parseVendorSettlementRecon}=await imported;
 for(const modify of [
  r=>{r.data[0].merchant_order_id='other_order'},
  r=>{r.data[0].currency='USD'},
  r=>{r.data[0].amount='151.00'},
 ]){
  const r=records();modify(r);assert.throws(()=>parseVendorSettlementRecon(r,scope));
 }
});
test('server requires authenticated admin, verified order, split and matching vendor bank first',()=>{
 const s=fs.readFileSync('supabase/functions/bite-cashfree-operations/index.ts','utf8');
 const start=s.indexOf('if(body.action==="inspect_vendor_recon"){');
 const end=s.indexOf('if(body.action==="reconcile"){',start);
 assert.ok(start>0&&end>start);
 const block=s.slice(start,end);
 for(const part of ['order_status!=="PAID"','parseCashfreeSplit','expectedVendor',
  'compareProviderVendorBank','bank_details_comparison!=="MATCH"','/split/order/vendor/recon',
  'order_ids:[intent.provider_order_id]','parseVendorSettlementRecon'])
  assert.ok(block.includes(part),part);
 assert.ok(!block.includes('.insert(')&&!block.includes('.update(')&&!block.includes('.delete('));
 assert.ok(s.includes('client.rpc("is_platform_admin")'));
});
