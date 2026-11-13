/* Bite Owner — date-wise real website orders calendar. No billing or status writes. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteOwnerCalendar=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const zone='Asia/Kolkata',today=()=>dateKey(new Date());
 const monthRegex=/^\d{4}-(0[1-9]|1[0-2])$/;
 const dayRegex=/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
 function dateKey(input){
  if(input==null||input==='')return '';
  const date=input instanceof Date?input:new Date(input);
  if(!Number.isFinite(date.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const pick=type=>parts.find(p=>p.type===type)?.value||'';
  return pick('year')+'-'+pick('month')+'-'+pick('day');
 }
 const dayCounts=orders=>orders.reduce((counts,order)=>{
   if(order?.isDemo||order?.is_demo)return counts;
   const key=dateKey(order?.createdAt);
   if(key)counts[key]=(counts[key]||0)+1;
   return counts;
 },Object.create(null));
 const monthShift=(ym,delta)=>{
   const [y,m]=ym.split('-').map(Number);
   const v=new Date(Date.UTC(y,m-1+delta,1));
   return String(v.getUTCFullYear())+'-'+String(v.getUTCMonth()+1).padStart(2,'0');
 };
 const safeDay=key=>dayRegex.test(key)&&!Number.isNaN(Date.parse(key+'T00:00:00Z'));
 let selected=null,month=today().slice(0,7),panel=null,summary=null,dayBox=null,monthTitle=null,totalLabel=null,clearBtn=null,tally=Object.create(null),onSelect=null;
 function monthLabel(key){
  const [y,m]=key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,1)));
 }
 function buildMonth(){
   if(!dayBox)return;
   dayBox.replaceChildren();
   monthTitle.textContent=monthLabel(month);
   const [y,m]=month.split('-').map(Number);
   const start=new Date(Date.UTC(y,m-1,1)),days=new Date(Date.UTC(y,m,0)).getUTCDate(),offset=start.getUTCDay();
   for(let i=0;i<offset;i++){const blank=dayBox.ownerDocument.createElement('span');blank.className='bite-cal-blank';blank.setAttribute('aria-hidden','true');dayBox.append(blank);}
   for(let day=1;day<=days;day++){
     const key=month+'-'+String(day).padStart(2,'0'),number=tally[key]||0;
     const button=dayBox.ownerDocument.createElement('button');button.type='button';button.className='bite-order-cal-day';button.dataset.orderDay=key;
     if(number)button.classList.add('has-orders');
     if(selected===key)button.classList.add('selected');
     if(today()===key)button.classList.add('today');
     button.setAttribute('aria-pressed',String(selected===key));
     button.setAttribute('aria-label',day+' '+monthLabel(month)+': '+number+' real orders');
     const numberText=dayBox.ownerDocument.createElement('strong');numberText.textContent=String(day);
     const countText=dayBox.ownerDocument.createElement('small');countText.textContent=number?String(number)+' order'+(number===1?'':'s'):'—';
     button.append(numberText,countText);
     button.addEventListener('click',()=>choose(key));
     dayBox.append(button);
   }
 }
 function choose(date){
  if(date!==null&&!safeDay(date))return;
  selected=date;
  if(date)month=date.slice(0,7);
  if(panel)panel.open=false;
  if(typeof onSelect==='function')onSelect(selected);
 }
 function ensure(doc,callback){
  const ordersPage=doc?.getElementById('orders');
  const anchor=doc?.getElementById('orderStatusTabs');
  if(!ordersPage||!anchor)return;
  onSelect=callback;
  if(summary?.isConnected)return;
  panel=doc.createElement('details');panel.className='bite-owner-orders-calendar';panel.id='biteOwnerOrdersCalendar';
  summary=doc.createElement('summary');summary.textContent='Calendar · Date-wise orders';
  panel.append(summary);
  const description=doc.createElement('p');description.className='bite-order-cal-note';description.textContent='Number wale din par tap karein; us din ke sabhi orders dekhein (demo alag).';
  panel.append(description);
  const toolbar=doc.createElement('div');toolbar.className='bite-order-cal-toolbar';
  const prev=doc.createElement('button');prev.type='button';prev.textContent='‹';prev.setAttribute('aria-label','Previous month');
  const next=doc.createElement('button');next.type='button';next.textContent='›';next.setAttribute('aria-label','Next month');
  monthTitle=doc.createElement('strong');monthTitle.setAttribute('aria-live','polite');
  prev.addEventListener('click',()=>{month=monthShift(month,-1);buildMonth()});
  next.addEventListener('click',()=>{month=monthShift(month,1);buildMonth()});
  toolbar.append(prev,monthTitle,next);panel.append(toolbar);
  const weekdays=doc.createElement('div');weekdays.className='bite-order-cal-weekdays';
  for(const wd of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']){const label=doc.createElement('span');label.textContent=wd;weekdays.append(label)}
  panel.append(weekdays);
  dayBox=doc.createElement('div');dayBox.className='bite-order-cal-days';panel.append(dayBox);
  const foot=doc.createElement('div');foot.className='bite-order-cal-footer';
  totalLabel=doc.createElement('span');totalLabel.setAttribute('role','status');
  clearBtn=doc.createElement('button');clearBtn.type='button';clearBtn.textContent='All dates';clearBtn.addEventListener('click',()=>choose(null));
  foot.append(totalLabel,clearBtn);panel.append(foot);
  anchor.insertAdjacentElement('afterend',panel);
 }
 function update(doc,orders,onDate){
  if(doc?.body?.dataset.role!=='owner'){if(panel)panel.hidden=true;return;}
  ensure(doc,onDate);
  if(!panel)return;
  panel.hidden=false;tally=dayCounts(orders);
  const total=Object.values(tally).reduce((s,n)=>s+n,0);
  totalLabel.textContent=total+' real website orders · '+monthLabel(month);
  summary.textContent=selected?'Date: '+selected+' · '+(tally[selected]||0)+' orders · Change date':'Calendar · '+total+' real orders · Choose date';
  clearBtn.hidden=!selected;
  buildMonth();
 }
 function labelForDay(key){
  if(!safeDay(key))return 'Date unavailable';
  const [y,m,d]=key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,d)));
 }
 return {dateKey,dayCounts,monthShift,choose,getSelected:()=>selected,update,labelForDay};
});
