/* Bite owner cancellation alert controller. All reads use existing tenant RLS. */
(function(root){
 'use strict';
 function create({client,doc,getContext,onNotify,onOpen,intervalMs=9000}){
  let active=false,timer=null,busy=false,scope=null,first=true,seen=new Set(),lastSignature='';
  const notice=doc.createElement('div');
  notice.id='biteOwnerCancelAlert';
  notice.className='bite-owner-cancel-alert';
  notice.setAttribute('role','status');
  notice.setAttribute('aria-live','polite');
  notice.hidden=true;
  notice.innerHTML='<span class="bite-cancel-alert-copy"></span><button type="button" class="bite-cancel-alert-open">Review now</button>';
  const copy=notice.querySelector('.bite-cancel-alert-copy');
  notice.querySelector('button').addEventListener('click',()=>{if(active&&scope)void onOpen();});
  const identity=()=>{const c=getContext()||{};return c.role==='owner'&&c.userId&&c.restaurantId?
   c.userId+':'+c.restaurantId:null;};
  function reset(){
   seen.clear();first=true;lastSignature='';
   notice.hidden=true;copy.textContent='';
  }
  async function refresh(){
   if(!active||busy||doc.visibilityState==='hidden')return;
   const key=identity();
   if(!key){scope=null;reset();return;}
   if(scope!==key){scope=key;reset();}
   const restaurantId=key.split(':')[1];
   busy=true;
   try{
    const {data,error}=await client.from('restaurant_customer_order_requests')
     .select('id,order_id,restaurant_id,request_type,status,created_at')
     .eq('restaurant_id',restaurantId).eq('request_type','cancel_request')
     .eq('status','Pending').order('created_at',{ascending:false}).limit(50);
    if(error)throw error;
    if(!active||identity()!==key)return;
    const rows=(data||[]).filter(r=>r.restaurant_id===restaurantId&&r.request_type==='cancel_request'&&r.status==='Pending');
    const newRows=first?[]:rows.filter(r=>!seen.has(r.id));
    for(const row of rows)seen.add(row.id);
    first=false;
    const label=rows.length===1?'1 cancellation request needs your decision':
      rows.length+' cancellation requests need your decision';
    const signature=String(rows.length)+':'+rows.map(r=>r.id).sort().join(',');
    if(lastSignature!==signature){
     notice.hidden=rows.length===0;
     copy.textContent=label;
     lastSignature=signature;
    }
    // No automatic decision: these are pending customer requests only.
    for(const row of newRows)onNotify(row);
   }catch(error){
    if(active&&identity()===key){
     // Do not invent a zero-request state when the network/RLS is unavailable.
     console.warn('Cancellation request alerts unavailable',String(error?.message||error).slice(0,100));
    }
   }finally{busy=false;}
  }
  function resume(){if(active)void refresh();}
  function start(){
   if(active)return;
   active=true;
   doc.getElementById('mainApp')?.prepend(notice);
   void refresh();
   timer=setInterval(()=>void refresh(),intervalMs);
   doc.addEventListener('visibilitychange',resume);
   root.addEventListener?.('pageshow',resume);
  }
  function stop(){
   active=false;clearInterval(timer);timer=null;
   doc.removeEventListener('visibilitychange',resume);
   root.removeEventListener?.('pageshow',resume);
   scope=null;reset();notice.remove();
  }
  return {start,stop,refresh,pendingCount:()=>notice.hidden?0:Number(copy.textContent.match(/^\d+/)?.[0]||0)};
 }
 const api={create};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.BiteOwnerCancellationAlerts=api;
})(typeof window!=='undefined'?window:globalThis);
