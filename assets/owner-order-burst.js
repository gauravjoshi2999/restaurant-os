/* Bite Owner: per-order burst accounting for foreground/reconnect alerts.
   Pure tracker, no privileged keys, payment writes or network side effects. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BiteOwnerOrderBurst=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const MAX_ACKNOWLEDGED=2000;
  const MAX_PENDING_AGE_MS=25*60*1000;
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
  // Backup polling discovers rows whose INSERT event never reached WebView.
  // Return only unseen IDs from the exact tenant; sorting is deterministic FIFO.
  function unseenReceivedIds(rows,knownIds,restaurantId){
    const known=knownIds instanceof Set?knownIds:new Set(knownIds||[]);
    const seen=new Set();
    return fifo((rows||[]).filter(order=>{
      const id=typeof order?.id==='string'?order.id.trim():'';
      if(!id||known.has(id)||seen.has(id)||!isIncoming(order,restaurantId))return false;
      seen.add(id);
      return true;
    })).map(order=>order.id);
  }
  function paidOrderIds(financials,restaurantId){
    return new Set((financials||[]).filter(f=>
      f&&f.restaurant_id===restaurantId&&
      String(f.channel||'').toLowerCase()==='own platform'&&
      String(f.payment_status||'').toLowerCase()==='paid'
    ).map(f=>String(f.order_id||'')));
  }
  function createTracker(options={}){
    const now=typeof options.now==='function'?options.now:Date.now;
    const pending=new Map();
    const announced=new Set();
    const expire=()=>{
      for(const [id,queuedAt] of pending){
        const age=now()-queuedAt;
        if(!Number.isFinite(age)||age>=MAX_PENDING_AGE_MS||age<0)pending.delete(id);
      }
    };
    const queue=id=>{
      const key=String(id||'').trim();
      if(!key||announced.has(key))return false;
      expire();
      if(!pending.has(key))pending.set(key,now());
      return true;
    };
    const take=(orders,restaurantId,canAnnounce=()=>true)=>{
      expire();
      const byId=new Map((orders||[]).filter(o=>o&&o.id).map(o=>[String(o.id),o]));
      const ready=[];
      for(const id of [...pending.keys()]){
        const order=byId.get(id);
        if(!order)continue; // May arrive before a committed row is visible.
        if(announced.has(id)||!isIncoming(order,restaurantId)){
          pending.delete(id);
          continue;
        }
        // Keep payment-pending IDs until the trusted financial snapshot confirms paid.
        if(!canAnnounce(order))continue;
        pending.delete(id);
        announced.add(id);
        if(announced.size>MAX_ACKNOWLEDGED)announced.delete(announced.values().next().value);
        ready.push(order);
      }
      return fifo(ready);
    };
    const reconcile=(before,after,restaurantId,canAnnounce=()=>true,beforePaid=null)=>{
      const previous=new Set((before||[]).map(o=>String(o?.id||'')));
      for(const order of after||[]){
        if(!order?.id||!isIncoming(order,restaurantId))continue;
        const id=String(order.id);
        // An existing unpaid order can become actionable after its payment snapshot arrives.
        // Treat the transition like a new order, while announced IDs still deduplicate.
        if(!previous.has(id)||(beforePaid instanceof Set&&!beforePaid.has(id)&&canAnnounce(order)))queue(id);
      }
      return take(after,restaurantId,canAnnounce);
    };
    return {queue,take,reconcile,pendingIds:()=>{expire();return [...pending.keys()]},
      pendingCount:()=>{expire();return pending.size},reset:()=>{pending.clear();announced.clear();}};
  }
  return {createTracker,isIncoming,fifo,unseenReceivedIds,paidOrderIds,MAX_PENDING_AGE_MS};
});
