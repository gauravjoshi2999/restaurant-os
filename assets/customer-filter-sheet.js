/* Bite customer discovery filters: accessible mobile sheet over existing verified selectors.
 * No new orders, payment mutations, ratings or availability claims. */
(function(root){
 'use strict';
 const SORTS=['recommended','rating','price','delivery_fee','fast'];
 const RATINGS=['0','3.5','4','4.5'];
 const DIETS=['all','veg','nonveg'];
 const SERVICES=['all','delivery','pickup'];
 const defaults=()=>({sort:'recommended',rating:'0',diet:'all',service:'all',openNow:false,scheduleOnly:false,category:'all',favourites:false});
 const valid=(value,choices,fallback)=>choices.includes(String(value))?String(value):fallback;
 function normalized(input={}){
  const d=defaults();
  return {sort:valid(input.sort,SORTS,d.sort),rating:valid(input.rating,RATINGS,d.rating),
   diet:valid(input.diet,DIETS,d.diet),service:valid(input.service,SERVICES,d.service),
   openNow:input.openNow===true,scheduleOnly:input.scheduleOnly===true,category:String(input.category||'all'),
   favourites:input.favourites===true};
 }
 function filterOptions(input,extras={}){
  const s=normalized(input);
  return {query:extras.query||'',category:s.category,service:s.service,
   fast:s.sort==='fast',geo:extras.geo||null,pin:extras.pin||'',
   openNow:s.openNow,scheduledOnly:s.scheduleOnly,favourites:s.favourites?(extras.favouriteIds||new Set()):null,
   diet:s.diet,minRating:Number(s.rating),
   sort:s.sort==='fast'?'recommended':s.sort};
 }
 const api={defaults,normalized,filterOptions};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof document==='undefined'||!document.querySelector('body[data-bite-app="customer"]'))return;
 if(typeof BITE_DIRECT_MODE!=='undefined'&&BITE_DIRECT_MODE)return;
 const tools=document.getElementById('discoveryTools');
 if(!tools||document.getElementById('biteFilterOpen'))return;
 const byId=id=>document.getElementById(id);
 const trigger=document.createElement('button');
 trigger.type='button';trigger.id='biteFilterOpen';
 trigger.className='tool-chip bite-filter-trigger';
 trigger.setAttribute('aria-haspopup','dialog');
 trigger.setAttribute('aria-controls','biteFilterBackdrop');
 trigger.innerHTML='<span aria-hidden="true">☷</span><span>Filters &amp; sorting</span><span class="bite-filter-trigger-count" id="biteFilterAppliedCount" hidden></span>';
 tools.insertBefore(trigger,tools.firstChild);

 const overlay=document.createElement('div');
 overlay.id='biteFilterBackdrop';overlay.className='bite-filter-backdrop';
 overlay.hidden=true;
 overlay.innerHTML=
  '<section class="bite-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="biteFilterTitle" aria-describedby="biteFilterSubtitle">'+
   '<div class="bite-filter-grip" aria-hidden="true"></div>'+
   '<header class="bite-filter-heading"><div><h2 id="biteFilterTitle">Filters &amp; sorting</h2><p id="biteFilterSubtitle">Find the food you want, faster.</p></div>'+
    '<button id="biteFilterClear" type="button" class="bite-filter-clear">Clear all</button>'+
    '<button id="biteFilterCloseX" type="button" class="bite-filter-icon-close" aria-label="Close filters">×</button></header>'+
   '<div class="bite-filter-body"><nav class="bite-filter-rail" role="tablist" aria-label="Filter categories" aria-orientation="vertical">'+
    '<button type="button" id="biteFilterTabSort" role="tab" aria-controls="biteFilterPanel" data-filter-tab="sort"><span aria-hidden="true">↕</span>Sort by</button>'+
    '<button type="button" id="biteFilterTabTime" role="tab" aria-controls="biteFilterPanel" data-filter-tab="time"><span aria-hidden="true">◷</span>Time</button>'+
    '<button type="button" id="biteFilterTabRating" role="tab" aria-controls="biteFilterPanel" data-filter-tab="rating"><span aria-hidden="true">★</span>Rating</button>'+
    '<button type="button" id="biteFilterTabDiet" role="tab" aria-controls="biteFilterPanel" data-filter-tab="diet"><span aria-hidden="true">◇</span>Food</button>'+
    '<button type="button" id="biteFilterTabService" role="tab" aria-controls="biteFilterPanel" data-filter-tab="service"><span aria-hidden="true">⌁</span>Service</button>'+
   '</nav>'+
   '<div class="bite-filter-content" role="tabpanel" id="biteFilterPanel" aria-labelledby="biteFilterTabSort" tabindex="0"></div></div>'+
   '<footer class="bite-filter-actions"><button type="button" id="biteFilterCancel">Close</button>'+
    '<button type="button" class="bite-filter-apply" id="biteFilterApply">Show results</button></footer>'+
  '</section>';
 document.body.appendChild(overlay);

 const panel=byId('biteFilterPanel');
 const sections=['sort','time','rating','diet','service'];
 let draft=defaults(),original=defaults(),section='sort',lastFocused=null,open=false;
 function fromPage(){
  return normalized({
   sort:root.restaurantSortFast?'fast':byId('discoverySort')?.value,
   rating:byId('discoveryRating')?.value,diet:byId('discoveryDiet')?.value,
   service:root.restaurantServiceFilter||'all',
   openNow:byId('filterOpenNow')?.getAttribute('aria-pressed')==='true',
   scheduleOnly:root.BiteScheduleDiscoveryOnly===true,
   category:typeof activeFilter!=='undefined'?activeFilter:'all',
   favourites:byId('filterFavourites')?.getAttribute('aria-pressed')==='true'
  });
 }
 function selection(label,value,selected,group){
  const checked=selected?' checked':'';
  return '<label class="bite-filter-option"><input type="radio" name="bite-filter-'+group+
   '" value="'+value+'"'+checked+'><span>'+label+'</span><span class="bite-filter-check" aria-hidden="true">✓</span></label>';
 }
 function liveCount(){
  try{
   if(root.biteStorefrontLoading||typeof restaurants==='undefined'||typeof publicMenuSearch==='undefined')return null;
   const opts=filterOptions(draft,{query:byId('homeSearchInput')?.value.trim()||'',
    pin:typeof currentDiscoveryPin!=='undefined'?currentDiscoveryPin:'',
    geo:typeof customerGeo!=='undefined'?customerGeo:null,
    favouriteIds:typeof favouriteRestaurantIds!=='undefined'?favouriteRestaurantIds:new Set()});
   return BiteDiscovery.selectRestaurants(restaurants,publicMenuSearch,opts).length;
  }catch{return null;}
 }
 function activeFilters(state=draft){
  const s=normalized(state);
  return Number(s.sort!=='recommended')+Number(s.rating!=='0')+Number(s.diet!=='all')+
   Number(s.service!=='all')+Number(s.openNow)+Number(s.scheduleOnly)+Number(s.category!=='all')+Number(s.favourites);
 }
 function updateCount(){
  const count=liveCount();
  byId('biteFilterApply').textContent=count===null?'Show results':'Show '+count+' result'+(count===1?'':'s');
  const current=activeFilters(fromPage());
  const bubble=byId('biteFilterAppliedCount');
  bubble.hidden=!current;
  bubble.textContent=String(current);
  trigger.setAttribute('aria-label','Filters and sorting'+(current?' — '+current+' active':''));
 }
 function renderPanel(){
  document.querySelectorAll('#biteFilterBackdrop [data-filter-tab]').forEach(tab=>{
   const selected=tab.dataset.filterTab===section;
   tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
   tab.classList.toggle('is-selected',selected);
  });
  panel.setAttribute('aria-labelledby','biteFilterTab'+section[0].toUpperCase()+section.slice(1));
  if(section==='sort'){
   panel.innerHTML='<h3>Sort by</h3><p class="bite-filter-help">Choose how restaurants are displayed.</p>'+
    selection('Relevance','recommended',draft.sort==='recommended','sort')+
    selection('Top rated','rating',draft.sort==='rating','sort')+
    selection('Lowest item price','price',draft.sort==='price','sort')+
    selection('Lowest delivery fee','delivery_fee',draft.sort==='delivery_fee','sort')+
    selection('Fastest preparation','fast',draft.sort==='fast','sort');
  }else if(section==='time'){
   panel.innerHTML='<h3>Time</h3><p class="bite-filter-help">See restaurants accepting orders now.</p>'+
    '<label class="bite-filter-switch"><span><strong>Open now</strong><small>Hide restaurants that are closed</small></span>'+
    '<input type="checkbox" id="biteFilterOpenNow" '+(draft.openNow?'checked':'')+'></label>'+
    '<button type="button" class="bite-filter-tile '+(draft.sort==='fast'?'is-active':'')+'" id="biteFilterFast">'+
    '<span aria-hidden="true">◷</span><strong>Fastest preparation</strong><small>Sort by owner-provided prep time</small></button>'+
    '<div class="bite-filter-coming"><strong>Scheduled delivery</strong><p>Show restaurants currently accepting preferred delivery slot requests. Choose your time at checkout.</p>'+
    '<label class="bite-filter-switch"><span><strong>Schedule available</strong><small>Choose a preferred 30-minute window at checkout</small></span>'+ 
    '<input type="checkbox" id="biteFilterScheduleOnly" '+(draft.scheduleOnly?'checked':'')+'></label></div>';
  }else if(section==='rating'){
   panel.innerHTML='<h3>Restaurant rating</h3><p class="bite-filter-help">Only restaurants with real published ratings appear above the selected threshold.</p>'+
    selection('Any rating','0',draft.rating==='0','rating')+
    selection('Rated 3.5+','3.5',draft.rating==='3.5','rating')+
    selection('Rated 4.0+','4',draft.rating==='4','rating')+
    selection('Rated 4.5+','4.5',draft.rating==='4.5','rating');
  }else if(section==='diet'){
   panel.innerHTML='<h3>Food preference</h3><p class="bite-filter-help">Filter by the restaurant’s published menu options.</p>'+
    selection('All food','all',draft.diet==='all','diet')+
    selection('Vegetarian options','veg',draft.diet==='veg','diet')+
    selection('Non-vegetarian options','nonveg',draft.diet==='nonveg','diet');
  }else{
   panel.innerHTML='<h3>Order type</h3><p class="bite-filter-help">Delivery is shown only for your confirmed service area.</p>'+
    selection('All restaurants','all',draft.service==='all','service')+
    selection('Delivery','delivery',draft.service==='delivery','service')+
    selection('Pickup','pickup',draft.service==='pickup','service');
  }
  updateCount();
 }
 function changeTab(next,focus=false){
  if(!sections.includes(next))return;
  section=next;renderPanel();
  if(focus)byId('biteFilterTab'+next[0].toUpperCase()+next.slice(1)).focus();
 }
 function show(){
  if(open)return;
  original=fromPage();draft={...original};section='sort';
  lastFocused=document.activeElement;
  overlay.hidden=false;document.body.classList.add('bite-filter-open');
  open=true;renderPanel();
  byId('biteFilterCloseX').focus({preventScroll:true});
 }
 function close(){
  if(!open)return;
  open=false;overlay.hidden=true;document.body.classList.remove('bite-filter-open');
  (lastFocused?.isConnected?lastFocused:trigger)?.focus({preventScroll:true});
 }
 function apply(){
  const next=normalized(draft);
  const select=(id,value)=>{if(byId(id))byId(id).value=value;};
  select('discoverySort',next.sort==='fast'?'recommended':next.sort);
  select('discoveryRating',next.rating);
  select('discoveryDiet',next.diet);
  root.restaurantSortFast=next.sort==='fast';
  const fastBtn=byId('sortFastBtn');
  if(fastBtn){fastBtn.classList.toggle('active',root.restaurantSortFast);
   fastBtn.setAttribute('aria-pressed',String(root.restaurantSortFast));
   fastBtn.textContent=root.restaurantSortFast?'✓ Fastest prep':'Fastest prep ↕';}
  root.restaurantServiceFilter=next.service;
  root.BiteScheduleDiscoveryOnly=next.scheduleOnly;
  document.querySelectorAll('[data-service-filter]').forEach(btn=>{
   const selected=btn.dataset.serviceFilter===next.service;
   btn.classList.toggle('active',selected);btn.setAttribute('aria-pressed',String(selected));
  });
  for(const [id,on] of [['filterOpenNow',next.openNow],['filterFavourites',next.favourites]]){
   const btn=byId(id);if(!btn)continue;
   btn.setAttribute('aria-pressed',String(on));btn.classList.toggle('active',on);
  }
  if(typeof activeFilter!=='undefined')activeFilter=next.category;
  document.querySelectorAll('[data-home-filter],#filters [data-filter]').forEach(btn=>{
   const selected=(btn.dataset.homeFilter||btn.dataset.filter)===next.category;
   btn.classList.toggle('active',selected);btn.setAttribute('aria-pressed',String(selected));
  });
  close();
  if(typeof renderRestaurants==='function')renderRestaurants();
  updateCount();
 }
 trigger.addEventListener('click',show);
 byId('biteFilterCloseX').addEventListener('click',close);
 byId('biteFilterCancel').addEventListener('click',close);
 byId('biteFilterClear').addEventListener('click',()=>{draft=defaults();renderPanel();});
 byId('biteFilterApply').addEventListener('click',apply);
 overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
 overlay.addEventListener('click',event=>{
  const tab=event.target.closest('[data-filter-tab]');
  if(tab){changeTab(tab.dataset.filterTab);return;}
  if(event.target.closest('#biteFilterFast')){draft.sort=draft.sort==='fast'?'recommended':'fast';renderPanel();byId('biteFilterFast')?.focus({preventScroll:true});return;}
 });
 overlay.addEventListener('change',event=>{
  const input=event.target;
  if(input.id==='biteFilterOpenNow')draft.openNow=input.checked;
  else if(input.id==='biteFilterScheduleOnly')draft.scheduleOnly=input.checked;
  else if(input.type==='radio'){
   const group=input.name.replace('bite-filter-','');
   if(group==='sort')draft.sort=valid(input.value,SORTS,'recommended');
   if(group==='rating')draft.rating=valid(input.value,RATINGS,'0');
   if(group==='diet')draft.diet=valid(input.value,DIETS,'all');
   if(group==='service')draft.service=valid(input.value,SERVICES,'all');
  }
  updateCount();
 });
 overlay.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();close();return;}
  if(event.key==='Tab'){
   const focusable=Array.from(overlay.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex="0"]'))
    .filter(el=>el.getClientRects().length);
   if(!focusable.length)return;
   if(event.shiftKey&&document.activeElement===focusable[0]){event.preventDefault();focusable.at(-1).focus();}
   else if(!event.shiftKey&&document.activeElement===focusable.at(-1)){event.preventDefault();focusable[0].focus();}
  }
  const tab=document.activeElement.closest?.('[data-filter-tab]');
  if(tab&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();
   const current=sections.indexOf(tab.dataset.filterTab);
   const index=event.key==='Home'?0:event.key==='End'?sections.length-1:
    (current+(event.key==='ArrowDown'?1:-1)+sections.length)%sections.length;
   changeTab(sections[index],true);
  }
 });
 // Keep active-filter count accurate after existing reset, quick chips, or location changes.
 tools.addEventListener('click',event=>{
  if(event.target.closest('#biteFilterOpen'))return;
  queueMicrotask(updateCount);
 });
 tools.addEventListener('change',()=>queueMicrotask(updateCount));
 root.BiteFilterSheet={open:show,close,defaults,filterOptions};
 updateCount();
})(typeof window!=='undefined'?window:globalThis);
