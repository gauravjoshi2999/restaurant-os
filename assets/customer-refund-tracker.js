/* Customer-owned refund information: provider statuses, never invented bank credits. */
(function(root){
 'use strict';
 const states=new Set(['pending_approval','approved','processing','submitted','succeeded','failed','rejected']);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 const date=v=>{if(!v)return '';const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});};
 function classify(order,refund,cancellation,unavailable=false){
  const paid=String(order?.payment_status||'').toLowerCase()==='paid';
  const cancelled=['Cancelled','Rejected'].includes(order?.status);
  if(unavailable)return {kind:'unknown',title:'Refund status temporarily unavailable',
   note:'Please refresh Order Details. Do not assume the refund was paid.'};
  if(!refund){
   if(cancellation?.status==='Pending')return {kind:'waiting',title:'Cancellation request pending',
    note:'Restaurant decision is pending. Payment has not been refunded.'};
   if(cancellation?.status==='Rejected')return {kind:'review',title:'Cancellation not approved',
    note:'Order remains active unless its status shows otherwise. No refund confirmed.'};
   if(cancelled)return {kind:'waiting',title:'Order cancelled · Refund status pending',
    note:'No refund record available yet. Contact Bite support if this does not update.'};
   return null;
  }
  const status=states.has(refund.status)?refund.status:'unknown';
  if(status==='pending_approval')return {kind:'waiting',title:'Refund waiting for processing',
   note:'Bite has recorded the refund request. Money has NOT been sent to your bank or UPI.'};
  if(status==='approved')return {kind:'waiting',title:'Refund approved · Not sent yet',
   note:'Bite has authorised the refund, but Cashfree processing has not been confirmed.'};
  if(status==='processing')return {kind:'processing',title:'Refund processing',
   note:'Bite is checking the refund with Cashfree. Bank credit is not yet confirmed.'};
  if(status==='submitted')return {kind:'processing',title:'Refund sent for processing',
   note:'Cashfree status: '+String(refund.provider_status||'not confirmed')+'. Bank credit is still pending.'};
  if(status==='succeeded'&&refund.provider_status==='SUCCESS'&&refund.provider_checked_at)return {
   kind:'success',title:'Refund successful at Cashfree',
   note:'Cashfree confirmed SUCCESS. Your original payment account may take time to show the credit.'};
  if(status==='failed'||status==='rejected')return {kind:'failed',title:'Refund needs help',
   note:'The refund is not confirmed successful. Contact Bite support from this order.'};
  return {kind:'unknown',title:'Refund status being verified',
   note:'Cashfree refund evidence is not final. No bank credit is confirmed.'};
 }
 function summary(order,refund,cancellation,unavailable=false){
  const info=classify(order,refund,cancellation,unavailable);
  if(!info)return '';
  const amount=refund&&Number.isFinite(Number(refund.amount))?money(refund.amount):'';
  return '<div class="bite-refund-summary bite-refund-'+esc(info.kind)+'" role="status">'+
   '<span class="bite-refund-dot" aria-hidden="true"></span><div><strong>'+esc(info.title)+'</strong>'+
   '<small>'+esc(amount?amount+' · '+info.note:info.note)+'</small>'+
   '<span class="bite-refund-expand-hint">View details for refund tracking</span></div></div>';
 }
 function details(order,refund,cancellation,unavailable=false){
  const info=classify(order,refund,cancellation,unavailable);
  if(!info)return '';
  const approved=!!refund&&(!!refund.approved_at||!!refund.auto_authorized_at);
  const providerConfirmed=!!refund?.provider_checked_at&&typeof refund?.provider_status==='string';
  const source='Original online payment method (UPI / card / bank, as used at checkout)';
  const amount=refund?money(refund.amount):money(order?.amount);
  const submitted=providerConfirmed&&['PENDING','PENDING_APPROVAL','ONHOLD','SUCCESS'].includes(refund.provider_status);
  const timeline=[
   ['Payment',String(order?.payment_status||'').toLowerCase()==='paid'?'Recorded as paid in Bite':'Verification pending'],
   ['Cancellation',cancellation?.status==='Approved'?'Approved by restaurant':
    ['Cancelled','Rejected'].includes(order?.status)?'Order cancelled':cancellation?.status==='Pending'?'Awaiting restaurant decision':'Request status unavailable'],
   ['Refund request',refund?'Created':'Not recorded'],
   ['Refund authorisation',approved?'Approved':refund?'Awaiting review':'Not started'],
   ['Cashfree processing',submitted?'Provider reported '+refund.provider_status:'Not verified'],
   ['Original bank / UPI credit','Not independently confirmed by Bite']
  ];
  const track=timeline.map(([name,value])=>'<li><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong></li>').join('');
  const ref=providerConfirmed&&refund.provider_refund_id?
    '<div class="bite-refund-row"><span>Cashfree refund ID (not bank UTR)</span><strong>'+esc(refund.provider_refund_id)+'</strong></div>':'';
  const statusUpdated=providerConfirmed&&refund.provider_checked_at?
   '<div class="bite-refund-row"><span>Last Cashfree status check</span><strong>'+esc(date(refund.provider_checked_at))+'</strong></div>':'';
  const estimate=submitted?
   'Cashfree guidance: generally 5–7 working days after refund initiation for the original bank/payment source. This is an estimate, not a confirmed credit date.':
   'Refund has not been confirmed as initiated. The 5–7 working-day bank timeframe does NOT start from cancellation approval.';
  return '<section class="bite-refund-details" aria-label="Refund tracking"><div class="bite-refund-details-head">'+
   '<div><strong>Payment & refund tracking</strong><p>'+esc(info.title)+'</p></div><strong>'+esc(amount)+'</strong></div>'+
   '<div class="bite-refund-row"><span>Refund destination</span><strong>'+esc(source)+'</strong></div>'+
   '<div class="bite-refund-row"><span>Cashfree refund status</span><strong>'+esc(providerConfirmed?refund.provider_status:'Not verified')+'</strong></div>'+
   ref+statusUpdated+'<ol class="bite-refund-timeline">'+track+'</ol>'+
   '<p class="bite-refund-eta">'+esc(estimate)+'</p>'+
   '<p class="bite-refund-safe-note">Bank account number, UPI ID and bank UTR are not available from the verified Bite record. We do not invent these details. For missing credits, use Order Support and your original payment reference.</p>'+
   '<button type="button" class="bite-refund-refresh" data-refresh-refund-id="'+esc(order.id)+'">Refresh refund status</button></section>';
 }
 const api={classify,summary,details};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.BiteRefundTracker=api;
})(typeof window!=='undefined'?window:globalThis);
