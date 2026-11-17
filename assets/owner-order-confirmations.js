/* Bite Owner — compact pending-payment approval queue (not yet real paid orders).
   Owner must approve before Cashfree session; old post-payment orders stay in existing Orders. */
(function(root){
 'use strict';
 let db=null,restaurant=null,rows=[],channel=null,timer=null,poll=null,loaded=false;
 let activeFilter='new',paidNewCount=0,busy=new Set(),seen=new Set();
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const rupees=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 const countdown=timestamp=>{
  const seconds=Math.max(0,Math.ceil((Date.parse(timestamp)-Date.now())/1000));
  return {seconds,label:String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')};
 };
 function panel(){
  if(typeof document==='undefined')return null;
  let el=document.getElementById('biteOwnerApprovalQueue');
  if(!el){const board=document.getElementById('orderBoard');if(!board)return null;
   el=document.createElement('section');el.id='biteOwnerApprovalQueue';el.className='bite-owner-approval-queue';
   el.setAttribute('aria-label','Customer requests awaiting restaurant approval');
   board.before(el);
   el.addEventListener('click',async e=>{
    const button=e.target.closest('button[data-bite-confirm]');
    if(!button||busy.has(button.dataset.intent))return;
    if(button.dataset.biteConfirm==='rejected'&&!root.confirm('Reject this request? Customer will not be charged.'))return;
    await review(button.dataset.intent,button.dataset.biteConfirm);
   });
  }
  return el;
 }
 function render(){
  const el=panel();if(!el)return;
  const display=!!restaurant&&['new','all'].includes(activeFilter);
  const available=rows.filter(r=>r.state==='pending'&&countdown(r.expires_at).seconds>0);
  el.hidden=!display||available.length===0;
  const empty=document.getElementById('orderEmpty');
  const boardPlaceholder=document.querySelector('#orderBoard .order-card-empty');
  if(boardPlaceholder)boardPlaceholder.hidden=display&&available.length>0;
  if(empty&&display&&available.length)empty.style.display='none';
  else if(empty&&!document.querySelector('#orderBoard .order-card'))empty.style.display='block';
  const badge=document.querySelector('#biteOwnerOrderStages [data-bite-stage="new"] [data-bite-stage-count]');
  if(badge)badge.textContent=String(Number(paidNewCount||0)+available.length);
  if(el.hidden){el.innerHTML='';return;}
  el.innerHTML='<div class="bite-approval-title"><strong>New · Restaurant approval needed <span>'+available.length+'</span></strong><small>Payment not collected yet</small></div>'+
   available.map(r=>{
    const left=countdown(r.expires_at);
    const items=Array.isArray(r.priced_items)?r.priced_items:[];
    const short=items.slice(0,4).map(i=>'<div class="bite-approval-item"><span>'+esc(i.quantity)+' × '+esc(i.item_name||'Item')+'</span></div>').join('');
    const extra=items.length>4?'<div class="bite-approval-item">+'+(items.length-4)+' more items</div>':'';
    const created=new Date(r.created_at).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit'});
    const id=esc(r.intent_id);
    return '<article class="bite-approval-card" data-bite-approval-id="'+id+'">'+
     '<div class="bite-approval-top"><strong>#'+id.slice(0,8).toUpperCase()+'</strong><span class="bite-approval-clock" data-bite-confirm-until="'+esc(r.expires_at)+'">Accept in '+left.label+'</span></div>'+
     '<div class="bite-approval-customer"><strong>'+esc(r.customer_name||'Customer')+'</strong><span>'+esc(r.delivery_type==='pickup'?'Takeaway':'Delivery')+'</span></div>'+
     '<small class="bite-approval-received">Received '+esc(created)+' · '+rupees(r.amount)+'</small>'+
     '<div class="bite-approval-items">'+short+extra+'</div>'+
     (r.customer_note?'<div class="bite-approval-note">📝 '+esc(r.customer_note)+'</div>':'')+
     (r.destination?'<div class="bite-approval-destination">📍 '+esc(r.destination)+'</div>':'')+
     '<div class="bite-approval-payment">Payment: Waiting for your approval</div>'+
     '<div class="bite-approval-actions"><button type="button" class="bite-approval-reject" data-intent="'+id+'" data-bite-confirm="rejected">Reject</button>'+
     '<button type="button" class="bite-approval-accept" data-intent="'+id+'" data-bite-confirm="approved">Approve for payment</button></div></article>';
   }).join('');
  for(const button of el.querySelectorAll('button[data-bite-confirm]'))button.disabled=busy.has(button.dataset.intent);
 }
 function tick(){
  const el=panel();if(!el||el.hidden)return;
  for(const chip of el.querySelectorAll('[data-bite-confirm-until]')){
   const remain=countdown(chip.dataset.biteConfirmUntil);
   chip.textContent=remain.seconds?'Accept in '+remain.label:'Confirmation time over';
   chip.classList.toggle('is-urgent',remain.seconds<=60);
   if(!remain.seconds){for(const b of chip.closest('article').querySelectorAll('button'))b.disabled=true;}
  }
  if(rows.some(r=>r.state==='pending'&&countdown(r.expires_at).seconds===0))render();
 }
 async function refresh(){
  if(!db||!restaurant)return;
  const id=restaurant;
  try{
   const {data,error}=await db.from('bite_order_confirmations')
    .select('intent_id,restaurant_id,customer_name,delivery_type,destination,customer_note,priced_items,amount,state,created_at,expires_at')
    .eq('restaurant_id',id).eq('state','pending').gte('expires_at',new Date().toISOString()).order('created_at',{ascending:true}).limit(50);
   if(error)throw error;
   if(id!==restaurant)return;
   const fresh=(data||[]).filter(x=>countdown(x.expires_at).seconds>0);
   if(loaded){const newRequests=fresh.filter(r=>!seen.has(r.intent_id));
    if(newRequests.length&&document.visibilityState!=='hidden'){
     root.showOrderLiveToast?.(newRequests.length+' customer order confirmation request'+(newRequests.length>1?'s':''));
     root.playOrderAlertSound?.();
    }
   }
   rows=fresh;seen=new Set(fresh.map(r=>r.intent_id));loaded=true;render();
  }catch(e){console.warn('Confirmation queue refresh unavailable',e);}
 }
 async function review(id,decision){
  if(!db||!restaurant||!['approved','rejected'].includes(decision))return;
  busy.add(id);render();
  try{
   const {data,error}=await db.rpc('bite_review_order_confirmation',{p_intent_id:id,p_decision:decision});
   if(error)throw error;
   if(data?.state!==decision)throw new Error(data?.state==='expired'?'Confirmation window ended':'Request changed on another device');
   await refresh();
  }catch(e){root.alert('Confirmation save nahi hua: '+(e.message||'Try again'));await refresh();}
  finally{busy.delete(id);render();}
 }
 function stop(){
  if(channel&&db)db.removeChannel(channel);
  if(timer)clearInterval(timer);if(poll)clearInterval(poll);
  channel=null;timer=null;poll=null;db=null;restaurant=null;rows=[];seen=new Set();loaded=false;
  const el=typeof document!=='undefined'?document.getElementById('biteOwnerApprovalQueue'):null;
  if(el){el.hidden=true;el.innerHTML='';}
 }
 function mount(supabase,id,filter='new',existingNew=0){
  activeFilter=filter;paidNewCount=existingNew;
  if(!id||!supabase){stop();return;}
  if(restaurant!==id||db!==supabase){
   stop();db=supabase;restaurant=id;
   channel=db.channel('bite-owner-confirm-'+id)
     .on('postgres_changes',{event:'*',schema:'public',table:'bite_order_confirmations',filter:'restaurant_id=eq.'+id},()=>{void refresh();})
     .subscribe();
   timer=setInterval(tick,1000);
   poll=setInterval(()=>{if(document.visibilityState!=='hidden')void refresh();},10000);
   void refresh();
  }
  render();
 }
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible')void refresh();
 });
 root.BiteOwnerConfirmations={mount,refresh,stop,review};
})(window);
