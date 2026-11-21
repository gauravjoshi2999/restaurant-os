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
  for(const key of ['bills','billed','guests','dine_in','takeaway','untracked','historical_bills','historical_billed','historical_received'])out[key]+=(Number(r[key])||0);
  return out;
 },{bills:0,billed:0,guests:0,dine_in:0,takeaway:0,untracked:0,historical_bills:0,historical_billed:0,historical_received:0});
}
// Reject partial, duplicate or mismatched calendar responses before calculating totals.
function completePeriod(data,period,day){
 if(!data||data.month!==period||data.selected_day!==day||
    !Array.isArray(data.days)||!Array.isArray(data.recent)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return false;
 const [year,m]=period.split('-').map(Number);
 const count=new Date(Date.UTC(year,m,0)).getUTCDate();
 if(data.days.length!==count)return false;
 const dates=new Set(data.days.map(row=>row?.date));
 if(!dates.has(day)||dates.size!==count)return false;
 for(let i=1;i<=count;i++)if(!dates.has(period+'-'+pad(i)))return false;
 return true;
}
function selectedRow(){return (report?.days||[]).find(x=>x.date===selected)||null;}
// Historical POS snapshots are read-only register entries, not new orders or cash movements.
// RLS on bite_owner_historical_entries scopes every page to the authenticated outlet.
async function historicalRowsForMonth(client,scope,period){
 const out=[],size=500,end=shiftMonth(period,1)+'-01';
 if(typeof client.from!=='function')throw Error('Historical register access is unavailable');
 for(let start=0;start<25000;start+=size){
  const {data,error}=await client.from('bite_owner_historical_entries')
   .select('id,record_date,recorded_at,customer_name,amount,received_amount,guest_count,visit_type')
   .eq('restaurant_id',scope).eq('entry_kind','pos')
   .gte('record_date',period+'-01').lt('record_date',end)
   .order('record_date',{ascending:false}).order('recorded_at',{ascending:false}).order('id',{ascending:false})
   .range(start,start+size-1);
  if(error)throw error;
  if(!Array.isArray(data))throw Error('Incomplete historical register response');
  out.push(...data);
  if(data.length<size)return out;
 }
 throw Error('Too many historical entries in this month; request a complete export');
}
function historicalMoney(value){
 if(!(typeof value==='number'||typeof value==='string'&&value.trim()!=='')||!Number.isFinite(Number(value))||Number(value)<0)throw Error('Historical money is unavailable');
 const cents=Math.round(Number(value)*100);
 if(!Number.isSafeInteger(cents)||Math.abs(Number(value)*100-cents)>0.00001)throw Error('Historical money is invalid');
 return cents/100;
}
function mergeHistorical(live,rows){
 const days=(live.days||[]).map(d=>({...d,historical_bills:0,historical_billed:0,historical_received:0}));
 const byDay=new Map(days.map(d=>[d.date,d]));
 const selectedHistory=[],seen=new Set();
 if(!Array.isArray(rows))throw Error('Incomplete historical register response');
 for(const h of rows){
  if(!h?.id||seen.has(h.id))throw Error('Duplicate or missing historical record identity');
  seen.add(h.id);
  const d=byDay.get(h.record_date);if(!d)throw Error('Historical record is outside the report dates');
  const billed=historicalMoney(h.amount),received=historicalMoney(h.received_amount);
  if(received>billed)throw Error('Historical received total exceeds bill');
  if(!['dine_in','takeaway'].includes(h.visit_type))throw Error('Historical visit type unavailable');
  if(h.visit_type==='dine_in'&&(!Number.isInteger(Number(h.guest_count))||Number(h.guest_count)<1||Number(h.guest_count)>200))throw Error('Historical guest count unavailable');
  d.bills=(Number(d.bills)||0)+1;d.billed=(Number(d.billed)||0)+billed;
  d.historical_bills+=1;d.historical_billed+=billed;d.historical_received+=received;
  if(h.visit_type==='dine_in'){
   d.dine_in=(Number(d.dine_in)||0)+1;
   d.guests=(Number(d.guests)||0)+(Number(h.guest_count)||0);
  }else if(h.visit_type==='takeaway')d.takeaway=(Number(d.takeaway)||0)+1;
  if(h.record_date===live.selected_day)selectedHistory.push({
   id:h.id,code:'Old register',customer:h.customer_name||'Walk-in',billed,
   service:h.visit_type,guests:h.guest_count,status:'Historical record',
   source:'historical',received,recordedAt:h.recorded_at
  });
 }
 selectedHistory.sort((a,b)=>String(b.recordedAt||'').localeCompare(String(a.recordedAt||'')));
 const oldRecent=(live.recent||[]).map(r=>({...r,source:'live'}));
 return {...live,days,recent:[...selectedHistory,...oldRecent].slice(0,8)};
}

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
  const history=b.source==='historical';
  return '<div class="bpr-bill"><span><strong>'+safe(history?'Old POS register':b.code||'POS Bill')+'</strong><small>'+safe(b.customer||'Walk-in')+' · '+safe(service)+(history?' · Historical entry':'')+'</small></span>'+
    '<strong>'+money(b.billed)+'</strong></div>';
 }).join('')+'</div>';
}
function showReport(){
 if(!container)return;
 const data=Array.isArray(report?.days)?report.days:[];
 if(!data.length){
  container.innerHTML='<div class="bpr-error">Report data abhi available nahi hai. <button type="button" data-bpr-refresh>Retry</button></div>';return;
 }
 const current=selectedRow()||{bills:0,billed:0,guests:0,dine_in:0,takeaway:0,untracked:0,historical_bills:0,historical_billed:0,historical_received:0};
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
 const historicalNote=report.historyError
   ?'<p class="bpr-history-alert" role="alert">Old register records load nahi hue: '+safe(report.historyError)+'. Live bills only dikh rahe hain. Refresh karein.</p>'
   :'<p class="bpr-history-note"><strong>'+Number(metric.historical_bills||0)+' old register bill(s)</strong> included · '+money(metric.historical_billed)+' historical billing · '+money(metric.historical_received)+' previously received (record only, not cash collected now).</p>';
 const addOld=mode!=='monthly'&&selected<today
   ?'<div class="bpr-old-action"><button type="button" data-bpr-add-old>＋ Add old POS bill · '+safe(dateLabel(selected))+'</button><small>Selected date will automatically fill in the New POS Bill form.</small></div>':'';

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
  selection+cards+countNote+historicalNote+addOld+
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
  if(!completePeriod(res.data,period,day))
   throw new Error('Incomplete report response');
  let historical=[],historyError='';
  try{historical=await historicalRowsForMonth(sb,scope,period);}
  catch(e){historyError=e?.message||'Network error';}
  if(epoch!==request||scope!==restaurantId||authUser!==userId||container==null)return;
  try{report=mergeHistorical(res.data,historical);}
  catch(e){historyError=e?.message||'Historical register validation failed';report=mergeHistorical(res.data,[]);}
  report.historyError=historyError;
  showReport();
 }catch(error){
  if(epoch!==request||scope!==restaurantId)return;
  fail(error?.code==='42501'?'Aapko is restaurant ki report dekhne ki permission nahi hai.':(error?.message||'Network error'));
 }finally{if(epoch===request)loading=false;}
}
function onClick(e){
 const btn=e.target.closest?.('[data-bpr-mode],[data-bpr-date],[data-bpr-shift],[data-bpr-refresh],[data-bpr-add-old]');
 if(!btn)return;
 if(btn.hasAttribute('data-bpr-add-old')){
  const date=selected;
  if(!date||date>=istToday())return;
  void (async()=>{
   if(typeof root.openOrder!=='function')throw Error('New POS Bill cannot be opened');
   await root.openOrder();
   root.BiteOwnerHistory?.scan?.();
   const form=doc.getElementById('orderForm'),input=form?.elements?.history_date;
   if(!form||!input||!doc.getElementById('orderModal')?.classList.contains('show'))
    throw Error('Old date calendar is not ready. Refresh and try again.');
   input.value=date;
   input.dispatchEvent(new Event('change',{bubbles:true}));
   form.querySelector('[data-bhe-calendar]')?.scrollIntoView?.({block:'nearest'});
  })().catch(error=>root.alert?.(error.message||String(error)));
  return;
 }
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
 const changed=restaurantId!==restaurant||userId!==user;
 const replacedPanel=container!==el;
 if(changed){epoch++;report=null;month=istToday().slice(0,7);selected=istToday();mode='today';loading=false;}
 else if(replacedPanel){epoch++;report=null;loading=false;} // Reopening Reports fetches fresh saved bills.
 if(container&&container!==el){container.removeEventListener('click',onClick);delete container.dataset.bprBound;}
 container=el;sb=client;restaurantId=restaurant;userId=user;
 if(el.dataset.bprBound!=='true'){el.dataset.bprBound='true';el.addEventListener('click',onClick);}
 if(!report&&!loading)void refresh();
 else if(report)showReport();
}
function focusDate(day){
 if(!container||!sb||!restaurantId||!userId||typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||
    day>istToday()||!Number.isFinite(new Date(day+'T00:00:00Z').getTime())||
    new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)return false;
 month=day.slice(0,7);selected=day;mode='calendar';
 void refresh(true);return true;
}
function clear(){epoch++;if(container){container.removeEventListener('click',onClick);delete container.dataset.bprBound;}container=null;sb=null;restaurantId='';userId='';report=null;loading=false;}
root.BitePOSReports={mount,refresh,focusDate,clear,summarize,shiftMonth,calendarHtml,istToday,mergeHistorical,historicalRowsForMonth,completePeriod};
})(window);
