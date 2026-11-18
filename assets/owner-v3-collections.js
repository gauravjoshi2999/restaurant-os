/* Bite Owner V3 · A03 Collections.
 * Read-only view of the existing property-scoped Daily Book RPC.
 * Never creates another payment, bill, deposit or settlement. */
(function(root){
 'use strict';
 const enc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const money=value=>'₹'+Number(value).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const methods={all:'All',cash:'Cash',bank:'UPI / Bank',gateway:'Gateway'};
 const sources={all:'All sources',order_payment:'POS / order',folio:'Hotel / guest',customer_ledger_payment:'Customer Khata',daybook:'Other book',expense:'Expenses / payouts'};
 const knownMethod=method=>['Cash','UPI','Card','Bank Transfer'].includes(method); // Gateway promise is not a confirmed bank settlement.
 const group=method=>method==='Cash'?'cash':['UPI','Card','Bank Transfer'].includes(method)?'bank':['Gateway','Cashfree'].includes(method)?'gateway':'other';
 function type(entry){
  if(!entry||!['in','out'].includes(entry.direction))return 'noncash';
  const source=String(entry.source_type||''),category=String(entry.category||'');
  if(entry.direction==='out')return knownMethod(entry.method)?'paid':'unverified';
  if(!knownMethod(entry.method))return 'unverified';
  if(source==='order_payment'||source==='customer_ledger_payment')return 'received';
  if(source==='folio'&&['payment','advance'].includes(category))return 'received';
  if(source==='daybook'&&category==='income')return 'received';
  return 'other'; // opening, transfers, refundable deposits: never labelled revenue
 }
 function describe(entry){
  const s=String(entry.source_type||'');
  return {order_payment:'POS payment',folio:'Guest folio',customer_ledger_payment:'Khata collection',
   daybook:'Daily Book',property_expense:'Property expense',expense:'Restaurant expense',
   purchase:'Supplier purchase',order_refund:'Order refund',employee_payment:'Staff payment'}[s]||'Money movement';
 }
 function sourceGroup(entry){
  return ['order_payment','folio','customer_ledger_payment','daybook'].includes(entry.source_type)?
   entry.source_type:(entry.direction==='out'?'expense':'other');
 }
 function summarize(journal,method='all',day='',source='all'){
  const all=Array.isArray(journal)?journal:[];
  const included=all.filter(x=>(!day||x.day===day)&&
   (method==='all'||group(x.method)===method)&&
   (source==='all'||sourceGroup(x)===source));
  const valid=included.filter(x=>['in','out'].includes(x.direction) && type(x)!=='noncash');
  const received=valid.filter(x=>type(x)==='received');
  const paid=valid.filter(x=>type(x)==='paid');
  const other=valid.filter(x=>type(x)==='other'||type(x)==='unverified');
  function total(rows){return rows.reduce((n,x)=>n+Number(x.amount),0)}
  if(valid.some(x=>x.amount==null||!Number.isFinite(Number(x.amount))))
   return {error:'Some recorded entries have incomplete amounts. Refresh Daily Book.'};
  return {entries:valid,received:total(received),paid:total(paid),other:total(other),
   receiptCount:received.length,paymentCount:paid.length,excludedCount:other.length};
 }
 function render(target,report,options={}){
  if(!target||!report||!Array.isArray(report.journal))return false;
  const from=String(report.from||''),to=String(report.to||''),scope=String(options.scope||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!scope)return false;
  const selected={method:'all',source:'all',day:options.day>=from&&options.day<=to?options.day:''};
  let active=true;
  const visible=()=>active&&options.scope===scope;
  function draw(){
   if(!visible())return;
   const sum=summarize(report.journal,selected.method,selected.day,selected.source);
   const tabButtons=Object.entries(methods).map(([k,label])=>
    '<button type="button" data-v3-money-method="'+enc(k)+'" class="v3-money-tab'+(selected.method===k?' active':'')+
    '" aria-pressed="'+(selected.method===k?'true':'false')+'">'+enc(label)+'</button>').join('');
   let entries='';
   if(sum.error)entries='<p role="alert">'+enc(sum.error)+'</p>';
   else entries=sum.entries.length?sum.entries.slice().sort((a,b)=>String(b.day).localeCompare(String(a.day))||
     String(b.id||'').localeCompare(String(a.id||''))).map(x=>{
     const t=type(x),direction=x.direction==='out'?'−':'+',note=t==='received'?'Confirmed receipt':
      t==='paid'?'Recorded payout':t==='unverified'?'Unverified method · not in totals':'Other movement · not in Received';
     const sourceButton=['order_payment','folio','customer_ledger_payment','expense','property_expense'].includes(x.source_type)&&
       /^[a-f0-9-]{36}$/i.test(String(x.id||''))?
      '<button type="button" class="v3-money-source" data-v3-money-source="'+enc(x.source_type)+
       '" data-v3-money-id="'+enc(x.id)+'">Open original source</button>':'';
     return '<details class="v3-money-row" data-source-type="'+enc(x.source_type)+'"><summary>'+
      '<span><b>'+enc(describe(x))+'</b><small>'+enc(x.day)+' · '+enc(x.method||'Not set')+' · '+enc(x.description||'')+
      '</small><small>'+enc(note)+'</small></span><strong class="'+(x.direction==='out'?'is-paid':'is-received')+
      '">'+direction+money(x.amount)+'</strong></summary><div class="v3-money-detail"><span>Source: '+enc(x.source_type)+
      '</span><span>Record: '+enc(String(x.id||'').slice(0,12))+'</span>'+
      (x.account_note?'<span>Account: '+enc(x.account_note)+'</span>':'')+sourceButton+'</div></details>';
    }).join(''):'<p class="v3-money-empty">No recorded movements for these filters. Change date, method or source.</p>';
   target.innerHTML='<div class="v3-money-heading"><div><h2>Collections</h2><p>Money movement date · source-linked records</p></div>'+
    '<small>'+enc(from)+' → '+enc(to)+'</small></div><div class="v3-money-filter-row">'+
    '<label>Day filter<input type="date" data-v3-money-day value="'+enc(selected.day)+'" min="'+enc(from)+'" max="'+enc(to)+'"></label>'+
    '<button type="button" data-v3-money-all-days>All days</button>'+
    '<label>Source<select data-v3-money-source-filter>'+Object.entries(sources).map(([k,label])=>
    '<option value="'+enc(k)+'"'+(k===selected.source?' selected':'')+'>'+enc(label)+'</option>').join('')+
    '</select></label></div><div class="v3-money-tabs" role="group" aria-label="Collection payment method">'+tabButtons+'</div>'+
    (sum.error?entries:
    '<div class="v3-money-totals"><div><span>Received</span><strong>'+money(sum.received)+
    '</strong><small>'+sum.receiptCount+' confirmed receipts</small></div><div><span>Paid out</span><strong>'+money(sum.paid)+
    '</strong><small>'+sum.paymentCount+' posted outgoing movements</small></div></div>'+
    '<p class="v3-money-note">'+(sum.excludedCount?sum.excludedCount+' other or unverified entries are shown below but excluded from Received. ':'')+
    'Opening balances, transfers and refundable deposits are not sales. Gateway receivables are separate from settled money.</p>'+entries);
  }
  target.addEventListener('click',event=>{
   if(!visible())return;
   const method=event.target.closest?.('[data-v3-money-method]');
   if(method&&Object.hasOwn(methods,method.dataset.v3MoneyMethod)){
    selected.method=method.dataset.v3MoneyMethod;draw();return;
   }
   if(event.target.closest?.('[data-v3-money-all-days]')){selected.day='';draw();return;}
   const source=event.target.closest?.('[data-v3-money-source]');
   if(source){
    const record=report.journal.find(x=>x.source_type===source.dataset.v3MoneySource&&
      String(x.id)===source.dataset.v3MoneyId);
    if(record&&visible()&&typeof options.onOpen==='function')options.onOpen(record);
   }
  });
  target.addEventListener('change',event=>{
   if(!visible())return;
   const e=event.target;
   if(e.matches?.('[data-v3-money-day]')){
    const day=String(e.value||'');if(day&&!(day>=from&&day<=to)){draw();return}
    selected.day=day;draw();
   }else if(e.matches?.('[data-v3-money-source-filter]')&&Object.hasOwn(sources,e.value)){
    selected.source=e.value;draw();
   }
  });
  draw();
  return {dispose(){active=false},draw};
 }
 const api={type,group,summarize,render};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteV3Collections=api;
})(typeof window!=='undefined'?window:globalThis);
