/* Bite Customer — restaurant approval before any Cashfree session is requested.
   Realtime is a convenience; authoritative status and deadlines live in Postgres. */
(function(root){
 'use strict';
 let client=null,activeId=null,record=null,channel=null,clock=null,poll=null,onChange=null;
 let refreshing=false,intentCreatedAt=null;
 const format=seconds=>String(Math.floor(Math.max(0,seconds)/60)).padStart(2,'0')+':'+String(Math.max(0,seconds)%60).padStart(2,'0');
 function view(id=activeId){
  if(!id||id!==activeId)return {state:'loading',seconds:0,label:'Checking restaurant…'};
  if(!record)return {state:'loading',seconds:0,label:'Checking restaurant…'};
  const now=Date.now();
  if(record.state==='pending'){
   const left=Math.max(0,Math.ceil((Date.parse(record.expires_at)-now)/1000));
   return {state:left?'pending':'expired',seconds:left,label:left?'Restaurant confirmation · '+format(left):'Restaurant did not confirm in time'};
  }
  if(record.state==='approved'){
   const intentDeadline=Date.parse(intentCreatedAt||'')+15*60000;
   const until=Math.min(Date.parse(record.reviewed_at||'')+8*60000,
     Number.isFinite(intentDeadline)?intentDeadline:Infinity);
   const left=Number.isFinite(until)?Math.max(0,Math.ceil((until-now)/1000)):0;
   return {state:left?'approved':'payment_expired',seconds:left,label:left?'Confirmed! Pay online · '+format(left):'Payment window expired'};
  }
  return {state:record.state,seconds:0,label:record.state==='rejected'?'Restaurant declined this request':record.state==='cancelled'?'Request cancelled':'Request expired'};
 }
 function banner(){
  const button=typeof document!=='undefined'?document.getElementById('placeOrderBtn'):null;
  if(!button)return null;
  let panel=document.getElementById('biteOrderConfirmationBanner');
  if(!panel){
   panel=document.createElement('div');panel.id='biteOrderConfirmationBanner';
   panel.className='bite-order-confirmation-banner';panel.setAttribute('role','status');
   button.closest('.checkoutactions')?.before(panel);
  }
  return panel;
 }
 function notify(){
  const current=view();
  const panel=banner();
  if(panel){
   panel.hidden=!activeId;
   panel.dataset.state=current.state;
   panel.innerHTML='<strong>'+(
    current.state==='approved'?'✓ Restaurant confirmed':
    current.state==='pending'?'⏳ Waiting for restaurant':
    current.state==='loading'?'⏳ Checking confirmation':'Restaurant confirmation'
   )+'</strong><span>'+current.label+'</span>'+
    (current.state==='pending'?'<small>No payment will be collected until the restaurant confirms.</small>':'');
  }
  if(typeof onChange==='function')onChange(current);
 }
 async function refresh(){
  if(!client||!activeId||refreshing)return view();
  const id=activeId;refreshing=true;
  try{
   const {data,error}=await client.from('bite_order_confirmations')
     .select('intent_id,state,expires_at,reviewed_at').eq('intent_id',id).maybeSingle();
   if(error)throw error;
   if(id===activeId){record=data;notify();}
  }catch(error){if(id===activeId)console.warn('Restaurant confirmation refresh unavailable',error);}
  finally{refreshing=false;}
  return view(id);
 }
 function stop(){
  if(channel&&client)client.removeChannel(channel);
  if(clock)clearInterval(clock);if(poll)clearInterval(poll);
  channel=null;clock=null;poll=null;client=null;activeId=null;record=null;onChange=null;intentCreatedAt=null;refreshing=false;
  const panel=typeof document!=='undefined'?document.getElementById('biteOrderConfirmationBanner'):null;
  if(panel)panel.hidden=true;
 }
 function watch(sb,id,callback,createdAt){
  if(!id||!sb)return;
  if(activeId===id){onChange=callback;if(createdAt)intentCreatedAt=createdAt;return;}
  stop();client=sb;activeId=id;onChange=callback;intentCreatedAt=createdAt||null;
  clock=setInterval(notify,1000);
  poll=setInterval(()=>{if(document.visibilityState!=='hidden')void refresh();},5000);
  channel=sb.channel('bite-confirm-customer-'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'bite_order_confirmations',filter:'intent_id=eq.'+id},()=>{void refresh();})
    .subscribe();
  void refresh();notify();
 }
 async function request(sb,id,callback){
  watch(sb,id,callback);
  const {data,error}=await sb.rpc('bite_request_order_confirmation',{p_intent_id:id});
  if(error)throw error;
  if(activeId===id){record=data;notify();}
  return data;
 }
 async function assertApproved(sb,id){
  watch(sb,id,onChange);
  await refresh();
  const result=view(id);
  if(result.state!=='approved')throw new Error(
    result.state==='pending'?'Restaurant confirmation ka wait karein.':
    'Restaurant ne order confirm nahi kiya. Payment shuru nahi ho sakti.'
  );
  return true;
 }
 async function cancel(sb,id){
  const {data,error}=await sb.rpc('bite_cancel_order_confirmation',{p_intent_id:id});
  if(error)throw error;
  if(activeId===id){record=data;notify();}
  return data;
 }
 root.BiteOrderConfirmation={view,watch,request,refresh,assertApproved,cancel,stop};
})(window);
