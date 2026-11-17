/* Bite Owner V3 · screenshot-matched Home and Orders, driven by current tenant data.
   No mock metrics and no direct writes to orders, financials or hotel rooms. */
(function(root){
 'use strict';
 let currentState=null,currentAccess=null,timer=null,lastHomeSignature='',searchTerm='';
 const icons={
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  bag:'<path d="M5 8h14l1.7 12H3.3L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  bed:'<rect x="3" y="10" width="18" height="8" rx="2"/><path d="M3 18v3m18-3v3M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/>',
  rupee:'<path d="M6 4h12M6 8h12M6 4c4 0 7 2 7 5s-3 5-7 5l9 7"/>',
  receipt:'<path d="M5 2h14v20l-3-2-4 2-4-2-3 2V2Z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
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
  return root.BiteOwnerConfirmations?.snapshot?.(currentAccess?.restaurantId)
    ?.filter(r=>r.state==='pending'&&secondsLeft(r.expires_at)>0).sort((a,b)=>Date.parse(a.expires_at)-Date.parse(b.expires_at))||[];
 }
 function summary(){
  const core=root.BiteDashboard;
  if(!core||!currentState||!currentAccess?.restaurantId)return null;
  return core.summarize(currentState,currentAccess.restaurantId);
 }
 function hotelSnapshot(){
  return root.BiteHospitality?.dashboardSnapshot?.()||null;
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
 function homeHtml(data,snap,waiting){
  const active=data?.active||[],statuses=data?.stages||{},paidNew=Number(statuses.Received||0);
  const hasHotel=!!snap?.hotel,hasFood=snap?.restaurant!==false;
  const todayOrders=data?.todayOrders?.length??0;
  const kpis=[
   keyCard("Today's orders",num(todayOrders),'bag','Real Bite website orders','is-purple'),
   keyCard("Online paid (net)",money(data?.todaySales||0),'rupee','Verified · refunds minus','is-green'),
   hasHotel?keyCard('Occupied rooms',num(snap?.occupied),'bed','Currently checked in','is-orange'):keyCard('Preparing',num(statuses.Preparing||0),'chef','Accepted + preparing','is-orange'),
   keyCard('POS billed',money(data?.todayPosBilled||0),'receipt','Not cash collected','is-blue')
  ];
  const quick=[];
  if(hasHotel&&permitted('hotel-register'))quick.push(actionLink('Check-in','hotel-register','bed'));
  if(hasHotel&&permitted('guests'))quick.push(actionLink('Guest search','guests','people'));
  if(permitted('pos'))quick.push(actionLink('New POS bill','pos','pos','data-bv3-new-pos="true"'));
  if(permitted('menu'))quick.push(actionLink('Menu','menu','chef'));
  if(!quick.length&&permitted('reports'))quick.push(actionLink('Reports','reports','chart'));
  const counts=[
   {name:'New',value:paidNew,route:'new',icon:'bag'},
   {name:'Preparing',value:Number(statuses.Preparing||0),route:'preparing',icon:'chef'},
   {name:'Ready',value:Number(statuses.Ready||0),route:'ready',icon:'ready'},
   {name:'Delivered',value:Number(data?.delivered||0),route:'completed',icon:'check'}
  ];
  const roomSub=hasHotel?(snap?.ready===false?'Room data loading…':num(snap?.occupied)+' occupied · '+num(snap?.available)+' available'):'Restaurant operations';
  const roomCard=hasHotel?'<div class="bv3-bottom-panel"><div class="bv3-card-title"><strong>Room status</strong><button data-bv3-route="rooms" type="button">'+icon('arrow')+'</button></div>'+
   '<div class="bv3-room"><span class="bv3-room-dot is-occupied"></span>Occupied<strong>'+num(snap?.occupied)+'</strong></div>'+
   '<div class="bv3-room"><span class="bv3-room-dot is-available"></span>Available<strong>'+num(snap?.available)+'</strong></div>'+
   (root.BiteHospitality?.housekeepingVisible?.()===true?'<div class="bv3-room"><span class="bv3-room-dot is-clean"></span>Cleaning<strong>'+num(snap?.cleaning)+'</strong></div>':'')+
   '</div>':'';
  const weekly='<div class="bv3-bottom-panel bv3-sales"><div class="bv3-card-title"><strong>7-day online paid trend</strong><button data-bv3-route="reports" type="button">'+icon('arrow')+'</button></div>'+
   chartSvg(data?.week)+'<small>Paid orders only; POS excluded</small></div>';
  return '<div class="bv3-intro"><span class="bv3-owner-mark">B</span><span><strong>'+escapeHtml(propertyName())+'</strong><small>Hotel &amp; restaurant control</small></span><button type="button" class="bv3-bell" data-bv3-route="orders" data-bv3-filter="new" aria-label="Open new order notifications">'+icon('bell')+
   (waiting.length?'<i>'+waiting.length+'</i>':'')+'</button></div>'+
   attentionCard(waiting,paidNew)+
   '<div class="bv3-section-label">Business snapshot <span>Today · Live data</span></div>'+
   '<section class="bv3-kpis" aria-label="Today business statistics">'+kpis.join('')+'</section>'+
   '<div class="bv3-section-label">Quick actions</div>'+
   '<section class="bv3-shortcuts" aria-label="Quick owner actions">'+quick.join('')+'</section>'+
   '<section class="bv3-insights">'+roomCard+weekly+'</section>'+
   (hasFood?'<section class="bv3-flow"><div class="bv3-flow-head"><strong>Live order status</strong><button type="button" data-bv3-route="orders">View all →</button></div>'+
      '<div class="bv3-flow-grid">'+counts.map(c=>'<button type="button" data-bv3-route="orders" data-bv3-filter="'+c.route+'">'+icon(c.icon)+'<span>'+escapeHtml(c.name)+'</span><b>'+num(c.value)+'</b></button>').join('')+'</div></section>':'')+
   '<p class="bv3-finance-note">Online paid, POS billed and cash received are separate. See Cashbook for collections.</p>';
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
  if(!currentState||currentAccess?.role!=='owner'||!currentAccess.restaurantId)return;
  const home=root.document.getElementById('biteV3Home');if(!home)return;
  const data=summary(),snap=hotelSnapshot(),waiting=approvals();
  if(!data)return;
  const signature=JSON.stringify([currentAccess.restaurantId,data.todayOrders.length,data.active.map(o=>[o.id,o.status]),
    data.todaySales,data.todayPosBilled,data.todayExpenses,(data.week||[]).map(x=>x.amount),snap?.occupied,snap?.available,snap?.ready,
    waiting.map(x=>[x.intent_id,x.state,x.expires_at,x.amount])]);
  if(force||signature!==lastHomeSignature){lastHomeSignature=signature;home.innerHTML=homeHtml(data,snap,waiting);}
  home.hidden=false;
  root.document.body.classList.add('bite-v3-active');
  updateOrderBadge(waiting.length);
  tick();
 }
 function updateOrderBadge(count){
  const nav=root.document.getElementById('biteOwnerBottomNav');
  const orders=nav?.querySelector('[data-bite-page="orders"]');
  if(orders){
   let badge=orders.querySelector('.bv3-nav-badge');
   if(!badge){badge=root.document.createElement('span');badge.className='bv3-nav-badge';orders.append(badge);}
   badge.textContent=count>9?'9+':String(count);
   badge.hidden=!count;
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
 function route(page,filter,newPos){
  if(!permitted(page))return;
  if(newPos&&page==='pos'&&typeof root.openPosFromOverview==='function'){
   void Promise.resolve(root.openPosFromOverview(null));return;
  }
  if(typeof root.showPage!=='function')return;
  void Promise.resolve(root.showPage(page)).then(()=>{
   if(page==='orders'&&filter&&typeof root.setOrderStatus==='function')root.setOrderStatus(filter);
   if(page==='orders')root.BiteOwnerConfirmations?.refresh?.();
  }).catch(e=>root.console?.warn?.('Owner route unavailable',e));
 }
 function onClick(e){
  if(currentAccess?.role!=='owner')return;
  const button=e.target.closest?.('[data-bv3-review],[data-bv3-route]');
  if(!button||!button.closest('#biteV3Home'))return;
  if(button.dataset.bv3Review){
   const id=button.dataset.bv3Intent,decision=button.dataset.bv3Review;
   if(decision==='rejected'&&!root.confirm('Reject this request? Customer has not paid yet.'))return;
   for(const peer of button.closest('.bv3-attention-actions').querySelectorAll('button'))peer.disabled=true;
   Promise.resolve(root.BiteOwnerConfirmations?.review?.(id,decision)).finally(()=>renderHome(true));
   return;
  }
  if(button.dataset.bv3Route)route(button.dataset.bv3Route,button.dataset.bv3Filter,button.dataset.bv3NewPos==='true');
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
  root.document.addEventListener('bite:owner-confirmations-updated',e=>{
   if(e.detail?.restaurantId===currentAccess?.restaurantId){
    renderHome(true);
    updateOrderSearch();
   }
  });
  root.addEventListener?.('bite:owner-summary',()=>renderHome(true));
  root.addEventListener?.('bite:capabilities',()=>renderHome(true));
  if(!timer)timer=root.setInterval(()=>{if(root.document.visibilityState!=='hidden')tick();},1000);
  root.document.addEventListener('visibilitychange',()=>{if(root.document.visibilityState==='visible')renderHome(true);});
 }
 function refresh(state,access){
  currentState=state;currentAccess=access;
  if(root.document?.body?.dataset?.role!=='owner'||access?.role!=='owner'){
   root.document?.body?.classList.remove('bite-v3-active');return;
  }
  initialize();renderHome();renderOrdersHeader();
 }
 function afterOrdersRender(){if(currentAccess?.role==='owner'){renderOrdersHeader();renderHome();}}
 root.BiteOwnerReferenceV3={refresh,afterOrdersRender,refreshHome:()=>renderHome(true),search:()=>updateOrderSearch(),timeLabel};
})(window);
