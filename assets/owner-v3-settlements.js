/* Bite Owner V3 / A06 — read-only online money, refunds and settlement evidence.
 * Never creates or confirms a payment, split, refund or bank transfer.
 * Tenant data comes only from authenticated Supabase RLS queries. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const digits=s=>String(s||'').replace(/[^0-9a-f]/gi,'');
 const idOK=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s||''));
 const cents=v=>{
  if(typeof v!=='number'&&!(typeof v==='string'&&v.trim()))return null;
  const n=Number(v),rounded=Math.round(n*100);
  return Number.isFinite(n)&&n>=0&&Number.isSafeInteger(rounded)&&Math.abs(n*100-rounded)<0.001?rounded:null;
 };
 const money=c=>c==null?'—':'₹'+(c/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const stamp=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):'Date unknown';
 const checkedTime=s=>typeof s==='string'&&s.trim()&&Number.isFinite(Date.parse(s))?Date.parse(s):null;
 const verifiedStatus=s=>['PAID','SUCCESS','CAPTURED','COMPLETED'].includes(String(s||'').toUpperCase());
 const formatStatus=s=>String(s||'not reported').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
 const shortRef=s=>String(s||'').length>6?'••••'+String(s).slice(-6):String(s||'—');
 function assertScope(list,rid,label){
  if(!Array.isArray(list))throw Error('Incomplete '+label+' records.');
  const seen=new Set();
  for(const r of list){
   if(!r||!idOK(r.id)||r.restaurant_id!==rid||seen.has(r.id))throw Error('Inconsistent or unrelated '+label+' record.');
   seen.add(r.id);
  }
  return list;
 }
 async function readTable(sb,table,columns,rid,sort,current){
  const rows=[],pageSize=250,limit=10000;
  for(let start=0;start<limit;start+=pageSize){
   if(!current())throw Error('Account changed during financial record read.');
   const result=await sb.from(table).select(columns).eq('restaurant_id',rid)
    .order(sort,{ascending:false}).order('id',{ascending:false}).range(start,start+pageSize-1);
   if(!current())throw Error('Account changed during financial record read.');
   if(result.error)throw result.error;
   if(!Array.isArray(result.data))throw Error('Incomplete '+table+' response.');
   rows.push(...result.data);
   if(result.data.length<pageSize)return assertScope(rows,rid,table);
  }
  throw Error('Too many '+table+' records. Totals are withheld until a complete export is available.');
 }
 async function load(sb,rid,current){
  if(!sb?.from||!idOK(rid)||typeof current!=='function'||!current())throw Error('Owner payment access not available.');
  const queries=[
   ['order_financials','id,order_id,restaurant_id,channel,payment_status,settlement_status,is_demo,created_at,customer_payable_amount,food_subtotal,commission_amount,provider_fee_actual,refund_amount_actual','created_at'],
   ['restaurant_settlements','id,restaurant_id,period_start,period_end,status,gross_order_value,commission_total,provider_fees_actual,refunds_actual,net_payable,amount_paid,provider_reference,created_at,paid_at','created_at'],
   ['bite_refund_jobs','id,order_id,restaurant_id,amount,status,provider_status,provider_refund_id,provider_checked_at,created_at,updated_at','created_at'],
   ['bite_provider_checks','id,order_id,restaurant_id,collection_status,collection_amount,provider_order_id,checked_at','checked_at']
  ];
  const [financials,settlements,refunds,checks]=await Promise.all(queries.map(([table,columns,sort])=>
   readTable(sb,table,columns,rid,sort,current)));
  if(!current())throw Error('Account changed during financial record read.');
  return {financials,settlements,refunds,checks};
 }
 function reconcile(data,rid,orders=[]){
  const financials=assertScope(data?.financials,rid,'financials').filter(f=>f.channel==='Own Platform'&&f.is_demo!==true);
  const settlements=assertScope(data?.settlements,rid,'settlements');
  const refunds=assertScope(data?.refunds,rid,'refunds');
  const checks=assertScope(data?.checks,rid,'provider checks');
  const orderLookup=new Map((orders||[]).filter(o=>o.restaurant===rid&&!o.isDemo).map(o=>[o.id,o]));
  const checksByOrder=new Map();
  for(const check of checks){
   if(!idOK(check.order_id))continue;
   const time=checkedTime(check.checked_at),previous=checksByOrder.get(check.order_id);
   if(time===null){checksByOrder.set(check.order_id,{invalid:true});continue;}
   if(previous?.invalid)continue;
   if(!previous||time>checkedTime(previous.checked_at))checksByOrder.set(check.order_id,check);
   else if(time===checkedTime(previous.checked_at)&&(check.collection_status!==previous.collection_status||cents(check.collection_amount)!==cents(previous.collection_amount)))checksByOrder.set(check.order_id,{invalid:true});
  }
  const paymentIds=new Set();
  let recordedPaid=0,providerChecked=0,reviewNeeded=0;
  const payments=financials.map(f=>{
   if(!idOK(f.order_id)||paymentIds.has(f.order_id))throw Error('Duplicate or invalid online payment source.');
   paymentIds.add(f.order_id);
   const amount=cents(f.customer_payable_amount),paid=f.payment_status==='paid',check=checksByOrder.get(f.order_id);
   if(amount===null)throw Error('Invalid customer payable amount in source financials.');
   const checked=paid&&checkedTime(check?.checked_at)!==null&&verifiedStatus(check.collection_status)&&
     cents(check.collection_amount)===amount;
   if(paid){recordedPaid+=amount;if(checked)providerChecked+=amount;else reviewNeeded++;}
   const order=orderLookup.get(f.order_id);
   return {...f,amountCents:amount,paid,providerChecked:checked,check,
    displayCode:order?.code||'Order '+String(f.order_id).slice(0,8).toUpperCase()};
  }).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  if(!Number.isSafeInteger(recordedPaid)||!Number.isSafeInteger(providerChecked))throw Error('Unsafe online payment total.');
  const settlementRows=settlements.slice().sort((a,b)=>String(b.period_start||'').localeCompare(String(a.period_start||'')));
  const refundRows=refunds.slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
   .map(x=>({...x,displayCode:orderLookup.get(x.order_id)?.code||payments.find(p=>p.order_id===x.order_id)?.displayCode||'Order '+String(x.order_id||'').slice(0,8).toUpperCase()}));
  return {payments,settlements:settlementRows,refunds:refundRows,recordedPaid,providerChecked,
   reviewNeeded,pendingRefunds:refundRows.filter(x=>!providerRefundConfirmed(x)&&String(x.status||'').toLowerCase()!=='cancelled').length};
 }
 function providerRefundConfirmed(row){return !!String(row.provider_refund_id||'').trim()&&checkedTime(row.provider_checked_at)!==null&&['SUCCESS','COMPLETED','REFUNDED'].includes(String(row.provider_status||'').toUpperCase());}
 function refundLabel(row){
  const provider=String(row.provider_status||'').toUpperCase();
  if(providerRefundConfirmed(row))
   return 'Provider reports refund processed · bank credit unverified';
  if(['FAILED','ERROR'].includes(provider))return 'Provider reported failure · follow up';
  if(row.status==='approved')return 'Approved in Bite · provider refund unverified';
  if(row.status==='pending_approval')return 'Awaiting approval in Bite';
  return formatStatus(row.status)+' · provider outcome unverified';
 }
 function timeline(payment,relatedRefunds,settlements){
  const fee=cents(payment.provider_fee_actual),commission=cents(payment.commission_amount);
  const rows=[
   ['Bite payment record',payment.paid?'Paid recorded in Bite':'Status: '+formatStatus(payment.payment_status),stamp(payment.created_at)],
   ['Cashfree collection check',payment.providerChecked?'Provider check: '+formatStatus(payment.check.collection_status):
     payment.paid?'Not independently verified':'No confirmed payment',stamp(payment.check?.checked_at)],
   ['Commission and provider fee','Commission '+money(commission)+' · actual fee '+money(fee),'Amounts from order financial record']
  ];
  if(relatedRefunds.length)for(const r of relatedRefunds)rows.push(['Refund '+money(cents(r.amount)),refundLabel(r),stamp(r.updated_at||r.created_at)]);
  rows.push(['Owner bank settlement',settlements.length?
    'Settlement record exists for this restaurant · matching transfer to this order is NOT verified':
    'No bank payout record verified for this order','Bank statement confirmation required']);
  return '<ol class="a06-timeline">'+rows.map(x=>'<li><strong>'+esc(x[0])+'</strong><span>'+esc(x[1])+'</span><small>'+esc(x[2])+'</small></li>').join('')+'</ol>';
 }
 function paymentsHTML(summary){
  if(!summary.payments.length)return '<p class="a06-empty">No own-platform order financial records for this outlet.</p>';
  return '<div class="a06-list">'+summary.payments.map(f=>{
   const matched=summary.refunds.filter(x=>x.order_id===f.order_id);
   return '<details class="a06-record"><summary><span class="a06-main"><strong>'+esc(f.displayCode)+'</strong><small>'+esc(stamp(f.created_at))+' · '+esc(f.providerChecked?'Cashfree check recorded':f.paid?'Bite paid · verification pending':formatStatus(f.payment_status))+'</small></span><span class="a06-amount">'+esc(money(f.amountCents))+'</span></summary>'+
    '<div class="a06-detail"><p>Customer paid in Bite: <strong>'+esc(f.paid?'Recorded':'Not confirmed')+'</strong></p>'+
    '<p>Provider evidence: <strong>'+esc(f.providerChecked?'Matching recorded Cashfree check':'Not independently verified')+'</strong></p>'+
    '<p>Commission: '+esc(money(cents(f.commission_amount)))+' · Actual provider fee: '+esc(money(cents(f.provider_fee_actual)))+'</p>'+
    '<p>Owner bank arrival: <strong>Not independently verified</strong></p>'+
    timeline(f,matched,summary.settlements)+
    '<button type="button" class="a06-copy" data-a06-copy="'+esc(f.displayCode)+'">Copy order reference</button></div></details>';
  }).join('')+'</div>';
 }
 function settlementsHTML(summary){
  if(!summary.settlements.length)return '<p class="a06-empty">No settlement batches are recorded in Bite for this outlet. Cashfree payouts, vendor splits and the owner bank statement must be checked separately. This does not mean a bank transfer definitely failed.</p>';
  return '<div class="a06-list">'+summary.settlements.map(s=>
   '<article class="a06-record a06-bank"><div><strong>'+esc(s.period_start||'Period unknown')+' → '+esc(s.period_end||'—')+'</strong>'+
   '<small>Bite status: '+esc(formatStatus(s.status))+' · Bank credit not independently verified</small></div>'+
   '<div class="a06-bank-values"><span>Net payable: <strong>'+esc(money(cents(s.net_payable)))+'</strong></span>'+
   '<span>Paid recorded: <strong>'+esc(money(cents(s.amount_paid)))+'</strong></span>'+
   '<span>Reference: '+esc(shortRef(s.provider_reference))+'</span>'+
   '<small>Recorded date '+esc(stamp(s.paid_at))+'</small></div></article>').join('')+'</div>';
 }
 function refundsHTML(summary){
  if(!summary.refunds.length)return '<p class="a06-empty">No online refund jobs recorded for this outlet. This is not proof of any bank transfer or refund.</p>';
  return '<div class="a06-list">'+summary.refunds.map(r=>
   '<article class="a06-record a06-refund"><div><strong>'+esc(r.displayCode)+' · '+esc(money(cents(r.amount)))+'</strong>'+
   '<small>'+esc(stamp(r.created_at))+'</small><p>'+esc(refundLabel(r))+'</p>'+
   '<p>Provider refund reference: '+esc(shortRef(r.provider_refund_id))+
   ' · Last provider check: '+esc(stamp(r.provider_checked_at))+'</p></div>'+
   '<button type="button" class="a06-copy" data-a06-copy="'+esc(r.displayCode)+'">Copy order reference</button></article>').join('')+'</div>';
 }
 function render(host,summary,tab,notice=''){
  if(!host)return;
  const content={payments:paymentsHTML(summary),settlements:settlementsHTML(summary),refunds:refundsHTML(summary)};
  host.innerHTML='<div class="a06-hero"><div><p class="a06-eyebrow">ACCOUNTING / A06</p><h1>Settlements & Refunds</h1>'+
   '<p>Customer payment, commission, refund and owner bank settlement — all separate.</p></div>'+
   '<button type="button" class="a06-refresh" data-a06-refresh>↻ Refresh verified records</button></div>'+
   '<div class="a06-stats"><div><span>Bite recorded paid</span><strong>'+esc(money(summary.recordedPaid))+'</strong>'+
   '<small>Not a bank transfer</small></div><div><span>Provider check matched</span><strong>'+esc(money(summary.providerChecked))+'</strong><small>Recorded verification evidence</small></div>'+
   '<div><span>Paid records to review</span><strong>'+summary.reviewNeeded+'</strong><small>Provider check still needed</small></div>'+
   '<div><span>Refunds needing review</span><strong>'+summary.pendingRefunds+'</strong><small>Not money returned</small></div></div>'+
   '<p class="a06-disclaimer">Customer paid ≠ Cashfree settlement ≠ owner bank credited. Commission and actual gateway fees are different. No POS cash, hotel folio or Customer Khata amount is added here. No payment, transfer or refund can be initiated from this page.</p>'+
   '<div class="a06-tabs" role="tablist" aria-label="Online settlement sections">'+
   [['payments','Payments'],['settlements','Settlements'],['refunds','Refunds']].map(([id,label])=>
   '<button type="button" role="tab" data-a06-tab="'+id+'" aria-selected="'+String(tab===id)+'">'+label+'</button>').join('')+'</div>'+
   '<section id="a06Content" role="tabpanel" tabindex="0">'+content[tab]+'</section>'+
   '<p class="a06-footnote">Payment and refund status comes from existing Bite and provider-check records. A reference, screenshot or approval alone never proves bank credit. For unresolved money, quote the order code when contacting Bite support.</p>'+
   (notice?'<p class="a06-notice" role="status">'+esc(notice)+'</p>':'');
 }
 let host=null,token=0,ctx=null,summary=null,selected='payments',busy=false;
 function validSession(c){
  const current=c?.getSession?.()||{};
  return !!c?.restaurantId&&idOK(c.restaurantId)&&!!c.userId&&current.userId===c.userId&&
   current.restaurantId===c.restaurantId&&current.role==='owner';
 }
 function active(c,n){return token===n&&host===c.el&&validSession(c);}
 async function refresh(){
  if(!ctx||!host)return;
  const c=ctx,n=++token;summary=null;busy=true;
  if(!validSession(c)){host.innerHTML='<p role="alert">Owner settlement access is unavailable.</p>';busy=false;return;}
  host.innerHTML='<p class="a06-loading" role="status">Loading this outlet’s recorded payments, settlements and refunds…</p>';
  try{
   const data=await load(c.client,c.restaurantId,()=>active(c,n));
   if(!active(c,n))return;
   summary=reconcile(data,c.restaurantId,c.getOrders?.()||[]);
   render(host,summary,selected);
  }catch(e){
   if(!active(c,n))return;
   summary=null;
   host.innerHTML='<div class="a06-error" role="alert"><h2>Settlement records unavailable</h2><p>'+
     esc(e?.message||'Network error')+'</p><p>No amount or payout status was guessed.</p>'+
     '<button type="button" data-a06-refresh>Retry</button></div>';
  }finally{if(token===n)busy=false;}
 }
 function click(e){
  if(!ctx||!validSession(ctx))return;
  const tab=e.target.closest?.('[data-a06-tab]');
  if(tab&&summary&&['payments','settlements','refunds'].includes(tab.dataset.a06Tab)){
   selected=tab.dataset.a06Tab;render(host,summary,selected);return;
  }
  if(e.target.closest?.('[data-a06-refresh]')){void refresh();return;}
  const copy=e.target.closest?.('[data-a06-copy]');
  if(copy){
   const text=copy.dataset.a06Copy;
   if(text&&root.navigator?.clipboard?.writeText){
    root.navigator.clipboard.writeText(text).then(()=>{copy.textContent='Copied';}).catch(()=>{copy.textContent='Copy unavailable';});
   }else copy.textContent='Select the order reference above';
  }
 }
 function open(input){
  if(!input?.el)return;
  if(host&&host!==input.el)host.removeEventListener('click',click);
  if(host!==input.el)input.el.addEventListener('click',click);
  host=input.el;ctx=input;selected='payments';return refresh();
 }
 function clear(){
  token++;if(host){host.removeEventListener('click',click);host.replaceChildren();}
  host=null;ctx=null;summary=null;selected='payments';busy=false;
 }
 const api={open,refresh,clear,cents,load,reconcile,refundLabel,render,timeline,validSession};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteOwnerA06=api;
})(typeof window!=='undefined'?window:globalThis);
