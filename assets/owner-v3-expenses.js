/* Bite Owner V3 / A04. Existing expense tables and commands remain the only writes.
 * A view-period is NEVER an expense/payment date. No duplicate cashbook insert. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const cents=n=>{
  if(!(typeof n==='number'||typeof n==='string'&&/^\d+(?:\.\d{1,2})?$/.test(n.trim())))return null;
  const amount=Number(n),c=Math.round(amount*100);
  return Number.isFinite(amount)&&amount>=0&&Number.isSafeInteger(c)&&Math.abs(amount*100-c)<0.00001?c:null;
 };
 let activeKey='',selected=null;
 const P=()=>root.BiteV3Period;
 function period(key,today){
  const api=P();if(!api||!api.validDay(today))return null;
  if(key!==activeKey){activeKey=key;selected=null;}
  if(!selected)selected=api.normalize({mode:'month',month:today.slice(0,7)},today);
  try{selected=api.normalize(selected.mode==='day'?{mode:'day',day:selected.day||selected.from}:
    selected.mode==='month'?{mode:'month',month:selected.month||selected.from.slice(0,7)}:
     {mode:'range',from:selected.from,to:selected.to},today)}
  catch{selected=api.normalize({mode:'day',day:today},today)}
  return selected;
 }
 function filter(records,key,today){
  const selectedPeriod=period(key,today);
  if(!selectedPeriod)return Array.isArray(records)?records:[];
  return (Array.isArray(records)?records:[]).filter(x=>{
   const date=String(x.expense_date||x.entry_date||'');
   return date>=selectedPeriod.from&&date<=selectedPeriod.to;
  });
 }
 function total(rows){
  if(!Array.isArray(rows))return null;
  let sum=0;for(const row of rows){const c=cents(row?.amount);if(c===null)return null;sum+=c;if(!Number.isSafeInteger(sum))return null;}
  return sum/100;
 }
 function verifiedRecords(rows,scope,field){
  if(!Array.isArray(rows)||!scope||!P()||total(rows)===null)return false;
  const ids=new Set();
  for(const row of rows){if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||row[field]!==scope||!P().validDay(row.expense_date))return false;ids.add(row.id);}
  return true;
 }
 function mountPicker(host,{key,today,onChange,basis}){
  if(!host||!P())return;
  // New container eliminates stale event handlers when the canonical page redraws.
  const replacement=host.cloneNode(false);host.replaceWith(replacement);
  P().mount(replacement,{value:period(key,today),today:()=>today,
   basis,isCurrent:()=>activeKey===key,
   onApply:async next=>{
    if(activeKey!==key)throw Error('Business changed. Reopen Expenses.');
    selected=next;onChange?.();
   }});
 }
 function card(row,hotel,canEdit){
  const id=String(row.id||'');
  const title=hotel?row.description:row.title;
  const method=row.method||row.payment_method||'Other';
  const category=hotel?'Property expense':row.category||'Expense';
  return '<article class="bv3-expense-card"><div class="bv3-expense-card-head"><div>'+
   '<span class="bv3-expense-category">'+esc(category)+'</span><strong>'+esc(title||'Expense')+'</strong>'+
   '<small>'+esc(row.expense_date||'')+' · '+esc(method)+'</small></div><b>'+fmt(row.amount)+'</b></div>'+
   (hotel?'':(row.description?'<p>'+esc(row.description)+'</p>':''))+
   '<div class="bv3-expense-card-foot"><span>Recorded paid expense · '+esc(String(id).slice(0,8))+'</span>'+
   (!hotel&&canEdit?'<div><button type="button" data-bv3-expense-edit="'+esc(id)+'">Edit</button>'+
    '<button type="button" data-bv3-expense-delete="'+esc(id)+'">Delete</button></div>':'')+'</div></article>';
 }
 function renderRestaurant({records,allRecords,key,today,onChange,onEdit,onDelete,onDue,canEdit}){
  const view=period(key,today);
  const page=root.document?.getElementById('expenses');
  if(!page||!view)return false;
  mountPicker(page.querySelector('#expenseV3Period'),{key,today,onChange,basis:'Expense / paid date · Existing restaurant expense records'});
  const label=page.querySelector('#expenseRangeLabel');
  if(label)label.textContent=P().label(view)+' · paid expenses';
  const note=page.querySelector('#expenseV3Status');
  if(note){
   note.innerHTML='<div class="bv3-expense-hint"><strong>Paid now</strong><span>These existing expenses record cash / payment movement on the expense date. View period does not change new entry date.</span></div>'+
    '<div class="bv3-expense-due"><button type="button" data-bv3-open-supplier-due>Pay later · Supplier purchases</button>'+
    '<small>For supplier credit, create an unpaid purchase in Purchases. Do not save the same expense twice. Later-payment date reconciliation is not yet available in this Expenses screen.</small></div>';
   note.onclick=e=>{
    const button=e.target.closest?.('[data-bv3-open-supplier-due]');
    if(button&&activeKey===key&&typeof onDue==='function')void onDue();
   };
  }
  const grid=page.querySelector('#expenseV3Cards');
  if(grid){
   grid.innerHTML=records.length?records.map(r=>card(r,false,canEdit)).join(''):
    '<div class="bv3-expense-empty">No recorded paid expenses for '+esc(P().label(view))+'. Try another period.</div>';
   grid.onclick=e=>{
    if(activeKey!==key)return;
    const edit=e.target.closest?.('[data-bv3-expense-edit]');
    const del=e.target.closest?.('[data-bv3-expense-delete]');
    const btn=edit||del, id=btn?.getAttribute(edit?'data-bv3-expense-edit':'data-bv3-expense-delete');
    if(!btn||!canEdit||!(allRecords||[]).some(x=>x.id===id))return;
    if(edit)onEdit?.(id);else onDelete?.(id);
   };
  }
  return true;
 }
 function renderHotel(target,{records,key,today,onChange,canWrite,propertyLabel}){
  const view=period(key,today);
  if(!target||!view)return false;
  if(!verifiedRecords(records,key.split(':').at(-1),'property_id')){
   target.textContent='Property expense records could not be verified. Refresh Expenses before relying on the total.';return true;
  }
  const displayed=filter(records,key,today);
  target.innerHTML='<section class="bv3-hotel-expense-head"><small>OWNER V3 · A04</small>'+
   '<h1>Expenses</h1><p>'+esc(propertyLabel||'Property')+' · Property expenses are separate from guest payments</p></section>'+
   '<div id="bv3HotelExpensePeriod"></div>'+
   '<div class="bv3-expense-metrics"><article><span>Recorded expenses in period</span><strong>'+fmt(total(displayed))+'</strong></article>'+
   '<article><span>Entries</span><strong>'+displayed.length+'</strong></article></div>'+
   '<div class="bv3-hotel-expense-grid">'+
   (canWrite?'<form class="bh-panel bh-form bv3-expense-form" data-hotel-form="expense"><h2>Record paid expense</h2>'+
    '<p class="bv3-expense-muted">Create a new expense entry; reporting filters do not change this date.</p>'+
    '<div class="bv3-expense-fields"><label>Expense / item<input name="description" type="text" required maxlength="250" placeholder="Vegetables, electricity, repairs…"></label>'+
    '<label>Amount (₹)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00"></label>'+
    '<label>Expense & payment date<input name="expense_date" type="date" value="'+esc(today)+'" max="'+esc(today)+'" required></label>'+
    '<label>Paid by<select name="method"><option>Cash</option><option>UPI</option><option>Card</option><option>Bank Transfer</option><option>Other</option></select></label></div>'+
    '<p class="bv3-expense-muted">Paid now only. Supplier credit / Pay later cannot be posted here without a verified due ledger. Do not enter it as paid.</p>'+
    '<p class="bh-message" role="status" aria-live="polite"></p><button class="btn" type="submit">Record paid expense</button></form>':
    '<div class="bh-panel">Expenses are view-only for this account.</div>')+
   '<section class="bh-panel bv3-hotel-expense-list"><h2>Expense history · '+esc(P().label(view))+'</h2>'+
    (displayed.length?displayed.map(r=>card(r,true,false)).join(''):'<p class="bv3-expense-empty">No recorded expenses for this period.</p>')+
   '</section></div>';
  mountPicker(target.querySelector('#bv3HotelExpensePeriod'),{key,today,onChange,basis:'Property expense date · recorded paid movement'});
  return true;
 }
 function reset(){activeKey='';selected=null}
 const api={filter,period,total,cents,verifiedRecords,renderRestaurant,renderHotel,reset};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteV3ExpenseView=api;
})(typeof window!=='undefined'?window:globalThis);
