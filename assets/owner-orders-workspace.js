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
  const moved=[];
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
  return {stages,isFilter,groupForStatus,matches,counts,prepare,update,requestReason};
});
