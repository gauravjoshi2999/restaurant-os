/* Bite Owner V3 A05 — Customer Khata is one linked view of the existing ledger.
 * Opening receivables never become new sales; payments aren't duplicated as POS sales.
 * Rendering never inserts, updates or deletes financial records. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const cash=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const cents=n=>{const x=Number(n);return Number.isFinite(x)&&x>=0&&Math.abs(x*100-Math.round(x*100))<1e-6?Math.round(x*100):null};
 const signed=n=>n>0?cash(n/100)+' due':n<0?cash(-n/100)+' advance':'Clear';
 const sourceLabel=row=>({
  manual:row.entry_type==='credit'?'Receipt · Khata':'Manual due / opening',
  pos_order:'Linked POS bill',pos_payment:'Linked POS payment',pos_refund:'Linked POS refund'
 })[row.source_type]||'Linked record';
 const effect=row=>{
  const n=cents(row?.amount);
  return n===null||!['debit','credit'].includes(row.entry_type)?null:row.entry_type==='debit'?n:-n;
 };
 function statement({entries=[],customerId,balance=0,from,to,complete=true}){
  const amount=Number(balance);
  const valid=Number.isFinite(amount)&&Number.isFinite(amount*100)&&Math.abs(amount*100-Math.round(amount*100))<1e-6;
  if(!valid||!complete)return {verified:false,reason:!complete?'Statement history is incomplete. Balance after each entry is hidden.':'Current balance is unverified.'};
  if(!root.BiteV3Period?.validDay(from)||!root.BiteV3Period?.validDay(to)||to<from)
   return {verified:false,reason:'Invalid report dates.'};
  const own=entries.filter(x=>x.customer_id===customerId),all=[];
  for(const x of own){
   const n=effect(x);
   if(n===null||!root.BiteV3Period?.validDay(x.entry_date))return {verified:false,reason:'One or more historical ledger rows are invalid.'};
   all.push({...x,effectCents:n});
  }
  const closing=Math.round(amount*100)-all.filter(x=>x.entry_date>to).reduce((a,x)=>a+x.effectCents,0);
  const within=all.filter(x=>x.entry_date>=from&&x.entry_date<=to);
  const opening=closing-within.reduce((a,x)=>a+x.effectCents,0);
  const ordered=within.sort((a,b)=>
   a.entry_date.localeCompare(b.entry_date)||
   String(a.created_at||'').localeCompare(String(b.created_at||''))||
   String(a.entry_id||'').localeCompare(String(b.entry_id||'')));
  let running=opening;
  const rows=ordered.map(x=>({...x,balanceAfterCents:(running+=x.effectCents)})).reverse();
  return {verified:true,openingCents:opening,closingCents:closing,rows,
   receiptCents:within.filter(x=>x.entry_type==='credit').reduce((a,x)=>a+cents(x.amount),0),
   chargeCents:within.filter(x=>x.entry_type==='debit').reduce((a,x)=>a+cents(x.amount),0)};
 }
 function filterCustomers(customers,balances,query='',status='all'){
  const q=String(query||'').trim().toLocaleLowerCase('en-IN');
  return (customers||[]).filter(c=>{
   const b=(balances||[]).find(x=>x.customer_id===c.id),balance=Number(b?.balance||0);
   const match=!q||[c.full_name,c.phone,c.address].some(x=>String(x||'').toLocaleLowerCase('en-IN').includes(q));
   const state=status==='due'?balance>0:status==='advance'?balance<0:status==='clear'?balance===0:true;
   return match&&state;
  });
 }
 function customerCards(host,{customers=[],balances=[],selectedId='',onSelect,onCollect}){
  if(!host)return;
  host.innerHTML=customers.length?customers.map(c=>{
   const b=balances.find(x=>x.customer_id===c.id),bal=Number(b?.balance||0);
   return '<article class="v3-khata-person'+(c.id===selectedId?' selected':'')+'">'+
    '<div class="v3-khata-person-top"><div><strong>'+esc(c.full_name)+'</strong><small>'+esc(c.phone||'No phone')+'</small></div>'+
    '<span class="'+(bal>0?'due':bal<0?'advance':'clear')+'">'+esc(signed(Math.round(bal*100)))+'</span></div>'+
    '<div class="v3-khata-person-actions"><button type="button" data-v3-khata-select="'+esc(c.id)+'">View statement</button>'+
    (bal>0&&c.status==='Active'?'<button type="button" data-v3-khata-collect="'+esc(c.id)+'">Collect due</button>':'')+'</div></article>';
  }).join(''):'<p class="v3-khata-empty">No matching customers. Try another name, mobile or filter.</p>';
  host.onclick=e=>{
   const open=e.target.closest?.('[data-v3-khata-select]');
   const collect=e.target.closest?.('[data-v3-khata-collect]');
   if(open)onSelect?.(open.dataset.v3KhataSelect);
   if(collect)onCollect?.(collect.dataset.v3KhataCollect);
  };
 }
 let scope='',selectedPeriod=null;
 function periodFor(key,today){
  if(scope!==key){scope=key;selectedPeriod=null;}
  const picker=root.BiteV3Period;
  if(!picker)return null;
  try{
   return selectedPeriod=picker.normalize(selectedPeriod?.mode==='day'?{mode:'day',day:selectedPeriod.from}:
    selectedPeriod?.mode==='range'?{mode:'range',from:selectedPeriod.from,to:selectedPeriod.to}:
     {mode:'month',month:selectedPeriod?.month||today.slice(0,7)},today);
  }catch{return selectedPeriod=picker.normalize({mode:'month',month:today.slice(0,7)},today)}
 }
 function mountPeriod(host,{key,today,onChange}){
  if(!host||!root.BiteV3Period)return null;
  const current=periodFor(key,today);
  const clone=host.cloneNode(false);host.replaceWith(clone);
  return root.BiteV3Period.mount(clone,{value:current,today:()=>today,
   basis:'Khata: transaction date · period filter only; new entry keeps its own date',
   isCurrent:()=>scope===key,
   onApply:next=>{if(scope!==key)throw Error('Restaurant changed. Reload Customer Khata.');selectedPeriod=next;onChange?.();}
  });
 }
 function renderStatement({host,customer,entries=[],balance=0,complete=true,key,today,onChange,onCollect,onOpening}){
  if(!host)return {verified:false};
  const p=periodFor(key,today),report=customer&&p?statement({entries,customerId:customer.id,balance,from:p.from,to:p.to,complete}):{verified:false,reason:'Select a customer.'};
  host.innerHTML=customer?
   '<div class="v3-khata-statement-head"><div><small>CUSTOMER STATEMENT</small><h2>'+esc(customer.full_name)+'</h2>'+
   '<p>'+esc(customer.phone||'Mobile not saved')+'</p></div>'+
   '<div class="v3-khata-current"><span>Current balance</span><strong>'+esc(signed(Math.round(Number(balance)*100)))+'</strong></div></div>'+
   '<div id="v3KhataStatementPeriod"></div>'+
   (report.verified?
    '<div class="v3-khata-statement-totals"><div><span>Opening before period</span><strong>'+esc(signed(report.openingCents))+'</strong></div>'+
    '<div><span>New dues / bills</span><strong>'+cash(report.chargeCents/100)+'</strong></div>'+
    '<div><span>Receipts</span><strong>'+cash(report.receiptCents/100)+'</strong></div>'+
    '<div><span>Balance at period end</span><strong>'+esc(signed(report.closingCents))+'</strong></div></div>':
    '<p role="alert" class="v3-khata-warning">'+esc(report.reason||'Statement not available.')+'</p>')+
   '<div class="v3-khata-statement-actions">'+
   (Number(balance)>0&&customer.status==='Active'?'<button type="button" class="primary" data-v3-khata-collect-due>Collect due</button>':'')+
   (customer.status==='Active'?'<button type="button" data-v3-khata-opening>Add opening balance</button>':'')+
   '<button type="button" data-v3-khata-copy>Copy statement</button>'+
   '<button type="button" data-v3-khata-print>Print statement</button></div>'+
   '<p class="v3-khata-guidance">Opening due is an old receivable, not new sales. If the same old bill is also entered into POS, review its source before adding opening dues.</p>'+
   '<p id="v3KhataShareStatus" role="status"></p>':
   '<p class="v3-khata-empty">Choose a customer to view a statement.</p>';
  if(customer){
   mountPeriod(host.querySelector('#v3KhataStatementPeriod'),{key,today,onChange});
   host.onclick=async e=>{
    const collect=e.target.closest?.('[data-v3-khata-collect-due]');
    const opening=e.target.closest?.('[data-v3-khata-opening]');
    const copy=e.target.closest?.('[data-v3-khata-copy]');
    const print=e.target.closest?.('[data-v3-khata-print]');
    if(collect){onCollect?.(customer.id);return}
    if(opening){onOpening?.(customer.id);return}
    if(print){
     if(!report.verified){host.querySelector('#v3KhataShareStatus').textContent='The history is incomplete. Refresh Khata before printing a statement.';return;}
     root.print?.();return;
    }
    if(copy){
     const result=host.querySelector('#v3KhataShareStatus');
     if(!report.verified){result.textContent='Full verified statement not available. Please refresh Khata.';return}
     const contents=['Bite · Customer Khata',customer.full_name,p.from+' to '+p.to,
      'Opening: '+signed(report.openingCents),...report.rows.slice().reverse().map(x=>x.entry_date+' · '+sourceLabel(x)+' · '+
       (x.entry_type==='credit'?'Received ':'Due ')+cash(x.amount)+' · balance '+signed(x.balanceAfterCents)),
       'Closing: '+signed(report.closingCents),
       'Includes linked POS bills, POS receipts, refunds and manual Khata entries. Not a tax invoice.'].join('\n');
     try{if(typeof root.navigator?.clipboard?.writeText!=='function')throw Error('Clipboard unavailable');await root.navigator.clipboard.writeText(contents);result.textContent='Statement copied.'}
     catch{result.textContent='Could not copy statement. Use Print statement.'}
    }
   };
  }
  return report;
 }
 function reset(){scope='';selectedPeriod=null}
 const api={cents,effect,statement,filterCustomers,sourceLabel,customerCards,periodFor,mountPeriod,renderStatement,reset};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteV3Khata=api;
})(typeof window!=='undefined'?window:globalThis);
