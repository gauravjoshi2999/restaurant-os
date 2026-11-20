/* Owner V3 R03 — read-only historical POS / canonical Daily Book reconciliation.
 * This never creates POS orders, cash receipts, ledger rows, statutory bills or debts. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const dayValid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  Number.isFinite(new Date(s+'T00:00:00Z').getTime())&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 const cents=v=>{
  const n=Number(v);
  if(!(typeof v==='number'||typeof v==='string'&&v.trim()!=='')||!Number.isFinite(n)||n<0||!Number.isSafeInteger(Math.round(n*100))||Math.abs(n*100-Math.round(n*100))>1e-6)return null;
  return Math.round(n*100);
 };
 function validPeriod(from,to,today){
  return dayValid(from)&&dayValid(to)&&dayValid(today)&&from<=to&&to<=today;
 }
 function summarize(rows,{restaurantId,from,to}){
  if(!Array.isArray(rows)||!restaurantId||!validPeriod(from,to,to))throw Error('Invalid historical register scope or report period.');
  const ids=new Set();
  let billedCents=0,receivedCents=0;
  const daily=new Map();
  const safeRows=[];
  for(const row of rows){
   if(!row?.id||ids.has(row.id)||row.restaurant_id!==restaurantId||!dayValid(row.record_date)||
      row.record_date<from||row.record_date>to)throw Error('Historical register returned inconsistent or unrelated records.');
   const bill=cents(row.amount),received=cents(row.received_amount);
   if(bill===null||received===null||received>bill)throw Error('Old register has an invalid billed or received amount.');
   ids.add(row.id);billedCents+=bill;receivedCents+=received;
   if(!Number.isSafeInteger(billedCents)||!Number.isSafeInteger(receivedCents))throw Error('Old register total exceeds safe bounds.');
   const date=String(row.record_date),current=daily.get(date)||{date,count:0,billedCents:0,receivedCents:0};
   current.count++;current.billedCents+=bill;current.receivedCents+=received;daily.set(date,current);
   safeRows.push({...row,billedCents:bill,receivedCents:received});
  }
  safeRows.sort((a,b)=>b.record_date.localeCompare(a.record_date)||
   String(b.recorded_at||'').localeCompare(String(a.recorded_at||''))||String(b.id).localeCompare(String(a.id)));
  return {rows:safeRows,count:safeRows.length,billedCents,receivedCents,
   remainingCents:billedCents-receivedCents,days:[...daily.values()].sort((a,b)=>b.date.localeCompare(a.date))};
 }
 async function load({client,restaurantId,from,to,today,isCurrent,pageSize=500,maxRows=20000}){
  if(!client?.from||!restaurantId||!validPeriod(from,to,today))throw Error('Choose a valid past/current date and restaurant.');
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>500||!Number.isInteger(maxRows)||maxRows<pageSize||maxRows%pageSize)
   throw Error('Historical query bounds are invalid.');
  const rows=[];
  for(let start=0;start<maxRows;start+=pageSize){
   if(isCurrent?.()===false)throw Error('Scope changed before historical register read.');
   const {data,error}=await client.from('bite_owner_historical_entries')
    .select('id,restaurant_id,record_date,recorded_at,customer_name,amount,received_amount,payment_method,guest_count,visit_type')
    .eq('restaurant_id',restaurantId).eq('entry_kind','pos')
    .gte('record_date',from).lte('record_date',to)
    .order('record_date',{ascending:false}).order('recorded_at',{ascending:false}).order('id',{ascending:false})
    .range(start,start+pageSize-1);
   if(isCurrent?.()===false)throw Error('Scope changed during historical register read.');
   if(error)throw error;
   if(!Array.isArray(data))throw Error('Old register returned incomplete data.');
   rows.push(...data);
   if(data.length<pageSize)return summarize(rows,{restaurantId,from,to});
  }
  throw Error('Old register exceeds the verified page limit; totals are hidden until a complete export is available.');
 }
 function postedPosSummary(journal,from,to){
  if(!Array.isArray(journal)||!validPeriod(from,to,to))return {verified:false};
  const seen=new Set();let count=0,totalCents=0;
  for(const x of journal){
   if(x?.source_type!=='order_payment'||x.direction!=='in')continue;
   if(!dayValid(x.day))return {verified:false};
   if(x.day<from||x.day>to||!['Cash','UPI','Card','Bank Transfer'].includes(x.method))continue;
   const value=cents(x.amount);
   if(typeof x.id!=='string'||!x.id.trim()||seen.has(x.id)||value===null||value<=0)return {verified:false};
   seen.add(x.id);count++;totalCents+=value;
   if(!Number.isSafeInteger(totalCents))return {verified:false};
  }
  return {verified:true,count,totalCents};
 }
 async function mount(target,{client,restaurantId,from,to,today,scope,isCurrent,onOpen,journal}={}){
  if(!target)return {ok:false};
  const active=()=>!!target.isConnected&&isCurrent?.()!==false;
  if(!restaurantId){
   target.innerHTML='<div class="v3-history-head"><h2>Old POS register</h2></div><p class="v3-history-note">No linked restaurant is available for this property. Old POS data was not included in live accounts.</p>';
   return {ok:false,reason:'unlinked'};
  }
  target.innerHTML='<div class="v3-history-head"><h2>Old POS register</h2><small>'+esc(from)+' → '+esc(to)+'</small></div><p role="status">Reading old POS entries…</p>';
  try{
   const summary=await load({client,restaurantId,from,to,today,isCurrent:active});
   if(!active())return {ok:false,reason:'stale'};
   const posted=postedPosSummary(journal,from,to);
   let visible=100;
   function draw(){
    if(!active())return;
    const list=summary.rows.slice(0,visible);
    target.innerHTML='<div class="v3-history-head"><div><h2>Old POS register</h2><p>Old records • separate from Daily Book transactions</p></div><small>'+esc(from)+' → '+esc(to)+'</small></div>'+
     (summary.count?'<div class="v3-history-metrics">'+
       '<div><span>Old entries</span><strong>'+summary.count+'</strong></div>'+
       '<div><span>Old billed (register)</span><strong>'+money(summary.billedCents/100)+'</strong></div>'+
       '<div><span>Old written received</span><strong>'+money(summary.receivedCents/100)+'</strong></div>'+
       '<div><span>Old register remainder</span><strong>'+money(summary.remainingCents/100)+'</strong></div></div>':'<p class="v3-history-empty">No saved old POS entries in this selected period. Live POS records remain in Daily Book and POS.</p>')+
     '<p class="v3-history-note">Reference only: old written received is NOT a newly collected or bank-verified payment. These figures are NOT added to live billed sales, cash/UPI, profit, GST invoices or customer Khata. Check originals before adjusting accounts.</p>'+
     '<p class="v3-history-posted">'+(posted.verified?
        'Existing Daily Book POS receipts for this property (independent, not matched): '+money(posted.totalCents/100)+' · '+posted.count+' transaction(s). Do not add this to the old register amount.':
        'Existing POS receipts could not be verified for comparison. No difference is calculated.')+'</p>'+
     (summary.count?'<div class="v3-history-list">'+list.map(x=>
       '<article class="v3-history-row"><div><strong>'+esc(x.record_date)+' · '+esc(x.customer_name||'Walk-in')+'</strong>'+
        '<small>'+esc(x.visit_type==='takeaway'?'Takeaway':x.visit_type==='dine_in'?String(x.guest_count||'?')+' dine-in guests':'Old POS entry')+
        ' · '+esc(x.payment_method||'Method not recorded')+'</small></div>'+
        '<div class="v3-history-values"><span>Bill '+money(x.billedCents/100)+'</span><span>Written received '+money(x.receivedCents/100)+'</span></div>'+
        '<button type="button" data-v3-old-pos-id="'+esc(x.id)+'">View date in POS</button></article>').join('')+'</div>'+
       (summary.count>visible?'<button type="button" class="v3-history-more" data-v3-old-more>Show more ('+(summary.count-visible)+' remaining)</button>':'')+
       (summary.count>100?'<p class="v3-history-note">Showing '+Math.min(visible,summary.count)+' of '+summary.count+' verified old register entries.</p>':''):'');
   }
   target.onclick=event=>{
    if(!active())return;
    if(event.target.closest?.('[data-v3-old-more]')){visible+=100;draw();return}
    const btn=event.target.closest?.('[data-v3-old-pos-id]');
    if(!btn)return;
    const found=summary.rows.find(x=>x.id===btn.dataset.v3OldPosId);
    if(found&&active()&&typeof onOpen==='function')void onOpen(found.record_date,found.id,scope);
   };
   draw();
   return {ok:true,...summary};
  }catch(error){
   if(!active())return {ok:false,reason:'stale'};
   target.innerHTML='<div class="v3-history-head"><h2>Old POS register</h2></div>'+
    '<p class="v3-history-error" role="alert">Old register cannot be verified: '+esc(error?.message||'Network error')+
    '. No historical totals have been added to Daily Book. Refresh to try again.</p>';
   return {ok:false,reason:error?.message||'error'};
  }
 }
 const api={cents,validPeriod,summarize,load,postedPosSummary,mount};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteV3HistoricalReconcile=api;
})(typeof window!=='undefined'?window:globalThis);
