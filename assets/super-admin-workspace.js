/* Bite platform workspace. Authentication/RLS/RPC checks are authoritative.
   Routes/capabilities are centralized for a future separate Admin role; only
   database-verified Super Admin is enabled today. No role comes from metadata. */
(function(root){
 'use strict';
 const primary=[['overview','Home','home'],['restaurants','Restaurants','shop'],['financials','Payments','wallet']];
 const secondary=[['orders','Orders'],['platform-commission','Commission'],['support','Customer support'],['platform-reports','Reports'],['audit','Audit log'],['customers','Customers'],['moderation','Review reports'],['storefront','Website & offers']];
 const capabilities=Object.freeze({super_admin:Object.freeze([...primary.map(x=>x[0]),...secondary.map(x=>x[0])])});
 const custom=new Set(['overview','restaurants','orders','financials','platform-commission','platform-reports']);
 let ctx=null,serial=0,actor=null,current='overview',rows=[],offset=0,total=0,filter='all',search='',restaurantFilter='',tab='payments',detail=null,commission=null,report=null,commissionRequest=0,refreshTimer=null;
 const $=id=>document.getElementById(id);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>v==null?'Awaiting confirmation':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(v));
 const when=v=>v?new Date(v).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):'Not recorded';
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const authorized=()=>!!ctx&&ctx.getAccess()?.role==='super_admin'&&ctx.getAccess()?.isPlatformAdmin===true&&!!ctx.getUser()?.id;
 const allowed=role=>capabilities[role]||[];
 const valid=t=>authorized()&&t===serial&&actor===ctx.getUser()?.id;
 const checked=async p=>{const r=await p;if(r.error)throw r.error;return r.data;};
 const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">'+({home:'<path d="m3 10 9-7 9 7v10H7V10h10v10M3 10h18"/>',shop:'<path d="M4 9V4h16v5M3 9l2-5h14l2 5v4H3V9Zm2 4v8h14v-8M9 21v-6h6v6"/>',wallet:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-6 5h3"/>'}[name]||'<circle cx="12" cy="12" r="8"/><path d="M12 8v8m-4-4h8"/>')+'</svg>';
 const button=(label,action,value='',cls='secondary')=>'<button type="button" class="btn '+cls+'" data-sa-action="'+esc(action)+'" data-id="'+esc(value)+'">'+esc(label)+'</button>';
 const pill=s=>'<span class="sa-pill">'+esc(String(s||'Not recorded').replaceAll('_',' '))+'</span>';
 const field=(label,value)=>'<div class="sa-fact"><dt>'+esc(label)+'</dt><dd>'+esc(value??'Not recorded')+'</dd></div>';
 const restaurantName=id=>ctx.getState().restaurants?.find(r=>r.id===id)?.name||'Restaurant …'+String(id||'').slice(-6);
 function mount(){
  if(!authorized()){restoreLanguage();return;}
  actor=ctx.getUser().id; $('mainApp').style.display='block';
  if(!$('saNavigation')){
   const nav=document.createElement('nav');nav.id='saNavigation';nav.dataset.saUi='';nav.setAttribute('aria-label','Super Admin primary');
   nav.innerHTML='<a class="sa-wordmark" href="?bite_app=admin">Bite<span>Eat. Repeat.</span></a><div class="sa-primary">'+primary.map(([id,label,i])=>'<button type="button" data-sa-route="'+id+'">'+icon(i)+'<span>'+label+'</span></button>').join('')+'</div><span class="sa-nav-role">Super Admin</span>';
   $('mainApp').append(nav);
   const header=document.createElement('header');header.id='saHeader';header.dataset.saUi='';
   header.innerHTML='<a class="sa-wordmark" href="?bite_app=admin">Bite<span>Eat. Repeat.</span></a><div class="sa-header-end"><span class="sa-role">Super Admin</span><details id="saMore"><summary>More</summary><div class="sa-more-menu">'+secondary.map(([id,label])=>'<button type="button" data-sa-route="'+id+'">'+label+'</button>').join('')+'<p id="saAccount"></p>'+button('Sign out','logout')+'</div></details></div>';
   document.querySelector('#mainApp .main').prepend(header);
   new MutationObserver(records=>{if(!authorized())return;moveLanguage();if(records.some(r=>r.target.closest?.('table')))labelTables(current);}).observe($('mainApp'),{childList:true,subtree:true});
   for(const [id] of secondary)if(!$(id)){const node=document.createElement('section');node.className='page';node.id=id;document.querySelector('#mainApp .content').append(node);}
  }
  moveLanguage();
  $('saAccount').textContent=ctx.getUser().email||ctx.getUser().phone||'';
  selectNav();
 }
 function restoreLanguage(){const row=$('saMore')?.querySelector('.bite-language-row'),target=document.querySelector('#mainApp .top');if(row&&target)target.after(row);}
 function moveLanguage(){const row=document.querySelector('.bite-language-row');if(row&&$('saMore')&&!row.closest('#saMore'))$('saMore').querySelector('.sa-more-menu').append(row);}
 function selectNav(){
  document.querySelectorAll('#saNavigation [data-sa-route],#saMore [data-sa-route]').forEach(b=>{const active=b.dataset.saRoute===current;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 }
 function host(id){
  let node=$('sa-'+id);
  if(!node){node=document.createElement('div');node.id='sa-'+id;node.className='sa-workspace';node.dataset.saUi='';$(id).prepend(node);}
  for(const child of [...$(id).children])if(child!==node&&!child.classList.contains('sa-advanced'))child.classList.add('sa-legacy');
  return node;
 }
 function heading(title,copy='',actions=button('Refresh','refresh')){return '<div class="sa-heading"><div><h1>'+esc(title)+'</h1>'+(copy?'<p>'+esc(copy)+'</p>':'')+'</div><div class="sa-actions">'+actions+'</div></div>';}
 function message(text,error=false){const el=$('saMessage');if(el){el.textContent=text;el.classList.toggle('sa-error',error);}}
 const status=()=>'<p id="saMessage" class="sa-message" role="status" aria-live="polite"></p>';
 function loading(id,title){host(id).innerHTML=heading(title)+'<div class="sa-card" role="status">Loading current records…</div>'+status();}
 function failed(id,error){if(!authorized())return;host(id).innerHTML=heading('Could not load records')+'<div class="sa-card sa-error" role="alert">'+esc(error.message||'Please try again.')+'</div>'+status();}
 function pagination(){return '<div class="sa-pagination">'+button('Previous','previous')+'<span>'+ (total===0?'0 records':(offset+1)+'–'+Math.min(offset+rows.length,total)+' of '+total)+'</span>'+button('Next','next')+'</div>';}
 function pageButtons(){const p=document.querySelector('[data-sa-action=previous]'),n=document.querySelector('[data-sa-action=next]');if(p)p.disabled=offset===0;if(n)n.disabled=offset+rows.length>=total;}
 async function open(id){
  if(!authorized()||!allowed(ctx.getAccess().role).includes(id))return;
  clearTimeout(refreshTimer);mount();const changed=current!==id;current=id;selectNav();$('saMore').open=false;
  if(changed){offset=0;filter='all';search='';restaurantFilter='';detail=null;document.querySelectorAll('.sa-workspace').forEach(n=>n.replaceChildren());document.querySelectorAll('.sa-advanced').forEach(n=>n.open=false);}
  if(!custom.has(id))return;
  const token=++serial;
  try{
   if(id==='overview')await home(token);
   else if(id==='platform-commission')await commissions(token);
   else if(id==='platform-reports')await reports(token);
   else await listing(token);
  }catch(error){if(valid(token))failed(id,error);}
 }
 async function sourceCount(table,filters=[]){
  // Count only; never read private customer/restaurant rows for Home statistics.
  if(!authorized())throw Error('Super Admin session unavailable');
  let query=ctx.sb.from(table).select('id',{count:'exact',head:true});
  for(const [column,value] of filters)query=query.eq(column,value);
  const {count,error}=await query;
  if(error||!Number.isSafeInteger(count)||count<0)throw Error('Source count unavailable');
  return count;
 }
 async function home(token){
  loading(current,'Super Admin Home');const d=await checked(ctx.sb.rpc('bite_super_admin_overview_v1'));if(!valid(token))return;
  const figures=await Promise.allSettled([
   sourceCount('restaurants'),
   sourceCount('restaurants',[['is_published',true],['status','Active'],['onboarding_status','approved']]),
   sourceCount('orders',[['channel','Own Platform'],['is_demo',false]])
  ]);
  if(!valid(token))return;
  const showCount=i=>figures[i].status==='fulfilled'?esc(figures[i].value):'Unverified';
  const attention=[['Pending restaurant review',d.pending_restaurants,'restaurants','pending'],['Delayed orders',d.delayed_orders,'orders','delayed'],['Refund follow-up',d.refund_followups,'financials','refunds'],['Pending settlements',d.pending_settlements,'financials','settlements'],['Owner access unassigned',d.owner_unassigned,'restaurants','unassigned'],['Customer support',d.open_support,'support','all']];
  host(current).innerHTML=heading('Super Admin Home','Overview · '+d.business_date+' · India time')+'<div class="sa-metrics"><article class="sa-card"><span>Today’s orders</span><strong data-sa-today-orders>'+esc(d.orders_today)+'</strong></article><article class="sa-card"><span>Recorded paid-order value</span><strong data-sa-today-payments>'+money(d.collections_today)+'</strong><small>Internal ledger snapshot; provider and bank confirmation separate</small></article><article class="sa-card"><span>All restaurants</span><strong data-sa-all-restaurants>'+showCount(0)+'</strong><small>Authorised directory total</small></article><article class="sa-card"><span>Published restaurants</span><strong data-sa-active-restaurants>'+showCount(1)+'</strong><small>Approved, active and published</small></article><article class="sa-card"><span>Website orders (all time)</span><strong data-sa-platform-orders>'+showCount(2)+'</strong><small>Non-demo Own Platform orders</small></article></div><section class="sa-card sa-attention"><h2>Needs your attention</h2>'+attention.map(([label,count,route,f])=>'<button type="button" data-sa-attention="'+route+'" data-filter="'+f+'"><span>'+esc(label)+'<b>'+esc(count)+' '+(count===1?'record':'records')+'</b></span><span>View details <span aria-hidden="true">›</span></span></button>').join('')+'</section><p class="sa-footnote">Live platform records · Demo orders excluded · Updated '+esc(when(d.checked_at))+'</p>'+status();
  const readinessHost=document.createElement('div');readinessHost.id='saPilotReadiness';readinessHost.dataset.saUi='';
  host(current).append(readinessHost);
  void root.BitePilotReadiness?.mount?.({client:ctx.sb,container:readinessHost,isCurrent:()=>valid(token)&&current==='overview'});
 }
 async function listing(token){
  const type=current==='financials'?tab:current;
  const titles={restaurants:'Restaurants',orders:'Orders',payments:'Payments',settlements:'Settlements',refunds:'Refunds'};
  loading(current,titles[type]);let q;
  if(type==='restaurants'){
   q=ctx.sb.from('restaurants').select('*',{count:'exact'}).order('created_at',{ascending:false}).order('id');
   if(filter==='pending')q=q.eq('onboarding_status','pending');
   if(filter==='active')q=q.eq('is_published',true).eq('onboarding_status','approved');
   if(filter==='paused')q=q.eq('is_published',false).in('onboarding_status',['approved','suspended']);
   if(search)q=q.ilike('name','%'+search.replace(/[%_\\]/g,'\\$&')+'%');
  }else if(type==='orders'){
   q=ctx.sb.from('orders').select('*',{count:'exact'}).eq('channel','Own Platform').eq('is_demo',false).order('order_date',{ascending:false}).order('id');
   if(filter==='active')q=q.in('status',['Received','New','Accepted','Preparing','Ready','Handed Over']);
   if(filter==='completed')q=q.eq('status','Completed');
   if(filter==='cancelled')q=q.in('status',['Cancelled','Rejected']);
   if(filter!=='delayed'&&restaurantFilter)q=q.eq('restaurant_id',restaurantFilter);
   if(filter!=='delayed'&&search)q=q.ilike('order_code','%'+search.replace(/[%_\\]/g,'\\$&')+'%');
  }else if(type==='payments'){
   q=ctx.sb.from('order_financials').select('*,orders!inner(order_code,channel,is_demo)',{count:'exact'}).eq('channel','Own Platform').eq('is_demo',false).eq('orders.channel','Own Platform').eq('orders.is_demo',false).order('created_at',{ascending:false}).order('id');
   if(filter!=='all')q=q.eq('payment_status',filter);
  }else if(type==='settlements'){
   q=ctx.sb.from('restaurant_settlements').select('*',{count:'exact'}).order('period_start',{ascending:false}).order('id');
   if(filter==='pending')q=q.neq('status','paid');else if(filter!=='all')q=q.eq('status',filter);
  }else{
   q=ctx.sb.from('bite_refund_jobs').select('*,orders!inner(order_code,channel,is_demo)',{count:'exact'}).eq('orders.channel','Own Platform').eq('orders.is_demo',false).order('created_at',{ascending:false}).order('id');
   if(filter==='followup')q=q.in('status',['pending_approval','approved','processing','submitted','failed']);else if(filter!=='all')q=q.eq('status',filter);
  }
  // Exact server predicates, one pagination offset and a snapshot-consistent count.
  const attention=['delayed','unassigned'].includes(filter);
  const response=attention?await ctx.sb.rpc('bite_super_admin_attention_v1',{p_kind:filter,p_offset:offset}):await q.range(offset,offset+24);
  if(!valid(token))return;if(response.error)throw response.error;
  rows=attention?(response.data.rows||[]):response.data||[];
  total=attention?Number(response.data.total_count):response.count??rows.length;
  const options=type==='restaurants'?[['all','All'],['pending','Pending review'],['active','Active'],['paused','Paused'],['unassigned','Owner unassigned']]:type==='orders'?[['all','All'],['active','Active'],['delayed','Delayed'],['completed','Completed'],['cancelled','Cancelled']]:type==='payments'?[['all','All'],['paid','Paid'],['pending','Pending'],['refunded','Refunded'],['partially_refunded','Partially refunded']]:type==='settlements'?[['all','All'],['pending','Pending'],['draft','Draft'],['approved','Approved'],['paid','Paid']]:[['all','All'],['followup','Needs follow-up'],['pending_approval','Requested'],['approved','Approved'],['processing','Processing'],['submitted','Submitted'],['refunded','Refunded'],['failed','Needs attention'],['rejected','Rejected']];
  const choices=type==='orders'&&filter!=='delayed'?(ctx.getState().restaurants||[]).filter(r=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(r?.id)&&typeof r?.name==='string').sort((a,b)=>a.name.localeCompare(b.name)):[];
  const restaurantPicker=type==='orders'&&filter!=='delayed'?'<label>Restaurant<select name="restaurant"><option value="">All restaurants</option>'+choices.map(r=>'<option value="'+esc(r.id)+'" '+(restaurantFilter===r.id?'selected':'')+'>'+esc(r.name)+'</option>').join('')+'</select></label>':'';
  const tabs=current==='financials'?'<div class="sa-tabs" role="tablist" aria-label="Financial records">'+['payments','settlements','refunds'].map(t=>'<button type="button" role="tab" aria-selected="'+(tab===t)+'" data-sa-tab="'+t+'">'+t[0].toUpperCase()+t.slice(1)+'</button>').join('')+'</div>':'';
  host(current).innerHTML=heading(titles[type],type==='orders'?'Website orders · Monitoring':type==='restaurants'?'Review restaurants and help owners sign in':'Collection, refunds and bank payouts have separate statuses')+tabs+'<form id="saListFilters" class="sa-filters"><label>Status<select name="filter">'+options.map(([v,l])=>'<option value="'+v+'" '+(v===filter?'selected':'')+'>'+l+'</option>').join('')+'</select></label>'+restaurantPicker+(['restaurants','orders'].includes(type)&&!(type==='orders'&&filter==='delayed')?'<label class="sa-search">'+(type==='restaurants'?'Search restaurant':'Search order code')+'<input name="search" type="search" maxlength="80" value="'+esc(search)+'" placeholder="Type to search"></label>':'')+'<button class="btn secondary" type="submit">Apply</button></form>'+(type==='orders'&&filter==='delayed'?'<p class="sa-footnote">Delayed orders use a platform-wide server alert rule. Restaurant and order-code filters are not applied to this view.</p>':'')+status()+'<div class="sa-records">'+(rows.length?rows.map(r=>record(type,r)).join(''):'<div class="sa-card sa-empty">No matching records.</div>')+'</div>'+pagination()+(['restaurants','financials'].includes(current)?button('More management tools','advanced',current):'');pageButtons();
 }
 function record(type,r){
  const id=type==='payments'?r.order_id:r.id;
  const title=type==='restaurants'?r.name:type==='orders'?r.order_code:type==='settlements'?restaurantName(r.restaurant_id):r.orders?.order_code||r.order_code||'Order …'+String(r.order_id).slice(-8);
  const state=type==='restaurants'?(r.onboarding_status==='pending'?'Pending review':r.onboarding_status==='rejected'?'Changes requested':r.is_published?'Active':'Paused'):type==='payments'?r.payment_status:r.status;
  const amount=type==='payments'?r.customer_payable_amount:type==='settlements'?r.net_payable:r.amount;
  return '<article class="sa-record"><div class="sa-record-top"><div><h2>'+esc(title)+'</h2><p>'+esc(type==='restaurants'?r.city:restaurantName(r.restaurant_id))+'</p></div>'+pill(state)+'</div>'+(type!=='restaurants'?'<div class="sa-record-facts"><span>'+esc(type==='settlements'?r.period_start+' – '+r.period_end:when(r.order_date||r.created_at))+'</span><strong>'+money(amount)+'</strong></div>':'')+'<div class="sa-record-bottom">'+(type==='payments'?'<span>Commission '+money(r.commission_amount)+'</span>':type==='refunds'?'<span>Gateway: '+esc(r.provider_status||'Awaiting update')+'</span>':'<span></span>')+button('View details','detail',type+':'+id)+'</div></article>';
 }
 async function showDetail(kind,id){
  if(!authorized())return;clearTimeout(refreshTimer);detail={kind,id,loading:true};const token=++serial;const page=current;host(page).innerHTML=heading('Details','',button('Back to list','back'))+'<div class="sa-card">Loading details…</div>'+status();
  try{
   if(kind==='restaurants'){
    const [r,menu,zones,owners]=await Promise.all([checked(ctx.sb.from('restaurants').select('*').eq('id',id).single()),checked(ctx.sb.from('menu_items').select('id,name,price,is_available,is_vegetarian').eq('restaurant_id',id).order('name').limit(1000)),checked(ctx.sb.from('restaurant_delivery_zones').select('id,name,is_active,restaurant_delivery_zone_pincodes(postal_code)').eq('restaurant_id',id).order('name')),checked(ctx.sb.rpc('admin_list_owner_assignments'))]);
    if(!valid(token))return;detail={kind,id,r,menu,zones,owners:owners.filter(o=>o.restaurant_id===id)};const cache=ctx.getState().restaurants;const legacy={...r,onboardingStatus:r.onboarding_status};const found=cache.find(x=>x.id===id);if(found)Object.assign(found,legacy);else cache.push(legacy);renderRestaurant();
   }else if(kind==='settlements'){
    const r=await checked(ctx.sb.from('restaurant_settlements').select('*').eq('id',id).single());if(!valid(token))return;detail={kind,id,r};renderSettlement();
   }else{
    let job=null,orderId=id;if(kind==='refunds'){job=await checked(ctx.sb.from('bite_refund_jobs').select('*').eq('id',id).single());orderId=job.order_id;}
    const [o,f,items,history]=await Promise.all([checked(ctx.sb.from('orders').select('*').eq('id',orderId).eq('channel','Own Platform').eq('is_demo',false).single()),checked(ctx.sb.from('order_financials').select('*').eq('order_id',orderId).eq('channel','Own Platform').eq('is_demo',false).maybeSingle()),checked(ctx.sb.from('order_items').select('*').eq('order_id',orderId).order('created_at')),checked(ctx.sb.from('order_status_history').select('*').eq('order_id',orderId).order('changed_at'))]);
    if(!valid(token))return;detail={kind,id,o,f,items,history,job};renderOrder();
   }
  }catch(error){if(valid(token)){host(page).innerHTML=heading('Details unavailable','',button('Back to list','back'))+status();message(error.message,true);}}
 }
 function renderRestaurant(){
  const {r,menu,zones,owners}=detail,hasOwner=owners.some(o=>o.owner_user_id),profile=String(r.name||'').trim().length>=2&&String(r.address||'').trim().length>=3&&String(r.phone||'').trim().length>=10,hasMenu=menu.some(m=>m.is_available),hasArea=r.accepts_pickup||(r.accepts_delivery&&zones.some(z=>z.is_active&&z.restaurant_delivery_zone_pincodes?.length));
  const checklist=[['Profile',profile?'Complete':'Needs details'],['Menu',hasMenu?'Available':'Needs items'],['Delivery / pickup',hasArea?'Configured':'Needs setup']];
  host(current).innerHTML=heading(r.name,r.city,button('Back to restaurants','back'))+status()+'<div class="sa-detail-grid"><section class="sa-card"><h2>Restaurant profile</h2><dl>'+field('Address',r.address)+field('Contact',r.contact_person)+field('Phone',r.phone)+field('Email',r.email)+field('Listing',r.is_published?'Published':'Not published')+field('Approval',r.onboarding_status)+'</dl>'+(r.onboarding_rejection_reason?'<p class="sa-error">'+esc(r.onboarding_rejection_reason)+'</p>':'')+'<h3>Review checklist</h3><dl>'+checklist.map(x=>field(...x)).join('')+'</dl><p>Delivery areas: '+esc(zones.filter(z=>z.is_active).map(z=>z.name).join(', ')||'None')+(r.accepts_pickup?' · Pickup enabled':'')+'</p><div class="sa-actions">'+(r.onboarding_status!=='approved'?button('Approve restaurant','review','approve',''):r.is_published?button('Pause listing','review','pause'):button('Publish listing','review','publish',''))+button('Request changes','request-changes')+'</div><form id="saRequestChanges" hidden><label>What should the owner change?<textarea name="note" minlength="5" maxlength="1000" required rows="3"></textarea></label><div class="sa-actions"><button type="submit" class="btn">Send request</button>'+button('Cancel','cancel-changes')+'</div></form><p class="sa-footnote">Approval and publishing are separate. Review the menu and delivery setup before approving.</p></section><section class="sa-card"><h2>Owner login assistance</h2><p>'+esc(hasOwner?'Owner login linked':'Owner login not assigned')+'</p>'+owners.filter(o=>o.owner_user_id).map(o=>'<p>'+esc(o.owner_name||o.owner_email||o.owner_user_id)+'</p>').join('')+'<div class="sa-actions">'+(hasOwner?button('Reset owner password','reset-owner',r.id):button('Create owner access','create-owner',r.id))+button('Review owner mapping','advanced','restaurants')+'</div><p class="sa-footnote">Password reset uses the existing verified Owner workflow.</p></section></div><section class="sa-card sa-menu-review"><h2>Menu review</h2><p>Read-only · '+menu.length+' items'+(menu.length===1000?' (first 1,000)':'')+'</p>'+menu.map(m=>'<div class="sa-menu-row"><span>'+esc(m.name)+'<small>'+esc(m.is_vegetarian?'Vegetarian':'Non-vegetarian')+' · '+(m.is_available?'Available':'Paused')+'</small></span><strong>'+money(m.price)+'</strong></div>').join('')+(!menu.length?'<p>No menu items added.</p>':'')+'</section>';
 }
 function renderOrder(){
  const {o,f,items,history,job}=detail;
  const fees=f?.provider_fee_actual,refund=Number(f?.refund_amount_actual||0),share=f&&fees!=null?Number(f.customer_payable_amount)+Number(f.platform_discount||0)-Number(f.commission_amount)-Number(fees)-refund:null;
  host(current).innerHTML=heading(job?'Refund details':o.order_code,restaurantName(o.restaurant_id),button('Back to list','back'))+status()+'<div class="sa-detail-grid"><section class="sa-card"><h2>'+esc(job?o.order_code:'Order details')+'</h2><dl>'+field('Order status',o.status)+field('Created',when(o.order_date))+field('Customer',o.customer_name)+field('Phone',o.customer_phone)+field('Service',o.delivery_type)+'</dl>'+(job?'<h3>Refund</h3><dl>'+field('Requested amount',money(job.amount))+field('Request status',job.status)+field('Gateway status',job.provider_status||'Awaiting update')+field('Gateway refund reference',job.provider_refund_id)+field('Last checked',when(job.provider_checked_at))+field('Reason',job.reason)+'</dl>':'<h3>Order items</h3>'+items.map(i=>'<div class="sa-menu-row"><span>'+esc(i.item_name)+' × '+esc(i.quantity)+'</span><strong>'+money(i.line_total)+'</strong></div>').join(''))+'</section><section class="sa-card"><h2>Payment breakdown</h2><dl>'+field('Customer payment',f?.payment_status||'Not recorded')+field('Total',money(f?.customer_payable_amount))+field('Bite commission',money(f?.commission_amount))+field('Actual gateway fee',money(fees))+field('Ledger-recorded refund',money(f?.refund_amount_actual))+field('Restaurant payable',money(share))+field('Settlement',f?.settlement_status||'Not recorded')+'</dl><p class="sa-footnote">Restaurant payable is a ledger amount. Bank payout requires separate confirmation.</p><div class="sa-actions">'+button('Check status','check-provider',job?'refund':'payment')+button('Review issue','support')+'</div><p id="saProviderResult" class="sa-provider-result" role="status"></p></section></div><section class="sa-card"><h2>'+(job?'Refund timeline':'Order timeline')+'</h2><ol class="sa-timeline">'+(job?'<li><b>Request received</b><span>'+esc(when(job.created_at))+'</span></li>'+(job.approved_at?'<li><b>Approved</b><span>'+esc(when(job.approved_at))+'</span></li>':'')+'<li><b>'+esc(job.status==='refunded'?'Provider-confirmed refund':job.status==='failed'?'Needs attention':'Awaiting completion')+'</b><span>'+esc(job.provider_status||'Provider confirmation pending')+'</span></li>':history.map(h=>'<li><b>'+esc(h.to_status)+'</b><span>'+esc(when(h.changed_at))+'</span>'+(h.note?'<p>'+esc(h.note)+'</p>':'')+'</li>').join('')||'<li>No status history recorded.</li>')+'</ol></section>';
 }
 function renderSettlement(){const r=detail.r;host(current).innerHTML=heading('Settlement details',restaurantName(r.restaurant_id),button('Back to list','back'))+status()+'<section class="sa-card"><dl>'+field('Period',r.period_start+' – '+r.period_end)+field('Recorded status',r.status)+field('Gross order value',money(r.gross_order_value))+field('Commission',money(r.commission_total))+field('Actual gateway fees',money(r.provider_fees_actual))+field('Confirmed refunds',money(r.refunds_actual))+field('Net payable',money(r.net_payable))+field('Recorded amount paid',money(r.amount_paid))+field('Provider reference',r.provider_reference)+field('Paid at',when(r.paid_at))+'</dl><p>Drafts do not send money. A collection status does not confirm restaurant bank credit.</p>'+button('Refresh recorded status','settlement-refresh')+button('Provider evidence tools','advanced','financials')+'</section>';}
 async function review(action,note=''){
  if(!detail||detail.kind!=='restaurants')return;const d=detail,token=serial;
  if(!confirm(({approve:'Approve this restaurant? Publishing remains a separate step.',publish:'Publish this approved restaurant on the customer website?',pause:'Pause this listing on the customer website?',request_changes:'Send these changes to the restaurant owner?'})[action]))return;
  try{await checked(ctx.sb.rpc('bite_super_admin_review_v1',{p_restaurant_id:d.id,p_action:action,p_note:note,p_expected_updated_at:d.r.updated_at}));if(!valid(token))return;await ctx.reload({silent:true,throwOnError:true});if(!authorized()||current!=='restaurants')return;await showDetail('restaurants',d.id);message('Saved and added to the audit log.');}catch(e){if(valid(token))message(e.message,true);}
 }
 async function providerCheck(buttonNode){
  if(!detail?.o)return;const d=detail,token=serial;buttonNode.disabled=true;const target=$('saProviderResult');target.textContent='Checking existing provider records…';
  try{
   const result=await checked(ctx.sb.functions.invoke('bite-cashfree-operations',{body:d.job?{action:'inspect_refund',refund_id:d.job.id}:{action:'reconcile',order_id:d.o.id}}));if(!valid(token))return;
   if(d.job){if(result.no_action_taken!==true||result.recorded_refund_status!==d.job.status||!Number.isFinite(Number(result.amount))||Math.abs(Number(result.amount)-Number(d.job.amount))>.001||!['PROVIDER_REFUND_RECORD_FOUND','NO_PROVIDER_REFUND_RECORD'].includes(result.status))throw Error('Refund evidence could not be verified.');target.textContent=result.status==='NO_PROVIDER_REFUND_RECORD'?'No provider refund record found. Completion is not confirmed.':'Cashfree refund status: '+String(result.provider_refund_status||'Unknown')+'. Bank credit is not independently confirmed.';}
   else{const c=result.collection;if(!c||!Number.isFinite(Number(c.amount)))throw Error('Provider evidence missing.');const amountMatches=!!d.f&&Math.abs(Number(c.amount)-Number(d.f.customer_payable_amount))<0.001;target.textContent='Cashfree collection: '+String(c.status||'Unknown')+' · '+money(c.amount)+(amountMatches?'':' · Amount mismatch: review required')+'. Platform bank settlement: '+String(result.platform_bank_settlement?.status||'Awaiting confirmation')+'. Restaurant bank payout: not independently verified.';}
  }catch(e){if(valid(token))target.textContent='Status check failed: '+e.message;}
  finally{if(valid(token))buttonNode.disabled=false;}
 }
 async function commissions(token){
  loading(current,'Commission');const s=await checked(ctx.sb.from('platform_settings').select('id,default_commission_rate').eq('id',1).single());if(!valid(token))return;commission=s;
  const restaurants=ctx.getState().restaurants||[];
  host(current).innerHTML=heading('Commission','Rates apply to future checkout snapshots. Existing payments stay unchanged.')+status()+'<section class="sa-card"><form id="saCommissionForm"><label>Scope<select name="scope"><option value="">Platform default</option>'+restaurants.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>').join('')+'</select></label><label>Commission (%)<input name="rate" type="number" min="0" max="100" step="0.01" required value="'+esc(s.default_commission_rate)+'"></label><label class="sa-checkbox"><input name="inherit" type="checkbox" disabled> Use platform default for this restaurant</label><p id="saCommissionHint">Current default: '+esc(s.default_commission_rate)+'%</p><button class="btn" type="submit">Save commission</button></form></section>';
 }
 async function scopeChanged(){
  const form=$('saCommissionForm'),rid=form.elements.scope.value,token=serial,request=++commissionRequest,submit=form.querySelector('[type=submit]');
  submit.disabled=true;form.dataset.ready='false';let rate=commission.default_commission_rate;
  try{
   if(rid){const r=await checked(ctx.sb.from('restaurants').select('id,platform_commission_rate').eq('id',rid).single());rate=r.platform_commission_rate;}
   if(!valid(token)||request!==commissionRequest||form.elements.scope.value!==rid)return;
   form.dataset.expected=rate==null?'null':String(rate);form.elements.inherit.disabled=!rid;form.elements.inherit.checked=!!rid&&rate==null;form.elements.rate.disabled=!!rid&&rate==null;form.elements.rate.value=rate??commission.default_commission_rate;form.dataset.ready='true';submit.disabled=false;
   $('saCommissionHint').textContent=rate==null?'Using platform default: '+commission.default_commission_rate+'%':'Current rate: '+rate+'%';
  }catch(e){if(valid(token)&&request===commissionRequest)message('Could not load the current rate. Refresh before saving. '+e.message,true);}
 }
 async function saveCommission(form,submit){if(form.dataset.ready==='false')return;const rid=form.elements.scope.value||null,rate=form.elements.inherit.checked?null:Number(form.elements.rate.value),expected=form.dataset.expected==='null'?null:form.dataset.expected==null?commission.default_commission_rate:Number(form.dataset.expected),token=serial;if(!confirm('Save commission for future checkouts? Existing order snapshots will stay unchanged.'))return;submit.disabled=true;try{await checked(ctx.sb.rpc('bite_super_admin_commission_v1',{p_restaurant_id:rid,p_rate:rate,p_expected_rate:expected}));if(!valid(token))return;form.dataset.expected=rate==null?'null':String(rate);if(!rid)commission.default_commission_rate=rate;message('Commission saved and audit logged. Existing order snapshots unchanged.');}catch(e){if(valid(token))message(e.message,true);}finally{if(valid(token))submit.disabled=false;}}
 async function reports(token,range){
  const from=range?.from||today().slice(0,7)+'-01',to=range?.to||today();loading(current,'Reports');const d=await checked(ctx.sb.rpc('bite_admin_business_metrics',{p_from:from,p_to:to}));if(!valid(token))return;report={from,to,data:d};
  const metrics=[['Ledger-recorded collections',money(d.verified_collections)],['Paid orders',d.paid_order_count??0],['Completed orders',d.completed_orders],['Booked commission',money(d.commission_booked)],['Ledger-recorded refunds',money(d.provider_confirmed_refunds)],['Actual gateway fees',money(d.gateway_fee_actual)]];
  host(current).innerHTML=heading('Reports','India business dates · Demo orders excluded',button('Export CSV','export'))+'<form id="saReportForm" class="sa-filters"><label>From<input name="from" type="date" required value="'+from+'"></label><label>To<input name="to" type="date" required value="'+to+'"></label><button class="btn secondary" type="submit">Update report</button></form>'+status()+'<div class="sa-metrics sa-report-metrics">'+metrics.map(([l,v])=>'<article class="sa-card"><span>'+esc(l)+'</span><strong>'+esc(v)+'</strong></article>').join('')+'</div><div class="sa-card"><h2>Data coverage</h2><p>'+esc(d.coverage_note)+'</p><p>Booked commission is ledger-booked revenue, not bank-verified earnings. Cashfree settlements, customer refunds and restaurant payouts need independent evidence.</p></div>';
 }
 function exportReport(){if(!report)return;const csv=v=>{const raw=String(v??'');const guarded=/^[\s\u0000-\u001f]*[=+@-]/.test(raw)?"'"+raw:raw;return '"'+guarded.replaceAll('"','""')+'"';};const exportNames={verified_collections:'Ledger-recorded collections (provider/bank verification separate)',provider_confirmed_refunds:'Ledger-recorded refunds (customer bank credit not proven)'};const body=[['From',report.from],['To',report.to],['Evidence','Internal ledger snapshots only; bank credit and vendor payout are not certified'],...Object.entries(report.data).map(([key,value])=>[exportNames[key]||key,value])].map(r=>r.map(csv).join(',')).join('\r\n');const link=document.createElement('a'),url=URL.createObjectURL(new Blob(['\ufeff'+body],{type:'text/csv;charset=utf-8'}));link.href=url;link.download='bite-platform-report-'+report.from+'-'+report.to+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function advanced(id){
  if(!['restaurants','financials'].includes(id))return;
  if(current!==id){await ctx.navigate(id);if(!authorized())return;}
  let tools=$(id).querySelector('.sa-advanced');if(!tools){tools=document.createElement('details');tools.className='sa-advanced';tools.innerHTML='<summary>Management tools</summary>';$(id).append(tools);}
  tools.open=true;await ctx.advanced(id);if(!authorized())return;
  for(const child of [...$(id).children])if(child!==host(id)&&child!==tools){child.classList.remove('sa-legacy');tools.append(child);}
  labelTables(id);tools.scrollIntoView({block:'start',behavior:'smooth'});
 }
 function labelTables(id){for(const table of $(id)?.querySelectorAll('table')||[]){const labels=[...table.querySelectorAll('thead th')].map(t=>t.textContent);for(const row of table.querySelectorAll('tbody tr'))[...row.children].forEach((cell,i)=>cell.dataset.saLabel=labels[i]||'Details');}}
 async function navigate(id){if(!authorized()||!allowed(ctx.getAccess().role).includes(id))return;$('saMore').open=false;await ctx.navigate(id);}
 function clear(){restoreLanguage();serial++;commissionRequest++;clearTimeout(refreshTimer);actor=null;current='overview';tab='payments';offset=0;filter='all';search='';restaurantFilter='';rows=[];detail=null;commission=null;report=null;document.querySelectorAll('.sa-workspace').forEach(n=>n.replaceChildren());$('saMore')?.removeAttribute('open');if($('saAccount'))$('saAccount').textContent='';}
 function init(config){ctx=config;setInterval(()=>{if(authorized()&&document.visibilityState==='visible'&&['overview','orders','financials'].includes(current)&&!detail&&!document.activeElement?.closest('form'))void open(current);},60000);document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-sa-route],[data-sa-attention],[data-sa-tab],[data-sa-action]');if(!el||!el.closest('[data-sa-ui]')||!authorized())return;
  if(el.dataset.saRoute){await navigate(el.dataset.saRoute);return;}
  if(el.dataset.saAttention){const dest=el.dataset.saAttention,f=el.dataset.filter;if(dest==='financials')tab=f;await navigate(dest);if(dest==='financials'){filter=f==='settlements'?'pending':'followup';offset=0;await open(dest);}else if(f!=='all'){filter=f;offset=0;await open(dest);}return;}
  if(el.dataset.saTab){tab=el.dataset.saTab;filter='all';offset=0;detail=null;await open('financials');return;}
  const action=el.dataset.saAction,id=el.dataset.id;
  if(['refresh','back'].includes(action)){detail=null;await open(current);}
  else if(action==='detail'){const split=id.indexOf(':');await showDetail(id.slice(0,split),id.slice(split+1));}
  else if(action==='next'||action==='previous'){offset=Math.max(0,offset+(action==='next'?25:-25));await open(current);}
  else if(action==='advanced')await advanced(id);
  else if(action==='review'){el.disabled=true;try{await review(id);}finally{el.disabled=false;}}
  else if(action==='request-changes'){$('saRequestChanges').hidden=false;$('saRequestChanges').elements.note.focus();}
  else if(action==='cancel-changes')$('saRequestChanges').hidden=true;
  else if(action==='reset-owner')await ctx.resetOwner(id);
  else if(action==='create-owner')ctx.createOwner(id);
  else if(action==='check-provider')await providerCheck(el);
  else if(action==='settlement-refresh')await showDetail('settlements',detail.id);
  else if(action==='support')await navigate('support');
  else if(action==='export')exportReport();
  else if(action==='logout')await ctx.logout();
 });
 document.addEventListener('submit',async e=>{if(!e.target.closest('[data-sa-ui]')||!authorized())return;const f=e.target;
  if(!['saListFilters','saRequestChanges','saCommissionForm','saReportForm'].includes(f.id))return;e.preventDefault();
  if(f.id==='saListFilters'){filter=f.elements.filter.value;search=(filter==='delayed'?'':f.elements.search?.value||'').trim();restaurantFilter=current==='orders'&&filter!=='delayed'?(f.elements.restaurant?.value||''):'';offset=0;await open(current);}
  else if(f.id==='saRequestChanges'){e.submitter.disabled=true;try{await review('request_changes',f.elements.note.value.trim());}finally{e.submitter.disabled=false;}}
  else if(f.id==='saCommissionForm')await saveCommission(f,e.submitter);
  else {const token=++serial;try{await reports(token,{from:f.elements.from.value,to:f.elements.to.value});}catch(error){if(valid(token))message(error.message,true);}}
 });
 document.addEventListener('change',e=>{if(!authorized())return;const f=e.target.closest('#saCommissionForm');if(!f)return;if(e.target.name==='scope')void scopeChanged();if(e.target.name==='inherit')f.elements.rate.disabled=e.target.checked;});
 }
 root.BiteSuperAdmin={init,mount,open,handles:id=>authorized()&&custom.has(id),allowed,clear,afterPage:id=>{if(authorized()){current=id;selectNav();labelTables(id);}},refresh:()=>{if(!authorized())return;mount();clearTimeout(refreshTimer);if(['overview','orders','financials'].includes(current)&&$('sa-'+current)&&!detail&&!document.activeElement?.closest('form'))refreshTimer=setTimeout(()=>{if(authorized()&&!detail)void open(current);},250);},escape:esc};
})(window);
