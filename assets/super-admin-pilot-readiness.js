/* Bite Super Admin — source-backed, read-only pilot release gate.
 * Aggregate row counts are NOT evidence of Cashfree bank settlement,
 * refund bank credit, or native Android notification delivery. */
(function(root){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ISSUE_URL='https://github.com/gauravjoshi2999/restaurant-os/issues/124';
  async function count(client,table,filters=[]){
    if(!client?.from)throw Error('Authenticated source unavailable');
    let query=client.from(table).select('id',{count:'exact',head:true});
    for(const [method,...args] of filters){
      if(!['eq','in'].includes(method)||typeof query[method]!=='function')throw Error('Invalid source filter');
      query=query[method](...args);
    }
    const {count:total,error}=await query;
    if(error)throw Error('Could not verify '+table);
    if(!Number.isSafeInteger(total)||total<0)throw Error('Incomplete '+table+' count');
    return total;
  }
  async function load(client,isCurrent){
    if(typeof isCurrent!=='function'||!isCurrent())throw Error('Admin session unavailable');
    const [providerChecks,settlements,refundsAwaiting]=await Promise.all([
      count(client,'bite_provider_checks'),
      count(client,'restaurant_settlements'),
      count(client,'bite_refund_jobs',[['in','status',['pending_approval','approved','processing','submitted']]])
    ]);
    if(!isCurrent())throw Error('Admin session changed');
    return {providerChecks,settlements,refundsAwaiting,
      // These require external merchant/bank records and real Android/Owner sessions.
      bankSettlementVerified:false,restaurantPayoutVerified:false,
      authenticatedOwnerAccepted:false,androidDeviceAccepted:false};
  }
  function render(data){
    const provider=Number.isSafeInteger(data?.providerChecks)?data.providerChecks:null;
    const settlements=Number.isSafeInteger(data?.settlements)?data.settlements:null;
    const refunds=Number.isSafeInteger(data?.refundsAwaiting)?data.refundsAwaiting:null;
    const stat=(heading,value,note)=>'<div class="sa-pilot-stat"><small>'+esc(heading)+'</small><strong>'+
       esc(value===null?'Unverified':value)+'</strong><span>'+esc(note)+'</span></div>';
    return '<section class="sa-card sa-pilot" aria-label="Pilot launch readiness" data-sa-pilot-readiness>'+
       '<div class="sa-pilot-head"><h2>Pilot Launch Readiness</h2>'+
       '<p>Limited pilot requires external approval. A green website build is not a live-money certification.</p></div>'+
       '<div class="sa-pilot-stats">'+
       stat('Provider reconciliation records',provider,'Records only; merchant bank credit not proven')+
       stat('Restaurant settlement records',settlements,'Records or drafts; vendor bank payout not proven')+
       stat('Refunds awaiting follow-up',refunds,'No customer bank credit inferred')+
       '</div><div class="sa-pilot-note"><strong>Manual acceptance remains required:</strong> '+
       'real Cashfree dashboard + bank reconciliation, correct refund status, authenticated Owner/Customer workflows, '+
       'and physical Android foreground/lock-screen alerts. No money was moved by this check.</div>'+
       '<a class="sa-pilot-link" target="_blank" rel="noopener noreferrer" href="'+ISSUE_URL+
       '">Open the pilot acceptance checklist</a></section>';
  }
  async function mount({client,container,isCurrent}={}){
    if(!container||typeof isCurrent!=='function'||!isCurrent())return;
    container.textContent='Checking pilot evidence from verified Admin sources…';
    try{
      const result=await load(client,isCurrent);
      if(!isCurrent())return;
      container.innerHTML=render(result);
    }catch(e){
      if(!isCurrent())return;
      container.innerHTML='<section class="sa-card sa-pilot" role="status"><h2>Pilot Launch Readiness</h2>'+
       '<p>Provider, refund or settlement evidence could not be verified. Do not certify launch readiness or infer any bank credit.</p>'+
       '<a class="sa-pilot-link" target="_blank" rel="noopener noreferrer" href="'+ISSUE_URL+
       '">Review the pilot acceptance checklist</a></section>';
    }
  }
  const api={count,load,render,mount};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BitePilotReadiness=api;
})(typeof window!=='undefined'?window:globalThis);
