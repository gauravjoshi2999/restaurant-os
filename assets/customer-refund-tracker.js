/* Bite customer refund UI: short, truthful stages; diagnostic details on demand. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 const date=v=>{
  if(!v)return '';
  const d=new Date(v);
  return Number.isNaN(d.getTime())?'':d.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
 };
 function classify(order,refund,cancellation,unavailable=false){
  const status=String(refund?.status||'');
  const provider=String(refund?.provider_status||'').toUpperCase();
  const confirmed=!!refund?.provider_checked_at;
  // An order's amount or Cancelled status is not proof of payment or a refund.
  // Only server-created refund jobs justify a refund claim. A cancellation
  // request can still be reported independently, without refund wording.
  if(!refund){
   if(cancellation?.status==='Pending')return {kind:'waiting',title:'Cancellation requested',
    note:'Waiting for the restaurant to respond.',stage:0,requestOnly:true};
   if(cancellation?.status==='Rejected')return {kind:'failed',title:'Cancellation declined',
    note:'The restaurant did not approve the request.',stage:0,requestOnly:true};
   return null;
  }
  if(unavailable)return {kind:'unknown',title:'Checking refund status',note:'Please try again shortly.',stage:0};
  // A fresh exact-refund provider check outranks a stale internal review label.
  // It must never be treated as evidence of credit to the customer's bank.
  if(confirmed&&status==='succeeded'&&provider==='SUCCESS')
   return {kind:'success',title:'Refund processed',note:'Cashfree confirmed success; bank credit may take longer.',stage:2};
  if(confirmed&&['PENDING','PENDING_APPROVAL','ONHOLD'].includes(provider))
   return {kind:'processing',title:'Refund initiated',
    note:'Cashfree has a refund record. Processing to the original payment method.',stage:1};
  if(confirmed&&['CANCELLED','REJECTED'].includes(provider))
   return {kind:'failed',title:'Refund needs attention',
    note:'Cashfree did not complete this refund. Please contact support.',stage:0};
  if(status==='pending_approval')return {kind:'waiting',title:'Refund under review',
   note:'We’ve received your refund request.',stage:0};
  if(status==='approved')return {kind:'waiting',title:'Refund request approved',
   note:'Payment-provider initiation is not confirmed yet.',stage:0};
  if(status==='processing')return {kind:'processing',title:'Refund processing',
   note:'We’re checking whether Cashfree has received the refund.',stage:0};
  if(status==='submitted'){
   if(confirmed&&['PENDING','PENDING_APPROVAL','ONHOLD','SUCCESS'].includes(provider))
    return {kind:'processing',title:'Refund initiated',
     note:'Processing to your original payment method.',stage:1};
   return {kind:'processing',title:'Refund processing',
    note:'Waiting for confirmation from the payment provider.',stage:0};
  }
  if(status==='succeeded'&&provider==='SUCCESS'&&confirmed)
   return {kind:'success',title:'Refund processed',note:'Payment provider confirmed success.',stage:2};
  if(status==='failed'||status==='rejected')return {kind:'failed',title:'Refund needs attention',
   note:'We couldn’t complete this refund. Please contact support.',stage:0};
  return {kind:'unknown',title:'Checking refund status',
   note:'We’re verifying the update from your payment provider.',stage:0};
 }
 function summary(order,refund,cancellation,unavailable=false){
  const info=classify(order,refund,cancellation,unavailable);
  if(!info)return '';
  const amount=refund&&Number.isFinite(Number(refund.amount))?money(refund.amount):'';
  return '<div class="bite-refund-summary bite-refund-'+esc(info.kind)+'" role="status">'+
   '<span class="bite-refund-dot" aria-hidden="true"></span>'+
   '<div class="bite-refund-summary-text"><strong>'+esc(info.title)+'</strong>'+
   '<small>'+esc(info.note)+'</small></div>'+
   (amount?'<strong class="bite-refund-summary-amount">'+esc(amount)+'</strong>':'')+'</div>';
 }
 function details(order,refund,cancellation,unavailable=false){
  const info=classify(order,refund,cancellation,unavailable);
  if(!info)return '';
  // Never display the order price as a refund amount.
  if(!refund||info.requestOnly)return '';
  const amount=Number.isFinite(Number(refund.amount))&&Number(refund.amount)>0?money(refund.amount):'';
  const provider=String(refund?.provider_status||'').toUpperCase();
  const checked=!!refund?.provider_checked_at;
  const initiated=checked&&['PENDING','PENDING_APPROVAL','ONHOLD','SUCCESS'].includes(provider)&&
   (['submitted','succeeded'].includes(refund?.status)||info.stage>=1);
  const complete=info.kind==='success'&&initiated;
  const stage=complete?2:initiated?1:0;
  // The bank is never marked credited merely because Cashfree returned SUCCESS.
  const phases=[
   {label:'Requested',done:!!refund||cancellation?.status==='Pending'||cancellation?.status==='Approved'},
   {label:'Initiated',done:initiated},
   {label:'Processed',done:complete}
  ];
  const stepMarkup=phases.map((p,i)=>
   '<li class="'+(p.done?'is-done':i===stage?'is-current':'is-upcoming')+'"'+
   (i===stage?' aria-current="step"':'')+'><span class="bite-refund-step-marker" aria-hidden="true">'+
   (p.done?'✓':String(i+1))+'</span><span>'+esc(p.label)+'</span></li>').join('');
  const expected=complete?
   'Cashfree has confirmed SUCCESS. The credit may still take time to appear in your account.':
   initiated?'Refunds generally reflect within 5–7 working days of initiation, depending on your bank.':
   'The refund timeframe starts after initiation, not when the order is cancelled.';
  const help=(
   '<details class="bite-refund-help"><summary>Payment details &amp; help</summary>'+
   '<div class="bite-refund-help-body">'+
   '<div><span>Refund to</span><strong>Original payment method</strong></div>'+
   '<div><span>Provider status</span><strong>'+esc(checked?provider:'Awaiting verification')+'</strong></div>'+
   ((checked&&refund?.provider_refund_id)?
    '<div><span>Cashfree refund ID (not bank UTR)</span><strong>'+esc(refund.provider_refund_id)+'</strong></div>':'')+
   ((checked&&refund?.provider_checked_at)?
    '<div><span>Last checked</span><strong>'+esc(date(refund.provider_checked_at))+'</strong></div>':'')+
   '<p>Refunds return to the original payment method. For a missing credit, contact Bite support using this order ID.</p>'+
   '</div></details>');
  return '<section class="bite-refund-details" aria-label="Refund tracking">'+
   '<div class="bite-refund-details-head"><div><span class="bite-refund-eyebrow">REFUND STATUS</span>'+
   '<strong>'+esc(info.title)+'</strong></div>'+(amount?'<strong class="bite-refund-amount">'+esc(amount)+'</strong>':'')+'</div>'+
   '<p class="bite-refund-details-note">'+esc(info.note)+'</p>'+
   '<ol class="bite-refund-steps" aria-label="Refund progress">'+stepMarkup+'</ol>'+
   '<p class="bite-refund-eta">'+esc(expected)+'</p>'+
   help+
   '<button type="button" class="bite-refund-refresh" data-refresh-refund-id="'+esc(order?.id)+'">Refresh status</button>'+
   '</section>';
 }
 const api={classify,summary,details};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.BiteRefundTracker=api;
})(typeof window!=='undefined'?window:globalThis);
