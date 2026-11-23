/* Bite Super Admin — collection/provider evidence/restaurant payout are distinct.
   All provider checks require a deliberate click; no transfers or refunds here. */
(function(root){
 'use strict';
 let deps=null,requestToken=0,loadedOrders=[],lastChecks=[],working=false,activeUser=null;
 let refundLoadToken=0,refundBusy=false,refundRows=[],refundReviewSeen=false,refundWatchTimer=null;
 let autoPolicyRequest=0;
 const refundEvidence=new Map();
 const splitResults=new Map(),vendorComparisons=new Map(),vendorBankChecks=new Map(),vendorReconResults=new Map();
 // Temporary only: a manual check's outcome, scoped to the same Super Admin
 // and order. Never treat this as proof of a restaurant bank payout.
 const collectionAttempts=new Map();
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
 // Read-only discrepancies in the INTERNAL order/financial ledger.
 // They do not establish provider collection, chargeback, refund or bank payout.
 function buildPaymentExceptions(orders,financials){
  const last=new Map();
  for(const f of financials||[]){
   if(!f?.order_id)continue;
   const previous=last.get(f.order_id);
   if(!previous||String(f.created_at||'')>=String(previous.created_at||''))last.set(f.order_id,f);
  }
  const out=[];
  for(const order of orders||[]){
   if(!order||order.is_demo===true||order.isDemo===true||
      String(order.channel||'').toLowerCase()!=='own platform')continue;
   const financial=last.get(order.id);
   const payment=String(financial?.payment_status||'missing').toLowerCase();
   const status=String(order.status||'');
   let issue='';
   if(status==='Completed'&&payment!=='paid')issue='COMPLETED_WITHOUT_RECORDED_PAYMENT';
   else if(status==='Handed Over'&&payment!=='paid')issue='HANDED_OVER_WITHOUT_RECORDED_PAYMENT';
   else if((status==='Cancelled'||status==='Rejected')&&payment==='paid')issue='PAID_ORDER_CANCELLED_OR_REJECTED';
   if(!issue)continue;
   out.push({
    orderId:order.id,restaurantId:order.restaurant_id,
    code:String(order.order_code||order.code||order.id||'Order').slice(0,45),
    issue,recordedPayment:payment
   });
  }
  return out.slice(0,100);
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
  refundLoadToken++;refundBusy=false;refundRows=[];refundEvidence.clear();
  byId('biteRefundReviewRows')?.replaceChildren();
  const refundCount=byId('biteRefundReviewCount');if(refundCount)refundCount.textContent='—';
  const refundStatus=byId('biteRefundReviewStatus');if(refundStatus)refundStatus.textContent='Sign in as Super Admin to review refund requests.';
  autoPolicyRequest++;
  const autoStatus=byId('biteRefundAutoStatus');if(autoStatus)autoStatus.textContent='Sign in as Super Admin to check refund automation.';
  loadedOrders=[];lastChecks=[];collectionAttempts.clear();splitResults.clear();vendorComparisons.clear();vendorBankChecks.clear();vendorReconResults.clear();
  const body=byId('biteProviderAuditRows');if(body)body.replaceChildren();
  byId('bitePaymentMismatchRows')?.replaceChildren();
  const mismatch=byId('bitePaymentMismatchCount');if(mismatch)mismatch.textContent='—';
  const empty=byId('bitePaymentMismatchEmpty');if(empty)empty.textContent='Sign in as Super Admin to review recorded order/payment mismatches.';
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
     return {orderId:f.order_id,restaurantId:f.restaurant_id,orderStatus:order.status,
      orderCode:order.order_code||order.code||String(order.id).slice(0,8),
      restaurantName:deps?.getState()?.restaurants?.find(r=>r.id===f.restaurant_id)?.name||'Restaurant',
      amount:customerAmount(f),check,verdict:classify(f,check)};
   });
 }
 function renderRefundReview(){
  if(!authorized()){wipe();return;}
  const body=byId('biteRefundReviewRows'),count=byId('biteRefundReviewCount');
  if(count)count.textContent=String(refundRows.length);
  if(!body)return;
  body.replaceChildren();
  for(const row of refundRows){
   const result=refundEvidence.get(row.id);
   const tr=document.createElement('tr');
   const action=cell('');
   const btn=document.createElement('button');
   btn.type='button';btn.className='btn secondary';
   btn.textContent='Check Cashfree refund (read-only)';
   btn.disabled=refundBusy;
   btn.dataset.biteInspectRefund=row.id;
   btn.setAttribute('aria-label','Read Cashfree refund status for '+row.code+' without issuing a refund');
   const preflight=document.createElement('button');
   preflight.type='button';preflight.className='btn secondary';
   preflight.textContent='Check automatic refund readiness';
   preflight.disabled=refundBusy;
   preflight.dataset.biteAutoRefundPreflight=row.id;
   preflight.setAttribute('aria-label','Check Cashfree payment and competing refunds for '+row.code+' without sending money');
   action.append(btn);
   if(!['succeeded','failed','rejected'].includes(row.status))action.append(preflight);
   const route=row.autoEligible?'Trusted auto rule recorded':'Manual review required (not auto-authorized)';
   const providerConfirmed=!!row.providerCheckedAt&&row.providerStatus==='SUCCESS';
   const providerLabel=providerConfirmed?'Cashfree reports refund processed; bank credit not independently confirmed':
    row.providerCheckedAt?'Cashfree check: '+String(row.providerStatus||'UNKNOWN').slice(0,24):
    'Provider status not independently verified';
   tr.append(cell(row.code),cell(money(row.amount)),
    cell(row.status),
    cell((result?.message||providerLabel)+' · '+route),action);
   body.append(tr);
  }
 }
 async function loadRefundReview(){
  if(!authorized()){wipe();return;}
  if(refundBusy)return;
  const userId=deps.getUser().id;
  if(activeUser&&activeUser!==userId)wipe();
  const token=++refundLoadToken;
  activeUser=userId;refundEvidence.clear();refundBusy=true;
  const status=byId('biteRefundReviewStatus');
  if(status)status.textContent='Loading pending and approved refunds from your admin RLS view…';
  try{
   const {data,error}=await deps.sb.from('bite_refund_jobs')
    .select('id,order_id,amount,status,provider_status,provider_checked_at,created_at,auto_authorized_at,auto_rule')
    .in('status',['pending_approval','approved','processing','submitted','succeeded','failed','rejected'])
    .order('created_at',{ascending:false}).limit(50);
   if(token!==refundLoadToken||!authorized()||deps.getUser()?.id!==userId)return;
   if(error)throw error;
   const orders=new Map((deps.getState()?.orders||[]).map(o=>[o.id,o]));
   const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
   const eligible=(data||[]).filter(r=>uuid.test(r?.id)&&
    ['pending_approval','approved','processing','submitted','succeeded','failed','rejected'].includes(r.status)&&
    Number.isFinite(Number(r.amount))&&Number(r.amount)>0);
   // A refund can reference an order absent from the paginated dashboard state.
   // Look up only its code through the authenticated Super Admin RLS view.
   // Do not expose a raw UUID or private order/customer fields in the UI.
   const missing=[...new Set(eligible.map(r=>r.order_id).filter(id=>
    uuid.test(id)&&!orders.get(id)?.order_code))].slice(0,50);
   if(missing.length){
    const found=await deps.sb.from('orders').select('id,order_code')
     .in('id',missing).limit(50);
    if(token!==refundLoadToken||!authorized()||deps.getUser()?.id!==userId)return;
    if(!found.error)for(const order of found.data||[]){
     if(uuid.test(order?.id)&&typeof order.order_code==='string'&&
        /^[A-Za-z0-9_-]{3,45}$/.test(order.order_code))
      orders.set(order.id,order);
    }
   }
   refundRows=eligible.map(r=>({
    id:r.id,orderId:r.order_id,amount:Number(r.amount),status:r.status,
    providerStatus:String(r.provider_status||'').toUpperCase(),providerCheckedAt:r.provider_checked_at,
    autoEligible:!!r.auto_authorized_at&&
      ['CUSTOMER_BEFORE_ACCEPTANCE','RESTAURANT_REJECTED','OWNER_ACCEPTED_CANCELLATION'].includes(r.auto_rule),
    code:String(orders.get(r.order_id)?.order_code||
      ('Order …'+String(r.order_id||'unknown').slice(-8))).slice(0,45)
   }));
   refundReviewSeen=true;
   if(status)status.textContent=refundRows.length+
    ' recent refund record(s), including completed outcomes. Provider checks are read-only; no refund was initiated.';
  }catch(error){
   if(token!==refundLoadToken||!authorized()||deps.getUser()?.id!==userId)return;
   refundRows=[];if(status)status.textContent='Refund review could not be loaded. No refund started.';
  }finally{
   if(token===refundLoadToken){refundBusy=false;if(authorized()&&deps.getUser()?.id===userId)renderRefundReview();}
  }
 }
 async function inspectRefund(refundId){
  if(!authorized()||refundBusy)return;
  const selected=refundRows.find(r=>r.id===refundId);
  if(!selected)return;
  const token=refundLoadToken,userId=deps.getUser().id;
  refundBusy=true;refundEvidence.delete(refundId);renderRefundReview();
  const status=byId('biteRefundReviewStatus');
  if(status)status.textContent='Reading existing Cashfree refund record. No refund will be initiated.';
  try{
   const {data,error}=await deps.sb.functions.invoke('bite-cashfree-operations',{
    body:{action:'inspect_refund',refund_id:refundId}});
   if(token!==refundLoadToken||!authorized()||deps.getUser()?.id!==userId)return;
   if(error)throw error;
   if(!['PROVIDER_REFUND_RECORD_FOUND','NO_PROVIDER_REFUND_RECORD'].includes(data?.status)||
      data.no_action_taken!==true||data.recorded_refund_status!==selected.status||
      !validAmount(data.amount)||Math.abs(Number(data.amount)-selected.amount)>0.001)
    throw Error('Provider refund evidence mismatch');
   const result=data.status==='PROVIDER_REFUND_RECORD_FOUND'?
    'Cashfree reports '+String(data.provider_refund_status||'UNKNOWN').slice(0,40)+
    '. STOP: check this existing provider record before considering another refund.':
    'No refund record found for this reference in Cashfree. Bite status is '+selected.status+
    '. This read-only check did not send a refund. Independently reconcile before any refund execution.';
   refundEvidence.set(refundId,{message:result});
   if(status)status.textContent=result;
  }catch(error){
   if(token!==refundLoadToken||!authorized()||deps.getUser()?.id!==userId)return;
   if(status)status.textContent='Refund provider status unavailable or mismatched. Do not issue another refund.';
  }finally{
   if(token===refundLoadToken){refundBusy=false;if(authorized()&&deps.getUser()?.id===userId)renderRefundReview();}
  }
 }

 // This policy check only reads RLS-protected configuration. It cannot turn
 // on refunds, issue payment requests, or mark an existing job successful.
 async function loadAutoRefundPolicy(){
  if(!authorized()){wipe();return;}
  const userId=deps.getUser().id,request=++autoPolicyRequest;
  const status=byId('biteRefundAutoStatus');
  if(status)status.textContent='Checking production refund automation policy…';
  try{
   const {data,error}=await deps.sb.from('bite_operations_config')
    .select('auto_refunds_enabled,auto_refund_max_amount').eq('id',true).maybeSingle();
   if(request!==autoPolicyRequest||!authorized()||deps.getUser()?.id!==userId)return;
   if(error||!data||typeof data.auto_refunds_enabled!=='boolean'||
      !Number.isFinite(Number(data.auto_refund_max_amount)))throw Error('Unavailable policy');
   const limit=Number(data.auto_refund_max_amount);
   if(status)status.textContent=data.auto_refunds_enabled?
    'AUTO REFUNDS ON · Maximum '+money(limit)+
    ' · Only newly trusted eligible cancellations qualify. Historical jobs still need manual review.':
    'AUTO REFUNDS OFF · Configured limit '+money(limit)+
    ' · Customer refunds will NOT be issued automatically. Historical jobs require manual review.';
  }catch{
   if(request!==autoPolicyRequest||!authorized()||deps.getUser()?.id!==userId)return;
   if(status)status.textContent='Automation status unavailable. Do not assume that automatic refunds are enabled.';
  }
 }
 async function preflightRefundJob(refundId){
  if(!authorized()||refundBusy)return;
  const selected=refundRows.find(r=>r.id===refundId);
  if(!selected)return;
  const token=refundLoadToken,userId=deps.getUser().id;
  refundBusy=true;refundEvidence.delete(refundId);renderRefundReview();
  const status=byId('biteRefundReviewStatus');
  if(status)status.textContent='Checking original Cashfree payment and full refund history. Read-only; no money action.';
  try{
   // Server verifies the refund job, original paid order and competing refunds.
   const signal=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?
    AbortSignal.timeout(30000):undefined;
   const {data,error}=await deps.sb.functions.invoke('bite-auto-refund',{
    body:{action:'preflight',order_id:selected.orderId},...(signal?{signal}:{})});
   if(token!==refundLoadToken||!authorized()||deps.getUser()?.id!==userId)return;
   if(error||data?.status!=='preflight'||data.refund_sent!==false||
      data.refund_created===true)throw Error('Invalid safe preflight response');
   const reasons={
    PAID_MATCHES_NO_REFUND:'Cashfree PAID and amount match; no provider refund found.',
    EXISTING_REFUND_RECORD:'STOP: Cashfree has existing refund record(s). Never resend.',
    CASHFREE_PAYMENT_MISMATCH:'STOP: Original payment does not match Cashfree.',
    INTERNAL_MISMATCH_OR_INELIGIBLE:'STOP: Bite order or financial record is ineligible.',
    PROVIDER_LOOKUP_UNAVAILABLE:'Cashfree payment lookup unavailable; do not retry a refund.',
    REFUND_LOOKUP_UNAVAILABLE:'Cashfree refund history unavailable; do not issue a refund.',
    REFUND_EVIDENCE_MISMATCH:'STOP: Existing provider refund differs from the Bite record.'
   };
   const kind=typeof data.result==='string'&&Object.prototype.hasOwnProperty.call(reasons,data.result)?
    data.result:'UNKNOWN';
   const route=selected.autoEligible?'Trusted auto-authorization exists':
    'This historical/manual request is NOT authorized for automatic execution';
   const message=(reasons[kind]||'Unknown verification result; manual investigation required.')+
    ' '+route+'. Automation '+(data.live_refunds_enabled===true?'ON':'OFF or unavailable')+
    '. This check did not send a refund.';
   refundEvidence.set(refundId,{message});if(status)status.textContent=message;
  }catch{
   if(token!==refundLoadToken||!authorized()||deps.getUser()?.id!==userId)return;
   const message='Read-only automatic refund safety check failed. No refund was sent; investigate in Cashfree.';
   refundEvidence.set(refundId,{message});if(status)status.textContent=message;
  }finally{
   if(token===refundLoadToken){refundBusy=false;if(authorized()&&deps.getUser()?.id===userId)renderRefundReview();}
  }
 }
 function renderPaymentExceptions(){
  if(!authorized())return;
  const result=buildPaymentExceptions(deps.getState()?.orders||[],deps.getState()?.financials||[]);
  const count=byId('bitePaymentMismatchCount'),body=byId('bitePaymentMismatchRows');
  if(count)count.textContent=String(result.length)+(result.length>=100?'+':'');
  if(body){
   body.replaceChildren();
   for(const row of result){
    const tr=document.createElement('tr');
    const issue={
     COMPLETED_WITHOUT_RECORDED_PAYMENT:'Completed but payment not recorded as paid',
     HANDED_OVER_WITHOUT_RECORDED_PAYMENT:'Handover but payment not recorded as paid',
     PAID_ORDER_CANCELLED_OR_REJECTED:'Cancelled/rejected while payment recorded paid'
    }[row.issue]||'Manual review required';
    tr.append(cell(row.code),cell(issue),cell(row.recordedPayment),cell('Needs independent reconciliation'));
    body.append(tr);
   }
  }
  const empty=byId('bitePaymentMismatchEmpty');
  if(empty)empty.textContent=result.length?'Read-only review queue. Do not settle, refund or modify orders from this screen.':
   'No order/payment state conflicts found in the currently loaded Super Admin records.';
 }
 function render(){
  if(!authorized()){wipe();return;}
  const body=byId('biteProviderAuditRows');if(!body)return;
  renderPaymentExceptions();
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
     if(bank&&bank.restaurantId===row.restaurantId&&bank.vendorId===comparison.vendorId){
      payoutNote+=' · '+bank.message;
      const recon=vendorReconResults.get(row.orderId);
      if(recon&&recon.restaurantId===row.restaurantId&&recon.vendorId===comparison.vendorId)
       payoutNote+=' · '+recon.message;
     }
    }
   }
   const collectionCell=cell(row.verdict.collection);
   const attempt=collectionAttempts.get(row.orderId);
   if(attempt&&attempt.restaurantId===row.restaurantId){
    const note=document.createElement('div');
    note.className='bite-audit-check-result'+(attempt.error?' is-error':attempt.pending?' is-pending':'');
    note.setAttribute('role','status');
    note.textContent='Last manual check (this session): '+attempt.message;
    collectionCell.append(note);
   }
   const auditCells=[
    cell(row.orderCode+' · '+row.restaurantName),
    cell(validAmount(row.amount)?money(row.amount):'Unverified amount'),
    collectionCell,cell(row.verdict.merchantSettlement),cell(payoutNote)
   ];
   const labels=['Order / restaurant','Customer paid (recorded)','Cashfree collection',
    'Merchant bank settlement','Restaurant payout'];
   auditCells.forEach((td,index)=>{td.dataset.label=labels[index];});
   tr.append(...auditCells);
   const action=cell('');
   action.dataset.label='Safe actions';
   const btn=document.createElement('button');
   btn.type='button';btn.className='btn secondary';btn.dataset.biteReconcileOrder=row.orderId;
   btn.textContent='Verify with Cashfree';btn.disabled=working;
   btn.setAttribute('aria-label','Verify Cashfree collection for order '+row.orderCode+' without a bank transfer');
   const splitBtn=document.createElement('button');
   splitBtn.type='button';splitBtn.className='btn secondary';splitBtn.dataset.biteInspectSplit=row.orderId;
   splitBtn.textContent='Check vendor split';splitBtn.disabled=working;
   splitBtn.setAttribute('aria-label','Read Cashfree vendor split for order '+row.orderCode+' without initiating a transfer');
   action.append(btn,splitBtn);
   if(['Cancelled','Rejected'].includes(row.orderStatus)){
    const preflightBtn=document.createElement('button');
    preflightBtn.type='button';preflightBtn.className='btn secondary';
    preflightBtn.textContent='Read-only refund preflight';
    preflightBtn.disabled=working;preflightBtn.dataset.biteRefundPreflightOrder=row.orderId;
    preflightBtn.setAttribute('aria-label','Read-only Cashfree refund preflight for '+row.orderCode+' without creating a refund');
    action.append(preflightBtn);
   }
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
     const bank=vendorBankChecks.get(row.orderId);
     if(bank?.restaurantId===row.restaurantId&&bank.vendorId===comparison.vendorId&&bank.bankMatch==='MATCH'){
      const statementLabel=document.createElement('label');
      statementLabel.textContent='Bank statement UTR (optional; never stored)';
      const statementInput=document.createElement('input');
      statementInput.type='text';statementInput.autocomplete='off';statementInput.maxLength=48;
      statementInput.placeholder='UTR from restaurant bank';
      statementInput.dataset.biteStatementUtr=row.orderId;
      statementInput.setAttribute('aria-label','Optional bank statement UTR for '+row.orderCode);
      statementLabel.append(statementInput);
      const reconBtn=document.createElement('button');
      reconBtn.type='button';reconBtn.className='btn secondary';reconBtn.disabled=working;
      reconBtn.dataset.biteInspectRecon=row.orderId;
      reconBtn.textContent='Check vendor settlement';
      reconBtn.setAttribute('aria-label','Read Cashfree vendor settlement and optionally compare entered bank statement UTR without a transfer');
      action.append(statementLabel,reconBtn);
     }
    }
   }
   if(attempt&&attempt.restaurantId===row.restaurantId){
    // The mobile card shows the latest result immediately below the pressed
    // action; desktop keeps the original evidence in the collection column.
    const actionResult=document.createElement('div');
    actionResult.className='bite-audit-check-result bite-audit-result-action'+
     (attempt.error?' is-error':attempt.pending?' is-pending':'');
    actionResult.setAttribute('role','status');
    actionResult.textContent='Last manual check (this session): '+attempt.message;
    action.append(actionResult);
   }
   tr.append(action);body.append(tr);
  }
  byId('biteProviderAuditEmpty').hidden=loadedOrders.length>0;
 }
 async function load(keepPending=false){
  if(!authorized()){requestToken++;wipe();return false;}
  // A manual page refresh cancels an in-flight display attempt.
  if(!keepPending)for(const [id,attempt] of collectionAttempts)
   if(attempt.pending)collectionAttempts.delete(id);
  const token=++requestToken,userId=deps.getUser().id;
  if(activeUser&&activeUser!==userId)wipe();
  // Refresh revokes any temporary vendor candidate evidence.
  splitResults.clear();vendorComparisons.clear();vendorBankChecks.clear();vendorReconResults.clear();
  activeUser=userId;setStatus('Loading recorded provider checks…');
  try{
   // Direct client access uses the existing admin/owner SELECT RLS on bite_provider_checks.
   // Payment intents are customer-only by RLS; do not broaden their policies here.
   const {data,error}=await deps.sb.from('bite_provider_checks')
    .select('order_id,collection_status,collection_amount,settlement_evidence,checked_at')
    .order('checked_at',{ascending:false}).limit(500);
   if(error)throw error;
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return false;
   lastChecks=data||[];
   const state=deps.getState();loadedOrders=buildRows(state.financials||[],state.orders||[],lastChecks);
   render();
   setStatus(loadedOrders.length?'Collection checks are audit evidence, not bank payout confirmations. Orders shown: '+loadedOrders.length:'No eligible non-demo paid own-platform orders in the current view.');
   return true;
  }catch(error){
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return false;
   wipe();setStatus('Unable to read provider-check records. No payment was started. '+String(error?.message||'Please retry').slice(0,140),true);
   return false;
  }
 }
 async function safeProviderErrorDetail(error){
  const response=error?.context;
  const status=Number(response?.status);
  if(![400,401,403,404,409,503].includes(status)||typeof response?.json!=='function')return null;
  try{
   const payload=await response.json();
   // Only server-authored, pre-approved error reasons can enter the UI.
   // Never print raw provider payloads, headers, bank fields or auth details.
   const messages={
    'Trusted payment reference missing':'The Bite checkout is missing a trusted payment reference.',
    'Provider collection lookup unavailable':'Cashfree collection lookup is unavailable.',
    'Provider collection evidence mismatch':'Cashfree order ID, currency or amount did not match the trusted Bite order.',
    'Provider settlement evidence mismatch':'Cashfree settlement response did not match the trusted Bite order.',
    'Could not save provider verification evidence':'The provider check could not be saved to the private audit ledger.',
    'Server configuration missing':'Verification server configuration is incomplete.',
    'Provider not configured':'Cashfree provider configuration is incomplete.',
    'Admin access required':'This session is not authorized to verify payments.',
    'Invalid session':'Super Admin session is invalid.',
    'Order database unavailable':'Order lookup failed on the server.',
    'Payment database unavailable':'Checkout lookup failed on the server.',
    'Live marketplace order not found':'The paid marketplace order was not found.',
    'Invalid order ID':'The order identifier was rejected by the server.'
   };
   if(typeof payload?.error!=='string'||!Object.prototype.hasOwnProperty.call(messages,payload.error))return null;
   return 'HTTP '+status+': '+messages[payload.error];
  }catch{return null;}
 }
 async function preflightRefund(orderId){
  if(!authorized()||working)return;
  const selected=loadedOrders.find(row=>row.orderId===orderId&&
   ['Cancelled','Rejected'].includes(row.orderStatus));
  if(!selected)return;
  const token=requestToken,userId=deps.getUser().id;
  working=true;
  collectionAttempts.set(orderId,{restaurantId:selected.restaurantId,pending:true,error:false,
   message:'Read-only Cashfree payment/refund checks running. No refund will be initiated.'});
  render();setStatus('Read-only Cashfree preflight running for '+selected.orderCode+'. No refund will be created.');
  try{
   // A mobile network may hang after the Edge Function responds. Bound only
   // this read-only call, with no refund creation/retry side effects.
   const signal=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?
    AbortSignal.timeout(30000):undefined;
   const {data,error}=await deps.sb.functions.invoke('bite-auto-refund',{
    body:{action:'preflight',order_id:orderId},...(signal?{signal}:{})});
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   if(error)throw error;
   const messages={
    PAID_MATCHES_NO_REFUND:'Cashfree PAID order matches Bite. No existing refund found. This was a READ-ONLY check, not an executed refund.',
    EXISTING_REFUND_RECORD:'Cashfree already has refund record(s). STOP: verify provider refund status before any further payment action.',
    CASHFREE_PAYMENT_MISMATCH:'Cashfree order status, amount, currency or reference does NOT match Bite. Auto-refunds must remain OFF.',
    INTERNAL_MISMATCH_OR_INELIGIBLE:'Bite order/refund details are ineligible or inconsistent. Manual review is required.',
    PROVIDER_LOOKUP_UNAVAILABLE:'Cashfree order lookup unavailable. Do not enable automatic refunds.',
    REFUND_LOOKUP_UNAVAILABLE:'Cashfree refund history unavailable. No refund has been initiated.',
    REFUND_EVIDENCE_MISMATCH:'Existing Cashfree refund evidence conflicts with Bite records. STOP.'
   };
   const outcome=typeof data?.result==='string'&&Object.prototype.hasOwnProperty.call(messages,data.result)?
    data.result:'UNKNOWN';
   const safeMessage=messages[outcome]||'Cashfree preflight result unavailable. No refund was initiated.';
   const ok=outcome==='PAID_MATCHES_NO_REFUND';
   const message=safeMessage+' Auto-refunds: '+(data?.live_refunds_enabled===true?'ENABLED':'Not confirmed enabled')+
    '. Provider refund confirmation is still required before claiming customer bank credit.';
   collectionAttempts.set(orderId,{restaurantId:selected.restaurantId,pending:false,error:!ok,message});
   render();setStatus(message,!ok);
  }catch{
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   const message='Read-only Cashfree preflight unavailable. No refund has been sent; do not enable automatic refunds.';
   collectionAttempts.set(orderId,{restaurantId:selected.restaurantId,pending:false,error:true,message});
   render();setStatus(message,true);
  }finally{
   working=false;
   if(token===requestToken&&authorized()&&deps.getUser()?.id===userId)render();
  }
 }
 async function reconcile(orderId){
  if(!authorized()||working)return;
  const selected=loadedOrders.find(row=>row.orderId===orderId);
  if(!selected)return;
  const userId=deps.getUser().id,token=requestToken;
  let outcome=null;
  collectionAttempts.set(orderId,{restaurantId:selected.restaurantId,pending:true,error:false,
   message:'Checking Cashfree collection. No new payment, refund or transfer is being made.'});
  working=true;render();
  setStatus('Checking Cashfree collection and settlement evidence. No refund, transfer or new payment is being made.');
  try{
   const {data,error}=await deps.sb.functions.invoke('bite-cashfree-operations',{body:{action:'reconcile',order_id:orderId}});
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   if(error)throw error;
   if(!data?.collection?.status)throw Error('Provider did not return collection status');
   const status=String(data.collection.status).slice(0,24);
   outcome={status,message:'Cashfree reports '+status+'. Restaurant payout remains unverified until separate vendor settlement evidence is checked.',error:false};
   setStatus(outcome.message);
  }catch(error){
   // Supabase HTTP errors carry an error Response in context; inspect only
   // a strict allowlist of safe server error reasons and then recheck session.
   const safeDetail=await safeProviderErrorDetail(error);
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   outcome={status:'UNAVAILABLE',message:'Provider check unavailable or mismatched for '+selected.orderCode+'. '+
    (safeDetail||'Cashfree verification did not complete.')+
    ' Do not mark the order or restaurant settled.',error:true};
   setStatus(outcome.message,true);
  }finally{
   working=false;
   if(token===requestToken&&authorized()&&deps.getUser()?.id===userId){
    // Refresh the read-only audit, then restore this attempt's result so an
    // Edge Function error is not hidden by the generic "Orders shown" status.
    const refreshing=load(true),refreshToken=requestToken;
    const refreshOk=await refreshing;
    if(refreshOk&&refreshToken===requestToken&&authorized()&&deps.getUser()?.id===userId&&outcome){
     const refreshed=loadedOrders.find(row=>row.orderId===orderId);
     const missingEvidence=outcome.status==='PAID'&&!refreshed?.verdict.verifiedCollection;
     const message=missingEvidence?
      'Cashfree reported PAID, but no matching provider-check audit record was saved for '+selected.orderCode+'. Collection is NOT independently verified in Bite. Do not mark settled or retry payment.':
      outcome.message;
     const error=missingEvidence||outcome.error;
     // Show the result in the same order row as the button that was used.
     collectionAttempts.set(orderId,{restaurantId:selected.restaurantId,pending:false,error,message});
     render();
     setStatus(message,error);
    }
   }
  }
 }
 async function inspectSplit(orderId){
  if(!authorized()||working)return;
  const selected=loadedOrders.find(row=>row.orderId===orderId);
  if(!selected)return;
  const userId=deps.getUser().id,token=requestToken;
  splitResults.delete(orderId);vendorComparisons.delete(orderId);vendorBankChecks.delete(orderId);vendorReconResults.delete(orderId);
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
  vendorBankChecks.delete(orderId);vendorReconResults.delete(orderId);
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
  vendorBankChecks.delete(orderId);vendorReconResults.delete(orderId);
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
 async function inspectVendorRecon(orderId,bankStatementUtr=''){
  if(!authorized()||working)return;
  const row=loadedOrders.find(r=>r.orderId===orderId);
  const choice=vendorComparisons.get(orderId),bank=vendorBankChecks.get(orderId);
  if(!row||!choice||!bank||choice.restaurantId!==row.restaurantId||
     choice.verdict.status!=='FOUND_IN_ORDER_ONLY'||
     bank.restaurantId!==row.restaurantId||bank.vendorId!==choice.vendorId||bank.bankMatch!=='MATCH')return;
  const bankUtr=typeof bankStatementUtr==='string'?bankStatementUtr.trim():'';
  if(bankUtr&&!/^[A-Za-z0-9]{6,48}$/.test(bankUtr)){
   setStatus('Invalid statement UTR. Use 6–48 letters/numbers, or leave it empty.',true);return;
  }
  const userId=deps.getUser().id,token=requestToken;
  vendorReconResults.delete(orderId);
  working=true;render();
  setStatus('Reading Cashfree vendor reconciliation report. This is not a transfer and never marks bank paid.');
  try{
   const {data,error}=await deps.sb.functions.invoke('bite-cashfree-operations',{
    body:{action:'inspect_vendor_recon',order_id:orderId,vendor_id:choice.vendorId,
     ...(bankUtr?{bank_statement_utr:bankUtr}:{})}});
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   if(error)throw error;
   const v=data?.vendor_reconciliation;
   const statuses=['PAGINATION_INCOMPLETE','NO_VENDOR_RECON_ROW','MULTIPLE_VENDOR_RECON_ROWS',
    'PROVIDER_NOT_SETTLED','PROVIDER_STATUS_UNCLEAR','PROVIDER_SETTLEMENT_EVIDENCE_INCOMPLETE',
    'PROVIDER_REPORTS_SETTLED'];
   if(!v||!statuses.includes(v.status)||
      !['NOT_SUBMITTED','MATCHES_OPERATOR_INPUT','DIFFERS_FROM_OPERATOR_INPUT'].includes(v.utr_check)||
      data.bank_settings_match!=='MATCH'||
      data.restaurant_payout!=='NOT_INDEPENDENTLY_VERIFIED'||
      data.bank_credit!=='NOT_INDEPENDENTLY_VERIFIED')
    throw Error('Untrusted provider reconciliation status');
   let message=v.status==='PROVIDER_REPORTS_SETTLED'?
    'Cashfree reports vendor SETTLED'+(v.vendor_settlement_utr_masked?' (masked UTR '+String(v.vendor_settlement_utr_masked).slice(0,10)+')':'')+
    '. Restaurant bank credit remains NOT independently verified.':
    'Cashfree vendor reconciliation: '+v.status.replaceAll('_',' ')+'. Restaurant bank credit NOT verified.';
   if(v.utr_check==='MATCHES_OPERATOR_INPUT')
    message+=' Operator-entered statement UTR MATCHES provider record; bank statement authenticity still requires independent verification.';
   if(v.utr_check==='DIFFERS_FROM_OPERATOR_INPUT')
    message+=' STOP: statement UTR DIFFERS from provider; do not mark the payout paid.';
   vendorReconResults.set(orderId,{restaurantId:row.restaurantId,vendorId:choice.vendorId,message});
   setStatus(message,v.status!=='PROVIDER_REPORTS_SETTLED'||v.utr_check==='DIFFERS_FROM_OPERATOR_INPUT');
  }catch(error){
   if(token!==requestToken||!authorized()||deps.getUser()?.id!==userId)return;
   setStatus('Cashfree vendor settlement lookup unavailable or mismatched. Bank credit NOT verified. '+
    String(error?.message||'Please retry later').slice(0,90),true);
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
  byId('biteRefundReviewLoad')?.addEventListener('click',()=>{void loadRefundReview();});
  // Keep open Super Admin refund history current without executing provider actions.
  // Account changes wipe data; hidden browser tabs do not poll.
  if(refundWatchTimer===null&&typeof root.setInterval==='function')
   refundWatchTimer=root.setInterval(()=>{
    if(refundReviewSeen&&authorized()&&document.visibilityState==='visible'&&!refundBusy)
     void loadRefundReview();
   },45000);
  byId('biteRefundAutoCheck')?.addEventListener('click',()=>{void loadAutoRefundPolicy();});
  byId('biteRefundReviewRows')?.addEventListener('click',event=>{
   const target=event.target.closest('[data-bite-inspect-refund]');
   if(target)void inspectRefund(target.dataset.biteInspectRefund);
   const preflight=event.target.closest('[data-bite-auto-refund-preflight]');
   if(preflight)void preflightRefundJob(preflight.dataset.biteAutoRefundPreflight);
  });
  byId('biteProviderAuditRows')?.addEventListener('click',event=>{
   const item=event.target.closest('[data-bite-reconcile-order]');
   if(item)void reconcile(item.dataset.biteReconcileOrder);
   const split=event.target.closest('[data-bite-inspect-split]');
   if(split)void inspectSplit(split.dataset.biteInspectSplit);
   const preflight=event.target.closest('[data-bite-refund-preflight-order]');
   if(preflight)void preflightRefund(preflight.dataset.biteRefundPreflightOrder);
   const compare=event.target.closest('[data-bite-compare-vendor]');
   if(compare){
    const input=byId('biteProviderAuditRows')?.querySelector(
     'input[data-bite-vendor-candidate="'+compare.dataset.biteCompareVendor+'"]');
    compareVendor(compare.dataset.biteCompareVendor,input?.value||'');
   }
   const vendor=event.target.closest('[data-bite-inspect-vendor]');
   if(vendor)void inspectVendor(vendor.dataset.biteInspectVendor);
   const recon=event.target.closest('[data-bite-inspect-recon]');
   if(recon){
    const input=byId('biteProviderAuditRows')?.querySelector(
     'input[data-bite-statement-utr="'+recon.dataset.biteInspectRecon+'"]');
    void inspectVendorRecon(recon.dataset.biteInspectRecon,input?.value||'');
   }
  });
 }
 function clear(){
  if(refundWatchTimer!==null){root.clearInterval?.(refundWatchTimer);refundWatchTimer=null;}
  refundReviewSeen=false;requestToken++;activeUser=null;working=false;wipe();
  setStatus('Super Admin login required.');
 }
 root.BiteCashfreeAudit={init,load,reconcile,preflightRefund,inspectSplit,compareVendor,inspectVendor,inspectVendorRecon,loadRefundReview,inspectRefund,loadAutoRefundPolicy,preflightRefundJob,compareVendorCandidate,clear,classify,buildRows,buildPaymentExceptions};
})(window);
