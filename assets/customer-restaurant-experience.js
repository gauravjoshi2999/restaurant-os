/* Restaurant menu context and mobile category jump. No invented offers/ETAs. */
(function(root){
 'use strict';
 function readClock(value){
  const m=/^([01]\d|2[0-4]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(String(value||''));
  if(!m)return null;
  const h=Number(m[1]),min=Number(m[2]);
  return h===24&&min!==0?null:h*60+min;
 }
 function minsUntilClosing(restaurant,instant=Date.now()){
  if(!restaurant||restaurant.is_temporarily_closed||restaurant.delivery_paused&&restaurant.accepts_pickup!==true)return null;
  const open=readClock(restaurant.opening_time),close=readClock(restaurant.closing_time);
  if(open===null||close===null||open===close)return null;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
   .formatToParts(new Date(instant));
  const clock=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const now=Number(clock.hour)*60+Number(clock.minute);
  if(open<close)return now>=open&&now<close?close-now:null;
  if(now>=open)return 1440-now+close;
  if(now<close)return close-now;
  return null;
 }
 function closingSoonMinutes(restaurant,instant=Date.now(),within=30){
  const mins=minsUntilClosing(restaurant,instant);
  return mins!==null&&mins>0&&mins<=within?mins:null;
 }
 function menuIsVegetarian(items){
  return Array.isArray(items)&&items.length>0&&items.every(item=>item.is_vegetarian===true);
 }
 const api={readClock,minsUntilClosing,closingSoonMinutes,menuIsVegetarian};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof document==='undefined')return;
 const view=document.getElementById('menuView'),header=view?.querySelector('.restauranthead');
 if(!view||!header||document.getElementById('biteRestaurantFacts'))return;
 const facts=document.createElement('section');
 facts.id='biteRestaurantFacts';facts.className='bite-restaurant-facts';
 facts.setAttribute('aria-label','Restaurant details');
 const chips=document.createElement('div');chips.className='bite-restaurant-facts-chips';
 const vegetarian=document.createElement('span');vegetarian.className='bite-restaurant-fact bite-restaurant-vegetarian';
 vegetarian.textContent='● Vegetarian menu';
 const prep=document.createElement('span');prep.className='bite-restaurant-fact';
 const distance=document.createElement('span');distance.className='bite-restaurant-fact';
 const rating=document.createElement('span');rating.className='bite-restaurant-fact';
 chips.append(vegetarian,prep,distance,rating);
 const notice=document.createElement('div');notice.id='biteRestaurantClosingSoon';notice.className='bite-restaurant-closing';
 notice.setAttribute('role','status');
 const delivery=document.createElement('p');delivery.id='biteRestaurantDeliveryInfo';delivery.className='bite-restaurant-delivery-info';
 facts.append(chips,notice,delivery);
 header.insertAdjacentElement('afterend',facts);

 const jump=document.createElement('button');
 jump.type='button';jump.id='biteFloatingMenuButton';jump.className='bite-floating-menu';
 jump.setAttribute('aria-haspopup','dialog');
 jump.setAttribute('aria-controls','biteMenuJumpOverlay');
 jump.textContent='☰  Menu';jump.hidden=true;
 view.append(jump);
 const backdrop=document.createElement('div');
 backdrop.id='biteMenuJumpOverlay';backdrop.className='bite-menu-jump-backdrop';
 backdrop.hidden=true;
 backdrop.innerHTML=
  '<section class="bite-menu-jump-sheet" role="dialog" aria-modal="true" aria-labelledby="biteMenuJumpHeading">'+
   '<span class="bite-menu-jump-grip" aria-hidden="true"></span>'+
   '<div class="bite-menu-jump-head"><h2 id="biteMenuJumpHeading">Explore the menu</h2>'+
    '<button type="button" id="biteMenuJumpClose" aria-label="Close menu categories">×</button></div>'+
   '<p class="bite-menu-jump-help">Jump straight to the dishes you want.</p>'+
   '<div id="biteMenuJumpOptions" class="bite-menu-jump-options"></div></section>';
 document.body.append(backdrop);
 const options=document.getElementById('biteMenuJumpOptions');
 const closeButton=document.getElementById('biteMenuJumpClose');
 let lastFocus=null,lastRestaurantId=null,loadedItems=[],jumpOpen=false;

 function updateFacts(restaurant,items){
  const hasMenu=menuIsVegetarian(items);
  vegetarian.hidden=!hasMenu;
  const prepMinutes=Number(restaurant?.estimated_prep_minutes);
  prep.hidden=!(Number.isFinite(prepMinutes)&&prepMinutes>0&&prepMinutes<=480);
  if(!prep.hidden)prep.textContent='◷ '+Math.round(prepMinutes)+' min prep estimate';
  const km=typeof customerGeo!=='undefined'&&restaurant&&root.BiteDiscovery?.distance
   ?root.BiteDiscovery.distance(restaurant,customerGeo):null;
  distance.hidden=km===null||!Number.isFinite(km);
  if(!distance.hidden)distance.textContent='⌖ ~'+km.toFixed(1)+' km straight-line';
  const score=Number(restaurant?.average_rating||0);
  rating.hidden=!(Number.isFinite(score)&&score>0&&score<=5);
  if(!rating.hidden)rating.textContent='★ '+score.toFixed(1)+' restaurant rating';
  chips.hidden=Array.from(chips.children).every(el=>el.hidden);
  const mins=closingSoonMinutes(restaurant);
  const isClosed=root.BiteDiscovery?.isClosed?.(restaurant)===true;
  notice.hidden=mins===null||isClosed;
  if(!notice.hidden)notice.textContent='◷ Closing soon · About '+mins+' minutes until the published closing time';
  const selectedPin=typeof currentDiscoveryPin!=='undefined'?currentDiscoveryPin:'';
  const fee=Number(restaurant?.zone_delivery_fee??restaurant?.default_delivery_fee);
  const usable=!!selectedPin&&restaurant?.serviceable===true&&restaurant?.accepts_delivery===true&&
   Number.isFinite(fee)&&fee>=0;
  delivery.hidden=!usable;
  if(usable)delivery.textContent='Delivery fee at selected PIN: '+money(fee)+
   ' · Final charge confirmed during checkout.';
  facts.hidden=chips.hidden&&notice.hidden&&delivery.hidden;
 }
 function render(restaurant,items=[]){
  if(!restaurant)return;
  lastRestaurantId=restaurant.id;
  loadedItems=Array.isArray(items)?items:[];
  updateFacts(restaurant,loadedItems);
  const categoryCount=view.querySelectorAll('#categoryBar [data-cat]').length;
  jump.hidden=categoryCount<=1;
 }
 function closeJump(){
  if(!jumpOpen)return;
  jumpOpen=false;backdrop.hidden=true;
  document.body.classList.remove('bite-menu-jump-open');
  (lastFocus?.isConnected?lastFocus:jump).focus({preventScroll:true});
 }
 function openJump(){
  if(jumpOpen||jump.hidden||view.classList.contains('hidden'))return;
  options.replaceChildren();
  const buttons=Array.from(view.querySelectorAll('#categoryBar button[data-cat]'));
  for(const source of buttons){
   const option=document.createElement('button');option.type='button';
   option.className='bite-menu-jump-option';
   option.dataset.menuJumpCategory=source.dataset.cat;
   option.textContent=source.textContent.trim();
   if(source.getAttribute('aria-pressed')==='true'){
    option.classList.add('is-active');option.setAttribute('aria-current','true');
   }
   options.append(option);
  }
  if(!buttons.length)return;
  lastFocus=document.activeElement;
  jumpOpen=true;backdrop.hidden=false;
  document.body.classList.add('bite-menu-jump-open');
  closeButton.focus({preventScroll:true});
 }
 jump.addEventListener('click',openJump);
 closeButton.addEventListener('click',closeJump);
 backdrop.addEventListener('click',event=>{
  if(event.target===backdrop){closeJump();return;}
  const option=event.target.closest('[data-menu-jump-category]');
  if(!option)return;
  const source=Array.from(view.querySelectorAll('#categoryBar button[data-cat]'))
   .find(btn=>btn.dataset.cat===option.dataset.menuJumpCategory);
  closeJump();
  if(source){source.click();document.getElementById('menuCategoryHeading')?.focus?.({preventScroll:true});}
 });
 backdrop.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();closeJump();return;}
  if(event.key==='Tab'){
   const focusable=Array.from(backdrop.querySelectorAll('button:not(:disabled)')).filter(el=>el.getClientRects().length);
   if(!focusable.length)return;
   if(event.shiftKey&&document.activeElement===focusable[0]){event.preventDefault();focusable.at(-1).focus();}
   else if(!event.shiftKey&&document.activeElement===focusable.at(-1)){event.preventDefault();focusable[0].focus();}
  }
 });
 // Only refresh the published closing-time hint; never alter order availability on client.
 setInterval(()=>{
  if(document.hidden||view.classList.contains('hidden')||!lastRestaurantId)return;
  const restaurant=typeof activeRestaurant!=='undefined'&&activeRestaurant?.id===lastRestaurantId?activeRestaurant:null;
  if(restaurant)updateFacts(restaurant,loadedItems);
 },60000);
 root.BiteRestaurantDetails={render,update:()=>{if(typeof activeRestaurant!=='undefined'&&activeRestaurant)render(activeRestaurant,loadedItems);},closeJump};
})(typeof window!=='undefined'?window:globalThis);
