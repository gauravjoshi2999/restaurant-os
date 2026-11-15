'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('assets/admin-cashfree-audit.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const makeNode=()=>({
 textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},style:{},children:[],handlers:{},
 setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;},
 append(...nodes){this.children.push(...nodes);},
 replaceChildren(){this.children=[];},
 closest(){return null;}
});
function setup(options={}){
 const elements=new Map();
 const find=id=>{
  if(!elements.has(id))elements.set(id,makeNode());
  return elements.get(id);
 };
 const document={getElementById:find,createElement:makeNode};
 const window={};
 vm.runInNewContext(code,{window,document,console});
 const calls=[],read=[];
 let user=options.userId??'admin-a',role=options.role??'super_admin',isAdmin=options.isAdmin??true;
 let checks=options.checks||[],refunds=options.refunds||[],error=null,table='';
 const orders=[
  {id:'order-paid',order_code:'BITE-123',is_demo:false,channel:'Own Platform'},
  {id:'order-demo',order_code:'DEMO',is_demo:true,channel:'Own Platform'},
  {id:'order-pos',order_code:'POS',is_demo:false,channel:'POS - Counter'}];
 const fin=[
  {order_id:'order-paid',restaurant_id:'restaurant-a',channel:'Own Platform',is_demo:false,payment_status:'paid',customer_payable_amount:174,created_at:'2026-11-14T09:00:00Z'},
  {order_id:'order-demo',restaurant_id:'restaurant-a',channel:'Own Platform',is_demo:true,payment_status:'paid',customer_payable_amount:150},
  {order_id:'order-pos',restaurant_id:'restaurant-a',channel:'POS - Counter',is_demo:false,payment_status:'paid',customer_payable_amount:100}
 ];
 const state={orders,financials:fin,restaurants:[{id:'restaurant-a',name:'Test Restaurant'}]};
 const query={select(...args){read.push({type:'select',args});return this;},eq(){return this;},in(column,ids){read.push({type:'in',table,column,ids});return this;},order(){return this;},async limit(){return {data:table==='bite_refund_jobs'?refunds:table==='orders'?(options.lookupOrders||[]):checks,error};}};
 const sb={from(name){table=name;read.push({type:'table',name});return query;},functions:{async invoke(name,payload){
    if(payload.body?.action==='inspect_refund'){
     calls.push({name,payload});
     return {data:{status:options.providerRefundFound?'PROVIDER_REFUND_RECORD_FOUND':'NO_PROVIDER_REFUND_RECORD',
       provider_refund_status:options.providerRefundStatus||null,
       recorded_refund_status:'pending_approval',amount:1,approved:false,no_action_taken:true},error:null};
    }
    calls.push({name,payload});
    if(payload.body?.action==='inspect_vendor_recon'){
      return {data:{vendor_reconciliation:{
       status:options.reconStatus||'PROVIDER_REPORTS_SETTLED',provider_settled:true,
       vendor_settlement_utr_masked:'••••6789',
       utr_check:payload.body.bank_statement_utr?
        (options.mismatchedUtr?'DIFFERS_FROM_OPERATOR_INPUT':'MATCHES_OPERATOR_INPUT'):'NOT_SUBMITTED',
       bank_credit:'NOT_INDEPENDENTLY_VERIFIED'},
       bank_settings_match:'MATCH',restaurant_payout:'NOT_INDEPENDENTLY_VERIFIED',
       bank_credit:'NOT_INDEPENDENTLY_VERIFIED'},error:null};
    }
    if(payload.body?.action==='inspect_vendor'){
      return {data:{provider_vendor:{
       vendor_id:payload.body.vendor_id,provider_vendor_status:'IN_BENE_CREATION',
       bank_details_comparison:options.vendorBankMatch||'MATCH',
       comparison_reason:'BANK_DETAILS_MATCH_ONLY',vendor_kyc:'NOT_VERIFIED'},
       restaurant_payout:'NOT_VERIFIED',bank_credit:'NOT_VERIFIED'},error:null};
    }
    if(payload.body?.action==='inspect_split'){
      return {data:{split:{status:'PROVIDER_VENDOR_SPLIT_RECORDS',vendor_count:1,
       vendors:[{vendor_id:'vendor_1',amount:145,settlement_reference:'78123'}],
       vendor_mapping:'NOT_VERIFIED',bank_payout:'NOT_VERIFIED'}},error:null};
    }
    if(options.reconcileError){
     const error=new Error('Edge Function returned a non-2xx status code');
     if(options.reconcileErrorBody)error.context={status:options.reconcileHttpStatus||409,
      json:async()=>({error:options.reconcileErrorBody,bank_account_number:'NEVER_SHOW_ME'})};
     return {data:null,error};
    }
    if(!options.reconcileNoAudit)checks=[{order_id:'order-paid',collection_status:'PAID',collection_amount:174,settlement_evidence:{settlement:{status:'SUCCESS',settlement_utr:'some-utr'}},checked_at:'2026-11-14T10:00:00Z'}];return {data:{collection:{status:'PAID',amount:174,currency:'INR'},restaurant_payout:'NOT_VERIFIED_BY_PG_COLLECTION'},error:null};}}};
 window.BiteCashfreeAudit.init({sb,getState:()=>state,getAccess:()=>({role,isPlatformAdmin:isAdmin}),getUser:()=>user?{id:user}:null,formatMoney:n=>'₹'+Number(n).toFixed(2)});
 return {audit:window.BiteCashfreeAudit,find,calls,read,state,setUser(x){user=x;},setRole(x){role=x;},setChecks(x){checks=x;},setRefunds(x){refunds=x;},setError(x){error=x;}};
}
test('classification never confuses provider collection or merchant evidence with vendor payout',()=>{
 const a=setup();
 const fin={customer_payable_amount:174};
 let v=a.audit.classify(fin,null);
 assert.equal(v.verifiedCollection,false);
 assert.match(v.restaurantPayout,/NOT verified/);
 v=a.audit.classify(fin,{collection_status:'PAID',collection_amount:173,settlement_evidence:{settlement:{status:'SUCCESS'}}});
 assert.equal(v.verifiedCollection,false,'Wrong amount is not verified');
 v=a.audit.classify(fin,{collection_status:'PAID',collection_amount:174,settlement_evidence:{settlement:{status:'SUCCESS'}}});
 assert.equal(v.verifiedCollection,true);
 assert.match(v.merchantSettlement,/bank not confirmed/);
 assert.match(v.restaurantPayout,/NOT verified/);
});
test('loading verified-payment queue reads RLS protected table and NEVER invokes Cashfree',async()=>{
 const a=setup();
 await a.audit.load();
 assert.equal(a.calls.length,0,'No provider call on page load');
 assert.ok(a.read.some(x=>x.name==='bite_provider_checks'));
 assert.equal(a.find('biteProviderNeedCount').textContent,'1');
 assert.equal(a.find('biteProviderCheckedCount').textContent,'0');
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
 assert.equal(a.find('biteProviderAuditRows').children.length,1,'No DEMO or POS orders in live reconciliation');
 assert.match(a.find('biteProviderAuditStatus').textContent,/not bank payout confirmations/);
});
test('manual verification invokes only the existing admin-only reconcile endpoint, not transfer/refund',async()=>{
 const a=setup();
 await a.audit.load();
 await a.audit.reconcile('order-paid');
 assert.equal(a.calls.length,1);
 assert.equal(a.calls[0].name,'bite-cashfree-operations');
 assert.equal(a.calls[0].payload.body.action,'reconcile');
 assert.equal(a.calls[0].payload.body.order_id,'order-paid');
 assert.equal(a.find('biteProviderCheckedCount').textContent,'1');
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});
test('Cashfree provider failure remains visible after the post-click read-only refresh',async()=>{
 const a=setup({reconcileError:true});
 await a.audit.load();
 await a.audit.reconcile('order-paid');
 assert.equal(a.calls.length,1);
 assert.equal(a.find('biteProviderCheckedCount').textContent,'0');
 assert.match(a.find('biteProviderAuditStatus').textContent,/Provider check unavailable or mismatched for BITE-123/);
 assert.doesNotMatch(a.find('biteProviderAuditStatus').textContent,/Orders shown/);
});
test('HTTP 409 shows only an approved safe provider mismatch explanation',async()=>{
 const a=setup({reconcileError:true,reconcileErrorBody:'Provider collection evidence mismatch'});
 await a.audit.load();
 await a.audit.reconcile('order-paid');
 const status=a.find('biteProviderAuditStatus').textContent;
 assert.match(status,/HTTP 409: Cashfree order ID, currency or amount did not match/);
 assert.doesNotMatch(status,/NEVER_SHOW_ME|bank_account_number|Orders shown/);
 assert.equal(a.find('biteProviderCheckedCount').textContent,'0');
});
test('unknown backend error text remains private and does not leak raw response',async()=>{
 const a=setup({reconcileError:true,reconcileErrorBody:'secret: DO NOT EXPOSE 123'});
 await a.audit.load();
 await a.audit.reconcile('order-paid');
 const status=a.find('biteProviderAuditStatus').textContent;
 assert.match(status,/Cashfree verification did not complete/);
 assert.doesNotMatch(status,/secret: DO NOT EXPOSE 123|NEVER_SHOW_ME/);
});
test('Cashfree PAID response without saved matching audit evidence stays explicitly unverified',async()=>{
 const a=setup({reconcileNoAudit:true});
 await a.audit.load();
 await a.audit.reconcile('order-paid');
 assert.equal(a.find('biteProviderCheckedCount').textContent,'0');
 assert.match(a.find('biteProviderAuditStatus').textContent,/no matching provider-check audit record was saved/);
 assert.match(a.find('biteProviderAuditStatus').textContent,/NOT independently verified/);
});
test('successful Cashfree collection check keeps confirmation visible but never claims vendor payout',async()=>{
 const a=setup();
 await a.audit.load();
 await a.audit.reconcile('order-paid');
 assert.equal(a.find('biteProviderCheckedCount').textContent,'1');
 assert.match(a.find('biteProviderAuditStatus').textContent,/Cashfree reports PAID/);
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});
test('HTTP 409 remains visible in the affected order collection cell after refresh',async()=>{
 const a=setup({reconcileError:true,reconcileErrorBody:'Provider collection evidence mismatch'});
 await a.audit.load();
 await a.audit.reconcile('order-paid');
 const collection=a.find('biteProviderAuditRows').children[0].children[2];
 assert.match(collection.textContent,/Provider check needed/);
 assert.equal(collection.children.length,1);
 assert.match(collection.children[0].textContent,/Last manual check \(this session\):/);
 assert.match(collection.children[0].textContent,/HTTP 409: Cashfree order ID, currency or amount did not match/);
 assert.match(collection.children[0].className,/is-error/);
 assert.doesNotMatch(collection.children[0].textContent,/NEVER_SHOW_ME|bank_account_number/);
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});
test('provider PAID without a saved audit row remains visibly unverified beside the order',async()=>{
 const a=setup({reconcileNoAudit:true});
 await a.audit.load();
 await a.audit.reconcile('order-paid');
 const collection=a.find('biteProviderAuditRows').children[0].children[2];
 assert.match(collection.children[0].textContent,/no matching provider-check audit record was saved/);
 assert.match(collection.children[0].className,/is-error/);
 assert.equal(a.find('biteProviderCheckedCount').textContent,'0');
});
test('order-scoped manual results survive audit reload but clear at sign out',async()=>{
 const a=setup();
 await a.audit.load();
 await a.audit.reconcile('order-paid');
 let collection=a.find('biteProviderAuditRows').children[0].children[2];
 assert.match(collection.children[0].textContent,/Cashfree reports PAID/);
 await a.audit.load();
 collection=a.find('biteProviderAuditRows').children[0].children[2];
 assert.match(collection.children[0].textContent,/Cashfree reports PAID/);
 a.audit.clear();
 await a.audit.load();
 collection=a.find('biteProviderAuditRows').children[0].children[2];
 assert.equal(collection.children.length,0);
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});
test('owner and signed-out sessions cannot read provider checks or invoke payment operations',async()=>{
 const a=setup({role:'owner',isAdmin:false});
 await a.audit.load();await a.audit.reconcile('order-paid');
 assert.equal(a.calls.length,0);
 assert.equal(a.read.length,0);
 assert.equal(a.find('biteProviderAuditRows').children.length,0);
 a.setRole('super_admin');a.setUser(null);
 await a.audit.load();await a.audit.reconcile('order-paid');
 assert.equal(a.calls.length,0);
 assert.equal(a.read.length,0);
});
test('a failed RLS query shows a safe error without implying payment failed or transferred',async()=>{
 const a=setup();a.setError(new Error('RLS denied'));
 await a.audit.load();
 assert.match(a.find('biteProviderAuditStatus').textContent,/Unable to read provider-check records/);
 assert.equal(a.calls.length,0);
});
test('GitHub UI wires Super Admin financials only and never exposes provider secret',()=>{
 assert.match(html,/id="biteProviderAuditRows"/);
 assert.match(html,/assets\/admin-cashfree-audit\.js/);
 assert.match(html,/financials:async\(\)=>\{/);
 assert.match(html,/window\.BiteCashfreeAudit\?\.clear\?\.\(\)/);
 assert.match(html,/role==='super_admin'\?platformPages/);
 assert.match(code,/role==='super_admin'/);
 assert.match(code,/action:'reconcile'/);
 assert.doesNotMatch(code,/CASHFREE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|execute_refund|create_refund|create_transfer/);
 for(const part of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]){
  if(part[1].trim()) assert.doesNotThrow(()=>new vm.Script(part[1]));
 }
});

test('manual vendor inspection only invokes read-only inspect_split and does not mark bank payout',async()=>{
 const a=setup();
 await a.audit.load();
 assert.equal(a.calls.length,0);
 await a.audit.inspectSplit('order-paid');
 assert.equal(a.calls.length,1);
 assert.equal(a.calls[0].payload.body.action,'inspect_split');
 assert.equal(a.calls[0].payload.body.order_id,'order-paid');
 const tr=a.find('biteProviderAuditRows').children[0];
 assert.match(tr.children[4].textContent,/vendor_1/);
 assert.match(tr.children[4].textContent,/NOT verified/);
 assert.match(a.find('biteProviderAuditStatus').textContent,/mapping and bank payout remain NOT verified/);
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});

test('split inspection is restricted to Super Admin and never starts automatically',async()=>{
 const a=setup({role:'owner',isAdmin:false});
 await a.audit.load();await a.audit.inspectSplit('order-paid');
 assert.equal(a.calls.length,0);
 const admin=setup();
 await admin.audit.load();
 assert.equal(admin.calls.length,0);
 assert.equal(admin.find('biteProviderAuditRows').children[0].children[5].children.length,2,
  'both manual actions are explicit buttons');
});

test('changing login clears split details instead of showing prior Owner or Admin data',async()=>{
 const a=setup();
 await a.audit.load();await a.audit.inspectSplit('order-paid');
 a.audit.clear();
 assert.equal(a.find('biteProviderAuditRows').children.length,0);
 a.setUser('another-admin');
 await a.audit.load();
 const tr=a.find('biteProviderAuditRows').children[0];
 assert.doesNotMatch(tr.children[4].textContent,/vendor_1/);
});

test('vendor candidate comparison requires provider evidence for the exact paid order and never writes mapping',async()=>{
 const a=setup();
 await a.audit.load();
 const without=a.audit.compareVendor('order-paid','vendor_1');
 assert.equal(without.status,'NO_TRUSTED_SPLIT');
 assert.equal(a.calls.length,0);
 await a.audit.inspectSplit('order-paid');
 const found=a.audit.compareVendor('order-paid','vendor_1');
 assert.equal(found.status,'FOUND_IN_ORDER_ONLY');
 assert.equal(found.amount,145);
 assert.match(found.message,/KYC, bank mapping and UTR are NOT verified/);
 assert.equal(a.calls.length,1,'only the deliberate provider split GET is invoked');
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
 const tr=a.find('biteProviderAuditRows').children[0];
 assert.match(tr.children[4].textContent,/Vendor ID appears in this paid order split/);
 assert.equal(tr.children[5].children.length,5,'vendor bank inspection is offered only after matching a split vendor');
});

test('other vendor candidate is rejected and is never cross-linked to the restaurant',async()=>{
 const a=setup();
 await a.audit.load();await a.audit.inspectSplit('order-paid');
 const bad=a.audit.compareVendor('order-paid','another_restaurant_vendor');
 assert.equal(bad.status,'NOT_IN_ORDER');
 assert.match(bad.message,/Do not link this restaurant/);
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});

test('invalid candidate IDs cannot be interpreted as an approved vendor mapping',async()=>{
 const a=setup();
 const split={status:'PROVIDER_VENDOR_SPLIT_RECORDS',vendor_count:1,vendors:[{vendor_id:'vendor_1',amount:145}]};
 for(const v of ['','vendor/other','<script>','vendor@bank.com','x'.repeat(81)])
  assert.equal(a.audit.compareVendorCandidate(v,split).status,'INVALID_ID');
 assert.equal(a.audit.compareVendorCandidate('vendor_1',split).status,'FOUND_IN_ORDER_ONLY');
 assert.equal(a.audit.compareVendorCandidate('vendor_1',{...split,vendor_count:2}).status,'NO_TRUSTED_SPLIT');
});

test('vendor candidate and any comparison are discarded on refresh or sign-out',async()=>{
 const a=setup();
 await a.audit.load();await a.audit.inspectSplit('order-paid');
 a.audit.compareVendor('order-paid','vendor_1');
 await a.audit.load();
 const tr=a.find('biteProviderAuditRows').children[0];
 assert.doesNotMatch(tr.children[4].textContent,/Vendor ID appears in this paid order split/);
 assert.equal(tr.children[5].children.length,2);
 a.audit.clear();
 assert.equal(a.find('biteProviderAuditRows').children.length,0);
});

test('owner cannot compare candidate or expose another restaurant vendor details',async()=>{
 const a=setup({role:'owner',isAdmin:false});
 await a.audit.load();
 assert.equal(a.audit.compareVendor('order-paid','vendor_1'),undefined);
 assert.equal(a.calls.length,0);
 assert.equal(a.find('biteProviderAuditRows').children.length,0);
});

test('candidate UI is cache-busted and never persists, transfers or marks restaurant payout paid',()=>{
 assert.match(html,/admin-cashfree-audit\.js\?v=20261115-per-order-result1/);
 assert.match(code,/function compareVendorCandidate\(/);
 assert.doesNotMatch(code,/localStorage|sessionStorage|create_transfer|create_vendor|bank_account_number|account_number|\.upsert\(/);
 assert.match(html,/Vendor ID compare/);
});

test('Cashfree vendor-bank comparison is explicit and requires a matched split candidate',async()=>{
 const a=setup();
 await a.audit.load();
 await a.audit.inspectVendor('order-paid');
 assert.equal(a.calls.length,0,'no bank lookup on page load or without vendor evidence');
 await a.audit.inspectSplit('order-paid');
 await a.audit.inspectVendor('order-paid');
 assert.equal(a.calls.length,1,'split GET only until candidate matches');
 a.audit.compareVendor('order-paid','vendor_1');
 await a.audit.inspectVendor('order-paid');
 assert.equal(a.calls.length,2,'bank comparison is a distinct deliberate action');
 assert.equal(a.calls[1].payload.body.action,'inspect_vendor');
 assert.equal(a.calls[1].payload.body.vendor_id,'vendor_1');
 assert.equal(a.calls[1].payload.body.order_id,'order-paid');
 const payout=a.find('biteProviderAuditRows').children[0].children[4].textContent;
 assert.match(payout,/bank settings MATCH/);
 assert.match(payout,/bank credit remain NOT verified/);
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});

test('Cashfree bank mismatch is a STOP signal and cannot show vendor as paid',async()=>{
 const a=setup({vendorBankMatch:'MISMATCH'});
 await a.audit.load();await a.audit.inspectSplit('order-paid');
 a.audit.compareVendor('order-paid','vendor_1');
 await a.audit.inspectVendor('order-paid');
 assert.match(a.find('biteProviderAuditStatus').textContent,/DO NOT MATCH/);
 assert.match(a.find('biteProviderAuditStatus').textContent,/do not map or pay/);
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});

test('vendor bank result clears whenever candidate changes, page refreshes or admin signs out',async()=>{
 const a=setup();
 await a.audit.load();await a.audit.inspectSplit('order-paid');
 a.audit.compareVendor('order-paid','vendor_1');await a.audit.inspectVendor('order-paid');
 a.audit.compareVendor('order-paid','another_vendor');
 let note=a.find('biteProviderAuditRows').children[0].children[4].textContent;
 assert.doesNotMatch(note,/bank settings MATCH/);
 await a.audit.load();
 note=a.find('biteProviderAuditRows').children[0].children[4].textContent;
 assert.doesNotMatch(note,/bank settings MATCH/);
 a.audit.clear();
 assert.equal(a.find('biteProviderAuditRows').children.length,0);
});

test('non-admin Owner cannot use vendor bank lookup',async()=>{
 const a=setup({role:'owner',isAdmin:false});
 await a.audit.load();await a.audit.inspectVendor('order-paid');
 assert.equal(a.calls.length,0);
 assert.equal(a.read.length,0);
});

test('public UI never receives or displays raw bank, PAN, KYC document or full account fields',()=>{
 assert.match(code,/action:'inspect_vendor'/);
 assert.match(code,/bank_details_comparison/);
 assert.doesNotMatch(code,/account_number|account_holder|PAN_NUMBER|bank\.ifsc|SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(html,/admin-cashfree-audit\.js/);
});

test('vendor recon only runs after exact provider split + matching restaurant bank',async()=>{
 const a=setup();
 await a.audit.load();
 await a.audit.inspectVendorRecon('order-paid','');
 assert.equal(a.calls.length,0);
 await a.audit.inspectSplit('order-paid');
 await a.audit.inspectVendorRecon('order-paid','');
 assert.equal(a.calls.length,1,'no settlement query without candidate and bank check');
 a.audit.compareVendor('order-paid','vendor_1');
 await a.audit.inspectVendorRecon('order-paid','');
 assert.equal(a.calls.length,1);
 await a.audit.inspectVendor('order-paid');
 await a.audit.inspectVendorRecon('order-paid','');
 assert.equal(a.calls.length,3);
 assert.equal(a.calls[2].payload.body.action,'inspect_vendor_recon');
 assert.equal(a.calls[2].payload.body.vendor_id,'vendor_1');
 assert.equal(a.calls[2].payload.body.order_id,'order-paid');
 assert.equal(a.calls[2].payload.body.bank_statement_utr,undefined);
 assert.match(a.find('biteProviderAuditStatus').textContent,/bank credit remains NOT independently verified/i);
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});
test('UTR comparison never triggers a transfer or a paid label',async()=>{
 const a=setup({mismatchedUtr:true});
 await a.audit.load();await a.audit.inspectSplit('order-paid');
 a.audit.compareVendor('order-paid','vendor_1');await a.audit.inspectVendor('order-paid');
 await a.audit.inspectVendorRecon('order-paid','EXAMPLEUTR6789');
 assert.equal(a.calls.at(-1).payload.body.bank_statement_utr,'EXAMPLEUTR6789');
 assert.match(a.find('biteProviderAuditStatus').textContent,/STOP.*DIFFERS/);
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});
test('invalid bank UTR and non-admin attempts fail before provider fetch',async()=>{
 const a=setup();
 await a.audit.load();await a.audit.inspectSplit('order-paid');
 a.audit.compareVendor('order-paid','vendor_1');await a.audit.inspectVendor('order-paid');
 await a.audit.inspectVendorRecon('order-paid','unsafe characters!');
 assert.equal(a.calls.length,2);
 assert.match(a.find('biteProviderAuditStatus').textContent,/Invalid statement UTR/);
 const owner=setup({role:'owner',isAdmin:false});
 await owner.audit.load();await owner.audit.inspectVendorRecon('order-paid','');
 assert.equal(owner.calls.length,0);
});
test('vendor recon evidence clears on refresh and bank recheck',async()=>{
 const a=setup();
 await a.audit.load();await a.audit.inspectSplit('order-paid');
 a.audit.compareVendor('order-paid','vendor_1');await a.audit.inspectVendor('order-paid');
 await a.audit.inspectVendorRecon('order-paid','');
 assert.match(a.find('biteProviderAuditRows').children[0].children[4].textContent,/Cashfree reports vendor SETTLED/);
 await a.audit.inspectVendor('order-paid');
 assert.doesNotMatch(a.find('biteProviderAuditRows').children[0].children[4].textContent,/Cashfree reports vendor SETTLED/);
 await a.audit.load();
 assert.equal(a.find('biteProviderAuditRows').children[0].children[5].children.length,2);
});


test('read-only payment exceptions flag completed unpaid/missing and cancelled paid orders',()=>{
 const a=setup();
 const orders=[
  {id:'completed-missing',order_code:'BITE-MISSING',status:'Completed',is_demo:false,channel:'Own Platform'},
  {id:'completed-pending',order_code:'BITE-PENDING',status:'Completed',is_demo:false,channel:'Own Platform'},
  {id:'completed-unpaid',order_code:'BITE-UNPAID',status:'Completed',is_demo:false,channel:'Own Platform'},
  {id:'handover-pending',order_code:'BITE-HANDOVER',status:'Handed Over',is_demo:false,channel:'Own Platform'},
  {id:'cancelled-paid',order_code:'BITE-CANCELLED',status:'Cancelled',is_demo:false,channel:'Own Platform'},
  {id:'received-pending',order_code:'BITE-RECEIVED',status:'Received',is_demo:false,channel:'Own Platform'},
  {id:'completed-paid',order_code:'BITE-OK',status:'Completed',is_demo:false,channel:'Own Platform'},
  {id:'demo-unpaid',order_code:'BITE-DEMO',status:'Completed',is_demo:true,channel:'Own Platform'},
  {id:'pos-unpaid',order_code:'BITE-POS',status:'Completed',is_demo:false,channel:'POS - Counter'}
 ];
 const financials=[
  {order_id:'completed-pending',payment_status:'pending'},
  {order_id:'completed-unpaid',payment_status:'unpaid'},
  {order_id:'handover-pending',payment_status:'pending'},
  {order_id:'cancelled-paid',payment_status:'paid'},
  {order_id:'received-pending',payment_status:'pending'},
  {order_id:'completed-paid',payment_status:'paid'},
  {order_id:'demo-unpaid',payment_status:'unpaid'},
  {order_id:'pos-unpaid',payment_status:'unpaid'}
 ];
 const exceptions=a.audit.buildPaymentExceptions(orders,financials);
 assert.equal(exceptions.length,5);
 assert.deepEqual(Array.from(exceptions,x=>x.code),
  ['BITE-MISSING','BITE-PENDING','BITE-UNPAID','BITE-HANDOVER','BITE-CANCELLED']);
 assert.equal(exceptions[0].recordedPayment,'missing');
 assert.equal(exceptions[4].issue,'PAID_ORDER_CANCELLED_OR_REJECTED');
 assert.ok(!JSON.stringify(exceptions).includes('account_number'));
});
test('conflicting payments are rendered ONLY to Super Admin without initiating provider calls',async()=>{
 const a=setup();
 a.state.orders.push({id:'risk-pending',order_code:'BITE-RISK',status:'Completed',channel:'Own Platform',is_demo:false});
 a.state.financials.push({order_id:'risk-pending',restaurant_id:'restaurant-a',payment_status:'pending',channel:'Own Platform',is_demo:false});
 await a.audit.load();
 assert.equal(a.find('bitePaymentMismatchCount').textContent,'1');
 assert.equal(a.find('bitePaymentMismatchRows').children.length,1);
 const first=a.find('bitePaymentMismatchRows').children[0].children;
 assert.equal(first[0].textContent,'BITE-RISK');
 assert.match(first[1].textContent,/Completed but payment not recorded as paid/);
 assert.match(first[3].textContent,/independent reconciliation/);
 assert.equal(a.calls.length,0,'render does not call provider or mutate financial rows');
 a.audit.clear();
 assert.equal(a.find('bitePaymentMismatchRows').children.length,0);
 assert.equal(a.find('bitePaymentMismatchCount').textContent,'—');
});
test('restaurant Owner and signed-out users see no Super Admin payment mismatch records',async()=>{
 const a=setup({role:'owner',isAdmin:false});
 a.state.orders.push({id:'risk',order_code:'PRIVATE',status:'Completed',channel:'Own Platform',is_demo:false});
 await a.audit.load();
 assert.equal(a.find('bitePaymentMismatchRows').children.length,0);
 assert.equal(a.find('bitePaymentMismatchCount').textContent,'—');
 assert.equal(a.read.length,0);
});
test('Admin financial mismatch UI is non-mutating and explicitly warns paid status is unverified',()=>{
 assert.match(html,/id="bitePaymentMismatchRows"/);
 assert.match(html,/id="bitePaymentMismatchCount"/);
 assert.match(html,/admin-cashfree-audit\.js\?v=20261115-per-order-result1/);
 assert.match(html,/require independent Cashfree and bank reconciliation/i);
 assert.match(code,/function buildPaymentExceptions\(/);
 assert.doesNotMatch(code,/\.insert\(|\.update\(|\.upsert\(|execute_refund|create_transfer/);
});


const REFUND_ID='11111111-1111-4111-8111-111111111111';
test('pending refund queue is loaded only after Super Admin manually clicks load',async()=>{
 const a=setup({refunds:[{id:REFUND_ID,order_id:'order-paid',amount:1,status:'pending_approval'}]});
 await a.audit.load();
 assert.equal(a.read.filter(x=>x.name==='bite_refund_jobs').length,0);
 assert.equal(a.calls.length,0);
 await a.audit.loadRefundReview();
 assert.equal(a.read.filter(x=>x.name==='bite_refund_jobs').length,1);
 assert.equal(a.find('biteRefundReviewCount').textContent,'1');
 assert.equal(a.find('biteRefundReviewRows').children.length,1);
 assert.match(a.find('biteRefundReviewRows').children[0].children[3].textContent,/not checked/);
 assert.equal(a.calls.length,0,'loading the refund queue does not call Cashfree');
});

test('provider refund GET preview never creates or approves a refund',async()=>{
 const a=setup({refunds:[{id:REFUND_ID,order_id:'order-paid',amount:1,status:'pending_approval'}]});
 await a.audit.loadRefundReview();
 await a.audit.inspectRefund(REFUND_ID);
 assert.equal(a.calls.length,1);
 assert.equal(a.calls[0].name,'bite-cashfree-operations');
 assert.deepEqual(JSON.parse(JSON.stringify(a.calls[0].payload.body)),
  {action:'inspect_refund',refund_id:REFUND_ID});
 assert.match(a.find('biteRefundReviewRows').children[0].children[3].textContent,/No refund record found/);
 assert.match(a.find('biteRefundReviewStatus').textContent,/No refund was created/);
 assert.equal(a.find('biteRefundReviewRows').children[0].children[2].textContent,'pending_approval');
});

test('existing provider refund record gives STOP warning instead of a duplicate refund',async()=>{
 const a=setup({providerRefundFound:true,providerRefundStatus:'SUCCESS',
  refunds:[{id:REFUND_ID,order_id:'order-paid',amount:1,status:'pending_approval'}]});
 await a.audit.loadRefundReview();await a.audit.inspectRefund(REFUND_ID);
 assert.match(a.find('biteRefundReviewStatus').textContent,/Cashfree reports SUCCESS/);
 assert.match(a.find('biteRefundReviewStatus').textContent,/STOP/);
 assert.equal(a.calls.length,1);
});

test('account switch, owner role and sign out cannot expose saved refund evidence',async()=>{
 const a=setup({refunds:[{id:REFUND_ID,order_id:'order-paid',amount:1,status:'pending_approval'}]});
 await a.audit.loadRefundReview();
 a.setRole('owner');await a.audit.loadRefundReview();await a.audit.inspectRefund(REFUND_ID);
 assert.equal(a.calls.length,0);
 assert.equal(a.find('biteRefundReviewRows').children.length,0);
 a.setRole('super_admin');a.setUser(null);
 await a.audit.loadRefundReview();
 assert.equal(a.find('biteRefundReviewRows').children.length,0);
});

test('provider refund preview has no client-side mutation controls or sensitive fields',()=>{
 assert.match(html,/id="biteRefundReviewRows"/);
 assert.match(html,/id="biteRefundReviewLoad"/);
 assert.match(html,/admin-cashfree-audit\.js\?v=20261115-per-order-result1/);
 assert.match(code,/action:'inspect_refund'/);
 assert.doesNotMatch(code,/action:'execute_refund'|BITE_PROVIDER_REFUNDS_ENABLED|\.update\(|\.insert\(|\.upsert\(/);
 assert.doesNotMatch(html,/SUPABASE_SERVICE_ROLE_KEY|CASHFREE_SECRET_KEY/);
});

test('refund references outside dashboard pagination resolve their actual order codes by RLS lookup',async()=>{
 const orderId='262b6281-b0a0-46ff-8fea-7e81ba4336b8';
 const refundId='11111111-1111-4111-8111-111111111111';
 const a=setup({refunds:[{id:refundId,order_id:orderId,amount:1,status:'pending_approval'}],
  lookupOrders:[{id:orderId,order_code:'BITE-C80BB5EB3413'}]});
 await a.audit.loadRefundReview();
 const lookup=a.read.filter(x=>x.type==='in'&&x.table==='orders');
 assert.equal(lookup.length,1,'Only missing refund order codes are queried');
 assert.equal(lookup[0].column,'id');
 assert.deepEqual(Array.from(lookup[0].ids),[orderId]);
 assert.equal(a.find('biteRefundReviewRows').children[0].children[0].textContent,'BITE-C80BB5EB3413');
 assert.equal(a.calls.length,0,'RLS lookup never sends refund or payment request');
});

test('refund review fails to an abbreviated order reference if RLS cannot resolve order code',async()=>{
 const orderId='262b6281-b0a0-46ff-8fea-7e81ba4336b8';
 const a=setup({refunds:[{id:'11111111-1111-4111-8111-111111111111',
  order_id:orderId,amount:1,status:'pending_approval'}],lookupOrders:[]});
 await a.audit.loadRefundReview();
 const label=a.find('biteRefundReviewRows').children[0].children[0].textContent;
 assert.match(label,/Order …ba4336b8/);
 assert.ok(!label.includes(orderId),'Never expose raw order UUID when lookup misses');
 assert.equal(a.calls.length,0);
});
