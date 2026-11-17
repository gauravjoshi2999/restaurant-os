/* Bite POS Step 3 — real, restaurant-scoped date / month reports.
 * Data are from authenticated bite_pos_reports_v1; no fabricated figures,
 * no payment mutations, no assumption about historical diner counts. */
(function(root){
'use strict';
const doc=root.document;
let sb=null,restaurantId='',userId='',container=null;
let month='',selected='',mode='today',epoch=0,report=null,loading=false;
const money=n=>'₹'+(Number(n)||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const safe=s=>String(s??'').replace(/[&<>"']/g,k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[k]));
const pad=n=>String(n).padStart(2,'0');
function istToday(){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(new Date()).map(part=>[part.type,part.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
function shiftMonth(ym,by){
 const [y,m]=ym.split('-').map(Number);
 const date=new Date(Date.UTC(y,m-1+by,1));
 return date.getUTCFullYear()+'-'+pad(date.getUTCMonth()+1);
}
function dateLabel(day,monthOnly=false){
 const dt=new Date((monthOnly?day+'-01':day)+'T12:00:00Z');
 return new Intl.DateTimeFormat('en-IN',{timeZone:'UTC',month:'long',year:'numeric',
  ...(monthOnly?{}:{day:'numeric'})}).format(dt);
}
function emptyDate(monthValue){return monthValue===istToday().slice(0,7)?istToday():monthValue+'-01';}
function summarize(days){
 const rows=Array.isArray(days)?days:[];
 return rows.reduce((out,r)=>{
  for(const key of ['bills','billed','guests','dine_in','takeaway','untracked'])out[key]+=(Number(r[key])||0);
  return out;
 },{bills:0,billed:0,guests:0,dine_in:0,takeaway:0,untracked:0});
}
function selectedRow(){return (report?.days||[]).find(x=>x.date===selected)||null;}
function summaryCard(name,value,theme,icon){
 return '<div class="bpr-metric '+theme+'"><span class="bpr-metric-icon">'+icon+'</span><span>'+safe(name)+'</span><strong>'+safe(value)+'</strong></div>';
}
function sparkline(days){
 const points=(days||[]).map(x=>Number(x.billed)||0);
 if(!points.some(x=>x>0))return '<div class="bpr-chart-empty">Is period mein koi recorded POS sale nahi hai.</div>';
 const max=Math.max(...points,1),w=300,h=100;
 const xy=points.map((v,i)=>({x:6+(i*(w-12)/Math.max(1,points.length-1)),y:86-(v/max*70)}));
 const path=xy.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
 const area=path+' L'+xy.at(-1).x.toFixed(1)+' 94 L6 94 Z';
 return '<svg class="bpr-chart" viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="Actual POS billed amount trend">'+
 '<defs><linearGradient id="bpr-spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f47613" stop-opacity=".32"/><stop offset="100%" stop-color="#f47613" stop-opacity="0"/></linearGradient></defs>'+
 '<path d="'+area+'" fill="url(#bpr-spark-fill)"/><path d="'+path+'" fill="none" stroke="#f47613" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'+
 xy.filter((_,i)=>i===0||i===xy.length-1||points.length<=7).map(p=>'<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3.2" fill="#fff" stroke="#f47613" stroke-width="2"/>').join('')+'</svg>';
}
function calendarHtml(days){
 const [year,m]=month.split('-').map(Number);
 const first=(new Date(Date.UTC(year,m-1,1)).getUTCDay()+6)%7;
 const head='<div class="bpr-weekdays">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>'<span>'+x+'</span>').join('')+'</div>';
 const empty=Array.from({length:first},()=>'<span aria-hidden="true"></span>').join('');
 const cells=days.map(r=>{
  const active=r.date===selected,hasBills=Number(r.bills)>0;
  return '<button type="button" class="bpr-date'+(active?' is-active':'')+'" data-bpr-date="'+safe(r.date)+'" aria-pressed="'+String(active)+'" aria-label="'+safe(dateLabel(r.date))+', '+(Number(r.bills)||0)+' bills">'+
   '<span>'+Number(r.date.slice(8))+'</span>'+(hasBills?'<i aria-hidden="true"></i>':'')+'</button>';
 }).join('');
 return '<div class="bpr-calendar">'+head+'<div class="bpr-calendar-grid">'+empty+cells+'</div></div>';
}
function billList(){
 const rows=report?.recent||[];
 if(!rows.length)return '<div class="bpr-empty">Is date ka koi POS bill record nahi mila.</div>';
 return '<div class="bpr-bills">'+rows.map(b=>{
  const service=b.service==='dine_in'?'Dine-in · '+b.guests+' guest(s)':b.service==='takeaway'?'Takeaway':'Old / Untracked';
  return '<div class="bpr-bill"><span><strong>'+safe(b.code||'POS Bill')+'</strong><small>'+safe(b.customer||'Walk-in')+' · '+safe(service)+'</small></span>'+
    '<strong>'+money(b.billed)+'</strong></div>';
 }).join('')+'</div>';
}
function showReport(){
 if(!container)return;
 const data=Array.isArray(report?.days)?report.days:[];
 if(!data.length){
  container.innerHTML='<div class="bpr-error">Report data abhi available nahi hai. <button type="button" data-bpr-refresh>Retry</button></div>';return;
 }
 const current=selectedRow()||{bills:0,billed:0,guests:0,dine_in:0,takeaway:0,untracked:0};
 const totals=summarize(data);
 const metric=mode==='monthly'?totals:current;
 const metricTitle=mode==='monthly'?'Monthly POS summary':dateLabel(selected);
 const avg=Number(metric.bills)?money(Number(metric.billed)/Number(metric.bills)):'₹0';
 const cards='<div class="bpr-metrics">'+
  summaryCard('Bills',String(metric.bills),'is-purple','▤')+
  summaryCard('Guests served',String(metric.guests),'is-amber','♙')+
  summaryCard('POS billed',money(metric.billed),'is-green','₹')+
  summaryCard('Avg. bill',avg,'is-blue','▣')+'</div>';
 const countNote='<p class="bpr-count-note">'+
  metric.dine_in+' dine-in · '+metric.takeaway+' takeaway'+
  (metric.untracked?' · '+metric.untracked+' old/untracked bills (guest counts unknown)':'')+
  '</p>';
 const today=istToday(),dataToShow=mode==='today'?data.filter(x=>x.date<=selected&&x.date>=(function(){const t=new Date(selected+'T12:00:00Z');t.setUTCDate(t.getUTCDate()-6);return t.toISOString().slice(0,10)})()):data;
 const trend='<div class="bpr-trend"><div class="bpr-heading"><strong>'+(mode==='today'?'Recent 7 days':'Daily sales trend')+'</strong><small>Billed value, not cash received</small></div>'+sparkline(dataToShow)+'</div>';
 const calendar=mode==='calendar'?calendarHtml(data):'';
 const selection='<div class="bpr-heading bpr-date-heading"><strong>'+safe(metricTitle)+'</strong>'+
  '<button type="button" data-bpr-refresh>Refresh ↻</button></div>';
 const recent=mode==='monthly'?'':('<div class="bpr-heading"><strong>Recent bills · '+safe(dateLabel(selected))+'</strong><small>Showing up to 8</small></div>'+billList());
 container.innerHTML='<section class="bite-pos-report" aria-label="POS daily and monthly reports">'+
  '<div class="bpr-heading"><strong>POS Reports</strong><small>Real restaurant counter bills</small></div>'+
  '<div class="bpr-period"><button type="button" data-bpr-shift="-1" aria-label="Previous month">‹</button>'+
   '<strong>'+safe(dateLabel(month,true))+'</strong>'+
   '<button type="button" data-bpr-shift="1" aria-label="Next month">›</button></div>'+
  '<div class="bpr-modes" role="group" aria-label="POS report view">'+
   ['today','calendar','monthly'].map(m=>'<button type="button" data-bpr-mode="'+m+'" aria-pressed="'+String(mode===m)+'">'+m[0].toUpperCase()+m.slice(1)+'</button>').join('')+'</div>'+
  selection+cards+countNote+
  (mode==='calendar'?calendar+trend:trend)+
  recent+'<p class="bpr-note">Online customer orders aur hotel room folio alag hain. Purane bills ki guest count estimate nahi ki gayi. Refund/cancelled sales billed value mein adjust hain.</p></section>';
}
function fail(message){
 if(!container)return;
 container.innerHTML='<div class="bpr-error"><strong>POS Reports load nahi hue</strong><p>'+safe(message)+'</p><button type="button" data-bpr-refresh>Retry report</button></div>';
}
async function refresh(force=false){
 if(!sb||!restaurantId||!userId||!container)return;
 if(loading&&!force)return;
 const request=++epoch,scope=restaurantId,authUser=userId,period=month,day=selected;
 loading=true;
 container.innerHTML='<div class="bpr-loading" role="status">POS reports loading…</div>';
 try{
  const res=await sb.rpc('bite_pos_reports_v1',{p_restaurant_id:scope,p_month:period+'-01',p_day:day});
  if(epoch!==request||scope!==restaurantId||authUser!==userId||container==null)return;
  if(res.error)throw res.error;
  if(!res.data||res.data.month!==period||!Array.isArray(res.data.days)||res.data.days.length<28)
   throw new Error('Incomplete report response');
  report=res.data;
  showReport();
 }catch(error){
  if(epoch!==request||scope!==restaurantId)return;
  fail(error?.code==='42501'?'Aapko is restaurant ki report dekhne ki permission nahi hai.':(error?.message||'Network error'));
 }finally{if(epoch===request)loading=false;}
}
function onClick(e){
 const btn=e.target.closest?.('[data-bpr-mode],[data-bpr-date],[data-bpr-shift],[data-bpr-refresh]');
 if(!btn)return;
 if(btn.dataset.bprMode){
  mode=btn.dataset.bprMode;
  if(mode==='today'){month=istToday().slice(0,7);selected=istToday();}
  if(mode==='monthly'){selected=emptyDate(month);}
  if(report?.month===month&&report?.selected_day===selected){showReport();}
  else void refresh(true);
 }else if(btn.dataset.bprDate){
  selected=btn.dataset.bprDate;mode='calendar';void refresh(true);
 }else if(btn.dataset.bprShift){
  month=shiftMonth(month,Number(btn.dataset.bprShift));
  selected=emptyDate(month);mode='calendar';void refresh(true);
 }else if(btn.hasAttribute('data-bpr-refresh'))void refresh(true);
}
function mount({el,client,restaurant,user}){
 if(!el||!client||!restaurant||!user)return;
 const changed=restaurantId!==restaurant||userId!==user||container!==el;
 if(changed){epoch++;report=null;month=istToday().slice(0,7);selected=istToday();mode='today';loading=false;}
 if(container&&container!==el)container.removeEventListener('click',onClick);
 container=el;sb=client;restaurantId=restaurant;userId=user;
 if(el.dataset.bprBound!=='true'){el.dataset.bprBound='true';el.addEventListener('click',onClick);}
 if(!report&&!loading)void refresh();
 else if(report)showReport();
}
function clear(){epoch++;if(container)container.removeEventListener('click',onClick);container=null;sb=null;restaurantId='';userId='';report=null;loading=false;}
root.BitePOSReports={mount,refresh,clear,summarize,shiftMonth,calendarHtml,istToday};
})(window);
