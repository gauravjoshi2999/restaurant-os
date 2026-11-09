/* Read-only dashboard presentation. Existing server permissions remain authoritative. */
(function(root){
  'use strict';
  const core=typeof module!=='undefined'&&module.exports?require('./owner-core.js'):root.BiteOwner;
  function summarize(state,restaurantId,now=new Date()){
    const orders=(state.orders||[]).filter(o=>o.restaurant===restaurantId&&!o.isDemo&&!o.is_demo&&/own platform|website|web/i.test(String(o.channel||''))&&!/zomato|swiggy|^pos/i.test(String(o.channel||'')));
    const today=core.day(now),todayOrders=orders.filter(o=>core.day(o.createdAt)===today);
    const financials=(state.financials||[]).filter(f=>!f.is_demo);
    const active=orders.filter(o=>['Received','Accepted','Preparing','Ready','Handed Over','Out for Delivery'].includes(o.status));
    const week=Array.from({length:7},(_,i)=>{
      const d=new Date(today+'T12:00:00+05:30');d.setUTCDate(d.getUTCDate()-6+i);const key=core.day(d);
      const dayOrders=orders.filter(o=>core.day(o.createdAt)===key);
      return {key,label:new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',weekday:'short'}).format(d),amount:core.financialSummary(dayOrders,financials).net};
    });
    const todayExpenses=core.round((state.expenses||[]).filter(e=>e.restaurant_id===restaurantId&&!e.is_demo&&e.expense_date===today).reduce((sum,e)=>sum+core.number(e.amount),0));
    return {orders,todayOrders,active,week,todayExpenses,todaySales:core.financialSummary(todayOrders,financials).net,
      delivered:todayOrders.filter(o=>['Delivered','Completed'].includes(o.status)).length,
      stages:{Received:active.filter(o=>o.status==='Received').length,Preparing:active.filter(o=>['Accepted','Preparing'].includes(o.status)).length,Ready:active.filter(o=>o.status==='Ready').length}};
  }
  function render(doc,state,access){
    const data=summarize(state,access.restaurantId),money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
    const set=(id,value)=>{const el=doc.getElementById(id);if(el)el.textContent=value;};
    const restaurant=(state.restaurants||[]).find(r=>r.id===access.restaurantId);
    set('ownerHomeTitle','Namaste.');set('ownerHomeSubtitle','Aaj ka kaam aur business ka hisaab, ek jagah.');
    set('ownerSidebarRestaurant',restaurant?.name||'Your restaurant');
    const closed=restaurant?.is_temporarily_closed&&(!restaurant.temporary_closure_until||new Date(restaurant.temporary_closure_until)>new Date());
    set('ownerOutletStatus',closed?'Temporarily closed':restaurant?.delivery_paused?'Delivery paused':restaurant?.accepts_delivery?'Delivery enabled':restaurant?.accepts_pickup?'Pickup enabled':'Manage availability');
    set('ownerTodaySales',money(data.todaySales));set('ownerTodayOrders',String(data.todayOrders.length));
    set('ownerPendingOrders',String(data.active.length));set('ownerTodayExpenses',money(data.todayExpenses));
    for(const [status,id] of [['Received','ownerNewOrders'],['Preparing','ownerPreparingOrders'],['Ready','ownerReadyOrders']])set(id,String(data.stages[status]));
    set('ownerQueueNote',data.stages.Received?data.stages.Received+' naye order aapke response ka intezaar kar rahe hain.':data.active.length?data.active.length+' active orders. Status update karke kaam aage badhayein.':'Sab up to date. Naye orders aate hi yahan dikhenge.');
    set('ownerWeekSales',money(core.round(data.week.reduce((n,d)=>n+d.amount,0))));
    const chart=doc.getElementById('ownerSalesChart'),max=Math.max(1,...data.week.map(d=>d.amount));
    if(chart){chart.replaceChildren();data.week.forEach(d=>{const col=doc.createElement('div');col.className='od-chart-column';col.title=d.key+' · '+money(d.amount);const track=doc.createElement('div');track.className='od-chart-track';const bar=doc.createElement('span');bar.style.height=(d.amount>0?Math.max(3,d.amount/max*100):0)+'%';track.append(bar);const label=doc.createElement('small');label.textContent=d.label;const value=doc.createElement('span');value.className='od-chart-value';value.textContent=money(d.amount);col.append(value,track,label);chart.append(col);});}
    set('ownerSalesNote',data.week.some(d=>d.amount)?'Confirmed collections, refunds adjust karke. Sample orders alag hain.':'Pichhle 7 din mein confirmed paid sale nahi hai. Payment aane par chart update hoga.');
    const rows=doc.getElementById('ownerRecentOrders');
    if(rows){rows.replaceChildren();data.orders.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5).forEach(o=>{const tr=doc.createElement('tr');[o.code||o.id.slice(0,8),'Bite',money(o.amount),o.status||'—'].forEach((value,index)=>{const td=doc.createElement('td');if(index===3){const pill=doc.createElement('span');pill.className='pill';pill.textContent=value;td.append(pill);}else td.textContent=value;tr.append(td);});rows.append(tr);});}
    const empty=doc.getElementById('ownerRecentEmpty');if(empty)empty.style.display=data.orders.length?'none':'flex';
  }
  const api={summarize,render};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BiteDashboard=api;
})(typeof window!=='undefined'?window:globalThis);
