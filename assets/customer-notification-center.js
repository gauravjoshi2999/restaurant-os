/* Bite Customer Notification Center: in-session unread alerts plus separately
 * labeled, read-only server history of customer-owned order status changes.
 * History is not push and does not imply permanently synchronized read receipts.
 */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BiteCustomerNotifications=api.attachBrowser(root)||api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const MAX=30;
 function createStore(onChange=()=>{}){
  let userId=null,items=[],serial=0;
  const emit=()=>onChange({userId,items:items.map(x=>({...x})),unread:items.filter(x=>!x.seen).length});
  function setUser(id){
   const next=typeof id==='string'&&id.trim()?id.trim():null;
   if(userId===next)return;
   userId=next;items=[];serial=0;emit();
  }
  function record(payload){
   const {userId:id,orderId,status,label}=payload||{};
   if(!userId||id!==userId||typeof orderId!=='string'||!orderId.trim()||
      typeof status!=='string'||!status.trim()||typeof label!=='string'||!label.trim())return false;
   // The controller verifies ownership and a real status transition before dispatch.
   const item={id:++serial,orderId:orderId.trim(),status:status.trim(),label:label.trim().slice(0,160),seen:false};
   items.unshift(item);
   if(items.length>MAX)items.length=MAX;
   emit();return true;
  }
  function markAllSeen(){if(!items.some(x=>!x.seen))return false;items=items.map(x=>({...x,seen:true}));emit();return true;}
  function markSeen(id){const index=items.findIndex(x=>x.id===id&&!x.seen);if(index<0)return false;items[index]={...items[index],seen:true};emit();return true;}
  function snapshot(){return {userId,items:items.map(x=>({...x})),unread:items.filter(x=>!x.seen).length};}
  return {setUser,record,markSeen,markAllSeen,snapshot};
 }
 async function fetchVerifiedOrderHistory(client,userId){
  if(!client||typeof userId!=='string'||!userId.trim())return [];
  // Verify the returned tenant as well as querying under authenticated RLS.
  const own=await client.from('orders').select('id,customer_id,order_code')
   .eq('customer_id',userId).order('created_at',{ascending:false}).limit(30);
  if(own.error)throw own.error;
  if(!Array.isArray(own.data))throw Error('Customer order history could not be verified.');
  const orderCodes=new Map();
  for(const row of own.data){
   if(!row||row.customer_id!==userId||typeof row.id!=='string'||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id)||
      typeof row.order_code!=='string'||!row.order_code.trim()||orderCodes.has(row.id))
    throw Error('Customer order scope could not be verified.');
   orderCodes.set(row.id,row.order_code.slice(0,40));
  }
  if(!orderCodes.size)return [];
  const history=await client.from('order_status_history')
   .select('id,order_id,to_status,changed_at')
   .in('order_id',[...orderCodes.keys()]).order('changed_at',{ascending:false}).limit(60);
  if(history.error)throw history.error;
  if(!Array.isArray(history.data))throw Error('Order status history could not be verified.');
  const seen=new Set();
  return history.data.map(row=>{
   if(!row||!orderCodes.has(row.order_id)||typeof row.id!=='string'||seen.has(row.id)||
      typeof row.to_status!=='string'||!row.to_status.trim()||
      typeof row.changed_at!=='string'||!Number.isFinite(Date.parse(row.changed_at)))
    throw Error('Order status history scope could not be verified.');
   seen.add(row.id);
   return {id:row.id,orderId:row.order_id,orderCode:orderCodes.get(row.order_id),
    status:row.to_status.slice(0,60),changedAt:row.changed_at};
  });
 }
 function attachBrowser(win){
  const doc=win?.document;
  if(!doc)return null;
  const section=doc.getElementById('biteAccountNotifications');
  if(!section||typeof sb==='undefined')return null;
  const bell=doc.getElementById('biteNotificationBell');
  const badge=doc.getElementById('biteNotificationBadge');
  const wrap=doc.getElementById('biteNotificationFeed');
  const count=doc.getElementById('biteNotificationCount');
  const mark=doc.getElementById('biteNotificationMarkRead');
  const list=doc.getElementById('biteNotificationEntries');
  const all=doc.getElementById('biteNotificationAll');
  const unread=doc.getElementById('biteNotificationUnread');
  if(!wrap||!count||!mark||!list||!all||!unread||!bell||!badge)return null;
  // Use the already durable order_status_history table; do not claim push,
  // notifications stored on the server, or synchronized read/unread receipts.
  const historyPanel=doc.createElement('details');
  historyPanel.id='biteVerifiedOrderHistory';
  historyPanel.className='bite-verified-order-history';
  const historyHeading=doc.createElement('summary');
  historyHeading.textContent='Past verified order activity';
  const historyHelp=doc.createElement('p');
  historyHelp.textContent='Read-only order status history saved by Bite. The unread badge above counts updates from this browser visit only.';
  const historyList=doc.createElement('ol');
  historyList.className='bite-order-history-entries';
  const historyStatus=doc.createElement('p');
  historyStatus.className='bite-order-history-status';
  historyStatus.setAttribute('role','status');
  historyPanel.append(historyHeading,historyHelp,historyStatus,historyList);
  wrap.append(historyPanel);
  let historyRequest=0;
  async function refreshHistory(){
   const userId=store.snapshot().userId,request=++historyRequest;
   historyList.replaceChildren();
   if(!userId){historyStatus.textContent='Sign in to view your previous order status history.';return;}
   historyStatus.textContent='Loading verified order activity…';
   try{
    const entries=await fetchVerifiedOrderHistory(sb,userId);
    if(request!==historyRequest||store.snapshot().userId!==userId)return;
    historyStatus.textContent=entries.length?'':'No previous order status updates found.';
    for(const entry of entries){
     const item=doc.createElement('li');
     const label=doc.createElement('strong');
     label.textContent=entry.orderCode+' · '+entry.status;
     const date=doc.createElement('small');
     const timestamp=entry.changedAt?new Date(entry.changedAt):null;
     date.textContent=timestamp&&!Number.isNaN(timestamp.getTime())
      ?timestamp.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
      :'Previous status update';
     item.append(label,date);historyList.append(item);
    }
   }catch{
    if(request!==historyRequest||store.snapshot().userId!==userId)return;
    historyStatus.textContent='Past order activity could not be loaded. Close and reopen to retry.';
   }
  }
  historyPanel.addEventListener('toggle',()=>{if(historyPanel.open)void refreshHistory();});
  let filter='all';
  const store=createStore(render);
  function render(){
   const state=store.snapshot();
   count.textContent=state.unread+' unread';
   badge.textContent=String(state.unread);
   badge.hidden=!state.userId||state.unread===0;
   bell.setAttribute('aria-label',state.userId&&state.unread?'Notifications, '+state.unread+' unread':'Notifications');
   mark.disabled=state.unread===0;
   all.setAttribute('aria-pressed',String(filter==='all'));
   unread.setAttribute('aria-pressed',String(filter==='unread'));
   list.replaceChildren();
   if(!state.userId){
    const msg=doc.createElement('li');msg.className='bite-notification-empty';
    msg.textContent='Sign in to view order updates from this visit.';list.append(msg);return;
   }
   if(!state.items.length){
    const msg=doc.createElement('li');msg.className='bite-notification-empty';
    msg.textContent='No new order changes this visit. My Orders shows the current verified status.';list.append(msg);return;
   }
   const shown=filter==='unread'?state.items.filter(item=>!item.seen):state.items;
   if(!shown.length){
    const msg=doc.createElement('li');msg.className='bite-notification-empty';
    msg.textContent='No unread order updates this visit.';list.append(msg);return;
   }
   for(const entry of shown){
    const row=doc.createElement('li');row.className='bite-notification-entry'+(entry.seen?'':' is-unread');
    const info=doc.createElement('div');info.className='bite-notification-copy';
    const title=doc.createElement('strong');title.textContent=entry.label;
    const detail=doc.createElement('span');detail.textContent='Order update received while Bite was open';
    info.append(title,detail);
    const button=doc.createElement('button');button.type='button';button.textContent='My Orders';
    button.setAttribute('aria-label','View My Orders for '+entry.label);
    button.addEventListener('click',()=>{store.markSeen(entry.id);doc.querySelector('#homeBottomNav [data-nav="orders"]')?.click();});
    row.append(info,button);list.append(row);
   }
  }
  mark.addEventListener('click',()=>store.markAllSeen());
  all.addEventListener('click',()=>{filter='all';render();});
  unread.addEventListener('click',()=>{filter='unread';render();});
  doc.addEventListener('bite:verified-order-update',event=>{
   if(store.record(event.detail)&&historyPanel.open)void refreshHistory();
  });
  let revision=0;
  function useSession(session){
   const id=session?.user?.id;
   const next=typeof id==='string'&&id.trim()?id.trim():null;
   if(store.snapshot().userId!==next){
    filter='all';
    ++historyRequest;historyList.replaceChildren();
    historyStatus.textContent=next?'Open to load your saved order activity.':'Sign in to view previous order activity.';
    store.setUser(next);
    if(historyPanel.open)win.setTimeout(()=>{if(store.snapshot().userId===next&&historyPanel.open)void refreshHistory();},0);
   }
  }
  sb.auth.onAuthStateChange((_event,session)=>{revision++;useSession(session);});
  const startRevision=revision;
  sb.auth.getSession().then(({data})=>{
   if(startRevision===revision)useSession(data?.session||null);
  }).catch(()=>{});
  render();
  return {syncUser:id=>{revision++;useSession(id?{user:{id}}:null)},record:store.record,markAllSeen:store.markAllSeen,snapshot:store.snapshot,render};
 }
 return {createStore,fetchVerifiedOrderHistory,attachBrowser};
});
