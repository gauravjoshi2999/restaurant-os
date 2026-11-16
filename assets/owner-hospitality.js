/* Hotel/property workspaces inside the existing Bite Owner app. No payment gateway. */
(function(root){
 'use strict';
 const C=root.BiteCapabilities;
 const titles={'hotel-register':'Hotel Register','reservations':'Reservations','rooms':'Rooms','guests':'Guests','folios':'Folios & Bills','housekeeping':'Housekeeping','business-modules':'Business Modules','room-service':'Room service'};
 let ctx,properties=[],data=empty(),workspaceReady=false,selectedFolio=null,loadVersion=0,poll=null,setupStep=1,setupDraft=null,activeWrites=0,reportFrom='',reportTo='';
 function empty(){return {rooms:[],guests:[],stays:[],groups:[],folios:[],entries:[],audit:[],members:[],expenses:[]}}
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 const today=()=>root.BiteOwner.day();
 const datePlus=n=>{const d=new Date(today()+'T12:00:00+05:30');d.setDate(d.getDate()+n);return root.BiteOwner.day(d)};
 const prop=()=>ctx?.getAccess().property||null;
 const has=cap=>C.has(prop(),cap);
 const identity=()=>[ctx?.getUser()?.id,prop()?.id].join(':');
 const restaurantAccess=()=>!!ctx?.getAccess().restaurantId;
 const allowed=()=>prop()?.role==='cashier'?['overview','pos',...(has('room_service')?['room-service']:[])]:C.routes(prop(),restaurantAccess());
 const $=id=>document.getElementById(id);
 const btn=(action,label,id='',extra='')=>`<button type="button" class="btn secondary" data-hotel-action="${action}" data-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
 const field=(name,label,type='text',value='',extra='')=>`<label class="bh-field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
 const select=(name,label,options,extra='')=>`<label class="bh-field"><span>${esc(label)}</span><select name="${name}" ${extra}>${options}</select></label>`;
 const option=(value,label,selected=false)=>`<option value="${esc(value)}" ${selected?'selected':''}>${esc(label)}</option>`;
 const notice=()=>'<p class="bh-message" role="status" aria-live="polite"></p>';
 const header=(title,detail,actions='')=>`<div class="bh-heading"><div><p class="bh-eyebrow">${esc(prop()?.name||'Bite Partner')}</p><h1>${esc(title)}</h1><p>${esc(detail)}</p></div><div class="bh-actions">${actions}</div></div>`;
 const stateCard=(text)=>`<div class="bh-empty">${esc(text)}</div>`;
 function init(context){
  ctx=context;root.BiteOwnerOperations?.init(context);
  const content=document.querySelector('#mainApp .main>.content');if(!content)return;
  for(const [id,title] of Object.entries(titles)){
   if(!$(id)){const s=document.createElement('section');s.id=id;s.className='page bh-workspace';s.hidden=true;s.setAttribute('aria-label',title);content.append(s)}
  }
  const home=document.createElement('div');home.id='biteHotelHome';home.className='bh-workspace';home.hidden=true;$('overview')?.prepend(home);
  const nav=document.querySelector('#mainApp .nav');
  if(nav&&!$('biteHotelNav')){
   const g=document.createElement('div');g.id='biteHotelNav';g.className='nav-group';g.hidden=true;
   g.innerHTML='<div class="nav-label">HOTEL OPERATIONS</div>'+C.hotel.map(([id,label])=>`<button type="button" data-page="${id}"><span class="nav-icon" aria-hidden="true">${id==='rooms'?'▤':'▧'}</span><span class="nav-text">${esc(label)}</span></button>`).join('');
   nav.prepend(g);g.addEventListener('click',e=>{const b=e.target.closest('button[data-page]');if(b)void ctx.navigate(b.dataset.page)});
  }
  if(!$('bitePropertySelect')){
   const holder=document.createElement('label');holder.className='bh-property-switch';holder.hidden=true;holder.innerHTML='<span class="sr-only">Current property</span><select id="bitePropertySelect" aria-label="Current property"></select>';
   document.querySelector('#mainApp .main>.top')?.append(holder);
   $('bitePropertySelect').addEventListener('change',async e=>{const id=e.target.value;try{await ctx.switchProperty(id)}catch(err){e.target.value=prop()?.id||'';showError(err)}});
  }
  const settings=$('settings');if(settings&&!$('biteModulesShortcut')){
   const box=document.createElement('div');box.id='biteModulesShortcut';box.className='card bh-module-shortcut';
   box.innerHTML='<div><strong>Business modules</strong><p>Property type, rooms, restaurant modules and access.</p></div>'+btn('modules','Manage modules');settings.prepend(box);
  }
  const alert=document.createElement('button');alert.id='biteHotelOrderAlert';alert.type='button';alert.hidden=true;alert.className='bh-order-alert';alert.addEventListener('click',()=>void ctx.navigate('orders'));
  document.querySelector('#mainApp .main>.top')?.append(alert);
  content.addEventListener('click',handleClick);content.addEventListener('submit',handleSubmit);
  content.addEventListener('input',e=>{
   const search=e.target.closest('[data-hotel-search]');if(search)filterCards(search);
   const form=e.target.closest('#bhCheckinForm');if(form){form.dataset.reviewed='';form.querySelector('.bh-review')?.remove();persistDraft(form)}
  });
  root.addEventListener('online',()=>{if(has('hotel_rooms'))void reload().catch(showError)});
  startPolling();
 }
 function startPolling(){if(!poll)poll=root.setInterval(()=>{if(document.visibilityState==='visible'&&!!prop()&&!document.querySelector('.bh-workspace form:focus-within'))void reload().catch(()=>{});syncOrderBadge()},30000)}
 async function loadContext(){
  const {data:rows,error}=await ctx.sb.rpc('bite_owner_context');
  if(error){
   // Deploy compatibility: only an absent new RPC permits the legacy shell.
   if(['PGRST202','42883'].includes(error.code)){properties=[];return []}
   throw error;
  }
  properties=Array.isArray(rows)?rows:[];
  return properties;
 }
 function preferredProperty(userId){
  let saved;try{saved=localStorage.getItem('bite_property_v1:'+userId)}catch{}
  return properties.find(p=>p.id===saved)||properties[0]||null;
 }
 function setProperty(property){
  root.BiteOwnerOperations?.clear();loadVersion++;data=empty();workspaceReady=false;selectedFolio=null;setupDraft=null;setupStep=1;reportFrom='';reportTo='';
  if(property)try{localStorage.setItem('bite_property_v1:'+ctx.getUser().id,property.id)}catch{}
  startPolling();
  // Clear the old property immediately, before any new network response.
  for(const id of Object.keys(titles))if($(id))$(id).replaceChildren();
  applyShell();
 }
 function routeList(access){return access.role==='owner'?(access.property?allowed():access.needsProperty?['overview','business-modules','settings']:null):null}
 function applyShell(){
  const p=prop(),owner=ctx.getAccess().role==='owner';
  if(!owner||!p){delete document.body.dataset.businessType;delete document.body.dataset.universalOwner;delete document.body.dataset.restaurantAccess;if($('biteHotelHome'))$('biteHotelHome').hidden=true;
   if($('bitePropertySelect')){$('bitePropertySelect').replaceChildren();$('bitePropertySelect').closest('label').hidden=true}
   if($('biteModulesShortcut'))$('biteModulesShortcut').hidden=true;
   document.body.dataset.ownerOnboarding=String(owner&&ctx.getAccess().needsProperty===true);
   if(owner&&ctx.getAccess().needsProperty)document.querySelectorAll('#mainApp .nav button[data-page]').forEach(b=>{b.hidden=true;b.style.display='none'});
   return}
  document.body.dataset.businessType=p.business_type;document.body.dataset.universalOwner='true';
  delete document.body.dataset.ownerOnboarding;
  document.body.dataset.restaurantAccess=String(restaurantAccess());
  const pages=allowed();
  document.querySelectorAll('#mainApp .nav button[data-page]').forEach(b=>{const ok=pages.includes(b.dataset.page);b.hidden=!ok;b.style.display=ok?'flex':'none'});
  document.querySelectorAll('#mainApp .nav-group').forEach(g=>{const visible=[...g.querySelectorAll('button')].some(b=>!b.hidden);g.hidden=!visible;g.style.display=visible?'':'none'});
  if($('biteModulesShortcut'))$('biteModulesShortcut').hidden=!p.can_configure;
  const select=$('bitePropertySelect');if(select){select.innerHTML=properties.map(x=>option(x.id,x.name,x.id===p.id)).join('');select.closest('label').hidden=!properties.length}
  if($('ownerSidebarRestaurant'))$('ownerSidebarRestaurant').textContent=p.name;
  if($('accountRole'))$('accountRole').textContent=p.role.toUpperCase().replaceAll('_',' ');
  if($('biteHotelHome'))$('biteHotelHome').hidden=!has('hotel_rooms')&&restaurantAccess();
  if(p.role==='cashier')renderHome();
  // The restaurant home remains the canonical food workspace in hybrid mode.
  document.querySelectorAll('#overview [data-owner-dashboard]').forEach(e=>{if(p.business_type==='hotel'||p.role==='cashier')e.style.setProperty('display','none','important')});
  root.dispatchEvent(new Event('bite:capabilities'));
  syncOrderBadge();
 }
 function dashboardSnapshot(){
  const property=prop();
  if(!property)return null;
  const canHotel=has('hotel_rooms'),canOrders=has('online_food_orders')&&restaurantAccess();
  const snapshot={ready:!canHotel||workspaceReady,hotel:canHotel,restaurant:canOrders,
   occupied:null,available:null,arrivals:null,departures:null,cleaning:null,openFolios:null,newOrders:null};
  if(canHotel&&workspaceReady){
   const rooms=data.rooms.filter(r=>r.active);
   const active=data.stays.filter(s=>s.status==='in_house');
   const todayString=today();
   const occupiedRoomIds=new Set(active.map(s=>s.room_id));
   snapshot.occupied=rooms.filter(r=>r.occupied||occupiedRoomIds.has(r.id)).length;
   snapshot.available=rooms.filter(r=>roomState(r)==='ready').length;
   snapshot.cleaning=rooms.filter(r=>['dirty','cleaning'].includes(r.housekeeping)).length;
   snapshot.arrivals=data.stays.filter(s=>s.status==='reserved'&&s.arrival<=todayString).length;
   snapshot.departures=active.filter(s=>s.departure<=todayString).length;
   snapshot.openFolios=data.folios.filter(f=>f.status==='open').length;
  }
  if(canOrders){
   const state=ctx?.getState()||{},orders=state.orders||[],rid=ctx.getAccess().restaurantId;
   const verified=root.BiteOwnerOrderBurst?.paidOrderIds;
   if(typeof verified==='function'){
    const paid=verified(state.financials||[],rid);
    snapshot.newOrders=orders.filter(o=>o.restaurant===rid&&!o.isDemo&&o.status==='Received'&&paid.has(o.id)&&/own platform|website|web/i.test(String(o.channel||''))&&!/^POS/i.test(String(o.channel||''))).length;
   }
  }
  return snapshot;
 }
 function syncOrderBadge(){
  const e=$('biteHotelOrderAlert');if(!e)return;
  const state=ctx?.getState()||{},orders=state.orders||[],rid=ctx.getAccess().restaurantId,paid=root.BiteOwnerOrderBurst?.paidOrderIds(state.financials||[],rid)||new Set();
  const count=orders.filter(o=>o.restaurant===rid&&!o.isDemo&&o.status==='Received'&&paid.has(o.id)&&/own platform|website|web/i.test(String(o.channel||''))&&!/^POS/i.test(String(o.channel||''))).length;
  e.hidden=!count||!has('online_food_orders');e.textContent=count+' new food order'+(count===1?'':'s');
 }
 async function reload(){
  const p=prop();if(!p)return;
  const version=++loadVersion,pid=p.id;
  const {data:rows,error}=await ctx.sb.rpc('bite_hotel_workspace',{p_property:pid});
  if(version!==loadVersion||prop()?.id!==pid)return;
  if(error){if(error.code==='42501'){data=empty();workspaceReady=false;for(const id of Object.keys(titles))$(id)?.replaceChildren();root.BiteOwnerOperations?.clear()}throw error;}
  data={...empty(),...rows};workspaceReady=true;renderHome();
  if(typeof root.dispatchEvent==='function')root.dispatchEvent(new Event('bite:owner-summary'));
  const active=document.querySelector('#mainApp .page.active')?.id;
  if(active&&handles(active)&&!document.querySelector('#'+active+' form:focus-within'))renderPage(active);
 }
 function handles(id){return (!!prop()||ctx?.getAccess().needsProperty)&&(!!titles[id]||(!restaurantAccess()&&['reports','settings','hr','expenses','overview'].includes(id)))}
 async function open(id){
  if(!routeList(ctx.getAccess())?.includes(id))throw Error('Is property/role ko is section ki permission nahi hai.');
  if(titles[id])$('pageTitle').textContent=titles[id];
  const target=$(id);if(target&&id!=='overview')target.innerHTML=header(titles[id]||id,'Loading current property…')+notice();
  try{
   if(id!=='business-modules'&&prop())await reload();
   renderPage(id);
  }catch(e){if(target)target.innerHTML=header(titles[id]||id,'Data load nahi hua.')+stateCard(e.message)+btn('retry','Retry',id);throw e}
 }
 function roomState(room){
  if(!room.active)return 'inactive';
  if(room.occupied||data.stays.some(s=>s.room_id===room.id&&s.status==='in_house'))return 'occupied';
  if(room.housekeeping!=='ready')return room.housekeeping;
  if(data.stays.some(s=>s.room_id===room.id&&s.status==='reserved'&&s.arrival<=today()&&s.departure>today()))return 'reserved';
  return 'ready';
 }
 function renderHome(){
  const home=$('biteHotelHome');if(!home)return;
  if(prop()?.role==='cashier'){home.hidden=false;home.innerHTML=header('Cashier billing','Create a food bill or charge an occupied room.',btn('route','New POS bill','pos'));return}
  if(!has('hotel_rooms')){home.hidden=restaurantAccess();if(!restaurantAccess())home.innerHTML=header('Restaurant setup','Your restaurant needs approval and an outlet assignment before orders or billing can start.')+'<article class="bh-panel"><h2>'+esc(prop()?.name||'Your business')+'</h2><p>Review your business details, then contact Bite to connect the approved restaurant account.</p><div class="bh-actions">'+(prop()?.can_configure?btn('modules','Review business modules'):'')+'<a class="btn secondary" href="contact.html" target="_blank" rel="noopener">Contact Bite</a></div></article>';return}
  home.hidden=false;
  const active=data.stays.filter(s=>s.status==='in_house'),rooms=data.rooms.filter(r=>r.active),dirty=rooms.filter(r=>['dirty','cleaning'].includes(r.housekeeping)),due=active.filter(s=>s.departure<=today()),arrivals=data.stays.filter(s=>s.status==='reserved'&&s.arrival<=today());
  const balance=data.folios.reduce((n,f)=>n+Number(f.totals?.balance||0),0);
  home.innerHTML=header('Aaj ka front desk','Arrivals, ready rooms aur guest balances — ek jagah.',has('guest_register')?btn('register','＋ New check-in'):'')+
   '<div class="bh-metrics">'+[['Occupied',active.length+' / '+rooms.length],['Ready',rooms.filter(r=>roomState(r)==='ready').length],['Needs cleaning',dirty.length],['Folio balance',money(balance)]].map(([k,v])=>`<div class="bh-metric"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')+'</div>'+
   '<div class="bh-home-grid"><article class="bh-panel"><h2>Arrivals & checkouts</h2>'+ (arrivals.length||due.length?[...due.map(s=>stayCard(s,'Checkout due')),...arrivals.map(s=>stayCard(s,'Arrival'))].join(''):stateCard('No arrivals or checkouts due.'))+'</article><article class="bh-panel"><h2>Room readiness</h2>'+rooms.slice(0,8).map(r=>`<div class="bh-room-line"><strong>${esc(r.number)}</strong><span>${esc(r.room_type)}</span><span class="bh-chip ${roomState(r)}">${esc(roomState(r))}</span></div>`).join('')+(!rooms.length?stateCard('Add your rooms to start. No sample rooms have been created.'):'')+btn('route','View rooms','rooms')+'</article></div>'+
   (!prop().tax_profile?.reviewed?'<p class="bh-note">Tax setup needs review. Draft statements do not certify GST compliance. Configure rates in Business Modules.</p>':'');
 }
 function stayCard(s,tag=''){
  const g=data.guests.find(g=>g.id===s.guest_id),r=data.rooms.find(r=>r.id===s.room_id),f=data.folios.find(f=>f.stay_id===s.id),group=data.groups.find(g=>g.id===s.group_id);
  return `<article class="bh-record" data-hotel-search-card="${esc([g?.full_name,g?.phone,r?.number,s.status,group?.name].join(' ').toLowerCase())}"><div><strong>${esc(g?.full_name||'Guest')}</strong><span class="bh-chip ${esc(s.status)}">${esc(tag||s.status)}</span><p>Room ${esc(r?.number||'—')} · ${esc(s.arrival)} → ${esc(s.departure)}${group?'<br>Group: '+esc(group.name)+' · individual room folio':''}</p></div><div class="bh-actions">${s.status==='reserved'?btn('checkin','Check in',s.id):''}${f?btn('folio','View folio',f.id):''}${['reserved','in_house'].includes(s.status)?btn('stay-options','Manage stay',s.id):''}</div></article>`;
 }
 function renderPage(id){
  if(!prop()&&id!=='business-modules'){void ctx.navigate('business-modules');return}
  if(id==='overview'){if(!prop()){void ctx.navigate('business-modules');return}renderHome();return}
  if(id==='business-modules'){renderSetup();return}
  const target=$(id);if(!target)return;
  if(id==='room-service'){root.BiteOwnerOperations?.tasks(target,'room_service');return}
  if(id==='hotel-register'){renderRegister();return}
  if(id==='rooms'||id==='housekeeping'){
   target.innerHTML=header(id==='rooms'?'Rooms':'Housekeeping','Checkout leaves the room Dirty. Inspect and mark Ready before the next arrival.',['owner','manager'].includes(prop().role)?btn('new-room','＋ Add room'):'')+notice()+
    '<div class="bh-room-grid">'+data.rooms.map(r=>`<article class="bh-panel"><div class="bh-room-title"><h2>${esc(r.number)}</h2><span class="bh-chip ${roomState(r)}">${esc(roomState(r))}</span></div><p>${esc(r.room_type)} · Floor ${esc(r.floor||'—')}</p><p>${money(r.nightly_rate)} / night · ${r.adults} adults, ${r.children} children</p><p>${esc(r.status_note)}</p>${r.do_not_disturb?'<p class="bh-chip">Do Not Disturb · cleaning delayed</p>':''}${r.cleaning_requested?'<p class="bh-note">Stayover cleaning requested</p>':''}<div class="bh-actions">${r.active?btn('room-privacy','DND / cleaning request',r.id):''}${r.active?btn('room-status','Update status',r.id):''}${['owner','manager'].includes(prop().role)?btn('edit-room','Edit',r.id):''}</div></article>`).join('')+'</div>'+(!data.rooms.length?stateCard('No rooms yet. Add the real room numbers and rates to begin.'):'' );root.BiteOwnerOperations?.decorateRooms(target);return;
  }
  if(id==='reservations'){
   target.innerHTML=header('Reservations','Choose a stay to check in, extend, move or review its folio.',btn('register','＋ New reservation')+btn('group-booking','Group booking'))+notice()+searchBox('Search guest, room or status')+data.stays.map(s=>stayCard(s)).join('')+(!data.stays.length?stateCard('No reservations in this property.'):'' );return;
  }
  if(id==='guests'){
   target.innerHTML=header('Guests','Returning guest profiles remain separate from individual stays.')+searchBox('Search name or phone')+data.guests.map(g=>`<article class="bh-record" data-hotel-search-card="${esc([g.full_name,g.phone].join(' ').toLowerCase())}"><div><strong>${esc(g.full_name)}</strong><p>${esc(g.phone)} · ${esc(g.country)}</p></div><div class="bh-actions">${btn('guest-use','New stay',g.id)}${btn('edit-guest','Edit details',g.id)}</div></article>`).join('')+(!data.guests.length?stateCard('No guest profiles yet.'):'' );return;
  }
  if(id==='folios'){renderFolios();return}
  if(id==='reports'){renderReports(target);return}
  if(id==='settings'){
   target.innerHTML=header('Settings','Manage this property and its enabled business modules.')+`<article class="bh-panel"><h2>${esc(prop().name)}</h2><p>${esc(prop().address)}</p><p>${esc(prop().phone)}</p>${prop().can_configure?btn('modules','Business Modules'):stateCard('Only the property owner can change modules.')}</article>`;root.BiteOwnerOperations?.settings(target);return;
  }
  if(id==='hr'){renderStaffAccess(target);return}
  if(id==='expenses'){
   target.innerHTML=header('Expenses','Property expenses do not count as guest payments.')+notice()+data.expenses.map(e=>`<article class="bh-record"><div><strong>${esc(e.description)}</strong><p>${esc(e.expense_date)} · ${esc(e.method)}</p></div><strong>${money(e.amount)}</strong></article>`).join('')+`<form class="bh-panel bh-form" data-hotel-form="expense">${field('description','Expense','text','','required maxlength="250"')}${field('amount','Amount (₹)','number','','required min="0.01" step="0.01"')}${field('expense_date','Date','date',today(),'required')}${select('method','Paid by',['Cash','UPI','Card','Bank Transfer','Other'].map(m=>option(m,m)).join(''))}${notice()}<button class="btn" type="submit">Record expense</button></form>`;return;
  }
 }
 function renderStaffAccess(target,embedded=false){
  target.innerHTML=(embedded?'<h2>Property account access</h2>':header('Staff','Manage property access here. Attendance and payroll stay in their existing workspace.'))+notice()+data.members.map(m=>`<article class="bh-record"><div><strong>${esc(m.display_name||m.email||m.role)}</strong><p>${esc(m.email||'')} · ${esc(m.role)} · ${m.active?'Active':'Revoked'}</p></div>${m.role!=='owner'&&m.active?btn('revoke-member','Revoke access',m.user_id):''}</article>`).join('')+(prop().can_configure?`<form class="bh-panel bh-form" data-hotel-form="member"><h2>Staff account access</h2>${field('email','Staff email (registered account) *','email','','required maxlength="254" autocomplete="off"')}${select('role','Role',['manager','receptionist','cashier','housekeeping','accountant'].map(r=>option(r,r)).join(''))}${select('active','Access',option('true','Active')+option('false','Revoke'))}<p class="bh-note">The staff member signs up with this email first. Verify the email with them before granting access. Restaurant POS also needs its approved outlet assignment. This does not send an invitation.</p>${notice()}<button class="btn" type="submit">Save access</button></form>`:stateCard('Owner manages staff account access.'));
 }
 function searchBox(label){return `<label class="bh-field bh-search"><span>${esc(label)}</span><input type="search" data-hotel-search placeholder="Type to search…" autocomplete="off"></label>`}
 function filterCards(input){const q=input.value.trim().toLowerCase();input.closest('.page').querySelectorAll('[data-hotel-search-card]').forEach(e=>{e.hidden=!e.dataset.hotelSearchCard.includes(q)})}
 function renderRegister(guestId=''){
  let draft={};try{const raw=JSON.parse(localStorage.getItem('bite_register_draft:'+identity())||'null');if(raw&&Date.now()-raw.savedAt<86400000)draft=raw.fields}catch{}
  if(guestId)draft.guest_id=guestId;
  const g=data.guests.find(g=>g.id===draft.guest_id);
  $('hotel-register').innerHTML=header('Hotel Register','Search an existing guest or enter essential details, then review the room and dates.')+
   `<form id="bhCheckinForm" class="bh-form bh-panel" data-hotel-form="register" data-stay-id="${esc(draft.stay_id||'')}">
   <h2>1 · Guest</h2>${field('guest_search','Search returning guest by name / phone','search','','autocomplete="off" data-guest-search')}${select('guest_id','Returning guest',option('','New guest')+data.guests.map(g=>option(g.id,g.full_name+' · '+g.phone,g.id===draft.guest_id)).join(''),'data-guest-picker')}
   <div class="bh-form-grid">${field('full_name','Guest name *','text',g?.full_name||draft.full_name||'','required maxlength="120" autocomplete="name"')}${field('phone','Phone *','tel',g?.phone||draft.phone||'','required minlength="7" maxlength="20" inputmode="tel"')}${field('country','Nationality / country *','text',g?.country||draft.country||'India','required maxlength="60"')}${field('email','Email (optional)','email',g?.email||draft.email||'','maxlength="120"')}${field('address','Address','text',g?.address||draft.address||'','maxlength="500"')}${field('id_type','Identity type','text',g?.id_type||draft.id_type||'','maxlength="40"')}${field('id_last4','ID last 4 characters only','text',g?.id_last4||draft.id_last4||'','maxlength="4" autocomplete="off"')}</div>
   <p class="bh-note">Retain only necessary guest information. For a foreign guest, complete the required FRRO reporting separately; Bite does not submit Form III.</p>
   <h2>2 · Stay & room</h2><div class="bh-form-grid">${field('arrival','Arrival *','date',draft.arrival||today(),'required')}${field('departure','Departure *','date',draft.departure||datePlus(1),'required')}${field('adults','Adults *','number',draft.adults||1,'required min="1" max="20"')}${field('children','Children','number',draft.children||0,'required min="0" max="20"')}${select('room_id','Room *',option('','Choose a room')+data.rooms.filter(r=>r.active&&r.housekeeping!=='blocked').map(r=>option(r.id,r.number+' · '+r.room_type+' · '+money(r.nightly_rate)+'/night · '+roomState(r),r.id===draft.room_id)).join(''),'required')}${field('compliance_note','Compliance / arrival note','text',draft.compliance_note||'','maxlength="250"')}</div>
   ${select('mode','On confirmation',option('checkin','Check in now',draft.mode!=='reserve')+option('reserve','Reserve for later',draft.mode==='reserve'))}
   <p class="bh-note">Availability and room readiness are checked again by the server. No payment is collected by this form.</p>${notice()}<div class="bh-form-actions">${btn('save-draft','Save draft')}<button type="submit" class="btn">Review check-in</button></div></form>`;
  root.BiteOwnerOperations?.registerFields($('bhCheckinForm'),draft,g);
  $('bhCheckinForm').querySelector('[data-guest-picker]').addEventListener('change',e=>{
   const f=$('bhCheckinForm'),g=data.guests.find(g=>g.id===e.target.value);
   if(g&&f.elements.is_oci)f.elements.is_oci.checked=!!g.is_oci;
   if(g)for(const key of ['full_name','phone','country','email','address','id_type','id_last4'])f.elements[key].value=g[key]||'';
   f.dataset.stayId='';f.dataset.reviewed='';f.querySelector('.bh-review')?.remove();persistDraft(f);
  });
  $('bhCheckinForm').querySelector('[data-guest-search]').addEventListener('input',e=>{
   const q=e.target.value.trim().toLowerCase(),picker=$('bhCheckinForm').elements.guest_id,selected=picker.value;
   picker.innerHTML=option('','New guest')+data.guests.filter(g=>g.id===selected||[g.full_name,g.phone].join(' ').toLowerCase().includes(q)).slice(0,30).map(g=>option(g.id,g.full_name+' · '+g.phone,g.id===selected)).join('');
  });
  if(draft.stay_id){
   const form=$('bhCheckinForm');form.elements.guest_id.disabled=true;
   for(const key of ['full_name','phone','country','email','address','id_type','id_last4','guest_search'])form.elements[key].readOnly=true;
   form.querySelector('.bh-message').textContent='Reservation already saved. You can correct its room/dates before retrying check-in. Guest corrections are in Guests.';
  }
 }
 function persistDraft(form){
  try{const fields=Object.fromEntries(new FormData(form));fields.guest_id=form.elements.guest_id.value;fields.stay_id=form.dataset.stayId||'';localStorage.setItem('bite_register_draft:'+identity(),JSON.stringify({savedAt:Date.now(),fields}));return true}catch{return false}
 }
 function renderFolios(){
  const target=$('folios'),f=data.folios.find(f=>f.id===selectedFolio);
  if(!f){target.innerHTML=header('Folios & Bills','One statement per stay. Deposits and pending transfers remain separate.')+notice()+data.folios.map(f=>{
   const s=data.stays.find(s=>s.id===f.stay_id),g=data.guests.find(g=>g.id===s?.guest_id),r=data.rooms.find(r=>r.id===s?.room_id);
   return `<article class="bh-record"><div><strong>${esc(g?.full_name||'Guest folio')}</strong><p>Room ${esc(r?.number||'—')} · ${esc(f.status)}</p></div><strong>${money(f.totals?.balance)}</strong>${btn('folio','Open',f.id)}</article>`;
  }).join('')+(!data.folios.length?stateCard('Check in or reserve a guest to open a folio.'):'' );return}
  const s=data.stays.find(s=>s.id===f.stay_id),g=data.guests.find(g=>g.id===s?.guest_id),r=data.rooms.find(r=>r.id===s?.room_id),t=f.totals||{},entries=data.entries.filter(e=>e.folio_id===f.id);
  const writable=f.status==='open'&&['owner','manager','receptionist'].includes(prop().role);
  target.innerHTML=header(g?.full_name||'Guest folio','Room '+(r?.number||'—')+' · '+(s?.arrival||'')+' → '+(s?.departure||''),btn('folio-list','All folios'))+
   '<div class="bh-metrics">'+[['Charges',money(t.charges)],['Applied payments',money(t.paid)],['Balance due',money(t.balance)],['Held deposit',money(t.deposit_held)]].map(([k,v])=>`<div class="bh-metric"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')+'</div>'+notice()+
   (Number(t.pending)>0?`<p class="bh-note">${money(t.pending)} verification pending. Pending transfers do not settle this bill.</p>`:'')+
   '<div class="bh-ledger">'+entries.map(e=>`<article class="bh-record"><div><strong>${esc(e.description)}</strong><p>${esc(e.kind)} · ${esc(e.category)}${e.method?' · '+esc(e.method):''} · ${esc(e.status)}<br>${esc(new Date(e.created_at).toLocaleString('en-IN'))}</p>${e.source_order_id?'<small>Linked POS sale — collect here once</small>'+((e.source_items||[]).map(i=>'<p>'+esc(i.quantity)+' × '+esc(i.name)+' · '+money(i.unit_price)+'</p>').join('')):''}</div><strong>${['payment','advance','discount','reversal','deposit_apply'].includes(e.kind)?'−':''}${money(Number(e.amount)+Number(e.tax_amount||0))}</strong><div class="bh-actions">${writable&&e.status==='pending'&&['owner','manager'].includes(prop().role)?btn('verify-payment','Verify received',e.id)+btn('void-payment','Not received',e.id):''}${writable&&e.kind==='charge'&&['owner','manager'].includes(prop().role)&&!entries.some(x=>x.reversal_of===e.id)?btn('reverse',e.source_order_id?'Reverse food sale':'Reverse',e.id):''}</div></article>`).join('')+'</div>'+(!entries.length?stateCard('No charges yet. Room nights are posted once at check-in.'):'' )+
   `<div class="bh-actions bh-folio-actions">${writable?btn('entry','＋ Add charge','charge')+btn('entry','Collect payment','payment')+btn('entry','Deposit','deposit_hold')+btn('entry','Return deposit','deposit_return')+btn('entry','Apply deposit','deposit_apply'):''}${writable&&['owner','manager'].includes(prop().role)?btn('entry','Discount','discount')+btn('entry','Record credit refund','refund'):''}${writable&&['owner','manager'].includes(prop().role)?btn('split-bill','Split payer statements',f.id):''}${f.payer_split?'<p class="bh-note">Split: '+esc(f.payer_split.first_name)+' '+f.payer_split.first_percent+'% / '+esc(f.payer_split.second_name)+' '+(100-f.payer_split.first_percent)+'%. Receipts remain on this folio.</p>':''}${(f.invoice_snapshot?.splits||[]).map((x,i)=>btn('split-preview','Print '+x.guest.name,String(i))).join('')}${btn('preview','Preview / Print',f.id)}${btn('share','Share statement',f.id)}${writable&&s?.status==='in_house'?btn('checkout','Settle & Check Out',f.id):''}</div><div id="bhFolioEditor"></div>`;root.BiteOwnerOperations?.decorateFolio(target,f,s,g);
 }
 function reportEntries(){const from=reportFrom||today(),to=reportTo||today();return data.entries.filter(e=>{const d=root.BiteOwner.day(e.created_at);return d>=from&&d<=to})}
 function renderReports(target){
  const from=reportFrom||today(),to=reportTo||today(),entries=reportEntries(),t=C.hotelTotals(entries),held=C.hotelTotals(data.entries.filter(e=>root.BiteOwner.day(e.created_at)<=to)).deposits,balance=data.folios.reduce((n,f)=>n+Number(f.totals?.balance||0),0);
  const methods=['Cash','UPI','Card','Bank Transfer','Other'].map(method=>({method,amount:entries.filter(e=>e.status==='confirmed'&&e.method===method).reduce((n,e)=>n+(['payment','advance','deposit_hold'].includes(e.kind)?Number(e.amount):['refund','deposit_return'].includes(e.kind)?-Number(e.amount):0),0)}));
  const expenses=data.expenses.filter(e=>e.expense_date>=from&&e.expense_date<=to).reduce((n,e)=>n+Number(e.amount),0);
  target.innerHTML=header('Hotel reports','Room and incidental charges, recorded collections and deposit liabilities stay separate.',btn('report-export','Export Excel'))+
   `<form class="bh-form bh-panel" data-hotel-form="report-filter"><div class="bh-form-grid">${field('from','From','date',from,'required')}${field('to','To','date',to,'required')}</div><button type="submit" class="btn">Apply dates</button>${notice()}</form>`+
   '<div class="bh-metrics">'+[['Room charges (incl. tax)',money(t.room)],['Incidentals (incl. tax)',money(t.incidentals)],['Recorded collections',money(t.collections)],['Deposit held at end date',money(held)],['Pending in period',money(t.pending)],['Current folio balance',money(balance)]].map(([k,v])=>`<div class="bh-metric"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')+'</div>'+
   `<p class="bh-note">${money(t.foodOnFolios)} food posted in this period references existing POS sales. Do not add it again to restaurant sales. Deposits and cash collections are not sales. These are ledger record dates and current verification states, not a bank settlement statement.</p>`+
   '<article class="bh-panel"><h2>Recorded money by method</h2>'+methods.map(m=>`<div class="bh-room-line"><strong>${m.method}</strong><span>${money(m.amount)}</span></div>`).join('')+`<p>Property expenses in period: ${money(expenses)}. Restaurant expenses stay in the existing restaurant reports.</p><p class="bh-note">Use the combined closing below to save a snapshot or explicitly lock the hotel and restaurant journals for a day. Online payment processing continues.</p></article>`+
   '<div id="bhOperationalReports"></div><article class="bh-panel"><h2>Recent audit activity</h2>'+data.audit.map(a=>`<div class="bh-room-line"><strong>${esc(a.action)}</strong><span>${esc(new Date(a.created_at).toLocaleString('en-IN'))}</span></div>`).join('')+(!data.audit.length?stateCard('No activity yet.'):'' )+'</article>';
  void loadOperationalReports().catch(showError);
 }
 let auditQuery='',auditBefore=null;
 async function loadOperationalReports(){
  const mount=$('bhOperationalReports'),p=prop(),from=reportFrom||today(),to=reportTo||today();if(!mount)return;
  mount.innerHTML=stateCard('Loading combined ledger…');
  const r=await ctx.sb.rpc('bite_property_report',{p_property:p.id,p_from:from,p_to:to});
  if(!mount.isConnected||prop()?.id!==p.id||from!==(reportFrom||today())||to!==(reportTo||today()))return;
  if(r.error){mount.innerHTML=stateCard('Combined report unavailable: '+r.error.message);return}
  const v=r.data;mount.innerHTML='<article class="bh-panel"><h2>Combined property ledger</h2><div class="bh-metrics">'+[['Room charges',v.room_revenue],['Incidentals',v.incidentals_revenue],['Food sales (source orders once)',v.food_revenue],['Total recorded sales',v.total_revenue],['Net drawer cash movement',v.cash_movement]].map(([k,n])=>'<div class="bh-metric"><span>'+esc(k)+'</span><strong>'+money(n)+'</strong></div>').join('')+'</div><p class="bh-note">Food transfers are collection references, not another sale. Deposit movements affect cash, not revenue. Gateway settlements remain in the existing payment reports.</p>'+v.methods.map(m=>'<div class="bh-room-line"><strong>'+esc(m.payment_method)+'</strong><span>'+money(m.net)+'</span></div>').join('')+(from===to&&['owner','manager'].includes(p.role)?btn('close-shift','Review combined closing'):'')+(v.closings||[]).map(c=>'<div class="bh-record"><div><strong>Closed '+esc(c.shift_date)+(c.locked?' · Journals locked':' · Snapshot')+'</strong><p>Expected '+money(c.expected_cash)+' · Counted '+money(c.counted_cash)+' · Difference '+money(c.difference)+'</p><p>'+esc(c.notes)+'</p>'+(from===to&&(c.lock_review||c.snapshot).source_hash!==v.source_hash?'<p class="bh-note">Entries changed after this snapshot. Review the later cash movements.</p>':'')+'</div></div>').join('')+'</article><form class="bh-panel bh-form" data-hotel-form="audit-search"><h2>Search audit history</h2>'+field('query','Action or entity identifier','search',auditQuery,'maxlength="100"')+'<button class="btn" type="submit">Search all history</button></form><div id="bhAuditResults"></div>';
 }
 async function searchAudit(more){
  const p=prop(),mount=$('bhAuditResults');if(!mount)return;
  const r=await ctx.sb.rpc('bite_unified_audit',{p_property:p.id,p_query:auditQuery,p_cursor:more?auditBefore:null});if(r.error)throw r.error;if(!mount.isConnected||p.id!==prop()?.id)return;
  mount.querySelector('[data-hotel-action=audit-more]')?.remove();if(!more)mount.replaceChildren();
  const rows=r.data?.rows||[];mount.insertAdjacentHTML('beforeend',rows.map(a=>'<article class="bh-record"><div><strong>'+esc(a.source||'Property')+' · '+esc(a.action)+'</strong><p>'+esc(a.actor_name||'Staff / system')+' · '+esc(new Date(a.created_at).toLocaleString('en-IN'))+'</p><small>'+esc(a.entity_id||'')+'</small></div></article>').join('')||stateCard('No matching actions.'));
  auditBefore=r.data?.next_cursor||null;if(auditBefore)mount.insertAdjacentHTML('beforeend',btn('audit-more','Load older actions'));
 }
 function renderSetup(){
  if(!setupDraft){const p=prop();setupDraft={name:p?.name||'',business_type:p?.business_type||'restaurant',address:p?.address||'',phone:p?.phone||'',capabilities:[...(p?.configured_capabilities||p?.capabilities||C.defaults.restaurant)],tax_profile:p?.tax_profile||{reviewed:false}}}
  const d=setupDraft;
  $('business-modules').innerHTML=header('Business Modules','Existing menus, orders and financial history stay linked to their original records.',btn('new-property','＋ Add property'))+
   `<p class="bh-steps" aria-label="Setup progress">${['Business type','Details','Modules','Review & save'].map((s,i)=>`<span ${setupStep===i+1?'aria-current="step"':''}>${i+1} · ${s}</span>`).join('')}</p><form class="bh-panel bh-form" data-hotel-form="setup" data-step="${setupStep}">`+
   (setupStep===1?'<h2>Choose your business type</h2><div class="bh-type-grid">'+[['restaurant','Restaurant Only','Orders, POS and one menu catalogue'],['hotel','Hotel Only','Rooms, guest register and folios'],['hybrid','Hotel + Restaurant','One property with linked room charges']].map(([v,label,desc])=>`<label class="bh-type-card"><input type="radio" name="business_type" value="${v}" ${d.business_type===v?'checked':''} required><strong>${label}</strong><span>${desc}</span></label>`).join('')+'</div>':'')+
   (setupStep===2?'<h2>Business details</h2><div class="bh-form-grid">'+field('name','Property name *','text',d.name,'required maxlength="120"')+field('address','Address','text',d.address,'maxlength="500"')+field('phone','Contact phone','tel',d.phone,'maxlength="20"')+'</div><p class="bh-note">Rooms and rates are configured in Rooms. Restaurant menu and pricing remain in the existing Menu workspace.</p>':'')+
   (setupStep===3?'<h2>Module preview</h2><div class="bh-modules">'+C.defaults.hybrid.map(c=>`<label><input type="checkbox" name="capabilities" value="${c}" ${d.capabilities.includes(c)?'checked':''}><span>${esc(c.replaceAll('_',' '))}</span></label>`).join('')+'</div><h3>Tax configuration</h3><p class="bh-note">Confirm these settings with your accountant. No screenshot tax rates are applied automatically.</p><div class="bh-form-grid">'+field('gstin','GSTIN (if registered)','text',d.tax_profile.gstin||'','maxlength="15"')+field('room_rate','Room tax %','number',d.tax_profile.room_rate||0,'min="0" max="100" step="0.001"')+field('incidental_rate','Incidental tax %','number',d.tax_profile.incidental_rate||0,'min="0" max="100" step="0.001"')+'</div><label class="bh-check"><input type="checkbox" name="tax_reviewed" '+(d.tax_profile.reviewed?'checked':'')+'> Rates and tax registration reviewed for this property</label>':'')+
   (setupStep===4?`<h2>Review & save</h2><p><strong>${esc(d.name)}</strong> · ${esc(d.business_type)}</p><p>${esc(d.address)}</p><p>Enabled: ${esc(d.capabilities.map(c=>c.replaceAll('_',' ')).join(', '))}</p><p>Mobile: ${esc(C.tabs({...d,can_configure:true},restaurantAccess()).map(t=>t.label).join(' · '))}</p><p class="bh-note">The server blocks unsafe disabling while stays, balances, deposits, food orders or refunds are unresolved. No history is erased. Restaurant publication still uses its existing approval process.</p>`:'')+
   notice()+`<div class="bh-form-actions">${setupStep>1?btn('setup-back','Back'):''}<button type="submit" class="btn">${setupStep===4?'Save configuration':'Continue'}</button></div></form>`;
 }
 async function command(action,payload){
  if(navigator.onLine===false)throw Error('Offline. Draft stays on this device; this action has not been confirmed. Reconnect and retry.');
  const key='bite_property_request:'+identity()+':'+action+':'+(payload.id||payload.folio_id||'new');
  let attempt;try{attempt=JSON.parse(localStorage.getItem(key)||'null')}catch{throw Error('Saved request unreadable. Contact support before repeating this action.')}
  const canonical=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v})(value));
  const signature=canonical(payload);
  if(attempt&&canonical(JSON.parse(attempt.signature))!==signature)throw Error('Pichhla request verification pending hai. Wahi details restore karke Retry karein.');
  if(!attempt){attempt={id:crypto.randomUUID(),signature};try{localStorage.setItem(key,JSON.stringify(attempt))}catch{throw Error('Safe retry storage unavailable. Action was not sent.')}}
  try{
   activeWrites++;
   const response=await ctx.sb.rpc('bite_property_command',{p_property:prop().id,p_action:action,p_payload:payload,p_request:attempt.id});
   if(response.error){if(['P0001','42501','P0002'].includes(response.error.code)||/^(22|23)/.test(response.error.code||''))localStorage.removeItem(key);throw response.error}
   localStorage.removeItem(key);return response.data;
  }catch(error){throw Error(error.message||'Response unknown. Same details ke saath retry karein; action dobara na banayein.')}finally{activeWrites=Math.max(0,activeWrites-1)}
 }
 function showError(error){const active=document.querySelector('.page.active');const msg=active?.querySelector('.bh-message');if(msg)msg.textContent=error.message||String(error);else root.alert(error.message||String(error))}
 function editor(html){const page=document.querySelector('.page.active');const mount=page?.querySelector('#bhFolioEditor')||page;const old=$('bhActionEditor');old?.remove();const box=document.createElement('div');box.id='bhActionEditor';box.className='bh-panel';box.innerHTML=html;mount.append(box);box.scrollIntoView({block:'nearest',behavior:'smooth'});box.querySelector('input,select,button')?.focus()}
 function entryForm(action,entryId=''){
  const labels={charge:'Add incidental charge',payment:'Record received payment / advance',deposit_hold:'Record held deposit',deposit_return:'Record returned deposit',deposit_apply:'Apply held deposit to bill',discount:'Authorized discount',refund:'Record credit refund already returned',reverse:'Reverse incorrect charge',payment_confirm:'Verify bank receipt',payment_void:'Mark pending transfer not received'};
  editor(`<form class="bh-form" data-hotel-form="entry" data-action="${esc(action)}" data-entry-id="${esc(entryId)}"><h2>${labels[action]}</h2>${!['reverse','payment_confirm','payment_void'].includes(action)?field('amount','Amount (₹) *','number','','required min="0.01" step="0.01" inputmode="decimal"'):''}${field('description','Description / reason *','text','','required maxlength="250"')}${['payment','deposit_hold','deposit_return','refund'].includes(action)?select('method','Collection / return method',['Cash','UPI','Card','Bank Transfer','Other'].map(m=>option(m,m)).join('')):''}${field('reference',action==='payment_confirm'?'Verified bank/provider reference *':'Reference (optional)','text','',action==='payment_confirm'?'required maxlength="100"':'maxlength="100"')}<p class="bh-note">UPI, card and bank receipts stay Pending until the owner/manager verifies receipt. This records front-desk transactions; it does not charge a card or trigger a gateway refund.</p>${notice()}<div class="bh-actions">${btn('close-editor','Cancel')}<button class="btn" type="submit">Confirm</button></div></form>`);
  try{const pending=JSON.parse(localStorage.getItem('bite_property_request:'+identity()+':'+action+':'+(entryId||selectedFolio))||'null');if(pending){const values=JSON.parse(pending.signature),form=$('bhActionEditor').querySelector('form');for(const key of ['amount','description','reference','method'])if(form.elements[key]&&values[key]!=null)form.elements[key].value=values[key];form.querySelector('.bh-message').textContent='Previous response unconfirmed. Details restored; Retry uses the same request.'}}catch{}
 }
 async function handleClick(event){
  const b=event.target.closest('[data-hotel-action]');if(!b||b.disabled)return;
  const {hotelAction:action,id}=b.dataset;b.disabled=true;
  try{
   if(action==='route'||action==='retry')await ctx.navigate(id);
   else if(action==='modules'){setupDraft=null;setupStep=1;await ctx.navigate('business-modules')}
   else if(action==='register')await ctx.navigate('hotel-register');
   else if(action==='report-export'){const rows=[['Date','Entry','Category','Description','Amount','Tax','Status','Method','Reference'],...reportEntries().map(e=>[root.BiteOwner.day(e.created_at),e.kind,e.category,e.description,Number(e.amount),Number(e.tax_amount||0),e.status,e.method||'',e.reference||''])];root.BiteExports.download(root.BiteExports.workbook(rows),'bite-hotel-ledger-'+(reportFrom||today())+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
   else if(action==='audit-more'){await searchAudit(true)}
   else if(action==='close-shift'){
    const date=reportFrom||today(),r=await ctx.sb.rpc('bite_property_report',{p_property:prop().id,p_from:date,p_to:date});if(r.error)throw r.error;
    editor(`<form class="bh-form" data-hotel-form="close-shift"><h2>Combined closing snapshot · ${esc(date)}</h2><input type="hidden" name="shift_date" value="${esc(date)}"><input type="hidden" name="source_hash" value="${esc(r.data.source_hash)}">${field('opening_cash','Combined opening cash','number',0,'required min="0" step="0.01"')}${field('counted_cash','Combined counted cash','number','','required min="0" step="0.01"')}${field('notes','Difference / shift notes','text','','maxlength="500"')}<p>Recorded cash movement: ${money(r.data.cash_movement)}. Expected = opening + movement. Deposits are liabilities, not revenue.</p><p class="bh-note">This creates one immutable combined closing snapshot. Choose a snapshot for review only, or lock hotel and restaurant journals for this date. A lock cannot be undone here; record corrections on a later open day. Online payment activation continues.</p><label class="bh-check"><input type="checkbox" name="lock_journals"> Lock hotel and restaurant journals for this date</label>${notice()}<button class="btn" type="submit">Review & record closing</button></form>`);
   }
   else if(action==='split-bill'){
    const f=data.folios.find(f=>f.id===id),v=f.payer_split||{};editor(`<form class="bh-form" data-hotel-form="split-bill"><h2>Split itemized payer statements</h2>${field('first_name','First payer name','text',v.first_name||'','required maxlength="120"')}${field('second_name','Second payer name','text',v.second_name||'','required maxlength="120"')}${field('first_percent','First payer share (%)','number',v.first_percent||50,'required min="0.01" max="99.99" step="0.01"')}<p class="bh-note">Each charge is partitioned in paise; the second payer receives the remainder. After settlement, print both itemized statements. Collections remain on the original folio; these are not separate payment receipts.</p>${notice()}<button class="btn" type="submit">Save payer split</button></form>`);
   }
   else if(action==='split-preview')printStatement(selectedFolio,Number(id));
   else if(action==='group-booking'){
    editor(`<form class="bh-form" data-hotel-form="group"><h2>Group reservation</h2>${field('name','Group name *','text','','required maxlength="120"')}${select('guest_id','Shared payer / lead guest',option('','New lead guest')+data.guests.map(g=>option(g.id,g.full_name+' · '+g.phone)).join(''))}<div class="bh-form-grid">${field('full_name','New lead guest name','text','','maxlength="120"')}${field('phone','New lead guest phone','tel','','maxlength="20"')}${field('arrival','Arrival *','date',today(),'required')}${field('departure','Departure *','date',datePlus(1),'required')}</div><h3>Rooms & occupancy</h3>${data.rooms.filter(r=>r.active&&r.housekeeping!=='blocked').map(r=>`<div class="bh-panel"><label class="bh-check"><input type="checkbox" name="room_ids" value="${esc(r.id)}"> Room ${esc(r.number)} · ${money(r.nightly_rate)} / night</label><div class="bh-form-grid">${field('adults_'+r.id,'Adults in this room','number',1,'min="1" max="'+r.adults+'"')}${field('children_'+r.id,'Children in this room','number',0,'min="0" max="'+r.children+'"')}</div></div>`).join('')}<p class="bh-note">All rooms reserve together, or none do. Each room keeps its own folio and invoice linked to this shared payer. Check rooms in individually after readiness inspection.</p>${notice()}<div class="bh-actions">${btn('close-editor','Cancel')}<button type="submit" class="btn">Reserve selected rooms</button></div></form>`);
   }
   else if(action==='folio'){selectedFolio=id;await ctx.navigate('folios')}
   else if(action==='folio-list'){selectedFolio=null;renderFolios()}
   else if(action==='guest-use'){await ctx.navigate('hotel-register');renderRegister(id)}
   else if(action==='save-draft'){const f=$('bhCheckinForm');f.querySelector('.bh-message').textContent=persistDraft(f)?'Draft saved on this device. Not checked in.':'Draft could not be saved.'}
   else if(action==='close-editor')$('bhActionEditor')?.remove();
   else if(action==='revoke-member'){const m=data.members.find(m=>m.user_id===id);if(m&&root.confirm('Revoke '+(m.email||m.display_name)+' access to this property now?')){await command('member',{id,role:m.role,active:false});await reload();const active=document.querySelector('.page.active')?.id;if(active==='hr'&&!restaurantAccess())renderStaffAccess($('hr'));else await augmentPage('hr')}}
   else if(action==='entry')entryForm(id);
   else if(action==='reverse'||action==='verify-payment')entryForm(action==='reverse'?'reverse':'payment_confirm',id);
   else if(action==='void-payment')entryForm('payment_void',id);
   else if(action==='checkout'){
    if(!root.confirm('Review the entire folio and recorded collections. Settle and check out now?'))return;
    await command('checkout',{folio_id:id});await reload();renderFolios();
   }else if(action==='checkin'){await command('checkin',{id});await reload();renderPage('reservations')}
   else if(action==='preview')printStatement(id);
   else if(action==='share')await shareStatement(id);
   else if(action==='setup-back'){setupStep=Math.max(1,setupStep-1);renderSetup()}
   else if(action==='new-property')editor(`<form class="bh-form" data-hotel-form="property"><h2>Add property</h2>${field('name','Property name *','text','','required maxlength="120"')}${select('type','Business type',option('hotel','Hotel Only')+option('hybrid','Hotel + Restaurant')+option('restaurant','Restaurant Only'))}<p class="bh-note">A new restaurant needs its existing Admin approval and verified outlet association before restaurant POS or marketplace access is available.</p>${notice()}<div class="bh-actions">${btn('close-editor','Cancel')}<button type="submit" class="btn">Create property</button></div></form>`);
   else if(action==='new-room'||action==='edit-room'){
    const r=data.rooms.find(r=>r.id===id)||{};
    editor(`<form class="bh-form" data-hotel-form="room" data-room-id="${esc(r.id||'')}"><h2>${r.id?'Edit room':'Add room'}</h2><div class="bh-form-grid">${field('number','Room number *','text',r.number||'','required maxlength="20"')}${field('room_type','Room type *','text',r.room_type||'Deluxe','required maxlength="60"')}${field('floor','Floor','text',r.floor||'','maxlength="30"')}${field('nightly_rate','Nightly rate (₹) *','number',r.nightly_rate??'','required min="0" step="0.01"')}${field('adults','Maximum adults','number',r.adults||2,'required min="1" max="20"')}${field('children','Maximum children','number',r.children??2,'required min="0" max="20"')}${select('active','Availability',option('true','Active',r.active!==false)+option('false','Deactivate',r.active===false))}</div>${notice()}<div class="bh-actions">${btn('close-editor','Cancel')}<button class="btn" type="submit">Save room</button></div></form>`);
   }else if(action==='room-privacy'){
    const r=data.rooms.find(r=>r.id===id);editor(`<form class="bh-form" data-hotel-form="room-privacy" data-room-id="${esc(id)}"><h2>Guest privacy & stayover service</h2><label class="bh-check"><input name="do_not_disturb" type="checkbox" ${r.do_not_disturb?'checked':''}> Do Not Disturb</label><label class="bh-check"><input name="cleaning_requested" type="checkbox" ${r.cleaning_requested?'checked':''}> Stayover cleaning requested</label>${field('note','Guest / service note','text',r.status_note||'','maxlength="250"')}<p>DND prevents starting cleaning until permission is confirmed and DND is cleared.</p>${notice()}<button type="submit" class="btn">Save guest preference</button></form>`);
   }else if(action==='room-status'){
    editor(`<form class="bh-form" data-hotel-form="room-status" data-room-id="${esc(id)}"><h2>Update room status</h2>${select('status','Status',['dirty','cleaning',...(['owner','manager','receptionist'].includes(prop().role)?['ready']:[]),...(['owner','manager'].includes(prop().role)?['blocked']:[])].map(s=>option(s,s)).join(''))}${field('note','Reason / cleaning note','text','','maxlength="250"')}${notice()}<div class="bh-actions">${btn('close-editor','Cancel')}<button class="btn" type="submit">Update status</button></div></form>`);
   }else if(action==='stay-options'){
    const s=data.stays.find(s=>s.id===id);if(!s)return;
    editor(`<form class="bh-form" data-hotel-form="stay" data-stay-id="${esc(id)}"><h2>Manage stay</h2>${select('action','Action',(s.status==='in_house'?option('extend','Extend stay')+option('move','Move room'):option('cancel','Cancel reservation')+option('no_show','Mark no-show')+option('extend','Extend reservation')+option('move','Reassign room')))}${field('departure','New departure (for extension)','date',datePlus(2))}${['owner','manager'].includes(prop().role)&&s.status==='in_house'?field('nightly_rate','Extension nightly rate (₹)','number',s.nightly_rate,'min="0" step="0.01"'):''}${select('room_id','New room (for move)',option('','Choose')+data.rooms.filter(r=>r.active&&r.id!==s.room_id).map(r=>option(r.id,r.number+' · '+roomState(r))).join(''))}<p class="bh-note">Extension uses the displayed agreed rate; only a manager can authorize a new rate for added nights. Advances/deposits must be resolved before cancellation.</p>${notice()}<div class="bh-actions">${btn('close-editor','Cancel')}<button class="btn" type="submit">Review & apply</button></div></form>`);
   }else if(action==='edit-guest'){
    const g=data.guests.find(g=>g.id===id);if(!g)return;
    editor(`<form class="bh-form" data-hotel-form="guest" data-guest-id="${esc(id)}"><h2>Correct guest details</h2>${['full_name','phone','country','email','address','id_type','id_last4'].map(k=>field(k,k.replaceAll('_',' '),k==='email'?'email':'text',g[k]||'',(k==='id_last4'?'maxlength="4"':k==='id_type'?'maxlength="40"':'maxlength="120"')+(['full_name','phone','country'].includes(k)?' required':''))).join('')}${notice()}<div class="bh-actions">${btn('close-editor','Cancel')}<button class="btn" type="submit">Save correction</button></div></form>`);
   }
  }catch(e){showError(e)}finally{b.disabled=false}
 }
 async function handleSubmit(event){
  const form=event.target.closest('[data-hotel-form]');if(!form)return;event.preventDefault();
  const button=form.querySelector('button[type="submit"]');if(button.disabled)return;button.disabled=true;
  const f=Object.fromEntries(new FormData(form)),type=form.dataset.hotelForm;const message=form.querySelector('.bh-message');if(message)message.textContent='Saving…';
  try{
   if(type==='audit-search'){auditQuery=f.query||'';auditBefore=null;await searchAudit(false)}else if(type==='report-filter'){root.BiteOwner.range(f.from,f.to);reportFrom=f.from;reportTo=f.to;const mount=$('biteHotelReports')||$('reports');renderReports(mount)}else if(type==='setup'){
    const step=Number(form.dataset.step);
    if(step===1){if(setupDraft.business_type!==f.business_type)setupDraft.capabilities=[...C.defaults[f.business_type]];setupDraft.business_type=f.business_type}
    if(step===2)Object.assign(setupDraft,{name:f.name,address:f.address,phone:f.phone});
    if(step===3){setupDraft.capabilities=C.validateModules(new FormData(form).getAll('capabilities'));setupDraft.tax_profile={reviewed:f.tax_reviewed==='on',gstin:f.gstin,room_rate:Number(f.room_rate||0),incidental_rate:Number(f.incidental_rate||0)}}
    if(step<4){setupStep++;renderSetup()}
    else{
     if(!prop()){
      const key='bite_initial_property:'+ctx.getUser().id;let attempt=JSON.parse(localStorage.getItem(key)||'null');
      if(!attempt){attempt={id:crypto.randomUUID(),name:setupDraft.name,type:setupDraft.business_type};localStorage.setItem(key,JSON.stringify(attempt))}
      if(attempt.name!==setupDraft.name||attempt.type!==setupDraft.business_type)throw Error('Earlier property creation pending. Restore its name and type.');
      const r=await ctx.sb.rpc('bite_create_property',{p_name:attempt.name,p_type:attempt.type,p_request:attempt.id});if(r.error)throw r.error;
      await loadContext();ctx.getAccess().properties=properties;ctx.getAccess().property=properties.find(p=>p.id===r.data);ctx.getAccess().needsProperty=false;localStorage.removeItem(key);localStorage.setItem('bite_property_v1:'+ctx.getUser().id,r.data);
     }
     const pid=prop().id;await command('config',setupDraft);await loadContext();ctx.getAccess().properties=properties;ctx.getAccess().property=properties.find(p=>p.id===pid);applyShell();await ctx.navigate('overview');
    }
   }else if(type==='property'){
    const key='bite_new_property_request:'+ctx.getUser().id;let attempt=JSON.parse(localStorage.getItem(key)||'null');
    if(attempt&&attempt.signature!==JSON.stringify(f))throw Error('Previous property request pending. Restore its name/type.');
    if(!attempt){attempt={id:crypto.randomUUID(),signature:JSON.stringify(f)};localStorage.setItem(key,JSON.stringify(attempt))}
    const result=await ctx.sb.rpc('bite_create_property',{p_name:f.name,p_type:f.type,p_request:attempt.id});if(result.error)throw result.error;localStorage.removeItem(key);await loadContext();ctx.getAccess().properties=properties;await ctx.switchProperty(result.data);
   }else if(type==='group'){
    let guest_id=f.guest_id;
    if(!guest_id){if(!f.full_name?.trim()||!f.phone?.trim())throw Error('Enter a lead guest name and phone.');const g=await command('guest_save',{full_name:f.full_name,phone:f.phone,country:'India'});guest_id=g.id;const o=document.createElement('option');o.value=guest_id;o.textContent=f.full_name;form.elements.guest_id.append(o);form.elements.guest_id.value=guest_id;}
    const ids=new FormData(form).getAll('room_ids');if(!ids.length)throw Error('Select at least one room.');
    await command('reserve_group',{name:f.name,guest_id,arrival:f.arrival,departure:f.departure,rooms:ids.map(id=>({room_id:id,adults:Number(f['adults_'+id]),children:Number(f['children_'+id])}))});await reload();renderPage('reservations');
   }else if(type==='register'){
    if(form.dataset.stayId){
     await reload();
     const existing=data.stays.find(s=>s.id===form.dataset.stayId);
     if(existing?.status==='in_house'||existing?.status==='checked_out'){selectedFolio=data.folios.find(x=>x.stay_id===existing.id)?.id||null;await ctx.navigate('folios');return}
    }
    if(form.dataset.reviewed!=='true'){
     if(!f.room_id)throw Error('Choose a room');if(f.departure<=f.arrival)throw Error('Departure must be after arrival.');
     const r=data.rooms.find(r=>r.id===f.room_id),n=Math.round((new Date(f.departure)-new Date(f.arrival))/86400000),quote=await root.BiteOwnerOperations.reservationQuote(f,form.dataset.stayId);form.dataset.quoteHash=quote.quote_hash;
     const review=document.createElement('div');review.className='bh-review';review.innerHTML=`<h2>3 · Review</h2><p>${esc(f.full_name)} · Room ${esc(r?.number)} · ${n} nights</p><p>Room ${money(quote.room)} · tax ${money(quote.room_tax)} · early arrival ${money(Number(quote.early_fee)+Number(quote.early_tax))}.<br><strong>Agreed total: ${money(quote.total)}</strong></p><p>${f.mode==='reserve'?'Create reservation':'Check in now'} · already received advance ${money(form.dataset.stayId?data.entries.filter(e=>e.folio_id===data.folios.find(x=>x.stay_id===form.dataset.stayId)?.id&&e.kind==='advance'&&e.status!=='void').reduce((n,e)=>n+Number(e.amount),0):f.advance_amount)} · ${esc(form.dataset.stayId?data.stays.find(s=>s.id===form.dataset.stayId)?.booking_source:f.booking_source||'walk_in')}. Bank transfers require verification.</p>`;form.querySelector('.bh-form-actions').before(review);form.dataset.reviewed='true';button.textContent=f.mode==='reserve'?'Confirm reservation':'Confirm check-in';if(message)message.textContent='Review guest, room and dates before confirming.';return;
    }
    let guestId=f.guest_id;
    if(!form.dataset.stayId){const g=await command('guest_save',{...Object.fromEntries(['full_name','phone','country','email','address','id_type','id_last4'].map(k=>[k,f[k]])),is_oci:f.is_oci==='on',...(guestId?{id:guestId}:{})});guestId=g.id;if(!f.guest_id){const op=document.createElement('option');op.value=guestId;op.textContent=f.full_name;form.elements.guest_id.append(op)}form.elements.guest_id.value=guestId;persistDraft(form)}
    let stayId=form.dataset.stayId,folioId;
    if(!stayId){const s=await command('reserve',{guest_id:guestId,room_id:f.room_id,arrival:f.arrival,departure:f.departure,adults:Number(f.adults),children:Number(f.children),compliance_note:f.compliance_note,booking_source:f.booking_source||'walk_in',booking_reference:f.booking_reference||'',advance_amount:Number(f.advance_amount||0),advance_method:f.advance_method||'Cash',advance_reference:f.advance_reference||'',advance_verified:f.advance_verified==='on',booking_mode:f.mode,quote_hash:form.dataset.quoteHash});stayId=s.id;folioId=s.folio_id;form.dataset.stayId=stayId;persistDraft(form)}
    else{await command('reservation_edit',{id:stayId,room_id:f.room_id,arrival:f.arrival,departure:f.departure,adults:Number(f.adults),children:Number(f.children)})}
    if(f.mode==='checkin'){const s=await command('checkin',{id:stayId});folioId=s.folio_id}
    localStorage.removeItem('bite_register_draft:'+identity());selectedFolio=folioId||null;await ctx.navigate('folios');
   }else{
    let action,payload;
    if(type==='room'){action='room_save';payload={...f,id:form.dataset.roomId||null,nightly_rate:Number(f.nightly_rate),adults:Number(f.adults),children:Number(f.children),active:f.active==='true'}}
    if(type==='close-shift'){action='close_shift';payload={...f,opening_cash:Number(f.opening_cash),counted_cash:Number(f.counted_cash),lock_journals:f.lock_journals==='on'};if(!root.confirm(f.lock_journals==='on'?'Lock hotel and restaurant journals for this day? Later corrections must use an open day. Online payment activation continues.':'Record the reviewed combined closing snapshot?'))return}
    if(type==='split-bill'){action='split_bill';payload={...f,folio_id:selectedFolio,first_percent:Number(f.first_percent)}}
    if(type==='room-privacy'){action='room_privacy';payload={...f,id:form.dataset.roomId,do_not_disturb:f.do_not_disturb==='on',cleaning_requested:f.cleaning_requested==='on'}}
    if(type==='room-status'){action='room_status';payload={...f,id:form.dataset.roomId}}
    if(type==='guest'){action='guest_save';payload={...f,id:form.dataset.guestId}}
    if(type==='entry'){action=form.dataset.action;payload={...f,folio_id:selectedFolio,...(f.amount?{amount:Number(f.amount)}:{}),...(form.dataset.entryId?{id:form.dataset.entryId}:{})}}
    if(type==='stay'){action=f.action;payload={id:form.dataset.stayId,...(action==='move'?{room_id:f.room_id}:action==='extend'?{departure:f.departure,...(f.nightly_rate!==undefined?{nightly_rate:Number(f.nightly_rate)}:{})}:{})}}
    if(type==='member'){action='member';payload={...f,active:f.active==='true'}}
    if(type==='expense'){action='expense';payload={...f,amount:Number(f.amount)}}
    if(!action)throw Error('Unknown action');await command(action,payload);await reload();
    const active=document.querySelector('.page.active')?.id;if(active){if(handles(active))renderPage(active);else await augmentPage(active)}
   }
  }catch(e){if(message)message.textContent=e.message||String(e)}finally{button.disabled=false}
 }
 function statement(id){
  const f=data.folios.find(f=>f.id===id);if(!f)throw Error('Folio not loaded');
  if(f.invoice_snapshot)return f.invoice_snapshot;
  const s=data.stays.find(s=>s.id===f.stay_id),g=data.guests.find(g=>g.id===s?.guest_id);
  return {number:'DRAFT — not issued',property:prop(),guest:{name:g?.full_name||'Guest',address:g?.address||''},stay:s,room:data.rooms.find(r=>r.id===s?.room_id),entries:data.entries.filter(e=>e.folio_id===id),totals:f.totals,tax_profile:prop().tax_profile};
 }
 function printStatement(id,splitIndex=null){
  const all=statement(id),s=splitIndex===null?all:all.splits?.[splitIndex];if(!s)throw Error('Split statement unavailable');const win=root.open('','_blank');if(!win)throw Error('Allow popups for invoice preview.');
  const taxLabel=s.tax_profile?.reviewed&&s.tax_profile?.gstin?'Tax configuration reviewed':'Guest statement — tax configuration pending review';
  win.document.write(`<!doctype html><html><head><title>${esc(s.number)}</title><meta name="viewport" content="width=device-width"><style>body{font:15px/1.5 system-ui;margin:30px;color:#17202a}h1{margin-bottom:0}table{border-collapse:collapse;width:100%;margin:24px 0}td,th{text-align:left;border-bottom:1px solid #ddd;padding:8px}button{padding:12px}@media print{button{display:none}}</style></head><body><h1>${esc(s.property.name)}</h1><p>${esc(s.property.address||'')}<br>${esc(s.property.phone||'')}</p><h2>${esc(s.number)}</h2><p>${esc(taxLabel)}${s.tax_profile?.gstin?' · GSTIN '+esc(s.tax_profile.gstin):''}</p><p>${esc(s.guest.name)}<br>${esc(s.guest.address||'')}</p>${s.allocation_note?'<p>'+esc(s.allocation_note)+'</p>':''}<p>Room ${esc(s.room?.number||'—')} · ${esc(s.stay?.arrival||'')} → ${esc(s.stay?.departure||'')}</p><table><thead><tr><th>Entry</th><th>Status</th><th>Amount</th></tr></thead><tbody>${s.entries.map(e=>`<tr><td>${esc(e.description)}<br><small>${esc(e.kind)}</small>${(e.source_items||[]).map(i=>'<br><small>'+esc(i.quantity)+' × '+esc(i.name)+' · '+money(i.unit_price)+'</small>').join('')}</td><td>${esc(e.status)}</td><td>${money(Number(e.amount)+Number(e.tax_amount||0))}</td></tr>`).join('')}</tbody></table><p>Charges: ${money(s.totals.charges)} · Applied payments: ${money(s.totals.paid)}<br><strong>Balance: ${money(s.totals.balance)}</strong> · Deposit held: ${money(s.totals.deposit_held)}</p><button onclick="window.print()">Print / Save PDF</button></body></html>`);win.document.close();win.opener=null;
 }
 async function shareStatement(id){
  if(root.BiteOwnerOperations){await root.BiteOwnerOperations.share(id);return}
  const s=statement(id),text=s.property.name+'\n'+s.number+'\nGuest: '+s.guest.name+'\nCharges: '+money(s.totals.charges)+'\nPayments: '+money(s.totals.paid)+'\nBalance: '+money(s.totals.balance);
  if(navigator.share)await navigator.share({title:s.property.name+' guest statement',text});
  else if(navigator.clipboard){await navigator.clipboard.writeText(text);const m=document.querySelector('.page.active .bh-message');if(m)m.textContent='Statement summary copied. Share only with the authorized guest.'}
  else editor('<h2>Share statement</h2><label class="bh-field"><span>Copy this guest summary</span><textarea readonly>'+esc(text)+'</textarea></label>'+btn('close-editor','Close'));
 }
 async function roomTargets(){const r=await ctx.sb.rpc('bite_room_charge_targets',{p_property:prop()?.id});if(r.error)throw r.error;return r.data||[]}
 async function preparePOS(){
  $('biteRoomPOSTender')?.remove();delete $('orderModal').dataset.roomCharge;
  $('bitePOSOrderType')?.remove();
  if(!restaurantAccess())return;
  const type=document.createElement('div');type.id='bitePOSOrderType';type.className='bh-workspace';
  type.innerHTML=select('bite_order_type','Order type',option('POS - Counter','Counter',true)+(has('dine_in')?option('POS - Dine-in','Dine-in'):'')+(has('takeaway')?option('POS - Takeaway','Takeaway'):''))+`<label class="bh-field" id="bitePOSTableField" hidden><span>Table (optional)</span><select name="bite_table_id"><option value="">No table assigned</option>${(ctx.getState().restaurantTables||[]).filter(t=>t.is_active!==false).map(t=>option(t.id,t.table_name)).join('')}</select></label>`;
  $('posPaymentSection').prepend(type);type.querySelector('[name=bite_order_type]').addEventListener('change',e=>{$('orderChannel').value=e.target.value;$('orderChannel').dispatchEvent(new Event('change'));$('bitePOSTableField').hidden=e.target.value!=='POS - Dine-in';if(e.target.value!=='POS - Dine-in')type.querySelector('[name=bite_table_id]').value=''});
  if(!has('charge_to_room'))return;
  const box=document.createElement('div');box.id='biteRoomPOSTender';box.className='bh-workspace';
  box.innerHTML=`${select('bite_tender','Food bill payment',option('pay_now','Pay now / usual POS')+option('room','Charge to room'))}<div id="biteRoomPOSPicker" hidden><label class="bh-field"><span>Verify room and guest</span><select id="biteRoomPOSFolio" name="bite_room_folio"><option value="">Loading occupied rooms…</option></select></label><p class="bh-note">No money collected here. The existing POS sale and its guest folio charge are saved together once.</p>${has('room_service')?select('bite_fulfilment','Fulfilment',option('served','Served now')+option('room_service','Prepare and deliver to room'))+field('bite_service_note','Room-service instructions','text','','maxlength="250"'):''}${['owner','manager'].includes(prop().role)?field('bite_food_discount','Room food discount (₹)','number',0,'min="0" step="0.01"')+field('bite_discount_reason','Discount reason','text','','maxlength="100"'):''}</div>`;
  $('posPaymentSection').prepend(box);box.querySelector('[name=bite_tender]').addEventListener('change',e=>{
   const room=e.target.value==='room';$('orderModal').dataset.roomCharge=String(room);$('biteRoomPOSPicker').hidden=!room;
  });
  try{const targets=await roomTargets();if(!box.isConnected)return;$('biteRoomPOSFolio').innerHTML=option('','Choose occupied room & guest')+targets.map(t=>option(t.folio_id,'Room '+t.room+' · '+t.guest)).join('')}
  catch(e){if(box.isConnected){$('biteRoomPOSFolio').innerHTML=option('','Room list unavailable — close and retry');box.querySelector('.bh-note').textContent=e.message}}
 }
 function roomPOSSelected(){return has('charge_to_room')&&$('orderForm')?.elements.bite_tender?.value==='room'}
 async function createRoomPOS(items){
  const folio_id=$('biteRoomPOSFolio')?.value;if(!folio_id)throw Error('Choose and verify the occupied room and guest.');
  if($('posReplaceOrderId')?.value)throw Error('A correction bill cannot be transferred to a room.');
  const total=items.reduce((n,i)=>n+Math.round(i.quantity*i.unit_price*100)/100,0);
  const text=$('biteRoomPOSFolio').selectedOptions[0]?.textContent;
  const discount=Number($('orderForm').elements.bite_food_discount?.value||0);
  if(!root.confirm(text+'\nFood charge '+money(total-discount)+(discount?' (discount '+money(discount)+')':'')+'\nPost once to this guest folio?'))throw Error('Room charge cancelled. Bill draft is preserved.');
  return command('room_pos',{folio_id,restaurant_id:ctx.getAccess().restaurantId,items,fulfilment:$('orderForm').elements.bite_fulfilment?.value||'served',service_note:$('orderForm').elements.bite_service_note?.value||'',channel:$('orderChannel').value,discount:Number($('orderForm').elements.bite_food_discount?.value||0),discount_reason:$('orderForm').elements.bite_discount_reason?.value||''});
 }
 function createPOSSale(items,fields){return command('pos_sale',{restaurant_id:ctx.getAccess().restaurantId,items,channel:fields.get('channel'),customer_name:fields.get('customer_name')||'',customer_phone:fields.get('customer_phone')||'',paid_amount:Number(fields.get('paid_amount')||0),payment_method:fields.get('payment_method'),reference:fields.get('payment_reference')||'',table_id:fields.get('bite_table_id')||null})}
 function postedOrder(id){return data.entries.find(e=>e.source_order_id===id)||null}
 async function augmentPage(id){
  if(!prop())return;
  if(id==='settings'&&restaurantAccess()){await reload();root.BiteOwnerOperations?.settings($('settings'))}
  if(!restaurantAccess())return;
  if(id==='hr'&&prop().can_configure){await reload();let box=$('bitePropertyStaffAccess');if(!box){box=document.createElement('div');box.id='bitePropertyStaffAccess';box.className='bh-workspace bh-panel';$('hr').append(box)}renderStaffAccess(box,true)}
  if(id==='reports'&&has('folios')){await reload();let box=$('biteHotelReports');if(!box){box=document.createElement('div');box.id='biteHotelReports';box.className='bh-workspace';$('reports').append(box)}renderReports(box)}
 }
 function clear(){root.BiteOwnerOperations?.clear();loadVersion++;data=empty();workspaceReady=false;properties=[];selectedFolio=null;if(poll){root.clearInterval(poll);poll=null}try{localStorage.removeItem('bite_register_draft:'+identity())}catch{}delete document.body.dataset.businessType;delete document.body.dataset.universalOwner;delete document.body.dataset.restaurantAccess;if($('biteHotelHome'))$('biteHotelHome').hidden=true}
 async function refreshContext(switchOutlet=false){const id=prop()?.id;await loadContext();ctx.getAccess().properties=properties;ctx.getAccess().property=properties.find(p=>p.id===id)||null;applyShell();if(switchOutlet)await ctx.switchProperty(id)}
 root.BiteHospitality={redraw:()=>{const id=document.querySelector('.page.active')?.id;if(id&&handles(id))renderPage(id)},editor,refreshContext,getWorkspace:()=>data,dashboardSnapshot,init,loadContext,preferredProperty,setProperty,routeList,applyShell,reload,handles,open,titles,prop,has,roomTargets,command,syncOrderBadge,clear,augmentPage,preparePOS,roomPOSSelected,createRoomPOS,createPOSSale,postedOrder,printStatement,busy:()=>activeWrites>0,
  getTabs:()=>C.tabs(prop(),restaurantAccess()).filter(t=>t.page==='more'||allowed()?.includes(t.page)),getMore:()=>[...C.hotel,...C.restaurant,...C.common,['settings','Settings','membership']].filter(r=>allowed()?.includes(r[0])).map(([page,label])=>[page,label,'Open '+label,'›'])};
})(typeof window!=='undefined'?window:globalThis);
