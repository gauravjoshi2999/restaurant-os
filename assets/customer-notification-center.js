/* Bite Customer Notification Center — verified order changes during this tab session.
 * Never presents an in-memory event as a server-saved, push or historical notification.
 * Account switching destroys the old user's entries; no persistent/browser storage.
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
  doc.addEventListener('bite:verified-order-update',event=>{store.record(event.detail);});
  let revision=0;
  function useSession(session){
   const next=session?.user?.id||null;
   if(store.snapshot().userId!==next)filter='all';
   store.setUser(next);
  }
  sb.auth.onAuthStateChange((_event,session)=>{revision++;useSession(session);});
  const startRevision=revision;
  sb.auth.getSession().then(({data})=>{
   if(startRevision===revision)useSession(data?.session||null);
  }).catch(()=>{});
  render();
  return {syncUser:id=>store.setUser(id),record:store.record,markAllSeen:store.markAllSeen,snapshot:store.snapshot,render};
 }
 return {createStore,attachBrowser};
});
