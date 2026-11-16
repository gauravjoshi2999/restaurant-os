/* Bite Owner V2: one capability-aware Command Center on top of existing operational data.
   Presentation only. No synthetic bookings, orders, payments or financial calculations. */
(function(root){
 'use strict';
 const actionCatalog={
  'hotel-register':{label:'Front Desk',hint:'Check in guests and manage arrivals',icon:'register'},
  reservations:{label:'Reservations',hint:'Upcoming stays and bookings',icon:'calendar'},
  rooms:{label:'Rooms',hint:'Room board, readiness and occupancy',icon:'bed'},
  guests:{label:'Guests',hint:'Search returning guests',icon:'people'},
  folios:{label:'Guest Bills',hint:'Room, food and final guest bill',icon:'receipt'},
  housekeeping:{label:'Housekeeping',hint:'Cleaning and room readiness',icon:'sparkles'},
  orders:{label:'Live Orders',hint:'Accept and fulfil paid orders',icon:'orders'},
  pos:{label:'POS Billing',hint:'Counter, takeaway and dine-in billing',icon:'pos'},
  menu:{label:'Menu',hint:'Manage dishes, prices and availability',icon:'menu'},
  tables:{label:'Tables',hint:'Manage dine-in service',icon:'table'},
  inventory:{label:'Stock',hint:'Inventory overview',icon:'package'},
  expenses:{label:'Expenses',hint:'Daily spending',icon:'wallet'},
  hr:{label:'Team',hint:'Attendance and staff',icon:'people'},
  reports:{label:'Reports',hint:'Business insight and trends',icon:'chart'},
  cashbook:{label:'Cashbook',hint:'Closing and cash reconciliation',icon:'wallet'}
 };
 const paths={
  bed:'<rect x="3" y="10" width="18" height="8" rx="2"/><path d="M3 18v3m18-3v3M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M7 8h3m4 0h3"/>',
  register:'<path d="M8 3h8l2 3v15H6V6zM9 3v4h6V3M9 12h6M9 16h4"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h3"/>',
  people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5"/>',
  receipt:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM9 8h6M9 12h6M9 16h3"/>',
  sparkles:'<path d="m12 2 2.3 6.7L21 11l-6.7 2.3L12 20l-2.3-6.7L3 11l6.7-2.3z"/>',
  orders:'<path d="M6 7h12l2 14H4zM9 8V6a3 3 0 0 1 6 0v2"/>',
  pos:'<rect x="3" y="3" width="18" height="15" rx="2"/><path d="M7 7h10M7 11h6M8 21h8m-4-3v3"/>',
  menu:'<path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5"/>',
  table:'<path d="M3 9h18v4H3zM6 13v8m12-8v8M9 5h6"/>',
  package:'<path d="m12 2 9 5-9 5-9-5zM3 7v10l9 5 9-5V7M12 12v10"/>',
  wallet:'<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 9V5a2 2 0 0 1 2-2h12M16 13h5v4h-5a2 2 0 0 1 0-4z"/>',
  chart:'<path d="M4 21V3m0 18h17M8 17v-6m5 6V7m5 10V4"/>',
  arrow:'<path d="m9 18 6-6-6-6"/>',
  check:'<path d="m5 12 4 4L19 6"/>'
 };
 const presets={
  hotel:['hotel-register','rooms','reservations','folios','housekeeping','guests','reports'],
  restaurant:['orders','pos','menu','inventory','reports','hr','expenses'],
  hybrid:['hotel-register','orders','rooms','pos','reservations','folios','menu','housekeeping','reports','hr']
 };
 const copy={
  hotel:{eyebrow:'HOTEL COMMAND CENTER',title:'Your hotel, beautifully in control.',subtitle:'Arrivals, rooms and guest care — one clear workspace.'},
  restaurant:{eyebrow:'RESTAURANT COMMAND CENTER',title:'Every order. Every moment. In control.',subtitle:'Live orders and smooth billing in one focused space.'},
  hybrid:{eyebrow:'HOTEL + RESTAURANT',title:'One property. Everything in control.',subtitle:'A clearer day for your front desk and restaurant.'}
 };
 const svg=key=>'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'+(paths[key]||paths.chart)+'</svg>';
 const el=(tag,cls,text)=>{const node=root.document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node};
 const routeButton=(route,text,cls='')=>{const b=el('button',cls,text);b.type='button';b.dataset.page=route;return b};
 function actionsFor(type,allowed){
  const allow=new Set(Array.isArray(allowed)?allowed:[]);
  return (presets[type]||presets.restaurant).filter(id=>allow.has(id)).map(id=>({page:id,...actionCatalog[id]}));
 }
 function viewModel(type,allowed,snapshot){
  const allowedSet=new Set(allowed||[]),known=snapshot||{};
  const rows=[],metrics=[];
  function addMetric(label,value,icon,page,tip){
   if(allowedSet.has(page))metrics.push({label,value:value==null?'—':String(value),icon,page,tip:tip||''});
  }
  function addAttention(title,value,page,icon){
   if(allowedSet.has(page)&&typeof value==='number'&&value>0)rows.push({title,count:value,page,icon});
  }
  if(type==='hotel'||type==='hybrid'){
   addMetric('Occupied rooms',known.occupied,'bed','rooms');
   addMetric('Expected arrivals',known.arrivals,'calendar','reservations');
   addAttention('Rooms need housekeeping',known.cleaning,'housekeeping','sparkles');
   addAttention('Guest arrivals to prepare',known.arrivals,'reservations','calendar');
   addAttention('Checkouts due',known.departures,'rooms','bed');
  }
  if(type==='restaurant'||type==='hybrid'){
   addMetric('New paid orders',known.newOrders,'orders','orders','Payment-verified online orders');
   addAttention('New paid orders to accept',known.newOrders,'orders','orders');
  }
  if(type==='hotel'){
   addMetric('Rooms ready',known.available,'check','rooms');
   addMetric('Open folios',known.openFolios,'receipt','folios');
  }else if(type==='hybrid'){
   addMetric('Housekeeping queue',known.cleaning,'sparkles','housekeeping');
  }
  return {metrics,rows};
 }
 function attentionStatus(rows,snapshot){
  if(Array.isArray(rows)&&rows.length)return 'urgent';
  if(!snapshot||snapshot.ready===false)return 'loading';
  if(snapshot.restaurant&&snapshot.newOrders==null)return 'unavailable';
  return 'clear';
 }
 function render(){
  const doc=root.document,home=doc?.getElementById('overview');
  const hotel=root.BiteHospitality,property=hotel?.prop?.(),role=doc?.body?.dataset?.role;
  let node=doc?.getElementById('bitePremiumHome');
  if(!home||role!=='owner'||!property){
   node?.remove();doc?.body?.classList.remove('bite-premium-ready');return;
  }
  const type=['hotel','restaurant','hybrid'].includes(property.business_type)?property.business_type:'restaurant';
  const routes=hotel.routeList({role:'owner',property})||[];
  const actions=actionsFor(type,routes);
  if(!actions.length){node?.remove();doc.body.classList.remove('bite-premium-ready');return;}
  const snapshot=hotel.dashboardSnapshot?.()||null;
  const signature=[property.id,type,routes.join(','),JSON.stringify(snapshot)].join('|');
  if(node?.dataset.signature===signature)return;
  if(!node){node=el('section','bite-premium-home');node.id='bitePremiumHome';node.setAttribute('aria-label','Owner Command Center');home.prepend(node)}
  node.replaceChildren();node.dataset.signature=signature;node.dataset.mode=type;
  const hero=el('header','bite-premium-hero');
  const copyBlock=el('div','bite-premium-hero-copy');
  copyBlock.append(el('span','bite-premium-eyebrow',copy[type].eyebrow),el('h1','',copy[type].title),el('p','',copy[type].subtitle));
  copyBlock.append(el('span','bite-premium-property',property.name||'Your business'));
  const primary=el('div','bite-premium-hero-actions');
  const preferences=type==='hotel'?['hotel-register','rooms']:type==='restaurant'?['orders','pos']:['hotel-register','orders'];
  for(const page of preferences){
   if(!routes.includes(page))continue;
   const b=routeButton(page,(page==='hotel-register'?'Open front desk':page==='rooms'?'View room board':page==='orders'?'Live orders':'New POS bill')+'  →','bite-premium-hero-cta');
   if(page==='orders')b.classList.add('is-secondary');
   if(page==='pos')b.dataset.billAction='open';
   primary.append(b);
  }
  copyBlock.append(primary);
  const motif=el('div','bite-premium-motif');
  motif.setAttribute('aria-hidden','true');motif.innerHTML='<span class="bite-premium-motif-orbit"></span><span class="bite-premium-motif-icon">'+svg(type==='hotel'?'bed':type==='restaurant'?'orders':'sparkles')+'</span>';
  hero.append(copyBlock,motif);
  node.append(hero);
  const vm=viewModel(type,routes,snapshot);
  const overview=el('section','bite-premium-today');
  overview.append(el('div','bite-premium-section-label','LIVE OPERATIONS'));
  const overviewHead=el('div','bite-premium-section-heading');overviewHead.append(el('h2','','Business overview'),el('span','','Real operational data'));
  overview.append(overviewHead);
  const grid=el('div','bite-premium-metric-grid');
  for(const metric of vm.metrics){
   const b=routeButton(metric.page,'','bite-premium-metric');
   b.setAttribute('aria-label',metric.label+': '+metric.value+'. Open '+metric.page);
   const badge=el('span','bite-premium-metric-icon');badge.innerHTML=svg(metric.icon);
   b.append(badge,el('strong','',metric.value),el('span','',metric.label));
   if(metric.tip)b.title=metric.tip;
   grid.append(b);
  }
  if(!vm.metrics.length)grid.append(el('p','bite-premium-neutral','Your enabled business tools will appear here.'));
  overview.append(grid);node.append(overview);
  const attention=el('section','bite-premium-attention');
  const attentionMode=attentionStatus(vm.rows,snapshot);
  attention.dataset.state=attentionMode;
  const attHead=el('div','bite-premium-section-heading');
  attHead.append(el('h2','',attentionMode==='clear'?'All caught up':'Needs attention'),el('span','bite-premium-live-label',attentionMode==='urgent'?'Action required':'Latest available status'));
  attention.append(attHead);
  const list=el('div','bite-premium-attention-list');
  if(attentionMode==='urgent'){
   for(const item of vm.rows){
    const b=routeButton(item.page,'','bite-premium-attention-item');
    const ico=el('span','bite-premium-attention-icon');ico.innerHTML=svg(item.icon);
    const content=el('span','bite-premium-attention-text');
    content.append(el('strong','',String(item.count)+' '+item.title),el('small','','Tap to open '+(actionCatalog[item.page]?.label||'workspace')));
    const arrow=el('span','bite-premium-attention-arrow');arrow.innerHTML=svg('arrow');
    b.append(ico,content,arrow);list.append(b);
   }
  }else if(attentionMode==='loading'){
   list.append(el('p','bite-premium-neutral','Checking your current business status…'));
  }else if(attentionMode==='unavailable'){
   list.append(el('p','bite-premium-neutral','Order status is not yet verified. Open Orders to check.'));
  }else{
   const clean=el('p','bite-premium-all-clear');clean.innerHTML=svg('check')+'<span>No urgent tasks in the latest available data.</span>';list.append(clean);
  }
  attention.append(list);node.append(attention);
  const work=el('section','bite-premium-workspaces');
  const workHead=el('div','bite-premium-section-heading');workHead.append(el('h2','','Workspaces'),el('span','','Your daily tools'));
  work.append(workHead);
  const cards=el('div','bite-premium-actions');
  const featured=actions.filter(a=>['hotel-register','rooms','orders','pos','menu','reports'].includes(a.page)).slice(0,5);
  for(const action of featured){
   const b=routeButton(action.page,'','bite-premium-action');
   const icon=el('span','bite-premium-action-icon');icon.innerHTML=svg(action.icon);
   b.append(icon,el('strong','',action.label),el('small','',action.hint),el('span','bite-premium-chevron','↗'));
   cards.append(b);
  }
  work.append(cards);node.append(work);
  doc.body.classList.add('bite-premium-ready');
 }
 function navigate(button){
  if(!button?.closest?.('#bitePremiumHome'))return;
  const property=root.BiteHospitality?.prop?.();
  const routes=root.BiteHospitality?.routeList?.({role:'owner',property})||[];
  const page=button.dataset.page;
  if(!routes.includes(page))return;
  if(button.dataset.billAction==='open'&&page==='pos'&&typeof root.openPosFromOverview==='function'){
   void Promise.resolve(root.openPosFromOverview(button)).catch(e=>root.console?.warn?.('Could not open POS bill',e));return;
  }
  if(typeof root.showPage==='function')void Promise.resolve(root.showPage(page)).catch(e=>root.console?.warn?.('Owner navigation failed',e));
 }
 function start(){
  root.document.getElementById('overview')?.addEventListener('click',e=>{const button=e.target.closest('#bitePremiumHome button[data-page]');if(button)navigate(button)});
  render();
  if(typeof root.MutationObserver==='function'){
   const observer=new root.MutationObserver(render);
   observer.observe(root.document.body,{attributes:true,attributeFilter:['data-role','data-business-type','data-universal-owner','data-restaurant-access']});
  }
  root.addEventListener('bite:capabilities',render);
  root.addEventListener('bite:owner-summary',render);
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={actionsFor,viewModel,attentionStatus,presets,copy};
 if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start()}
})(typeof window!=='undefined'?window:globalThis);
