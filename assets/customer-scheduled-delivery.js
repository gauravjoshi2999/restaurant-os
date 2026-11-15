/* Bite scheduled delivery: real published restaurant hours + server-validated preferred slots.
 * A request is not a guaranteed delivery ETA; paid intent records exact selection. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteSchedule=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const IST_MS=330*60*1000,SLOT_MS=30*60*1000;
 const parseClock=value=>{
  const m=/^([01]\d|2[0-4]):([0-5]\d)/.exec(String(value||''));
  return !m||Number(m[1])===24&&Number(m[2])!==0?null:Number(m[1])*60+Number(m[2]);
 };
 function withinHours(restaurant,instant){
  if(!restaurant)return false;
  const opening=parseClock(restaurant.opening_time),closing=parseClock(restaurant.closing_time);
  if(opening===null||closing===null||opening===closing)return false;
  const local=new Date(Number(instant)+IST_MS),at=local.getUTCHours()*60+local.getUTCMinutes();
  if(opening<closing)return at>=opening&&at+30<=closing;
  return at>=opening&&at+30<=1440+closing||at<closing&&at+30<=closing;
 }
 function generateSlots(restaurant,now=Date.now()){
  if(!restaurant||restaurant.accepts_scheduled_delivery!==true||restaurant.accepts_delivery!==true
     ||restaurant.delivery_paused===true||!Number.isFinite(Number(now)))return [];
  const lead=Number(restaurant.scheduled_lead_minutes??90);
  const days=Number(restaurant.scheduled_horizon_days??3);
  if(!Number.isInteger(lead)||lead<30||lead>480||!Number.isInteger(days)||days<1||days>7)return [];
  const lower=Number(now)+lead*60*1000,upper=Number(now)+days*86400000;
  const first=Math.ceil((lower+IST_MS)/SLOT_MS)*SLOT_MS-IST_MS;
  const slots=[];
  for(let at=first;at<=upper;at+=SLOT_MS){
   if(!withinHours(restaurant,at))continue;
   if(restaurant.is_temporarily_closed&&(!restaurant.temporary_closure_until
       ||Date.parse(restaurant.temporary_closure_until)>at))continue;
   const date=new Date(at+IST_MS);
   const key=date.toISOString().slice(0,10);
   const fmt=instant=>new Intl.DateTimeFormat('en-IN',{
    timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit',hour12:true
   }).format(new Date(instant));
   slots.push({iso:new Date(at).toISOString(),dayKey:key,label:fmt(at)+' – '+fmt(at+SLOT_MS)});
  }
  return slots;
 }
 const canSchedule=restaurant=>{
  if(typeof BITE_SANDBOX_CHECKOUT!=='undefined'&&BITE_SANDBOX_CHECKOUT)return false;
  return generateSlots(restaurant).length>0;
 };
 const api={withinHours,generateSlots,canSchedule};
 if(typeof document==='undefined')return api;
 const checkout=document.getElementById('checkoutFormPanel'),summary=document.getElementById('checkoutSummary');
 if(!checkout||!summary)return api;
 const panel=document.createElement('section');
 panel.id='biteDeliverySchedule';panel.className='bite-delivery-schedule';panel.hidden=true;
 panel.innerHTML='<div><strong>Delivery time</strong><small>Choose ASAP or a preferred slot</small></div>'+
  '<div class="bite-schedule-choices"><button id="biteScheduleAsap" type="button" aria-pressed="true">ASAP</button>'+
  '<button id="biteSchedulePick" type="button" aria-haspopup="dialog" aria-controls="biteScheduleOverlay">Schedule</button></div>'+
  '<p id="biteScheduleSelection" role="status"></p>';
 summary.insertAdjacentElement('afterend',panel);
 const overlay=document.createElement('div');
 overlay.id='biteScheduleOverlay';overlay.className='bite-schedule-overlay';overlay.hidden=true;
 overlay.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="biteScheduleHeading" class="bite-schedule-sheet">'+
  '<span class="bite-schedule-grip" aria-hidden="true"></span>'+
  '<header><h2 id="biteScheduleHeading">Select your delivery time</h2>'+
    '<button id="biteScheduleClose" type="button" aria-label="Close delivery time picker">×</button></header>'+
  '<p class="bite-schedule-hint">Preferred 30-minute delivery window. The restaurant confirms after accepting your order.</p>'+
  '<div class="bite-schedule-days" id="biteScheduleDays" role="tablist" aria-label="Delivery date"></div>'+
  '<div class="bite-schedule-slots" id="biteScheduleSlots" role="group" aria-label="Preferred delivery slots"></div>'+
  '<footer><button id="biteScheduleConfirm" type="button" disabled>Confirm preferred time</button></footer>'+
  '</section>';
 document.body.append(overlay);
 const byId=id=>document.getElementById(id);
 let restaurantId=null,selected=null,draft=null,day=null,slots=[],lastFocus=null,open=false;
 const eligible=()=>{
  if(typeof activeRestaurant==='undefined'||!activeRestaurant)return false;
  if(typeof checkoutMode==='function'&&checkoutMode()!=='delivery')return false;
  return canSchedule(activeRestaurant);
 };
 function getSelectedFor(id){
  if(!eligible()||activeRestaurant.id!==id||restaurantId!==id||!selected)return null;
  return selected;
 }
 function clearCheckoutIdempotency(){
  if(typeof pendingLiveCheckout!=='undefined'&&pendingLiveCheckout)return;
  if(typeof checkoutRequestKey!=='undefined')checkoutRequestKey=null;
  window.BiteCustomerExtras?.saveCheckoutKey?.(null);
 }
 function sync(){
  const r=typeof activeRestaurant!=='undefined'?activeRestaurant:null;
  if(r?.id!==restaurantId){restaurantId=r?.id||null;selected=null;}
  const shown=eligible();
  panel.hidden=!shown;
  if(!shown)return;
  const scheduled=!!selected;
  byId('biteScheduleAsap').setAttribute('aria-pressed',String(!scheduled));
  byId('biteSchedulePick').setAttribute('aria-pressed',String(scheduled));
  byId('biteSchedulePick').disabled=typeof pendingLiveCheckout!=='undefined'&&!!pendingLiveCheckout;
  byId('biteScheduleAsap').disabled=typeof pendingLiveCheckout!=='undefined'&&!!pendingLiveCheckout;
  byId('biteScheduleSelection').textContent=scheduled
    ?'Preferred time: '+new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(selected))+' · Subject to restaurant acceptance'
    :'ASAP delivery selected';
 }
 function close(){
  if(!open)return;
  open=false;overlay.hidden=true;document.body.classList.remove('bite-schedule-open');
  (lastFocus?.isConnected?lastFocus:byId('biteSchedulePick')).focus({preventScroll:true});
 }
 function renderDays(){
  const host=byId('biteScheduleDays');host.replaceChildren();
  const days=[...new Set(slots.map(x=>x.dayKey))];
  if(!days.includes(day))day=days[0]||null;
  for(const key of days){
   const button=document.createElement('button');button.type='button';
   button.textContent=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',weekday:'short'}).format(new Date(key+'T06:30:00Z'));
   button.dataset.biteDay=key;
   button.setAttribute('role','tab');
   button.setAttribute('aria-selected',String(key===day));
   button.classList.toggle('active',key===day);
   host.append(button);
  }
  renderSlots();
 }
 function renderSlots(){
  const host=byId('biteScheduleSlots');host.replaceChildren();
  const current=slots.filter(x=>x.dayKey===day);
  if(!current.length){const p=document.createElement('p');p.textContent='No scheduled slots available for this date.';host.append(p);}
  for(const slot of current){
   const button=document.createElement('button');button.type='button';button.dataset.biteSlot=slot.iso;
   button.textContent=slot.label;button.setAttribute('aria-pressed',String(draft===slot.iso));
   button.classList.toggle('active',draft===slot.iso);host.append(button);
  }
  byId('biteScheduleConfirm').disabled=!draft||!slots.some(x=>x.iso===draft);
 }
 function show(){
  if(!eligible()||open)return;
  slots=generateSlots(activeRestaurant);
  if(!slots.length){
   byId('biteScheduleSelection').textContent='Restaurant hours mein abhi future slots available nahi hain.';
   return;
  }
  draft=slots.some(x=>x.iso===selected)?selected:null;day=draft?slots.find(x=>x.iso===draft)?.dayKey:null;
  lastFocus=document.activeElement;
  open=true;overlay.hidden=false;document.body.classList.add('bite-schedule-open');
  renderDays();byId('biteScheduleClose').focus({preventScroll:true});
 }
 byId('biteSchedulePick').addEventListener('click',show);
 byId('biteScheduleAsap').addEventListener('click',()=>{if(selected!==null)clearCheckoutIdempotency();selected=null;sync();});
 byId('biteScheduleClose').addEventListener('click',close);
 overlay.addEventListener('click',event=>{
  if(event.target===overlay){close();return;}
  const selectedDay=event.target.closest('[data-bite-day]');
  if(selectedDay){day=selectedDay.dataset.biteDay;renderDays();return;}
  const selectedSlot=event.target.closest('[data-bite-slot]');
  if(selectedSlot){draft=selectedSlot.dataset.biteSlot;renderSlots();return;}
 });
 byId('biteScheduleConfirm').addEventListener('click',()=>{
  if(!draft||!slots.some(x=>x.iso===draft))return;
  if(selected!==draft)clearCheckoutIdempotency();
  selected=draft;close();sync();
 });
 overlay.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();close();return;}
  if(event.key==='Tab'){
   const controls=Array.from(overlay.querySelectorAll('button:not([disabled])'))
    .filter(el=>el.getClientRects().length);
   if(!controls.length)return;
   if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1).focus();}
   else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0].focus();}
  }
 });
 return {...api,sync,getSelectedFor,reset:()=>{selected=null;restaurantId=null;sync();}};
});
