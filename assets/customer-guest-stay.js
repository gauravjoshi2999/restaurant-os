/* Read one hotel folio through an expiring bearer link, inside the customer app. */
(function(root){
 'use strict';
 let sb,token='',timer=null,version=0,returnFocus=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 const $=id=>document.getElementById(id);
 function fromLink(value){
  const raw=String(value||'').trim();if(/^[a-f0-9]{64}$/.test(raw))return raw;
  try{const u=new URL(raw,root.location.href);return new URLSearchParams(u.hash.slice(1)).get('stay')||''}catch{return ''}
 }
 function init(client){
  sb=client;const dialog=document.createElement('dialog');dialog.id='biteGuestStayDialog';dialog.className='bite-guest-stay';dialog.setAttribute('aria-labelledby','biteGuestStayTitle');
  dialog.innerHTML='<div class="bite-guest-stay-head"><div><small>BITE · GUEST SERVICES</small><h2 id="biteGuestStayTitle">Hotel bill & refund progress</h2></div><button type="button" id="biteGuestStayClose" aria-label="Close guest bill">×</button></div><form id="biteGuestStayForm"><label for="biteGuestStayLink">Private link from your hotel</label><div class="bite-guest-stay-input"><input id="biteGuestStayLink" autocomplete="off" placeholder="Paste your guest link" required><button type="submit">Open bill</button></div></form><p id="biteGuestStayStatus" role="status" aria-live="polite"></p><div id="biteGuestStayContent"></div>';
  document.body.append(dialog);$('biteGuestStayClose').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close()});
  $('biteGuestStayForm').onsubmit=e=>{e.preventDefault();open(fromLink($('biteGuestStayLink').value))};
  const account=$('accountView');if(account){const button=document.createElement('button');button.type='button';button.className='secondary';button.id='biteGuestStayAccount';button.textContent='Hotel bill & refund progress';button.onclick=()=>open('');account.append(button)}
  root.addEventListener('hashchange',()=>{const t=new URLSearchParams(root.location.hash.slice(1)).get('stay');if(t)open(t)});
  const t=new URLSearchParams(root.location.hash.slice(1)).get('stay');if(t)open(t);
 }
 function open(value){
  const d=$('biteGuestStayDialog');if(!d.open){returnFocus=document.activeElement;d.showModal()}token=value;$('biteGuestStayContent').replaceChildren();$('biteGuestStayForm').hidden=!!value;
  document.body.dataset.guestStayOpen='true';const location=$('biteLocationSheet');if(location){location.hidden=true;document.body.classList.remove('bite-location-locked')}
  clearInterval(timer);if(value){void refresh();timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh()},30000)}else $('biteGuestStayStatus').textContent='Use the private, time-limited bill link supplied by your hotel.';
 }
 function close(){version++;token='';clearInterval(timer);timer=null;$('biteGuestStayDialog').close();$('biteGuestStayContent').replaceChildren();$('biteGuestStayLink').value='';delete document.body.dataset.guestStayOpen;
  if(new URLSearchParams(root.location.hash.slice(1)).has('stay'))history.replaceState(null,'',root.location.pathname+root.location.search);returnFocus?.focus?.();
 }
 async function refresh(){
  const v=++version,t=token,status=$('biteGuestStayStatus');status.textContent='Checking hotel records…';
  try{
   if(!/^[a-f0-9]{64}$/.test(t))throw Error('This guest link is invalid or expired. Ask the hotel for a new link.');
   const r=await sb.rpc('bite_guest_folio',{p_token:t});if(v!==version||t!==token)return;if(r.error)throw Error(r.error.code==='42501'?'This guest link is invalid, expired or revoked. Ask the hotel for a new link.':'Hotel records could not be loaded. Check your connection and retry.');
   render(r.data);status.textContent='Updated '+new Date().toLocaleTimeString('en-IN')+' · Hotel records. Bank settlement timing is confirmed by the hotel.';
  }catch(error){if(v!==version||t!==token)return;$('biteGuestStayContent').replaceChildren();status.textContent=error.message||'Unable to load this bill.';const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.onclick=()=>void refresh();$('biteGuestStayContent').append(retry);$('biteGuestStayForm').hidden=false}
 }
 function render(v){
  if(!v||!v.property||!v.totals)throw Error('The hotel bill response is incomplete. Retry or contact the hotel.');
  const total=v.totals,refunds=v.refunds||[],content=$('biteGuestStayContent');
  content.innerHTML='<section><h3>'+esc(v.property.name)+'</h3><p>'+esc(v.number)+' · '+esc(v.status)+'<br>'+esc(v.arrival)+' → '+esc(v.departure)+'</p><div class="bite-guest-stay-totals">'+[['Charges',total.charges],['Applied payments',total.paid],['Balance due',total.balance],['Held deposit',total.deposit_held],['Verification pending',total.pending]].map(([label,n])=>'<div><span>'+label+'</span><strong>'+money(n)+'</strong></div>').join('')+'</div><h3>Itemized statement</h3><div class="bite-guest-stay-lines">'+(v.entries||[]).map(e=>'<div><span>'+esc(e.description)+'<small>'+esc(e.kind)+' · '+esc(e.status)+(e.method?' · '+esc(e.method):'')+(e.reference_tail?' · reference ending '+esc(e.reference_tail):'')+'</small></span><strong>'+(['payment','advance','discount','reversal','deposit_apply'].includes(e.kind)?'−':'')+money(Number(e.amount)+Number(e.tax||0))+'</strong></div>').join('')+'</div><h3>Hotel refund progress</h3>'+(refunds.length?refunds.map(j=>'<article class="bite-guest-refund"><strong>'+money(j.amount)+' · '+esc(({requested:'Requested — awaiting hotel action',processing:'Processing by hotel',failed:'Return needs hotel follow-up',paid:'Return recorded as paid by hotel',cancelled:'Request cancelled'})[j.status]||j.status)+'</strong><p>'+esc(j.method)+(j.reference_tail?' · reference ending '+esc(j.reference_tail):'')+'</p></article>').join(''):'<p>No hotel refund request has been recorded for this bill.</p>')+'<p>Online food order refunds appear in your food order details.</p><p>For questions, contact '+esc(v.property.name)+(v.property.phone?' · '+esc(v.property.phone):'')+'. Link expires '+esc(new Date(v.expires_at).toLocaleString('en-IN'))+'.</p><div class="bite-guest-stay-actions"><button type="button" data-guest-refresh>Refresh progress</button><button type="button" data-guest-print>Print / Save PDF</button></div></section>';
  content.querySelector('[data-guest-refresh]').onclick=()=>void refresh();content.querySelector('[data-guest-print]').onclick=()=>root.print();
 }
 root.BiteGuestStay={init,open,close,fromLink};
})(typeof window!=='undefined'?window:globalThis);
