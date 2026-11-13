/* Bite Owner Orders — one actionable queue, grouped stages and non-destructive detail disclosures.
   Presentation only; all order mutations remain in existing controller/RLS/RPC. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BiteOwnerOrders=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const stages=Object.freeze([
    {key:'new',label:'New',statuses:['Received']},
    {key:'preparing',label:'Preparing',statuses:['Accepted','Preparing']},
    {key:'ready',label:'Ready',statuses:['Ready']},
    {key:'delivery',label:'Delivery',statuses:['Handed Over','Out for Delivery']},
    {key:'completed',label:'Delivered',statuses:['Completed','Delivered']},
    {key:'cancelled',label:'Cancelled',statuses:['Rejected','Cancelled']},
    {key:'all',label:'All',statuses:[]}
  ]);
  const matches=(filter,status)=>filter==='all'||!!stages.find(s=>s.key===filter)?.statuses.includes(status);
  const isFilter=filter=>stages.some(s=>s.key===filter);
  const groupForStatus=status=>stages.find(s=>s.key!=='all'&&s.statuses.includes(status))?.key||'all';
  const counts=orders=>Object.fromEntries(stages.map(stage=>[
    stage.key,stage.key==='all'?orders.length:orders.filter(order=>matches(stage.key,order.status)).length
  ]));
  // The date is the restaurant's local calendar day, not the browser's UTC day.
  function dayKey(value){
    if(!value)return '';
    const date=new Date(value);
    if(!Number.isFinite(date.getTime()))return '';
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
      timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    return parts.year+'-'+parts.month+'-'+parts.day;
  }
  const countByDay=orders=>(orders||[]).reduce((acc,order)=>{
    const key=dayKey(order.createdAt);
    if(key)acc[key]=(acc[key]||0)+1;
    return acc;
  },{});
  const dateFilter=orders=>selectedDay?(orders||[]).filter(o=>dayKey(o.createdAt)===selectedDay):(orders||[]);
  function formatDay(day){
    return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',
      timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
  }
  const moved=[];
  let calendar=null,calendarMonth=dayKey(new Date()).slice(0,7),selectedDay=null,calendarOpened=false;
  let latestOrders=[];
  function notifyDateChange(doc){
    if(typeof doc?.dispatchEvent==='function')doc.dispatchEvent(new CustomEvent('bite-owner-order-date-change'));
  }
  function drawCalendar(doc){
    if(!calendar||calendar.hidden)return;
    const counts=countByDay(latestOrders);
    const total=latestOrders.length;
    const month=new Date(calendarMonth+'-01T12:00:00Z');
    const year=month.getUTCFullYear(),monthNum=month.getUTCMonth();
    const monthLabel=new Intl.DateTimeFormat('en-IN',{timeZone:'UTC',month:'long',year:'numeric'}).format(month);
    const start=(new Date(Date.UTC(year,monthNum,1)).getUTCDay()+6)%7;
    const last=new Date(Date.UTC(year,monthNum+1,0)).getUTCDate();
    const today=dayKey(new Date());
    const selection=selectedDay?(formatDay(selectedDay)+' · '+(counts[selectedDay]||0)+' orders'):'Sabhi dates · '+total+' orders';
    const header='<div class="bite-orders-date-head"><strong>Orders date-wise</strong><span aria-live="polite">'+selection+'</span></div>';
    const toolbar='<div class="bite-orders-date-tools"><button type="button" data-date-calendar-toggle aria-expanded="'+String(calendarOpened)+'">'+(calendarOpened?'Calendar band karein':'Calendar kholein')+'</button><button type="button" data-date-select="all"'+(!selectedDay?' class="active"':'')+'>All dates</button><button type="button" data-date-select="'+today+'">Today'+(counts[today]?' · '+counts[today]:'')+'</button></div>';
    const dow=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>'<span class="bite-date-weekday">'+d+'</span>').join('');
    let days='';
    for(let cell=0;cell<start+last;cell++){
      const n=cell-start+1;
      if(n<=0){days+='<span class="bite-date-blank"></span>';continue;}
      const day=calendarMonth+'-'+String(n).padStart(2,'0');
      const count=counts[day]||0;
      days+='<button type="button" class="bite-date-cell'+(count?' has-orders':'')+(selectedDay===day?' selected':'')+(today===day?' today':'')+'" data-date-select="'+day+'" aria-label="'+formatDay(day)+' '+count+' orders" aria-pressed="'+(selectedDay===day)+'"><strong>'+n+'</strong>'+(count?'<small>'+count+' orders</small>':'<small aria-hidden="true">·</small>')+'</button>';
    }
    const body=calendarOpened?'<div class="bite-orders-calendar-body"><div class="bite-date-month-nav"><button type="button" data-date-month="-1" aria-label="Previous month">‹</button><strong>'+monthLabel+'</strong><button type="button" data-date-month="1" aria-label="Next month">›</button></div><div class="bite-date-grid">'+dow+days+'</div><p>Sirf load hue Bite website orders count hote hain. Kisi date par tap karke us din ke orders dekhein.</p></div>':'';
    calendar.innerHTML=header+toolbar+body;
  }
  function prepareCalendar(doc,anchor){
    if(calendar)return;
    calendar=doc.createElement('section');
    calendar.id='biteOwnerOrderCalendar';
    calendar.className='bite-owner-order-calendar';
    calendar.setAttribute('aria-label','Choose order date and view daily counts');
    anchor.insertAdjacentElement('afterend',calendar);
    calendar.addEventListener('click',event=>{
      const target=event.target.closest?.('button');
      if(!target||!calendar.contains(target))return;
      if(target.hasAttribute('data-date-calendar-toggle'))calendarOpened=!calendarOpened;
      else if(target.hasAttribute('data-date-month')){
        const [y,m]=calendarMonth.split('-').map(Number);
        const date=new Date(Date.UTC(y,m-1+Number(target.dataset.dateMonth),1));
        calendarMonth=date.toISOString().slice(0,7);
      }else if(target.hasAttribute('data-date-select')){
        const value=target.dataset.dateSelect;
        selectedDay=value==='all'?null:value;
        if(selectedDay)calendarMonth=selectedDay.slice(0,7);
        notifyDateChange(doc);
      }
      drawCalendar(doc);
    });
  }
  let ownerStarted=false;
  let stageBar=null;
  let disclosures=[];
  function removeDisclosures(){
    for(const item of moved.splice(0)){
      if(item.marker.parentNode)item.marker.parentNode.insertBefore(item.element,item.marker);
      item.marker.remove();
    }
    for(const wrap of disclosures){wrap.remove()}
    disclosures=[];
    if(stageBar)stageBar.hidden=true;
    if(calendar)calendar.hidden=true;
    selectedDay=null;
    ownerStarted=false;
  }
  function createDisclosure(doc,anchor,title,ids){
    const wrap=doc.createElement('details');
    wrap.className='bite-owner-order-disclosure';
    const summary=doc.createElement('summary');summary.textContent=title;
    wrap.append(summary);
    for(const id of ids){
      const element=doc.getElementById(id);
      if(!element)continue;
      const marker=doc.createComment('original location of '+id);
      element.before(marker);
      moved.push({element,marker});
      wrap.append(element);
    }
    if(!moved.some(item=>item.element.parentNode===wrap))return;
    anchor.insertAdjacentElement('afterend',wrap);
    disclosures.push(wrap);
  }
  function prepare(doc,role,onSelect){
    if(!doc)return;
    if(role!=='owner'){
      if(ownerStarted)removeDisclosures();
      return;
    }
    const base=doc.getElementById('orderStatusTabs'),ordersPage=doc.getElementById('orders');
    if(!base||!ordersPage)return;
    if(!stageBar){
      stageBar=doc.createElement('nav');
      stageBar.id='biteOwnerOrderStages';
      stageBar.setAttribute('aria-label','Filter restaurant orders by stage');
      stageBar.className='bite-owner-order-stages';
      for(const stage of stages){
        const button=doc.createElement('button');
        button.type='button';
        button.dataset.biteStage=stage.key;
        button.className='bite-owner-order-stage';
        button.setAttribute('aria-label',stage.label+' orders');
        const label=doc.createElement('span');label.textContent=stage.label;
        const count=doc.createElement('b');count.dataset.biteStageCount=stage.key;count.textContent='0';
        button.append(label,count);
        button.addEventListener('click',()=>{if(typeof onSelect==='function')onSelect(stage.key)});
        stageBar.append(button);
      }
      base.insertAdjacentElement('afterend',stageBar);
    }
    prepareCalendar(doc,stageBar);
    if(calendar)calendar.hidden=false;
    stageBar.hidden=false;
    if(!ownerStarted){
      const layout=doc.querySelector('#orders .orders-page-layout');
      if(layout){
        // These secondary panels stay accessible but are collapsed by default;
        // the only actionable owner queue is #orderBoard.
        createDisclosure(doc,layout,'Customer requests & reviews',[
          'customerOrderRequestsCard','restaurantReviewsCard'
        ]);
        createDisclosure(doc,disclosures[0]||layout,'Payment verification & sandbox tests',[
          'verifiedLiveInboxPanel','sandboxPaidOrdersPanel'
        ]);
      }
      ownerStarted=true;
    }
  }
  function update(doc,orders,filter){
    if(!stageBar||stageBar.hidden)return;
    latestOrders=orders||[];
    drawCalendar(doc);
    const tally=counts(orders);
    for(const button of stageBar.querySelectorAll('[data-bite-stage]')){
      const key=button.dataset.biteStage;
      const num=button.querySelector('[data-bite-stage-count]');
      if(num)num.textContent=String(tally[key]||0);
      const active=key===filter;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
      if(active)button.setAttribute('aria-current','true');
      else button.removeAttribute('aria-current');
    }
    const title=doc.getElementById('orderStatusTitle');
    if(title)title.textContent=(stages.find(x=>x.key===filter)?.label||'New')+' Orders';
  }
  // Browser-native confirmation surface: no reliance on prompt() or demo data.
  // The existing advanceOrder() still sends the reason as orders.status_note.
  function requestReason(doc,next){
    if(!doc?.body)return Promise.resolve(null);
    const reasons=next==='Rejected'
      ?['Out of stock','Kitchen busy','Cannot deliver','Other']
      :['Customer requested cancellation','Item unavailable','Cannot fulfil order','Other'];
    return new Promise(resolve=>{
      const layer=doc.createElement('div');
      layer.className='bite-order-reason-overlay';
      layer.setAttribute('role','presentation');
      const panel=doc.createElement('section');
      panel.className='bite-order-reason-modal';
      panel.setAttribute('role','dialog');
      panel.setAttribute('aria-modal','true');
      panel.setAttribute('aria-labelledby','biteOrderReasonTitle');
      const title=doc.createElement('h2');title.id='biteOrderReasonTitle';
      title.textContent=next==='Rejected'?'Reject order':'Cancel order';
      const intro=doc.createElement('p');intro.textContent='Order change ka reason select karein. Bina reason confirm nahi hoga.';
      const form=doc.createElement('form');form.noValidate=true;
      const reasonLabel=doc.createElement('label');
      reasonLabel.textContent='Reason *';
      const select=doc.createElement('select');select.required=true;
      select.setAttribute('aria-label','Order reason');
      const blank=doc.createElement('option');blank.value='';blank.textContent='Choose reason';
      select.append(blank);
      for(const text of reasons){
        const option=doc.createElement('option');option.value=text;option.textContent=text;select.append(option);
      }
      reasonLabel.append(select);
      const extraLabel=doc.createElement('label');extraLabel.textContent='Additional detail (optional)';
      const extra=doc.createElement('textarea');extra.maxLength=300;extra.rows=2;
      extra.placeholder='Detail likhein — Other reason ke liye zaroori';
      extraLabel.append(extra);
      const message=doc.createElement('p');message.className='bite-order-reason-error';
      message.setAttribute('role','alert');
      const actions=doc.createElement('div');actions.className='bite-order-reason-actions';
      const cancel=doc.createElement('button');cancel.type='button';cancel.textContent='Back';
      cancel.className='btn secondary';
      const confirm=doc.createElement('button');confirm.type='submit';confirm.className='btn danger';
      confirm.textContent=next==='Rejected'?'Confirm Reject':'Confirm Cancel';
      actions.append(cancel,confirm);
      form.append(reasonLabel,extraLabel,message,actions);
      panel.append(title,intro,form);layer.append(panel);doc.body.append(layer);
      let finished=false;
      function finish(value){
        if(finished)return;
        finished=true;
        doc.removeEventListener('keydown',onKey,true);
        layer.remove();
        resolve(value);
      }
      function onKey(event){
        if(event.key==='Escape'){event.preventDefault();finish(null)}
      }
      doc.addEventListener('keydown',onKey,true);
      cancel.addEventListener('click',()=>finish(null));
      layer.addEventListener('click',event=>{if(event.target===layer)finish(null)});
      form.addEventListener('submit',event=>{
        event.preventDefault();
        const choice=select.value,detail=extra.value.trim();
        if(!choice){message.textContent='Reject/Cancel reason chunein.';select.focus();return}
        if(choice==='Other'&&detail.length<2){
          message.textContent='Other ke liye kam se kam 2 characters ka reason likhein.';
          extra.focus();return;
        }
        const note=choice==='Other'?detail:(detail?choice+' — '+detail:choice);
        finish(note);
      });
      select.focus();
    });
  }
  return {stages,isFilter,groupForStatus,matches,counts,dayKey,countByDay,dateFilter,formatDay,prepare,update,requestReason,selectedDay:()=>selectedDay};
});
