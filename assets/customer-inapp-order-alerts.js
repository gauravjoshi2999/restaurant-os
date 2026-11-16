/* Bite real-time customer in-app order alerts.
 * Visible only while Bite is open, from authenticated Supabase order updates.
 * No push/SMS/email/WhatsApp subscription is claimed or created.
 */
(function(root){
'use strict';
const LABELS={
 Received:'Order received',Pending:'Order received',Accepted:'Restaurant accepted your order',
 Preparing:'Your food is being prepared',Ready:'Your order is ready',
 'Handed Over':'Out for delivery',Delivered:'Order delivered',Completed:'Order completed',
 Cancelled:'Order cancelled',Rejected:'Restaurant could not accept your order'
};
function createController(onAlert=()=>{}){
 let userId=null,enabled=false;
 const known=new Map();
 function setUser(id){
  const valid=typeof id==='string'&&id.length?id:null;
  if(userId!==valid){userId=valid;known.clear();}
 }
 function setEnabled(allowed){enabled=allowed===true;}
 function seed(rows,id){
  if(!userId||id!==userId||!Array.isArray(rows))return;
  for(const row of rows){
   if(row&&typeof row.id==='string'&&typeof row.status==='string')known.set(row.id,row.status);
  }
 }
 function onUpdate(payload,id){
  const row=payload?.new;
  if(!userId||id!==userId||row?.customer_id!==userId||
    typeof row.id!=='string'||typeof row.status!=='string')return false;
  const before=known.get(row.id)||payload?.old?.status||null;
  known.set(row.id,row.status);
  if(!enabled||!before||before===row.status)return false;
  const label=LABELS[row.status]||'Order status updated';
  onAlert(label);
  return true;
 }
 return {setUser,setEnabled,seed,onUpdate,currentUser:()=>userId,enabled:()=>enabled};
}
function attachBrowser(){
 if(!root?.document||typeof sb==='undefined')return;
 const document=root.document;
 let dismissTimer=null,toast=null;
 function dismiss(){
  if(dismissTimer){root.clearTimeout(dismissTimer);dismissTimer=null;}
  if(toast){toast.remove();toast=null;}
 }
 function emit(label){
  if(document.visibilityState==='hidden'||document.querySelector('#checkoutModal.show, #cartModal.show'))return;
  dismiss();
  toast=document.createElement('aside');
  toast.className='bite-inapp-order-alert';
  toast.setAttribute('role','status');
  toast.setAttribute('aria-live','polite');
  const copy=document.createElement('div');
  copy.className='bite-inapp-order-alert-copy';
  const eyebrow=document.createElement('small');eyebrow.textContent='BITE · ORDER UPDATE';
  const title=document.createElement('strong');title.textContent=label;
  copy.append(eyebrow,title);
  const open=document.createElement('button');
  open.type='button';open.textContent='View';
  open.addEventListener('click',()=>{
   dismiss();
   const tab=document.querySelector('#homeBottomNav [data-nav="orders"]');
   tab?.click();
  });
  const close=document.createElement('button');
  close.type='button';close.className='bite-inapp-order-alert-close';
  close.textContent='×';close.setAttribute('aria-label','Dismiss order update');
  close.addEventListener('click',dismiss);
  toast.append(copy,open,close);
  document.body.append(toast);
  dismissTimer=root.setTimeout(dismiss,6000);
 }
 const core=createController(emit);
 function useSession(session){
  const user=session?.user||null;
  const old=core.currentUser();
  core.setUser(user?.id||null);
  core.setEnabled(user?.user_metadata?.bite_preferences_v1?.in_app_updates===true);
  if(old!==core.currentUser())dismiss();
 }
 let authRevision=0;
 sb.auth.onAuthStateChange((_event,session)=>{authRevision++;useSession(session);});
 const bootstrapRevision=authRevision;
 sb.auth.getSession().then(({data})=>{
  // Never restore stale Account A after a newer sign-out or Account B switch.
  if(authRevision===bootstrapRevision)useSession(data?.session||null);
 }).catch(()=>{});
 root.BiteCustomerOrderAlerts={
  seedOrders:(rows,customerId)=>core.seed(rows,customerId),
  onOrderUpdate:(payload,customerId)=>core.onUpdate(payload,customerId),
  syncUser:useSession,
  clear(){core.setUser(null);dismiss();}
 };
}
if(typeof module!=='undefined'&&module.exports)module.exports={createController};
attachBrowser();
})(typeof window!=='undefined'?window:null);
