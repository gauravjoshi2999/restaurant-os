/* Bite Owner V3 / A04 supplier dues. Append-only payment records via one scoped RPC.
 * Existing purchase paid_amount remains the initial payment on PURCHASE date.
 * No cashbook INSERT or independent duplicate expense entries here. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const cents=n=>{
  if(typeof n!=='number'&&!(typeof n==='string'&&n.trim()))return null;
  const v=Number(n),c=Math.round(v*100);
  return Number.isFinite(v)&&v>=0&&Number.isSafeInteger(c)&&Math.abs(v*100-c)<0.00001?c:null;
 };
 const rupees=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
   !Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 function laterTotal(purchase,payments){
  if(!purchase?.id||!purchase.restaurant_id||!Array.isArray(payments))return null;
  let sum=0;const seen=new Set();
  for(const p of payments){
   if(!p||p.purchase_id!==purchase.id||p.restaurant_id!==purchase.restaurant_id)continue;
   const c=cents(p.amount);
   if(!p.id||seen.has(p.id)||c===null||c<=0||!validDay(p.payment_date)||p.payment_date<purchase.purchase_date)return null;
   seen.add(p.id);sum+=c;if(!Number.isSafeInteger(sum))return null;
  }
  return sum;
 }
 function balances(purchase,payments){
  if(!purchase||!validDay(purchase.purchase_date))return null;
  const total=cents(purchase.total_amount),initial=cents(purchase.paid_amount),later=laterTotal(purchase,payments);
  if([total,initial,later].includes(null)||!Number.isSafeInteger(initial+later)||initial+later>total)return null;
  return {due:(total-initial-later)/100,paid:(initial+later)/100};
 }
 function outstanding(purchase,payments){return balances(purchase,payments)?.due??null;}
 function paid(purchase,payments){return balances(purchase,payments)?.paid??null;}
 function summary(purchases,payments){
  if(!Array.isArray(purchases)||!Array.isArray(payments))return {error:'Supplier balances unavailable.'};
  const seen=new Set(),dues=[];let sum=0;
  for(const p of purchases){
   const amount=outstanding(p,payments);
   if(!p?.id||seen.has(p.id)||amount===null)return {error:'Supplier balance could not be verified. Refresh Purchases.'};
   seen.add(p.id);if(amount>0){dues.push({id:p.id,amount});sum+=Math.round(amount*100);}
   if(!Number.isSafeInteger(sum))return {error:'Supplier balance too large to verify.'};
  }
  return {count:dues.length,total:sum/100,dues};
 }
 function validate({purchase,payments,amount,date,method,reference,today}){
  if(!purchase||!purchase.id)throw Error('Select a saved supplier purchase.');
  const n=Number(amount);
  if(amount===''||!Number.isFinite(n)||n<=0||n!==Math.round(n*100)/100)
   throw Error('Enter a positive payment amount with at most two decimals.');
  const due=outstanding(purchase,payments);
  if(due===null)throw Error('Supplier due could not be verified. Refresh Purchases.');
  if(n>due)
   throw Error('Payment is higher than the current supplier due. Refresh Purchases.');
  if(!validDay(date)||date>today||date<purchase.purchase_date)
   throw Error('Payment date must be between purchase date and today.');
  if(!['Cash','UPI','Card','Bank Transfer'].includes(method))
   throw Error('Choose how money was actually paid.');
  if(String(reference||'').length>100)throw Error('Reference must be 100 characters or fewer.');
  return {amount:n,date,method,reference:String(reference||'').trim()};
 }
 let panel=null;
 function close(){if(panel){panel.remove();panel=null;}}
 function open({purchase,payments,today,owner,onSave,onSuccess}){
  if(!owner)throw Error('Only restaurant owner may record supplier payments.');
  if(!purchase||!onSave)throw Error('Purchase payment is unavailable.');
  close();
  const due=outstanding(purchase,payments);
  if(due===null)throw Error('Supplier due could not be verified. Refresh Purchases.');
  if(due<=0)throw Error('This supplier purchase is already settled.');
  const requestId=root.crypto?.randomUUID?.();
  if(!requestId)throw Error('Secure payment request ID is unavailable. Open Bite via HTTPS.');
  const el=root.document.createElement('div');
  el.className='bsp-modal-backdrop';
  el.innerHTML='<div class="bsp-dialog" role="dialog" aria-modal="true" aria-label="Record supplier payment" tabindex="-1">'+
   '<header><div><small>OWNER V3 · SUPPLIER DUE</small><h2>Record supplier payment</h2><p>Record money already paid. Bite does not transfer money.</p></div><button type="button" data-bsp-close aria-label="Close supplier payment">×</button></header>'+
   '<div class="bsp-due"><span>Remaining supplier due</span><strong>'+rupees(due)+'</strong>'+
   '<small>Purchase '+esc(String(purchase.id).slice(0,8))+' · '+esc(purchase.purchase_date)+'</small></div>'+
   '<form class="bsp-form"><label>Amount paid (₹)<input name="amount" type="number" min="0.01" max="'+due.toFixed(2)+'" step="0.01" inputmode="decimal" required value="'+due.toFixed(2)+'"></label>'+
   '<label>Actual payment date<input name="date" type="date" min="'+esc(purchase.purchase_date)+'" max="'+esc(today)+'" required value="'+esc(today)+'"></label>'+
   '<label>Paid by<select name="method" required><option>Cash</option><option>UPI</option><option>Card</option><option>Bank Transfer</option></select></label>'+
   '<label>Reference / UTR (optional)<input name="reference" maxlength="100" placeholder="Transaction ID / note"></label>'+
   '<label class="bsp-confirm"><input name="confirmed" type="checkbox" required> I confirm this money was actually paid. This adds a Cashbook outflow, not a second expense.</label>'+
   '<div class="bsp-error" role="alert" aria-live="polite"></div>'+
   '<div class="bsp-actions"><button type="button" data-bsp-close>Cancel</button><button type="submit" class="primary">Save payment</button></div></form></div>';
  root.document.body.append(el);panel=el;
  const form=el.querySelector('form'),submit=form.querySelector('[type=submit]');
  let saving=false;
  el.addEventListener('click',e=>{if(!saving&&(e.target===el||e.target.closest?.('[data-bsp-close]')))close()});
  el.addEventListener('keydown',e=>{if(e.key==='Escape'&&!saving){e.preventDefault();close()}});
  el.querySelector('.bsp-dialog').focus();
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(saving)return;
   const fields=new FormData(form);
   const error=el.querySelector('.bsp-error');error.textContent='';
   try{
    if(fields.get('confirmed')!=='on')throw Error('Confirm the payment before saving.');
    const data=validate({purchase,payments,today,
     amount:fields.get('amount'),date:fields.get('date'),method:fields.get('method'),reference:fields.get('reference')});
    saving=true;submit.disabled=true;submit.textContent='Recording…';
    await onSave({purchaseId:purchase.id,...data,requestId});
    close();
    await onSuccess?.();
   }catch(err){
    if(panel===el){
     error.textContent=err.message||'Payment could not be saved. Review this purchase before retrying.';
     saving=false;submit.disabled=false;submit.textContent='Retry same payment';
    }
   }
  });
  return requestId;
 }
 function renderSummary(target,{purchases,payments,available,owner,onOpen}){
  if(!target)return;
  if(!available){
   target.innerHTML='<div class="bsp-unavailable"><strong>Supplier due payment service unavailable</strong><p>Existing purchases still work. Do not re-enter a purchase as an expense or record a second Cashbook payment.</p></div>';
   return;
  }
  const d=summary(purchases,payments);
  if(d.error){target.onclick=null;target.textContent=d.error;return;}
  const owed=d.dues.slice(0,10);
  target.innerHTML='<section class="bsp-summary" aria-label="Supplier dues">'+
   '<div class="bsp-summary-head"><div><small>SUPPLIER DUES</small><h2>Pay later · Outstanding bills</h2></div>'+
   '<span>'+d.count+' unpaid / partly paid</span></div>'+
   '<div class="bsp-summary-total">'+rupees(d.total)+'<small>Remaining due · Not a Cashbook payment</small></div>'+
   (owed.length?'<div class="bsp-due-list">'+owed.map(due=>{
    const p=(purchases||[]).find(x=>x.id===due.id);
    return '<div class="bsp-due-item"><div><strong>'+esc(p?.supplier_name_snapshot||'Supplier purchase')+'</strong>'+
     '<small>'+esc(p?.purchase_date)+' · Bill '+esc(p?.invoice_number||String(p?.id||'').slice(0,8))+'</small></div>'+
     '<b>'+rupees(due.amount)+'</b>'+
     (owner?'<button type="button" data-bsp-pay="'+esc(due.id)+'">Record payment</button>':'')+'</div>';
   }).join('')+'</div>':
   '<p class="bsp-empty">No outstanding supplier purchases. Initial paid amounts are retained on purchase day.</p>')+
   (d.count>10?'<p class="bsp-foot">Showing 10 supplier dues. See the Purchases history for all bills.</p>':'')+
   '<p class="bsp-foot">Payment records use the actual paid date. Initial purchase-day payments are kept unchanged. Stock purchases are not automatically expensed twice.</p>'+
   '</section>';
  target.onclick=e=>{
   const btn=e.target.closest?.('[data-bsp-pay]');
   if(btn&&owner)onOpen?.(btn.dataset.bspPay);
  };
 }
 const api={laterTotal,outstanding,paid,summary,validate,renderSummary,open,close};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteSupplierDues=api;
})(typeof window!=='undefined'?window:globalThis);
