/* Bite Owner: lossless burst accounting for foreground and resume-time order alerts.
   Pure, dependency-free tracker; Supabase, sound, push, and money stay in the Owner controller. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BiteOwnerOrderBurst=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const MAX_ACKNOWLEDGED=2000;
  function isIncoming(order,restaurantId){
    if(!order||!restaurantId)return false;
    const rid=order.restaurant||order.restaurant_id;
    const channel=String(order.channel||'').toLowerCase();
    return rid===restaurantId&&order.status==='Received'&&
      order.isDemo!==true&&order.is_demo!==true&&
      (channel.includes('own platform')||channel.includes('website')||channel.includes('web'))&&
      !channel.includes('zomato')&&!channel.includes('swiggy');
  }
  function fifo(orders){
    return [...orders].sort((a,b)=>{
      const at=Date.parse(a.createdAt||a.order_date||a.created_at||'');
      const bt=Date.parse(b.createdAt||b.order_date||b.created_at||'');
      const diff=(Number.isFinite(at)?at:0)-(Number.isFinite(bt)?bt:0);
      return diff||String(a.id||'').localeCompare(String(b.id||''));
    });
  }
  function createTracker(){
    const pending=new Set();
    const announced=new Set();
    const queue=id=>{
      const key=String(id||'').trim();
      if(!key||announced.has(key))return false;
      pending.add(key);
      return true;
    };
    const take=(orders,restaurantId)=>{
      const byId=new Map((orders||[]).filter(o=>o&&o.id).map(o=>[String(o.id),o]));
      const ready=[];
      for(const id of [...pending]){
        const order=byId.get(id);
        if(!order)continue; // Load may lag an event; keep the ID for a later refresh.
        pending.delete(id);
        if(announced.has(id)||!isIncoming(order,restaurantId))continue;
        announced.add(id);
        if(announced.size>MAX_ACKNOWLEDGED)announced.delete(announced.values().next().value);
        ready.push(order);
      }
      return fifo(ready);
    };
    const reconcile=(before,after,restaurantId)=>{
      const previous=new Set((before||[]).map(o=>String(o?.id||'')));
      for(const order of after||[]){
        if(order?.id&&!previous.has(String(order.id))&&isIncoming(order,restaurantId))queue(order.id);
      }
      return take(after,restaurantId);
    };
    return {queue,take,reconcile,pendingCount:()=>pending.size,reset:()=>{pending.clear();announced.clear();}};
  }
  return {createTracker,isIncoming,fifo};
});
