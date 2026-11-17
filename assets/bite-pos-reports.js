/* Real POS people/sales reports — use saved order + immutable service metadata only. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 const dayKey=v=>root.BitePOSV2?.dateKey?.(v)||'';
 const nowDay=()=>dayKey(new Date());
 let mode='today',selectedDate=nowDay(),selectedMonth=selectedDate.slice(0,7),attached=false;
 let source={restaurantId:null,orders:[]};
 function valid(o){
  return !!o&&o.restaurant===source.restaurantId&&o.channel?.startsWith('POS - ')&&!o.isDemo&&
  !['Cancelled','Rejected'].includes(o.status)&&!o.roomLinked&&!String(o.code||'').startsWith('POS-ROOM-');
 }
 function orders(){return source.orders.filter(valid);}
 function billAmount(o){return Math.max(0,Number(o.amount||0)-Number(o.waivedOffAmount||0));}
 function stats(bills){
  let guests=0,counted=0,dineInUnknown=0;
  for(const b of bills){
   const isDine=b.serviceType==='dine_in'||(b.serviceType==null&&b.channel==='POS - Dine-in');
   if(isDine){
    if(Number.isInteger(b.guestCount)&&b.guestCount>0){guests+=b.guestCount;counted++;}
    else dineInUnknown++;
   }
  }
  const sales=bills.reduce((s,o)=>s+billAmount(o),0);
  return {bills:bills.length,guests,counted,dineInUnknown,sales,average:bills.length?sales/bills.length:0};
 }
 function summary(range){
  const all=orders();
  const selected=range?.month?all.filter(o=>dayKey(o.createdAt).slice(0,7)===range.month):
    all.filter(o=>dayKey(o.createdAt)===(range?.date||nowDay()));
  return {...stats(selected),rows:selected};
 }
 function dayTotals(month){
  const grouped={};
  for(const o of orders()){
   const date=dayKey(o.createdAt);
   if(!date.startsWith(month))continue;
   if(!grouped[date])grouped[date]=[];
   grouped[date].push(o);
  }
  return Object.fromEntries(Object.entries(grouped).map(([day,list])=>[day,stats(list)]));
 }
 function monthName(month){
  const date=new Date(month+'-01T12:00:00+05:30');
  return new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'Asia/Kolkata'}).format(date);
 }
 function adjacent(month,delta){
  const [y,m]=month.split('-').map(Number);
  const d=new Date(Date.UTC(y,m-1+delta,1));
  return d.toISOString().slice(0,7);
 }
 function calendar(month){
  const [y,m]=month.split('-').map(Number),first=new Date(Date.UTC(y,m-1,1)),last=new Date(Date.UTC(y,m,0));
  const monday=(first.getUTCDay()+6)%7;
  const totals=dayTotals(month);
  let parts=['<div class="bpv3-week-days">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>'<span>'+x+'</span>').join('')+'</div>'];
  const days=[];
  for(let i=0;i<monday;i++)days.push('<span class="bpv3-empty-day"></span>');
  for(let d=1;d<=last.getUTCDate();d++){
   const key=month+'-'+String(d).padStart(2,'0'),n=totals[key];
   const c=['bpv3-day',key===selectedDate?'active':'',n?.bills?'has-bill':''].filter(Boolean).join(' ');
   days.push('<button type="button" class="'+c+'" data-bpv3-date="'+key+'" aria-label="'+d+' '+esc(monthName(month))+(n?.bills?', '+n.bills+' bills':'')+'">'+d+(n?.bills?'<i></i>':'')+'</button>');
  }
  parts.push('<div class="bpv3-calendar-days">'+days.join('')+'</div>');
  return parts.join('');
 }
 function trend(month){
  const map=dayTotals(month),days=Object.keys(map).sort(),list=days.map(d=>({day:d,total:map[d].sales}));
  if(!list.length||!list.some(x=>x.total>0))return '<div class="bpv3-no-trend">No recorded POS sales for this month</div>';
  const maximum=Math.max(...list.map(x=>x.total),1),width=280,height=78;
  const pts=list.map((x,i)=>[list.length===1?width/2:i*width/(list.length-1),height-10-(x.total/maximum)*(height-23)]);
  const poly=pts.map(([x,y],i)=>(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)).join(' ');
  const fill=poly+' L'+pts.at(-1)[0].toFixed(1)+' '+height+' L'+pts[0][0].toFixed(1)+' '+height+' Z';
  return '<svg class="bpv3-trend" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="POS billed sales across recorded days"><path d="'+fill+'" fill="#ffa94b33"/><path d="'+poly+'" fill="none" stroke="#f57203" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'+pts.map(([x,y])=>'<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="3" fill="#fff" stroke="#f57203" stroke-width="2"/>').join('')+'</svg>';
 }
 function reportBills(bills){
  if(!bills.length)return '<p class="bpv2-empty">No saved POS bills for this period.</p>';
  return '<div class="bpv3-bills">'+bills.slice().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,70).map(o=>{
   const type=o.serviceType==='dine_in'||o.channel==='POS - Dine-in'?'Dine-in':o.serviceType==='takeaway'||o.channel==='POS - Takeaway'?'Takeaway':'POS';
   const guest=type==='Dine-in'?(Number.isInteger(o.guestCount)?o.guestCount+' guests':'People not recorded'):'';
   const collected=Number(o.receivedAmount||0),total=billAmount(o);
   const payment=collected>=total?'Paid':collected>0?'Partial':'Unpaid';
   return '<div class="bpv3-bill"><span><strong>'+esc(o.code||'POS Bill')+'</strong><small>'+esc(o.customerName||'Walk-in')+' · '+esc(type)+(guest?' · '+esc(guest):'')+'</small></span>'+
    '<span class="bpv3-bill-sum"><b>'+money(total)+'</b><small>'+esc(payment)+'</small></span></div>';
  }).join('')+'</div>';
 }
 function paint(){
  const target=root.document.getElementById('bpv2Stats');
  if(!target)return;
  const windowSummary=mode==='monthly'?summary({month:selectedMonth}):summary({date:selectedDate});
  const known=windowSummary.counted?' / '+windowSummary.counted+' bills':'';
  target.innerHTML='<div class="bpv3-report" id="bitePOSReports" aria-label="POS sales and people reports">'+
   '<div class="bpv3-report-title"><strong>POS Reports</strong><small>Real bill history · IST calendar</small></div>'+
   '<nav class="bpv3-mode" aria-label="Report period">'+
   [['today','Today'],['calendar','Calendar'],['monthly','Monthly']].map(([id,label])=>
     '<button type="button" data-bpv3-mode="'+id+'" aria-pressed="'+(mode===id)+'">'+label+'</button>').join('')+'</nav>'+
   '<div class="bpv3-date-bar"><button type="button" data-bpv3-month="-1" aria-label="Previous month">‹</button><strong>'+esc(monthName(selectedMonth))+'</strong><button type="button" data-bpv3-month="1" aria-label="Next month">›</button></div>'+
   (mode==='today'?'<div class="bpv3-date-input"><label>Select day <input type="date" data-bpv3-input value="'+esc(selectedDate)+'"></label></div>':'')+
   '<div class="bpv3-metrics">'+
   [['Bills',windowSummary.bills],['People served',windowSummary.counted?windowSummary.guests:'—'],['POS billed',money(windowSummary.sales)],['Average bill',money(windowSummary.average)]].map(([label,value],i)=>'<div class="bpv3-metric shade-'+i+'"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>').join('')+'</div>'+
   '<div class="bpv3-coverage">'+(windowSummary.dineInUnknown?'⚠ '+windowSummary.dineInUnknown+' old dine-in bill(s) have no people count.':'Only recorded dine-in guest counts are included.')+known+'</div>'+
   (mode!=='today'?'<div class="bpv3-calendar-wrap">'+calendar(selectedMonth)+'</div>':'')+
   (mode==='monthly'?'<div class="bpv3-trend-card"><strong>POS billed sales trend</strong>'+trend(selectedMonth)+'</div>':'')+
   '<div class="bpv3-bill-title"><strong>'+ (mode==='monthly'?'Monthly bills':mode==='calendar'?'Selected day bills':'Day bills')+'</strong><span>'+windowSummary.bills+'</span></div>'+
   reportBills(windowSummary.rows)+
   '<p class="bpv3-note">No estimated guests. Billed sales are not bank cash or Cashfree settlement. Cancelled orders excluded.</p></div>';
  const recent=root.document.getElementById('bpv2Recent');if(recent)recent.innerHTML='';
 }
 function attach(){
  const el=root.document.getElementById('bitePosV2Desk');if(!el||attached)return;
  attached=true;
  el.addEventListener('click',event=>{
   const b=event.target.closest('[data-bpv3-mode],[data-bpv3-month],[data-bpv3-date]');if(!b)return;
   if(b.dataset.bpv3Mode){mode=b.dataset.bpv3Mode;if(mode==='today')selectedDate=nowDay();paint();}
   if(b.dataset.bpv3Month){selectedMonth=adjacent(selectedMonth,Number(b.dataset.bpv3Month));if(!selectedDate.startsWith(selectedMonth))selectedDate=selectedMonth+'-01';paint();}
   if(b.dataset.bpv3Date){selectedDate=b.dataset.bpv3Date;mode='calendar';paint();}
  });
  el.addEventListener('change',event=>{
   if(event.target.matches('[data-bpv3-input]')&&/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)){selectedDate=event.target.value;selectedMonth=selectedDate.slice(0,7);paint();}
  });
 }
 function render(input){
  source={restaurantId:input?.restaurantId,orders:Array.isArray(input?.orders)?input.orders:[]};
  if(mode==='today'){selectedDate=nowDay();selectedMonth=selectedDate.slice(0,7);}
  attach();paint();
 }
 root.BitePOSReports={render,summary,dayTotals,stats,adjacent,calendar,activeMode:()=>mode};
})(window);
