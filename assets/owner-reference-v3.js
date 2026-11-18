/* Bite Owner V3 · screenshot-matched Home and Orders, driven by current tenant data.
   No mock metrics and no direct writes to orders, financials or hotel rooms. */
(function(root){
 'use strict';
 let currentState=null,currentAccess=null,timer=null,lastHomeSignature='',searchTerm='';
 let roomRecoveryProperty='',roomRecoveryAccess=null,roomRecoveryAttempted=false,roomRecoveryError=false;
 // H02/H03 one selected business day; never cache another owner's data on screen.
 let selectedFinanceProperty='',selectedFinanceDay='',financeRequest=0;
 let financeQuery={key:'',status:'idle',value:null,error:'',loadedAt:0};
 function todayBusinessDay(){return root.BiteOwner?.day?.()||new Date().toISOString().slice(0,10);}
 function businessDay(){
  const id=root.BiteHospitality?.prop?.()?.id||'no-property',today=todayBusinessDay();
  if(selectedFinanceProperty!==id){selectedFinanceProperty=id;selectedFinanceDay=today;}
  if(!selectedFinanceDay||selectedFinanceDay>today)selectedFinanceDay=today;
  return selectedFinanceDay;
 }
 function homeFinanceKey(){return [root.BiteHospitality?.prop?.()?.id||'',currentAccess?.restaurantId||'',businessDay()].join('|');}
 function loadHomeFinance(force=false){
  const property=root.BiteHospitality?.prop?.(),day=businessDay(),key=homeFinanceKey();
  if(!property?.id||currentAccess?.role!=='owner'||!permitted('daily-book')||
     typeof root.BiteHotelAccounts?.reportOwnerHomeDay!=='function'||root.BiteHotelAccounts?.enabled?.()!==true)return;
  const now=Date.now();
  if(financeQuery.key!==key)financeQuery={key,status:'idle',value:null,error:'',loadedAt:0};
  if(!force&&(
   financeQuery.status==='loading'||
   (financeQuery.status==='ready'&&now-financeQuery.loadedAt<60000)||
   (financeQuery.status==='error'&&now-financeQuery.loadedAt<20000)))return;
  const request=++financeRequest;
  financeQuery={key,status:'loading',value:null,error:'',loadedAt:now};
  Promise.resolve().then(()=>root.BiteHotelAccounts.reportOwnerHomeDay(day)).then(result=>{
   if(financeRequest!==request||homeFinanceKey()!==key||currentAccess?.role!=='owner'||
      root.document?.body?.dataset?.role!=='owner')return;
   if(result?.propertyId!==property.id||result?.day!==day)
    throw Error('Received a report for a different business or date.');
   financeQuery={key,status:'ready',value:result,error:'',loadedAt:Date.now()};
   renderHome(true);
  }).catch(error=>{
   if(financeRequest!==request||homeFinanceKey()!==key||currentAccess?.role!=='owner')return;
   financeQuery={key,status:'error',value:null,error:String(error?.message||error),loadedAt:Date.now()};
   renderHome(true);
  });
 }

 const icons={
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  bag:'<path d="M5 8h14l1.7 12H3.3L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  bed:'<rect x="3" y="10" width="18" height="8" rx="2"/><path d="M3 18v3m18-3v3M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/>',
  rupee:'<path d="M6 4h12M6 8h12M6 4c4 0 7 2 7 5s-3 5-7 5l9 7"/>',
  receipt:'<path d="M5 2h14v20l-3-2-4 2-4-2-3 2V2Z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  book:'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1z"/><path d="M12 5v15"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  chef:'<path d="M7 14a4 4 0 0 1 0-8 5 5 0 0 1 10 0 4 4 0 0 1 0 8"/><path d="M7 14v5h10v-5"/>',
  ready:'<path d="M3 17h18M5 16a7 7 0 0 1 14 0"/><path d="M12 9V6"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  arrow:'<path d="m9 5 7 7-7 7"/>',
  alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5m0 4h.01"/>',
  pos:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h5M7 17h10"/>',
  people:'<circle cx="9" cy="8" r="3"/><path d="M3 21a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5"/>',
  chart:'<path d="M4 20V4m0 16h16"/><path d="m7 16 4-4 3 2 5-8"/>',
  spark:'<path d="m12 2 2.4 7.4L22 12l-7.6 2.6L12 22l-2.4-7.4L2 12l7.6-2.6Z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>'
 };
 function icon(id,cls=''){return '<svg class="'+cls+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(icons[id]||icons.spark)+'</svg>';}
 const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const money=value=>'₹'+Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 const num=value=>value==null||!Number.isFinite(Number(value))?'—':String(value);
 const secondsLeft=deadline=>Math.max(0,Math.ceil((Date.parse(String(deadline||''))-Date.now())/1000)||0);
 function timeLabel(deadline){const s=secondsLeft(deadline);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
 function permitted(route){
  const p=root.BiteHospitality?.prop?.();
  const allowed=p?root.BiteHospitality?.routeList?.({role:'owner',property:p}):null;
  return Array.isArray(allowed)?allowed.includes(route):['overview','orders','pos','menu','reports'].includes(route);
 }
 function propertyName(){
  const prop=root.BiteHospitality?.prop?.();
  if(prop?.name)return prop.name;
  return (currentState?.restaurants||[]).find(r=>r.id===currentAccess?.restaurantId)?.name||'Your restaurant';
 }
 function approvals(){
  // A hotel-only property has no outlet: never show restaurant notices from a prior tenant.
  if(hotelSnapshot()?.restaurant===false)return [];
  return root.BiteOwnerConfirmations?.snapshot?.(currentAccess?.restaurantId)
    ?.filter(r=>r.state==='pending'&&secondsLeft(r.expires_at)>0).sort((a,b)=>Date.parse(a.expires_at)-Date.parse(b.expires_at))||[];
 }
 function summary(){
  const core=root.BiteDashboard;
  if(!core||!currentState||!currentAccess?.restaurantId||hotelSnapshot()?.restaurant===false)return null;
  return core.summarize(currentState,currentAccess.restaurantId);
 }
 function hotelSnapshot(){
  return root.BiteHospitality?.dashboardSnapshot?.()||null;
 }
 // An initial Owner/Home render can precede hotel workspace hydration, particularly
 // on slower mobile networks. Retry a missing *read-only* snapshot once per property.
 // The existing hospitality backend and role-scoped RPC remain the only sources of truth.
 function recoverRoomSnapshot(snap){
  const property=root.BiteHospitality?.prop?.();
  if(!property?.id||!snap?.hotel||currentAccess?.role!=='owner')return;
  if(roomRecoveryProperty!==property.id||roomRecoveryAccess!==currentAccess){
   roomRecoveryProperty=property.id;roomRecoveryAccess=currentAccess;
   roomRecoveryAttempted=false;roomRecoveryError=false;
  }
  if(snap.ready){roomRecoveryError=false;return;}
  if(roomRecoveryAttempted||typeof root.setTimeout!=='function')return;
  roomRecoveryAttempted=true;
  const selectedProperty=property.id,selectedAccess=currentAccess;
  root.setTimeout(async()=>{
   if(root.BiteHospitality?.prop?.()?.id!==selectedProperty||
      currentAccess!==selectedAccess||root.document?.body?.dataset?.role!=='owner')return;
   if(root.BiteHospitality?.dashboardSnapshot?.()?.ready)return;
   try{
    await root.BiteHospitality?.reload?.();
   }catch(error){
    if(root.BiteHospitality?.prop?.()?.id!==selectedProperty||currentAccess!==selectedAccess)return;
    roomRecoveryError=true;
    root.console?.warn?.('Owner V3 hotel count refresh unavailable',error);
   }finally{
    if(root.BiteHospitality?.prop?.()?.id===selectedProperty&&currentAccess===selectedAccess)
     renderHome(true);
   }
  },3500);
 }
 function actionLink(label,route,key,extra=''){
  return '<button type="button" class="bv3-shortcut" data-bv3-route="'+escapeHtml(route)+'" '+(extra||'')+'>'+
   '<span class="bv3-shortcut-icon">'+icon(key)+'</span><span>'+escapeHtml(label)+'</span></button>';
 }
 function keyCard(label,value,ico,sub,cls=''){
  return '<article class="bv3-kpi '+cls+'"><span class="bv3-kpi-icon">'+icon(ico)+'</span>'+
   '<small>'+escapeHtml(label)+'</small><strong>'+escapeHtml(value)+'</strong><span>'+escapeHtml(sub)+'</span></article>';
 }
 function chartSvg(week){
  const amounts=(week||[]).map(d=>Math.max(0,Number(d.amount||0)));
  if(amounts.length!==7||!amounts.some(n=>n>0))return '<div class="bv3-no-trend">No verified online payments this week</div>';
  const max=Math.max(1,...amounts),width=280,height=70;
  const pts=amounts.map((v,i)=>[Math.round(i*width/6),Math.round(height-8-v/max*(height-17))]);
  const path=pts.map(([x,y],i)=>(i?'L':'M')+x+' '+y).join(' ');
  const area=path+' L280 70 L0 70 Z';
  return '<svg class="bv3-sales-line" role="img" aria-label="Verified online paid sales during last seven days" viewBox="0 0 280 70" preserveAspectRatio="none"><path d="'+area+'" fill="#f99b3533"/><path d="'+path+'" fill="none" stroke="#f77910" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>'+pts.map(([x,y])=>'<circle cx="'+x+'" cy="'+y+'" r="3.3" fill="#fff" stroke="#f77910" stroke-width="2"/>').join('')+'</svg>';
 }
 function attentionCard(list,paidNew){
  if(list.length){
   const r=list[0],total=list.length,items=Array.isArray(r.priced_items)?r.priced_items:[];
   return '<section class="bv3-attention" aria-label="Pending customer confirmations">'+
    '<div class="bv3-attention-head"><span>'+icon('alert')+' Action Center</span><b>'+total+' pending</b></div>'+
    '<div class="bv3-attention-name"><strong>New order confirmation</strong><span class="bv3-timer" data-bv3-until="'+escapeHtml(r.expires_at)+'">'+icon('clock')+' '+timeLabel(r.expires_at)+'</span></div>'+
    '<div class="bv3-attention-order"><span><strong>#'+escapeHtml(String(r.intent_id||'').slice(0,8).toUpperCase())+'</strong><small>'+escapeHtml(r.customer_name||'Customer')+' · '+items.length+' items</small></span><strong>'+money(r.amount)+'</strong></div>'+
    '<div class="bv3-attention-meta"><span>'+icon('bag')+' '+escapeHtml(r.delivery_type==='pickup'?'Takeaway':'Delivery')+'</span><span>Payment not collected</span></div>'+
    '<div class="bv3-attention-actions"><button type="button" class="bv3-reject" data-bv3-review="rejected" data-bv3-intent="'+escapeHtml(r.intent_id)+'">Reject</button>'+
    '<button type="button" class="bv3-accept" data-bv3-review="approved" data-bv3-intent="'+escapeHtml(r.intent_id)+'">'+icon('check')+' Approve for payment</button></div>'+
    (total>1?'<button type="button" class="bv3-view-rest" data-bv3-route="orders" data-bv3-filter="new">+'+(total-1)+' more requests · View all →</button>':'')+'</section>';
  }
  if(paidNew){
   return '<section class="bv3-quiet is-active">'+icon('bell')+'<span><strong>'+paidNew+' new paid order'+(paidNew>1?'s':'')+'</strong><small>Ready for kitchen · open Orders to start cooking</small></span><button type="button" data-bv3-route="orders" data-bv3-filter="new">Open →</button></section>';
  }
  return '<section class="bv3-quiet">'+icon('check')+'<span><strong>All caught up</strong><small>No customer confirmation waiting right now</small></span><button type="button" data-bv3-route="orders">Orders →</button></section>';
 }

 function monthRegisterSummary(){
  const workspace=root.BiteHospitality?.getWorkspace?.(),snap=hotelSnapshot();
  if(!snap?.hotel||!snap.ready)return {label:'',count:null};
  const today=root.BiteOwner?.day?.()||new Date().toISOString().slice(0,10);
  const month=today.slice(0,7);
  const label=new Intl.DateTimeFormat('en-IN',{month:'short',timeZone:'Asia/Kolkata'}).format(new Date(month+'-15T12:00:00+05:30'));
  const records=(workspace?.stays||[]).filter(stay=>{
   const register=stay.registration||{};
   const date=String(register.entry_date||(register.registered_at?root.BiteOwner?.day?.(register.registered_at):'')||stay.arrival||'');
   return date.startsWith(month)&&['in_house','checked_out'].includes(stay.status);
  });
  return {label,count:records.length};
 }
 function noticeEntries(data,waiting){
  const approvals=waiting.map(item=>({id:'approval:'+item.intent_id,kind:'approval',title:'Order approval needed',
    subtitle:'#'+String(item.intent_id||'').slice(0,8).toUpperCase()+' · '+String(item.customer_name||'Customer'),route:'orders',filter:'new'}));
  const snap=hotelSnapshot();
  const checkouts=permitted('checkouts')?(root.BiteHospitality?.checkoutDue?.()||[]).map(stay=>{const db=root.BiteHospitality.getWorkspace(),guest=db.guests.find(g=>g.id===stay.guest_id),room=db.rooms.find(r=>r.id===stay.room_id),folio=db.folios.find(f=>f.stay_id===stay.id);return {id:'checkout:'+stay.id,kind:'checkout',title:stay.departure<root.BiteOwner.day()?'Overdue checkout':'Checkout today',subtitle:(guest?.full_name||'Guest')+' · Room '+(room?.number||'—'),route:folio?'folios':'checkouts',folioId:folio?.id}}):[];
  if(snap?.restaurant===false)return checkouts.concat(approvals);
  const pid=currentAccess?.restaurantId;
  const verified=root.BiteOwnerOrderBurst?.paidOrderIds?.(currentState?.financials||[],pid);
  const paid=(data?.active||[]).filter(order=>order.status==='Received'&&verified?.has?.(order.id));
  return checkouts.concat(approvals,paid.map(order=>({id:'paid:'+order.id,kind:'paid',title:'New paid Bite order',
   subtitle:'#'+String(order.code||order.id||'').slice(0,14),route:'orders',filter:'new'})));
 }
 let notificationList=[],noticeOpen=false;
 function paintNoticeTray(){
  const tray=root.document?.getElementById('biteOwnerNoticeTray');
  const bell=root.document?.getElementById('biteV3HeaderBell');
  if(!tray||!bell)return;
  tray.hidden=!noticeOpen;
  bell.setAttribute('aria-expanded',String(noticeOpen));
  if(!noticeOpen)return;
  tray.innerHTML='<header class="boh-notice-head"><strong>Notifications</strong><button type="button" data-bv3-close-notices aria-label="Close notifications">×</button></header>'+
   (notificationList.length?'<div class="boh-notice-list">'+notificationList.map((n,i)=>'<button type="button" class="boh-notice-item" data-bv3-notice-index="'+i+'"><span class="boh-notice-symbol">'+icon(n.kind==='paid'?'bag':'clock')+'</span><span><strong>'+escapeHtml(n.title)+'</strong><small>'+escapeHtml(n.subtitle)+'</small></span>'+icon('arrow')+'</button>').join('')+'</div>':
   '<p class="boh-notice-empty">No notifications right now.</p>');
 }
 function setNotices(items){
  notificationList=items;
  updateOrderBadge(items.length,items.filter(n=>n.kind!=='checkout').length);
  if(noticeOpen)paintNoticeTray();
 }
 function toggleNoticeTray(force){
  noticeOpen=typeof force==='boolean'?force:!noticeOpen;
  paintNoticeTray();
 }
 function featureCard(tone,route,title,ico,sub,action='',extra=''){
  if(!permitted(route))return '';
  return '<button type="button" class="boh-feature boh-'+tone+'" data-bv3-route="'+escapeHtml(route)+'" '+extra+'>'+
   '<span class="boh-card-illustration" aria-hidden="true"></span>'+
   '<span class="boh-feature-icon">'+icon(ico)+'</span><strong>'+escapeHtml(title)+'</strong>'+
   (sub?'<small>'+escapeHtml(sub)+'</small>':'')+
   (action?'<span class="boh-card-cta">'+escapeHtml(action)+' '+icon('arrow')+'</span>':'<span class="boh-feature-arrow">'+icon('arrow')+'</span>')+
   '</button>';
 }
 function checkinCard(snap){
  if(!permitted('hotel-register'))return '';
  const card=featureCard('checkin','hotel-register','Check-in','people','New guest / family','Open check-in');
  return '<article class="boh-checkin-checkout">'+card+(permitted('checkouts')?'<button type="button" class="boh-checkout-link" data-bv3-route="checkouts" aria-label="Open checkouts due"><span>Checkout today</span><b data-checkout-count>'+num(snap?.ready?snap.departures:null)+'</b>'+icon('arrow')+'</button>':'')+'</article>';
 }
 function roomStatusCard(snap){
  if(!snap?.hotel||!permitted('rooms'))return '';
  const ready=snap.ready===true,hk=root.BiteHospitality?.housekeepingVisible?.()===true;
  return '<button type="button" class="boh-feature boh-room" data-bv3-route="rooms" aria-label="Open Room Status'+(ready?'':', room data still loading. Open to retry')+'">'+
   '<span class="boh-card-illustration" aria-hidden="true"></span><span class="boh-feature-icon">'+icon('bed')+'</span>'+
   '<strong>Room Status</strong>'+
   '<span class="boh-room-stat"><span class="boh-dot is-occupied"></span>Occupied <b>'+num(ready?snap.occupied:null)+'</b></span>'+
   '<span class="boh-room-stat"><span class="boh-dot is-available"></span>Available <b>'+num(ready?snap.available:null)+'</b></span>'+
   (hk?'<span class="boh-room-stat"><span class="boh-dot is-cleaning"></span>Cleaning <b>'+num(ready?snap.cleaning:null)+'</b></span>':'')+
   (!ready?'<span class="boh-room-sync" role="status">'+(roomRecoveryError?'Room data sync failed · Tap to retry':'Syncing room data · Tap to retry')+'</span>':'')+
   '</button>';
 }
 function quickLink(label,route,ico,tone='',extra=''){
  if(!permitted(route))return '';
  return '<button type="button" class="boh-quick boh-quick-'+tone+'" data-bv3-route="'+escapeHtml(route)+'" '+extra+'>'+
   '<span class="boh-quick-icon">'+icon(ico)+'</span><strong>'+escapeHtml(label)+'</strong></button>';
 }
 // PDF H01–H03 / stage 1. Render one Home for mobile AND desktop.
 // Only report money which the current read-only source can actually establish.
 // Full cross-source Sales/Received/Due/Expenses reconciliation is staged in A02/A03.
 function pdfMetric(label,value,description,routeName){
  const allowed=routeName&&permitted(routeName),tag=allowed?'button':'article';
  return '<'+tag+(allowed?' type="button" data-bv3-route="'+escapeHtml(routeName)+'"':'')+
   ' class="bv3-pdf-metric" aria-label="'+escapeHtml(label+' · '+(value==='—'?'Not yet reconciled':value))+'">'+
   '<span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong><small>'+escapeHtml(description)+'</small>'+
   (allowed?'<span class="bv3-pdf-metric-arrow" aria-hidden="true">›</span>':'')+'</'+tag+'>';
 }
 function pdfRow(title,subtitle,routeName,kind=''){
  const allowed=routeName&&permitted(routeName),tag=allowed?'button':'div';
  return '<'+tag+(allowed?' type="button" data-bv3-route="'+escapeHtml(routeName)+'"':'')+
   ' class="bv3-pdf-row'+(kind?' bv3-pdf-row-'+escapeHtml(kind):'')+'"><span class="bv3-pdf-row-copy"><strong>'+
   escapeHtml(title)+'</strong><small>'+escapeHtml(subtitle)+'</small></span>'+
   (allowed?'<span class="bv3-pdf-open" aria-hidden="true">Open ›</span>':'')+'</'+tag+'>';
 }
 function pdfHomeFinance(data,snap){
  const matching=financeQuery.key===homeFinanceKey(),report=matching&&financeQuery.status==='ready'?financeQuery.value:null;
  const historical=businessDay()!==todayBusinessDay();
  // A Restaurant-only site may not have the Hotel/Hybrid day-book enabled:
  // retain its verified today summary, but never display today's totals for a past date.
  const restaurantReady=!report&&!permitted('daily-book')&&!snap?.hotel&&!historical&&!!data&&!!currentAccess?.restaurantId;
  const restaurantSales=restaurantReady&&Number.isFinite(Number(data.todayPosBilled))&&Number.isFinite(Number(data.todaySales))
   ?money(Number(data.todayPosBilled)+Number(data.todaySales)):'—';
  const restaurantExpenses=restaurantReady&&Number.isFinite(Number(data.todayExpenses))?money(data.todayExpenses):'—';
  const receiptRoute=permitted('daily-book')?'daily-book':permitted('cashbook')?'cashbook':null;
  const dueRoute=permitted('folios')?'folios':permitted('khata')?'khata':null;
  const loading=matching&&financeQuery.status==='loading';
  return [
   pdfMetric('Sales',report?money(report.sales):restaurantSales,
    report?'Issued bills · selected service date':loading?'Loading recorded sales…':restaurantReady?'Restaurant POS and paid Bite orders':'Cross-source sales unavailable','reports'),
   pdfMetric('Received',report?money(report.received):'—',
    report?'Posted customer receipts · excludes deposits':loading?'Loading confirmed receipts…':'Collection source verification pending',receiptRoute),
   pdfMetric('Due','—','As-of-date receivables reconciliation pending',dueRoute),
   pdfMetric('Expenses',report?money(report.expenses):restaurantExpenses,
    report?'Recorded costs · selected expense date':loading?'Loading recorded expenses…':restaurantReady?'Restaurant expenses today':'Cross-source expenses unavailable','expenses')
  ].join('');
 }
 function homeHtml(data,snap,waiting){
  const ws=root.BiteHospitality?.getWorkspace?.()||{},hotel=!!snap?.hotel&&permitted('rooms'),
   today=todayBusinessDay(),selectedDay=businessDay(),historical=selectedDay!==today,
   totalRooms=snap?.ready?(ws.rooms||[]).filter(r=>r.active).length:null,
   blocked=snap?.ready?(ws.rooms||[]).filter(r=>r.active&&(r.housekeeping==='blocked'||r.status==='blocked')).length:null,
   checkoutRows=hotel&&permitted('checkouts')&&snap?.ready?(root.BiteHospitality?.checkoutDue?.()||[]):[],
   approvalCount=waiting.length;
  const paidIds=root.BiteOwnerOrderBurst?.paidOrderIds?.(currentState?.financials||[],currentAccess?.restaurantId);
  const paidNew=permitted('orders')?(data?.active||[]).filter(o=>o.status==='Received'&&paidIds?.has?.(o.id)).length:0;
  const finance=pdfHomeFinance(data,snap),financeReady=financeQuery.key===homeFinanceKey()&&financeQuery.status==='ready';
  const financeStatus=financeQuery.key===homeFinanceKey()?financeQuery.status:'idle';
  const financeNotice='<p class="bv3-pdf-finance-note" role="status">'+
   (financeReady?'Selected-day accounting uses the existing authorized Daily Book. Received excludes refundable deposits and internal transfers.':
    financeStatus==='error'?'Accounts unavailable for this date. No zero has been assumed. <button type="button" class="bv3-pdf-retry" data-bv3-retry-finance="true">Retry accounts</button>':
    'Sales = billed services, Received = confirmed collections, Due = unpaid balances. Cross-source totals show — until linked accounting is verified; no sample amounts are used.')+
   '</p>';
  const orderRows=permitted('orders')?
    (approvalCount?pdfRow(approvalCount+' customer request'+(approvalCount===1?'':'s')+' awaiting approval','Payment not collected · Today','orders','urgent'):'')+
    (paidNew?pdfRow(paidNew+' new paid Bite order'+(paidNew===1?'':'s'),'Verified online payment · Today','orders','urgent'):'')+
    (!approvalCount&&!paidNew?'<p class="bv3-pdf-empty">No verified new orders requiring attention.</p>':''):
    '<p class="bv3-pdf-empty">Orders module is not enabled for this property.</p>';
  const checkout=permitted('checkouts')&&hotel?
    (!snap?.ready?'<p class="bv3-pdf-empty">Loading checkout information…</p>':
     checkoutRows.length?checkoutRows.slice(0,2).map(s=>{
      const room=(ws.rooms||[]).find(r=>r.id===s.room_id);
      return pdfRow('Checkout due · Room '+(room?.number||'—'),
       (s.departure&&s.departure<today?'Overdue · ':'')+'Open guest bill to review balance',
       'checkouts','attention');
     }).join(''): '<p class="bv3-pdf-empty">No checkouts currently due.</p>'):'';
  const arrival=hotel&&permitted('reservations')?
    pdfRow(snap?.ready?String(snap.arrivals??0)+' arrival'+(snap.arrivals===1?'':'s')+' due':'Arrivals loading',
     'Review reservations and check-in availability','reservations'):'';
  const rooms=hotel?'<section class="bv3-pdf-panel bv3-pdf-room-panel" aria-label="Rooms summary">'+
   '<div class="bv3-pdf-panel-head"><h2>Rooms'+(totalRooms===null?'':' / '+totalRooms)+(historical?' · Live today':'')+'</h2>'+
   '<button type="button" data-bv3-route="rooms">Open rooms ›</button></div>'+
   '<div class="bv3-pdf-room-stats">'+
   [['Occupied',snap?.ready?snap.occupied:null],['Ready',snap?.ready?snap.available:null],
    ...(root.BiteHospitality?.housekeepingVisible?.()?[['Cleaning',snap?.ready?snap.cleaning:null]]:[]),
    ['Blocked',blocked]].map(([label,value])=>'<div><span>'+label+'</span><b>'+num(value)+'</b></div>').join('')+
   '</div>'+(!snap?.ready?'<p class="bv3-pdf-empty">'+(roomRecoveryError?'Room data sync failed. Open Rooms to retry.':'Room data syncing…')+'</p>':'')+
   '</section>':'';
  const recent=[];
  if(permitted('pos')&&currentAccess?.restaurantId){
   const latest=(currentState?.orders||[]).filter(o=>o.restaurant===currentAccess.restaurantId&&!o.isDemo&&/^POS - /i.test(String(o.channel||'')))
    .sort((x,y)=>new Date(y.createdAt||0)-new Date(x.createdAt||0))[0];
   if(latest)recent.push(pdfRow('POS bill · '+(latest.code||String(latest.id||'').slice(0,8)),
    'Open saved bill and payment history','pos'));
  }
  if(hotel&&snap?.ready){
   const lastAudit=(ws.audit||[]).find(a=>a.action);
   if(lastAudit)recent.push(pdfRow('Hotel activity · '+lastAudit.action,'See property activity and guest records','guests'));
  }
  const quickRoutes=[
   ['Orders','orders',''],
   ['New POS bill','pos','data-bv3-new-pos="true"'],
   ['New check-in','hotel-register',''],
   ['Daily Book','daily-book',''],
   ['Reports','reports','']
  ];
  const quick=quickRoutes.filter(([,routeName])=>permitted(routeName)).map(([title,routeName,extra])=>
   '<button type="button" class="bv3-pdf-quick" data-bv3-route="'+routeName+'" '+extra+'>'+escapeHtml(title)+' <span aria-hidden="true">›</span></button>').join('');
  return '<div class="bv3-pdf-home" data-pdf-screen="H02-H03" aria-label="Bite Owner V3 single workspace">'+
    '<header class="bv3-pdf-heading"><div><p class="bv3-pdf-kicker">BITE OWNER · '+(historical?'SELECTED DAY':'TODAY')+' <span class="bv3-pdf-today">'+(historical?'HISTORICAL':'LIVE')+'</span></p>'+
    '<h1>'+escapeHtml(propertyName())+'</h1><small>'+escapeHtml(selectedDay)+(historical?' · Historical accounts; live alerts remain today':' · Enabled business departments')+'</small></div>'+
    (permitted('daily-book')?'<div class="bv3-pdf-date-controls"><label class="bv3-pdf-date-field">Business date<input type="date" data-bv3-business-day="true" value="'+escapeHtml(selectedDay)+'" max="'+escapeHtml(today)+'" aria-label="Selected business date"></label><button type="button" class="bv3-pdf-date-link" data-bv3-date-today="true">Today</button></div>':'')+'</header>'+
    '<section class="bv3-pdf-metrics" aria-label="Business financial summary">'+finance+'</section>'+financeNotice+
    '<div class="bv3-pdf-columns"><div class="bv3-pdf-main-column">'+
    '<section class="bv3-pdf-panel"><div class="bv3-pdf-panel-head"><h2>Live orders</h2><span class="bv3-pdf-today">Today</span></div>'+orderRows+'</section>'+
    (hotel?'<section class="bv3-pdf-panel"><div class="bv3-pdf-panel-head"><h2>Arrivals &amp; checkouts</h2>'+(permitted('checkouts')?'<span data-checkout-count>'+num(snap?.ready?snap.departures:null)+'</span>':'')+'</div>'+checkout+arrival+'</section>':'')+
    '</div><div class="bv3-pdf-side-column">'+rooms+
    '<section class="bv3-pdf-panel"><div class="bv3-pdf-panel-head"><h2>Recent activity</h2></div>'+
    (recent.length?recent.join(''):'<p class="bv3-pdf-empty">No recent activity available in this session.</p>')+'</section></div></div>'+
    (quick?'<section class="bv3-pdf-quick-section"><h2>Quick actions</h2><div class="bv3-pdf-quick-grid">'+quick+'</div></section>':'')+
   '</div>';
 }
 const legacyHomeDisplays=new WeakMap();
 function syncLegacyHomeVisibility(){
  const doc=root.document;
  if(!doc?.querySelectorAll)return;
  const compact=doc.body?.dataset?.role==='owner' &&
   !!doc.body?.classList?.contains?.('bite-v3-active');
  for(const element of doc.querySelectorAll('#overview > [data-owner-dashboard], #overview > [data-platform-dashboard], #overview > #bitePremiumHome, #overview > #biteHotelHome')){
   if(compact){
    if(!legacyHomeDisplays.has(element))legacyHomeDisplays.set(element,{
     value:element.style.getPropertyValue('display'),
     priority:element.style.getPropertyPriority('display')
    });
    // Legacy role/finance refreshes can set inline display!important.
    // A scoped CSS override alone cannot beat that inline declaration.
    element.style.setProperty('display','none','important');
   }else if(legacyHomeDisplays.has(element)){
    const prior=legacyHomeDisplays.get(element);
    if(prior.value)element.style.setProperty('display',prior.value,prior.priority);
    else element.style.removeProperty('display');
    legacyHomeDisplays.delete(element);
   }
  }
 }
 function tick(){
  const home=root.document?.getElementById('biteV3Home');
  if(!home||home.hidden)return;
  const chips=home.querySelectorAll('[data-bv3-until]');
  for(const chip of chips){
   const remaining=secondsLeft(chip.dataset.bv3Until);
   chip.innerHTML=icon('clock')+' '+timeLabel(chip.dataset.bv3Until);
   chip.classList.toggle('is-urgent',remaining<=60);
   if(!remaining){for(const button of home.querySelectorAll('[data-bv3-review]'))button.disabled=true;}
  }
  if(chips.length&&[...chips].every(el=>secondsLeft(el.dataset.bv3Until)===0))renderHome(true);
 }
 function renderHome(force=false){
  if(!currentState||currentAccess?.role!=='owner'||(!currentAccess.restaurantId&&!root.BiteHospitality?.prop?.()))return;
  const home=root.document.getElementById('biteV3Home');if(!home)return;
  const data=summary()||{active:[],todayOrders:[],stages:{},week:[],todaySales:0,todayPosBilled:0,todayExpenses:0},snap=hotelSnapshot(),waiting=approvals();
  recoverRoomSnapshot(snap);
  loadHomeFinance();
  const headerBell=root.document.getElementById('biteV3HeaderBell');if(headerBell)headerBell.hidden=false;
  const notices=noticeEntries(data,waiting),register=monthRegisterSummary();
  const signature=JSON.stringify([root.BiteHospitality?.prop?.()?.id,currentAccess.restaurantId,data.todayOrders.length,data.active.map(o=>[o.id,o.status]),
    data.todaySales,data.todayPosBilled,data.todayExpenses,(data.week||[]).map(x=>x.amount),snap?.occupied,snap?.available,snap?.arrivals,snap?.openFolios,snap?.cleaning,snap?.restaurant,snap?.ready,root.BiteHospitality?.housekeepingVisible?.(),
    waiting.map(x=>[x.intent_id,x.state,x.expires_at,x.amount]),notices.map(n=>n.id),register.label,register.count,roomRecoveryError,businessDay(),financeQuery.status,financeQuery.key,financeQuery.value?.received,financeQuery.value?.sales,financeQuery.value?.expenses,root.BiteHospitality?.prop?.()?.tax_profile?.gstin]);
  if(force||signature!==lastHomeSignature){lastHomeSignature=signature;home.innerHTML=homeHtml(data,snap,waiting);}
  home.hidden=false;
  const overview=root.document.getElementById('overview');
  if(overview)overview.dataset.biteHomeCompact='true';
  root.document.body.classList.add('bite-v3-active');
  syncLegacyHomeVisibility();
  setNotices(notices);
  tick();
 }
 function updateOrderBadge(count,orderCount=count){
  const topBell=root.document.getElementById('biteV3HeaderBell');
  if(topBell){const badge=topBell.querySelector('i');if(badge){badge.textContent=count>9?'9+':String(count);badge.hidden=!count;}}
  const nav=root.document.getElementById('biteOwnerBottomNav');
  const orders=nav?.querySelector('[data-bite-page="orders"]');
  if(orders){
   let badge=orders.querySelector('.bv3-nav-badge');
   if(!badge){badge=root.document.createElement('span');badge.className='bv3-nav-badge';orders.append(badge);}
   badge.textContent=orderCount>9?'9+':String(orderCount);
   badge.hidden=!orderCount;
  }
 }
 function updateOrderSearch(){
  const board=root.document.getElementById('orderBoard');
  const queue=root.document.getElementById('biteOwnerApprovalQueue');
  const cards=[...(board?.querySelectorAll('.order-card')||[]),...(queue?.querySelectorAll('.bite-approval-card')||[])];
  let visible=0;
  for(const card of cards){
   const haystack=(card.textContent||'').toLowerCase();
   const matches=haystack.includes(searchTerm.trim().toLowerCase());
   card.classList.toggle('bv3-search-hidden',!matches);
   if(matches)visible++;
  }
  const empty=root.document.getElementById('bv3SearchEmpty');
  if(empty)empty.hidden=!searchTerm||visible>0;
 }
 function renderOrdersHeader(){
  const doc=root.document,orders=doc.getElementById('orders'),main=orders?.querySelector('.orders-main-column');
  if(!orders||!main||!currentAccess||currentAccess.role!=='owner')return;
  let heading=doc.getElementById('biteV3OrdersHeading');
  if(!heading){
   heading=doc.createElement('header');heading.id='biteV3OrdersHeading';heading.className='bv3-orders-heading';
   heading.innerHTML='<span><strong>Orders</strong><small>Customer requests and kitchen queue</small></span>'+
    '<span class="bv3-live-state" id="bv3LivePill">Connecting</span>';
   main.prepend(heading);
  }
  const liveText=doc.getElementById('orderLiveState')?.textContent||'';
  const indicator=doc.getElementById('bv3LivePill');
  const live=/connected|live|subscribed/i.test(liveText)&&!/disconnected|not connected|offline|connecting/i.test(liveText);
  if(indicator){indicator.textContent=live?'● Live':'◌ Updating';indicator.classList.toggle('is-live',live);}
  const stages=doc.getElementById('biteOwnerOrderStages');
  let toolbar=doc.getElementById('biteV3OrderTools');
  if(!toolbar&&stages){
   toolbar=doc.createElement('div');toolbar.id='biteV3OrderTools';toolbar.className='bv3-order-tools';
   toolbar.innerHTML='<label class="bv3-order-search">'+icon('search')+'<input type="search" id="bv3OrderSearch" placeholder="Search Order ID, customer or item" autocomplete="off" aria-label="Search restaurant orders"></label>'+
    '<label class="bv3-order-filter">'+icon('chart')+'<select id="bv3StageSelect" aria-label="Filter order status"><option value="all">All</option><option value="new">New</option><option value="preparing">Preparing</option><option value="ready">Ready</option><option value="delivery">Delivery</option><option value="completed">Delivered</option><option value="cancelled">Cancelled</option></select></label>'+
    '<div class="bv3-search-empty" id="bv3SearchEmpty" hidden>No matching order on this screen</div>';
   stages.insertAdjacentElement('afterend',toolbar);
   // Date-wise records remain available, but the giant calendar toolbar
   // does not consume screen space unless the owner asks for it.
   const calendar=doc.getElementById('biteOwnerOrderCalendar');
   if(calendar){
    const details=doc.createElement('details');
    details.id='bv3DateDisclosure';details.className='bv3-date-disclosure';
    const summary=doc.createElement('summary');summary.textContent='Date-wise orders and calendar';
    details.append(summary,calendar);toolbar.insertAdjacentElement('afterend',details);
   }
   const input=toolbar.querySelector('input');
   input.addEventListener('input',()=>{searchTerm=input.value;updateOrderSearch();});
   toolbar.querySelector('select').addEventListener('change',event=>{
    if(typeof root.setOrderStatus==='function')root.setOrderStatus(event.target.value);
   });
  }
  const selected=stages?.querySelector('[data-bite-stage].active')?.dataset.biteStage||'new';
  const stageSelect=toolbar?.querySelector('select');
  if(stageSelect&&[...stageSelect.options].some(o=>o.value===selected))stageSelect.value=selected;
  updateOrderSearch();
 }
 function focusNotificationOrder(item){
  if(!item?.id||!root.document)return;
  const approval=item.kind==='approval',orderId=String(item.id).slice(item.id.indexOf(':')+1);
  const list=approval?'#biteOwnerApprovalQueue [data-bite-approval-id]':'#orderBoard .order-card[data-order-id]';
  const attribute=approval?'biteApprovalId':'orderId';
  const target=()=>[...root.document.querySelectorAll(list)].find(el=>el.dataset?.[attribute]===orderId);
  let observer=null,deadline=null;
  function reveal(){
   const card=target();
   if(!card)return false;
   observer?.disconnect();if(deadline)root.clearTimeout(deadline);
   card.classList.add('boh-notice-target');
   card.setAttribute('tabindex','-1');
   card.scrollIntoView?.({behavior:'smooth',block:'center'});
   card.focus?.({preventScroll:true});
   return true;
  }
  if(reveal())return;
  const parent=root.document.getElementById('orders');
  if(!parent||typeof root.MutationObserver!=='function')return;
  observer=new root.MutationObserver(reveal);
  observer.observe(parent,{subtree:true,childList:true});
  deadline=root.setTimeout(()=>observer?.disconnect(),5000);
 }
 function route(page,filter,newPos,notification){
  if(!permitted(page))return;
  if(page==='daily-book')root.BiteHotelAccounts?.selectOwnerHomeMonth?.(businessDay());
  if(notification?.folioId&&page==='folios'){void root.BiteHospitality.openFolio(notification.folioId);return;}
  if(newPos&&page==='pos'&&typeof root.openPosFromOverview==='function'){
   void Promise.resolve(root.openPosFromOverview(null));return;
  }
  if(typeof root.showPage!=='function')return;
  void Promise.resolve(root.showPage(page)).then(()=>{
   if(page==='orders'&&filter&&typeof root.setOrderStatus==='function')root.setOrderStatus(filter);
   if(page==='orders'){
    root.BiteOwnerConfirmations?.refresh?.();
    if(notification)focusNotificationOrder(notification);
   }
   if(page==='hr'&&typeof root.BiteOwnerHRTabs?.activate==='function'&&filter==='attendance')root.BiteOwnerHRTabs.activate(root.document,'attendance');
   if(page==='daily-book'&&filter==='gst')root.document.querySelector('#daily-book [data-ha-action="gst"]')?.scrollIntoView?.({block:'center',behavior:'smooth'});
  }).catch(e=>root.console?.warn?.('Owner route unavailable',e));
 }
 function onClick(e){
  if(currentAccess?.role!=='owner')return;
  const button=e.target.closest?.('[data-bv3-review],[data-bv3-route],[data-bv3-date-today],[data-bv3-retry-finance]');
  if(!button||!button.closest('#biteV3Home'))return;
  if(button.dataset.bv3DateToday==='true'){
   selectedFinanceDay=todayBusinessDay();financeRequest++;financeQuery={key:'',status:'idle',value:null,error:'',loadedAt:0};
   renderHome(true);return;
  }
  if(button.dataset.bv3RetryFinance==='true'){
   financeQuery={key:'',status:'idle',value:null,error:'',loadedAt:0};
   loadHomeFinance(true);renderHome(true);return;
  }
  if(button.dataset.bv3Review){
   const id=button.dataset.bv3Intent,decision=button.dataset.bv3Review;
   if(decision==='rejected'&&!root.confirm('Reject this request? Customer has not paid yet.'))return;
   for(const peer of button.closest('.bv3-attention-actions').querySelectorAll('button'))peer.disabled=true;
   Promise.resolve(root.BiteOwnerConfirmations?.review?.(id,decision)).finally(()=>renderHome(true));
   return;
  }
  if(button.dataset.bv3Route)route(button.dataset.bv3Route,button.dataset.bv3Attendance==='true'?'attendance':button.dataset.bv3Gst==='true'?'gst':button.dataset.bv3Filter,button.dataset.bv3NewPos==='true');
 }
 function onHomeBusinessDateChange(event){
  const input=event.target;
  if(!input?.matches?.('[data-bv3-business-day]')||currentAccess?.role!=='owner')return;
  const chosen=String(input.value||''),today=todayBusinessDay();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(chosen)||chosen>today||
     (!Number.isFinite(Date.parse(chosen+'T12:00:00Z'))||new Date(chosen+'T12:00:00Z').toISOString().slice(0,10)!==chosen)){
   input.value=businessDay();return;
  }
  if(chosen===businessDay())return;
  selectedFinanceDay=chosen;
  financeRequest++;financeQuery={key:'',status:'idle',value:null,error:'',loadedAt:0};
  renderHome(true);
 }
 function initialize(){
  if(root.document?.getElementById('biteV3Home'))return;
  const overview=root.document?.getElementById('overview');
  if(!overview)return;
  const home=root.document.createElement('section');
  home.id='biteV3Home';home.className='bite-v3-home';home.hidden=true;
  home.setAttribute('aria-label','Bite owner command center');
  overview.prepend(home);
  home.addEventListener('click',onClick);
  home.addEventListener('change',onHomeBusinessDateChange);
  const header=root.document.querySelector('#mainApp>.main>.top');
  if(header&&!root.document.getElementById('biteV3HeaderBell')){
   const bell=root.document.createElement('button');
   bell.type='button';bell.id='biteV3HeaderBell';bell.className='bv3-header-bell';
   bell.setAttribute('aria-label','Open notifications');
   bell.setAttribute('aria-haspopup','true');
   bell.setAttribute('aria-expanded','false');
   bell.innerHTML=icon('bell')+'<i hidden>0</i>';
   bell.addEventListener('click',()=>toggleNoticeTray());
   header.append(bell);
   const tray=root.document.createElement('section');
   tray.id='biteOwnerNoticeTray';tray.className='boh-notice-tray';tray.hidden=true;
   tray.setAttribute('aria-label','Hotel and order notifications');tray.setAttribute('role','region');
   root.document.querySelector('#mainApp>.main')?.append(tray);
   tray.addEventListener('click',e=>{
    if(e.target.closest?.('[data-bv3-close-notices]')){toggleNoticeTray(false);return;}
    const button=e.target.closest?.('[data-bv3-notice-index]');
    if(!button)return;
    const item=notificationList[Number(button.dataset.bv3NoticeIndex)];
    toggleNoticeTray(false);
    if(item)route(item.route,item.filter,false,item);
   });
   root.document.addEventListener('click',e=>{
    if(noticeOpen&&!e.target.closest?.('#biteOwnerNoticeTray,#biteV3HeaderBell'))toggleNoticeTray(false);
   });
   root.document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&noticeOpen)toggleNoticeTray(false);
   });
  }
  root.document.addEventListener('bite:owner-confirmations-updated',e=>{
   if(e.detail?.restaurantId===currentAccess?.restaurantId){
    renderHome(true);
    updateOrderSearch();
   }
  });
  root.addEventListener?.('bite:owner-summary',()=>renderHome(true));
  // Capabilities are observed at module scope so Hotel-only owners can bootstrap V3.
  if(!timer)timer=root.setInterval(()=>{if(root.document.visibilityState!=='hidden')tick();},1000);
  root.document.addEventListener('visibilitychange',()=>{if(root.document.visibilityState==='visible')renderHome(true);});
 }
 function ensureOwnerHome(){
  // Hotel-only owners do not have a restaurantId and therefore do not always
  // enter the restaurant dashboard refresh path. Initialize on property context.
  const doc=root.document,property=root.BiteHospitality?.prop?.();
  if(!doc||doc.body?.dataset?.role!=='owner'||!property||!doc.getElementById('overview'))return;
  if(!currentAccess||currentAccess.role!=='owner')currentAccess={role:'owner',restaurantId:null};
  if(!currentState)currentState={orders:[],financials:[],expenses:[]};
  initialize();
  renderHome(true);
 }
 root.addEventListener?.('bite:capabilities',ensureOwnerHome);
 root.addEventListener?.('resize',syncLegacyHomeVisibility);
 if(root.document?.readyState==='loading'){
  root.document.addEventListener('DOMContentLoaded',ensureOwnerHome,{once:true});
 }else ensureOwnerHome();
 function refresh(state,access){
  currentState=state;currentAccess=access;
  if(root.document?.body?.dataset?.role!=='owner'||access?.role!=='owner'){
   financeRequest++;financeQuery={key:'',status:'idle',value:null,error:'',loadedAt:0};selectedFinanceProperty='';selectedFinanceDay='';
   toggleNoticeTray(false);
   root.document?.body?.classList.remove('bite-v3-active');
   syncLegacyHomeVisibility();
   const bell=root.document?.getElementById('biteV3HeaderBell');if(bell)bell.hidden=true;
   return;
  }
  initialize();const bell=root.document?.getElementById('biteV3HeaderBell');if(bell)bell.hidden=false;
  renderHome();renderOrdersHeader();
 }
 function afterOrdersRender(){if(currentAccess?.role==='owner'){renderOrdersHeader();renderHome();}}
 root.BiteOwnerReferenceV3={refresh,afterOrdersRender,refreshHome:()=>renderHome(true),search:()=>updateOrderSearch(),timeLabel};
})(window);
