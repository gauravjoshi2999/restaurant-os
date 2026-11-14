/* Bite Super Admin — collection/provider evidence/restaurant payout are distinct.
   All provider checks require a deliberate click; no transfers or refunds here. */
(function(root){
 'use strict';
 let deps=null,requestToken=0,loadedOrders=[],lastChecks=[],working=false,activeUser=null;
 const splitResults=new Map(),vendorComparisons=new Map(),vendorBankChecks=new Map();
 // Candidate matching is deliberately ephemeral. It is NOT an approved
 // restaurant/vendor mapping and must never authorize transfers or paid labels.
 function compareVendorCandidate(value,split){
  const id=typeof value==='string'?value.trim():'';
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(id))
   return {status:'INVALID_ID',message:'Enter a valid Cashfree Vendor ID (letters, numbers, _ or -).'};
  if(split?.status!=='PROVIDER_VENDOR_SPLIT_RECORDS'||!Array.isArray(split.vendors)||
     split.vendor_count!==split.vendors.length||split.vendors.length>50)
   return {status:'NO_TRUSTED_SPLIT',message:'First check the provider split for this exact order.'};
  const found=split.vendors.filter(v=>v&&v.vendor_id===id);
  if(found.length!==1)
   return {status:'NOT_IN_ORDER',message:'Vendor ID is not present in this order split. Do not link this restaurant.'};
  const amount=found[0].amount;
  if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0)
   return {status:'INVALID_SPLIT_AMOUNT',message:'Provider split amount is invalid.'};
  return {status:'FOUND_IN_ORDER_ONLY',vendorId:id,amount,
   message:'Vendor ID appears in this paid order split. Restaurant identity, KYC, bank mapping and UTR are NOT verified.'};
 }
 const byId=id=>document.getElementById(id);
 const authorized=()=>!!deps&&deps.getAccess()?.isPlatformAdmin===true&&deps.getAccess()?.role==='super_admin'&&!!deps.getUser()?.id;
 const customerAmount=f=>Number(f?.customer_payable_amount);
 const validAmount=(v)=>Number.isFinite(Number(v))&&Number(v)>=0;
 function classify(financial,check){
  const hasMatch=!!check&&check.collection_status==='PAID'&&validAmount(check.collection_amount)
   &&validAmount(customerAmount(financial))&&Math.abs(Number(check.collection_amount)-customerAmount(financial))<0.001;
  const settlement=check?.settlement_evidence;
  const providerSettlement=settlement?.settlement?.status||null;
  return {
   collection:hasMatch?'Provider checked: PAID':check?'Needs review: provider check mismatch':'Provider check needed',
   verifiedCollection:hasMatch,
   merchantSettlement:providerSettlement?'Provider report: '+String(providerSettlement).slice(0,35)+' (bank not confirmed)':'Bank settlement not confirmed',
   restaurantPayout:'Restaurant payout NOT verified',
   lastChecked:check?.checked_at||null
  };
 }
 const setStatus=(message,error=false)=>{
  const el=byId('biteProviderAuditStatus');
  if(el){el.textContent=message;el.style.color=error?'#b42318':'var(--muted)';}
 };
 const cell=(text)=>{
  const td=document.createElement('td');td.textContent=String(text??'');return td;
 };
 const money=n=>deps?.formatMoney?deps.formatMoney(n):'₹'+Number(n||0).toFixed(2);
 function wipe(){
  loadedOrders=[];lastChecks=[];splitResults.clear();vendorComparisons.clear();vendorBankChecks.clear();
  const body=byId('biteProviderAuditRows');if(body)body.replaceChildren();
  for(const id of ['biteProviderNeedCount','biteProviderCheckedCount','biteProviderPayoutCount']){
   const el=byId(id);if(el)el.textContent='—';
  }
 }
 function buildRows(financials,orders,checks){
  const byOrder=new Map((orders||[]).map(o=>[o.id,o]));
  const latest=new Map();
  for(const check of checks||[])if(check?.order_id&&!latest.has(check.order_id))latest.set(check.order_id,check);
  return (financials||[]).filter(f=>{
    const order=byOrder.get(f.order_id);
    return f.channel==='Own Platform'&&f.payment_status==='paid'&&!f.is_demo&&order&&
      !order.is_demo&&!order.isDemo&&order.channel==='Own Platform';
  }).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
   .slice(0,100).map(f=>{
     const order=byOrder.get(f.order_id),check=latest.get(f.order_id)||null;
     return {orderId:f.order_id,restaurantId:f.restaurant_id,orderCode:order.order_code||order.code||String(order.id).slice(0,8),
      restaurantName:deps?.getState()?.restaurants?.find(r=>r.id===f.restaurant_id)?.name||'Restaurant',
      amount:customerAmount(f),check,verdict:classify(f,check)};
   });
 }
 function render(){
  if(!authorized()){wipe();return;}
  const body=byId('biteProviderAuditRows');if(!body)return;
  body.replaceChildren();
  const needs=loadedOrders.filter(o=>!o.verdict.verifiedCollection).length;
  byId('biteProviderNeedCount').textContent=String(needs);
  byId('biteProviderCheckedCount').textContent=String(loadedOrders.length-needs);
  // Never equate a provider settlement response with a verified vendor bank payout.
  byId('biteProviderPayoutCount').textContent='Not independently verified';
  for(const row of loadedOrders){
   const tr=document.createElement('tr');
   const split=splitResults.get(row.orderId);
   let payoutNote=row.verdict.restaurantPayout;
   if(split){
    const names=split.vendors.map(v=>v.vendor_id.slice(0,35)+' · '+money(v.amount)).join(', ');
    payoutNote+=' · '+(split.status==='NOT_FOUND'?'No Easy Split record found':
     split.status==='NO_VENDOR_SPLIT_RECORDS'?'No vendor entries in provider response':
     'Provider split records: '+split.vendor_count+' ['+names+']');
    payoutNote+=' · Vendor mapping/bank UTR still unverified';
    const comparison=vendorComparisons.get(row.orderId);
    if(comparison&&comparison.restaurantId===row.restaurantId){
     payoutNote+=' · '+comparison.verdict.message;
     const bank=vendorBankChecks.get(row.orderId);
     if(bank&&bank.restaurantId===row.restaurantId&&bank.vendorId===comparison.vendorId)
      payoutNote+=' · '+bank.message;
    }
   }
   tr.append(cell(row.orderCode+' · '+row.restaurantName),cell(validAmount(row.amount)?money(row.amount):'Unverified amount'),
    cell(row.verdict.collection),cell(row.verdict.merchantSettlement),cell(payoutNote));
   const action=cell('');
   const btn=document.createElement('button');
   btn.type='button';btn.className='btn secondary';btn.dataset.biteReconcileOrder=row.orderId;
   btn.textContent='Verify with Cashfree';btn.disabled=working;
   btn.setAttribute('aria-label','Verify Cashfree collection for order '+row.orderCode+' without a bank transfer');
   const splitBtn=document.createElement('button');
   splitBtn.type='button';splitBtn.className='btn secondary';splitBtn.dataset.biteInspectSplit=row.orderId;
   splitBtn.textContent='Check vendor split';splitBtn.disabled=working;
   splitBtn.setAttribute('aria-label','Read Cashfree vendor split for order '+row.orderCode+' without initiating a transfer');
   action.append(btn,splitBtn);
   if(split?.status==='PROVIDER_VENDOR_SPLIT_RECORDS'){
    const label=document.createElement('label');
    label.textContent='Cashfree vendor ID (candidate only)';
    const input=document.createElement('input');
    input.type='text';input.maxLength=80;input.autocomplete='off';
    input.dataset.biteVendorCandidate=row.orderId;
    input.placeholder='Vendor ID from Cashfree';
    input.setAttribute('aria-label','Candidate Cashfree Vendor ID for '+row.orderCode);
    input.value=vendorComparisons.get(row.orderId)?.vendorId||'';
    label.append(input);
    const compareBtn=document.createElement('button');
    compareBtn.type='button';compareBtn.className='btn secondary';
    compareBtn.dataset.biteCompareVendor=row.orderId;
    compareBtn.textContent='Compare vendor ID';compareBtn.disabled=working;
    compareBtn.setAttribute('aria-label','Compare candidate vendor to Cashfree split without saving a mapping');
    action.append(label,compareBtn);
    const comparison=vendorComparisons.get(row.orderId);
    if(comparison?.restaurantId===row.restaurantId&&comparison.verdict.status==='FOUND_IN_ORDER_ONLY'){
     const bankBtn=document.createElement('button');
     bankBtn.type='button';bankBtn.className='btn secondary';
     bankBtn.dataset.biteInspectVendor=row.orderId;
     bankBtn.textContent='Check Cashfree bank match';bankBtn.disabled=working;
     bankBtn.setAttribute('aria-label','Compare provider vendor bank with this restaurant saved payout profile without a transfer');
     action.append(bankBtn);
    }
   }
   tr.append(action);body.append(tr);
  }
  byId('biteProviderAuditEmpty').hidden=loadedOrders.length>0;
 }
 async function load(){
  if(!authorized()){requestToken++;wipe();return;}
  const token=++requestToken,userId=deps.getUser().id;
  if(activeUser&&activeUser!==userId)wipe();
  // Refresh revokes any temporary vendor candidate evidence.
  splitResults.clear();vendorComparisons.clear();vendorBankChecks.clear();
  activeUser=userId;setStatus('Loading recorded provider checks…');
  try{
   // Direct client access uses the existing admin/owner SELECT RLS on bite_provider_checks.
   // Payment intents are customer-only by RLS; do not broaden their policies here.
   const {data,error}=await deps.sb.from('bite_provider_checks')
    .select('order_id,collection_status,collection_amount,settlement_evidence,checked_at')
    .order('checked_at',{ascending:false}).limit(500);
   if(error)throw error;
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   lastChecks=data||[];
   const state=deps.getState();loadedOrders=buildRows(state.financials||[],state.orders||[],lastChecks);
   render();
   setStatus(loadedOrders.length?'Collection checks are audit evidence, not bank payout confirmations. Orders shown: '+loadedOrders.length:'No eligible non-demo paid own-platform orders in the current view.');
  }catch(error){
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   wipe();setStatus('Unable to read provider-check records. No payment was started. '+String(error?.message||'Please retry').slice(0,140),true);
  }
 }
 async function reconcile(orderId){
  if(!authorized()||working)return;
  const selected=loadedOrders.find(row=>row.orderId===orderId);
  if(!selected)return;
  const userId=deps.getUser().id,token=requestToken;
  working=true;render();
  setStatus('Checking Cashfree collection and settlement evidence. No refund, transfer or new payment is being made.');
  try{
   const {data,error}=await deps.sb.functions.invoke('bite-cashfree-operations',{body:{action:'reconcile',order_id:orderId}});
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   if(error)throw error;
   if(!data?.collection?.status)throw Error('Provider did not return collection status');
   const status=data.collection.status;
   setStatus('Cashfree reports '+String(status).slice(0,24)+'. Restaurant payout remains unverified until separate vendor settlement evidence is checked.');
  }catch(error){
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   setStatus('Provider check unavailable or mismatched. Do not mark this order settled. '+String(error?.message||'Try again later').slice(0,150),true);
  }finally{
   working=false;
   if(token===requestToken&&authorized()&&deps.getUser()?.id===userId){
    // A fresh RLS read shows only checks actually saved by the server.
    await load();
   }
  }
 }
 async function inspectSplit(orderId){
  if(!authorized()||working)return;
  const selected=loadedOrders.find(row=>row.orderId===orderId);
  if(!selected)return;
  const userId=deps.getUser().id,token=requestToken;
  splitResults.delete(orderId);vendorComparisons.delete(orderId);vendorBankChecks.delete(orderId);
  working=true;render();
  setStatus('Reading Cashfree Easy Split order record. This does not create a vendor, split, refund or transfer.');
  try{
   const {data,error}=await deps.sb.functions.invoke('bite-cashfree-operations',{body:{action:'inspect_split',order_id:orderId}});
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   if(error)throw error;
   const split=data?.split;
   if(!split||!['NOT_FOUND','NO_VENDOR_SPLIT_RECORDS','PROVIDER_VENDOR_SPLIT_RECORDS'].includes(split.status)||
      !Number.isInteger(split.vendor_count)||!Array.isArray(split.vendors))
    throw Error('Provider split response cannot be trusted');
   splitResults.set(orderId,split);
   setStatus(split.status==='NOT_FOUND'?'Cashfree found no Easy Split record for this order. Restaurant bank payout is NOT verified.':
    'Provider reports '+split.vendor_count+' vendor split rows. Restaurant vendor mapping and bank payout remain NOT verified.');
  }catch(error){
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   setStatus('Vendor split lookup unavailable or inconsistent. Do not mark restaurant paid. '+String(error?.message||'Check Cashfree account approval').slice(0,140),true);
  }finally{
   working=false;
   if(token===requestToken&&authorized()&&deps.getUser()?.id===userId)render();
  }
 }
 function compareVendor(orderId,candidate){
  if(!authorized()||working)return;
  const row=loadedOrders.find(r=>r.orderId===orderId);
  if(!row)return;
  const verdict=compareVendorCandidate(candidate,splitResults.get(orderId));
  vendorBankChecks.delete(orderId);
  vendorComparisons.set(orderId,{restaurantId:row.restaurantId,
   vendorId:typeof candidate==='string'?candidate.trim().slice(0,80):'',verdict});
  render();
  setStatus(verdict.message,verdict.status!=='FOUND_IN_ORDER_ONLY');
  return verdict;
 }
 async function inspectVendor(orderId){
  if(!authorized()||working)return;
  const row=loadedOrders.find(r=>r.orderId===orderId);
  const choice=vendorComparisons.get(orderId);
  if(!row||!choice||choice.restaurantId!==row.restaurantId||
     choice.verdict.status!=='FOUND_IN_ORDER_ONLY'||choice.verdict.vendorId!==choice.vendorId)return;
  const userId=deps.getUser().id,token=requestToken;
  vendorBankChecks.delete(orderId);
  working=true;render();
  setStatus('Comparing Cashfree vendor bank with this restaurant payout settings. No transfer is being made.');
  try{
   const {data,error}=await deps.sb.functions.invoke('bite-cashfree-operations',{
    body:{action:'inspect_vendor',order_id:orderId,vendor_id:choice.vendorId}});
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   if(error)throw error;
   const result=data?.provider_vendor;
   if(!result||result.vendor_id!==choice.vendorId||
      !['MATCH','MISMATCH','NOT_COMPARABLE'].includes(result.bank_details_comparison)||
      typeof result.provider_vendor_status!=='string'||
      !/^[A-Z][A-Z0-9_]{0,39}$/.test(result.provider_vendor_status)||
      data.restaurant_payout!=='NOT_VERIFIED'||data.bank_credit!=='NOT_VERIFIED')
    throw Error('Untrusted provider comparison result');
   const message=result.bank_details_comparison==='MATCH'?
    'Cashfree vendor bank settings MATCH this restaurant saved payout profile. KYC, approval, UTR and bank credit remain NOT verified.':
    result.bank_details_comparison==='MISMATCH'?
    'Cashfree vendor bank settings DO NOT MATCH this restaurant payout profile. STOP: do not map or pay.':
    'Bank settings could not be compared. Check Cashfree vendor status and restaurant bank profile before proceeding.';
   vendorBankChecks.set(orderId,{restaurantId:row.restaurantId,vendorId:choice.vendorId,
    message,bankMatch:result.bank_details_comparison});
   setStatus(message,result.bank_details_comparison!=='MATCH');
  }catch(error){
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   setStatus('Bank comparison unavailable. Restaurant payout is NOT verified. '+
    String(error?.message||'Try again later').slice(0,110),true);
  }finally{
   working=false;
   if(token===requestToken&&authorized()&&deps.getUser()?.id===userId)render();
  }
 }
 function init(config){
  deps=config;
  if(byId('biteProviderAuditRefresh')?.dataset.auditWired==='1')return;
  const button=byId('biteProviderAuditRefresh');
  if(!button)return;
  button.dataset.auditWired='1';
  button.addEventListener('click',()=>{void load();});
  byId('biteProviderAuditRows')?.addEventListener('click',event=>{
   const item=event.target.closest('[data-bite-reconcile-order]');
   if(item)void reconcile(item.dataset.biteReconcileOrder);
   const split=event.target.closest('[data-bite-inspect-split]');
   if(split)void inspectSplit(split.dataset.biteInspectSplit);
   const compare=event.target.closest('[data-bite-compare-vendor]');
   if(compare){
    const input=byId('biteProviderAuditRows')?.querySelector(
     'input[data-bite-vendor-candidate="'+compare.dataset.biteCompareVendor+'"]');
    compareVendor(compare.dataset.biteCompareVendor,input?.value||'');
   }
   const vendor=event.target.closest('[data-bite-inspect-vendor]');
   if(vendor)void inspectVendor(vendor.dataset.biteInspectVendor);
  });
 }
 function clear(){requestToken++;activeUser=null;working=false;wipe();setStatus('Super Admin login required.');}
 root.BiteCashfreeAudit={init,load,reconcile,inspectSplit,compareVendor,inspectVendor,compareVendorCandidate,clear,classify,buildRows};
})(window);
