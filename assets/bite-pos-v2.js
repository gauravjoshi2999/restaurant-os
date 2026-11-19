/* Bite Owner POS — Stage 1: compact, honest mobile dashboard.
   Existing canonical New Bill, Drafts, History and POS RPCs stay unchanged. */
(function(root){
 "use strict";
 const doc=root.document;
 let view="today",current=null;
 const glyph={
  bill:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z"/><path d="M9 8h6m-6 4h6m-6 4h3"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  back:'<path d="m15 18-6-6 6-6"/>',
  forward:'<path d="m9 18 6-6-6-6"/>',
  draft:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8m-8 4h5"/>',
  bag:'<path d="M4 8h16l1 13H3L4 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  rupee:'<path d="M6 4h12M6 8h12M6 4c4 0 7 2 7 5s-3 5-7 5l9 7"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  people:'<circle cx="8" cy="8" r="3"/><path d="M2 20a6 6 0 0 1 12 0M16 8a3 3 0 0 1 0 6M17 16a5 5 0 0 1 4 4"/>'
 };
 const ic=n=>'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(glyph[n]||glyph.bill)+'</svg>';
 const safe=v=>String(v??"").replace(/[&<>"']/g,k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[k]));
 const money=n=>'₹'+Math.max(0,Number(n)||0).toLocaleString("en-IN",{maximumFractionDigits:2});
 function dateKey(value){
  const d=new Date(value||"");
  if(!Number.isFinite(d.getTime()))return "";
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
    timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(d).map(p=>[p.type,p.value]));
  return parts.year+"-"+parts.month+"-"+parts.day;
 }
 function todayKey(){return dateKey(new Date());}
 function eligible(o){
  return !!o&&!o.isDemo&&!['Cancelled','Rejected'].includes(o.status)&&
    !String(o.code||"").startsWith("POS-ROOM-")&&!(o.roomLinked);
 }
 function numbers(input){
  const real=(input.orders||[]).filter(eligible);
  const date=input.date||todayKey(),same=real.filter(o=>dateKey(o.createdAt)===date);
  const billed=same.reduce((n,o)=>n+Math.max(0,Number(o.amount||0)-Number(o.waivedOffAmount||0)),0);
  const received=same.reduce((n,o)=>n+Math.max(0,Number(o.receivedAmount||0)),0);
  const due=same.reduce((n,o)=>n+Math.max(0,Number(o.dueAmount||0)),0);
  const withVisit=same.filter(o=>o.posVisit&&['dine_in','takeaway'].includes(o.posVisit.visit_type));
  const dineIn=withVisit.filter(o=>o.posVisit.visit_type==='dine_in');
  const people=dineIn.reduce((n,o)=>n+Number(o.posVisit.guest_count||0),0);
  return {same,all:real,bills:same.length,billed,received,due,people,
   dineInBills:dineIn.length,takeawayBills:withVisit.length-dineIn.length,
   untrackedBills:same.length-withVisit.length};
 }
 function ensure(){
  const pos=doc.getElementById('pos');
  if(!pos)return null;
  let el=doc.getElementById("bitePosV2Desk");
  if(el)return el;
  el=doc.createElement("section");el.id="bitePosV2Desk";el.className="bite-pos-v2";el.setAttribute("aria-label","Restaurant POS dashboard");
  el.innerHTML='<div class="bpv2-intro"><span class="bpv2-eyebrow">BITE • RESTAURANT POS</span><strong>Fast counter billing</strong><small>One itemized bill for dine-in &amp; takeaway.</small></div>'+
   '<nav class="bpv2-tabs" aria-label="POS sections">'+
   '<button type="button" data-bpv2-tab="today" aria-pressed="true">Today</button>'+
   '<button type="button" data-bpv2-tab="bills" aria-pressed="false">Bills</button>'+
   '<button type="button" data-bpv2-tab="drafts" aria-pressed="false">Drafts</button>'+
   '<button type="button" data-bpv2-tab="reports" aria-pressed="false">Reports</button></nav>'+
   '<div id="bpv2Stats" aria-live="polite"></div>'+
   '<div id="bpv2Recent" aria-live="polite"></div>'+
   '<div class="bpv2-footer-note">Bill amount is not cash received. Online Bite customer orders are separate.</div>';
  const welcome=pos.querySelector(".welcome");
  (welcome||pos).insertAdjacentElement(welcome?"afterend":"afterbegin",el);
  el.addEventListener('click',event=>{
   const tab=event.target.closest("[data-bpv2-tab]");
   if(tab){view=tab.dataset.bpv2Tab;paint();return;}
   const bill=event.target.closest("[data-bpv2-print]");
   if(bill&&current){
    const found=current.orders.find(o=>String(o.id)===bill.dataset.bpv2Print);
    if(found&&found.restaurant===current.restaurantId&&typeof root.printOwnerInvoice==="function")
     root.printOwnerInvoice(found.id);
    return;
   }
   const receipt=event.target.closest('[data-bpv2-receipt]');
   if(receipt&&current){
    const found=current.orders.find(o=>o.id===receipt.dataset.bpv2Receipt);
    if(found?.restaurant===current.restaurantId&&found?.receipt?.id===receipt.dataset.bpv2PaymentId&&
      typeof root.showPOSReceiptInDailyBook==='function')
     void root.showPOSReceiptInDailyBook(found.id,found.receipt.id);
    return;
   }
   const jump=event.target.closest("[data-bpv2-go]");
   if(jump){view=jump.dataset.bpv2Go;paint();}
  });
  return el;
 }
 function dayText(key){
  if(!key)return "Today";
  const d=new Date(key+"T12:00:00+05:30");
  return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("en-IN",{day:"numeric",month:"short",year:"numeric",timeZone:"Asia/Kolkata"}).format(d):"Today";
 }
 function paint(){
  const el=ensure();if(!el||!current)return;
  const pos=doc.getElementById("pos");
  pos.dataset.bitePosView=view;
  for(const btn of el.querySelectorAll("[data-bpv2-tab]"))btn.setAttribute("aria-pressed",String(btn.dataset.bpv2Tab===view));
  const stats=doc.getElementById("bpv2Stats"),recent=doc.getElementById("bpv2Recent");
  if(view==="reports"){
   stats.innerHTML='<div id="bpv2ReportsPanel" aria-label="POS Reports"></div>';
   recent.innerHTML='';
   root.BitePOSReports?.mount?.({
    el:doc.getElementById('bpv2ReportsPanel'),client:current.client,
    restaurant:current.restaurantId,user:current.userId
   });
   return;
  }
  if(view==="drafts"){
   stats.innerHTML='<div class="bpv2-panel-heading"><strong>Saved drafts</strong><small>Resume or delete an unfinished bill below</small></div>';
   recent.innerHTML='';
   return;
  }
  if(view==="bills"){
   stats.innerHTML='<div class="bpv2-panel-heading"><strong>Bills &amp; History</strong><small>Existing saved POS bills. Open a bill or add a pending payment below.</small></div>';
   recent.innerHTML='';
   return;
  }
  const n=numbers(current),last=n.same.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,3);
  stats.innerHTML='<div class="bpv2-section-heading"><strong>'+safe(dayText(todayKey()))+'</strong><span>Recorded POS data</span></div>'+
   '<div class="bpv2-stats">'+
   '<div class="bpv2-stat is-orange">'+ic("bill")+'<small>Bills today</small><strong>'+n.bills+'</strong></div>'+
   '<div class="bpv2-stat is-green">'+ic("rupee")+'<small>POS billed</small><strong>'+money(n.billed)+'</strong></div>'+
   '<div class="bpv2-stat is-purple">'+ic("rupee")+'<small>Received</small><strong>'+money(n.received)+'</strong></div>'+
   '<div class="bpv2-stat is-blue">'+ic("clock")+'<small>Balance due</small><strong>'+money(n.due)+'</strong></div></div>'+
   '<div class="bpv2-people-note'+(n.dineInBills?' is-recorded':'')+'">'+ic("people")+
   '<span><strong>'+n.people+' people served</strong><small>'+n.dineInBills+' dine-in bill(s) · '+n.takeawayBills+' takeaway bill(s)'+
   (n.untrackedBills?' · '+n.untrackedBills+' older/unrecorded bill(s) excluded':'')+'</small></span></div>';
  recent.innerHTML='<div class="bpv2-section-heading"><strong>Recent bills</strong><button type="button" data-bpv2-go="bills">View all '+ic('forward')+'</button></div>'+
   (last.length?'<div class="bpv2-recents">'+last.map(o=>{
    const amount=Math.max(0,Number(o.amount||0)-Number(o.waivedOffAmount||0));
    return '<article class="bpv2-recent"><span class="bpv2-recent-icon">'+ic('bill')+'</span>'+
     '<span class="bpv2-recent-body"><strong>'+safe(o.code||'POS Bill')+'</strong><small>'+safe(o.customerName||'Walk-in')+'</small>'+
     (o.posVisit?'<small class="bpv2-visit-tag">'+safe(o.posVisit.visit_type==='takeaway'?'Takeaway':'Dine-in · '+o.posVisit.guest_count+' people')+'</small>':'')+
     (o.receipt?'<button type="button" class="bpv2-receipt-link" data-bpv2-receipt="'+safe(o.id)+'" data-bpv2-payment-id="'+safe(o.receipt.id)+'">Daily Book · '+safe(o.receipt.date)+'</button>':'')+'</span>'+
     '<strong class="bpv2-amount">'+money(amount)+'</strong>'+
     '<button type="button" data-bpv2-print="'+safe(o.id)+'" aria-label="Open bill '+safe(o.code||'')+'">'+ic('forward')+'</button></article>';
   }).join('')+'</div>':'<p class="bpv2-empty">No POS bills recorded today. Tap <strong>New POS Bill</strong> to begin.</p>');
 }
 function render(input){
  if(!input||!input.restaurantId)return;
  current={restaurantId:input.restaurantId,userId:input.userId,client:input.client,orders:Array.isArray(input.orders)?input.orders.map(o=>({...o})):[]};
  paint();
 }
 root.BitePOSV2={render,dateKey,numbers,activeView:()=>view};
})(window);
