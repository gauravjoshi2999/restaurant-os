/* Bite Reorder: customer review before replacing an existing single-restaurant cart.
 * Uses only current restaurant menu data and optional verified historical order snapshots.
 * No checkout, payment, refund, or backend writes.
 */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BiteReorderReview=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 function amount(value){
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?n:null;
 }
 function text(value){return String(value??'').trim().slice(0,150);}
 function rupees(value){
  return '₹'+Number(value).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2});
 }
 function summary(items,options={}){
  const rows=(Array.isArray(items)?items:[]).map((item,index)=>{
   const quantity=Math.min(99,Math.max(1,Number.isInteger(Number(item?.quantity))?Number(item.quantity):1));
   const oldUnit=amount(item?.previous_price);
   const newUnit=amount(item?.price);
   const available=item?.available===true&&!!item?.menu_item_id&&newUnit!==null;
   const changed=available&&oldUnit!==null&&Math.round((newUnit-oldUnit)*100)!==0;
   return {key:String(item?.menu_item_id||index),name:text(item?.name)||'Menu item',quantity,
    available,previousUnit:oldUnit,currentUnit:newUnit,changed,
    previousLine:oldUnit===null?null:Math.round(oldUnit*quantity*100)/100,
    currentLine:available?Math.round(newUnit*quantity*100)/100:null};
  });
  const available=rows.filter(i=>i.available);
  const missing=rows.filter(i=>!i.available);
  const previousSubtotal=rows.length&&rows.every(i=>i.previousLine!==null)?
   Math.round(rows.reduce((sum,i)=>sum+i.previousLine,0)*100)/100:null;
  const currentSubtotal=Math.round(available.reduce((sum,i)=>sum+i.currentLine,0)*100)/100;
  return {rows,available,missing,previousSubtotal,currentSubtotal,
   hasExistingCart:options.hasExistingCart===true,
   changedCount:available.filter(i=>i.changed).length,
   canContinue:available.length>0};
 }
 function promptReview(items,options={}){
  const review=summary(items,options);
  if(!review.canContinue)return Promise.resolve(false);
  if(typeof document==='undefined'||typeof HTMLDialogElement==='undefined'){
   return Promise.resolve(typeof confirm==='function'?confirm(
    'Review '+review.available.length+' available item(s) at current menu prices. '+
    review.missing.length+' item(s) unavailable. '+
    (review.hasExistingCart?'Your existing cart will be replaced. ':'')+
    'Continue to editable cart?'):false);
  }
  return new Promise(resolve=>{
   const dialog=document.createElement('dialog');
   dialog.className='bite-reorder-review';
   dialog.setAttribute('role','dialog');
   dialog.setAttribute('aria-labelledby','biteReorderReviewTitle');
   dialog.setAttribute('aria-describedby','biteReorderReviewInfo');
   const heading=document.createElement('header');
   const title=document.createElement('h2');
   title.id='biteReorderReviewTitle';title.textContent='Review your reorder';
   const intro=document.createElement('p');intro.id='biteReorderReviewInfo';
   intro.textContent='Prices and availability may have changed since your previous order.';
   heading.append(title,intro);
   const content=document.createElement('section');content.className='bite-reorder-content';
   const list=document.createElement('ul');list.className='bite-reorder-lines';
   for(const row of review.rows){
    const li=document.createElement('li');
    const label=document.createElement('strong');label.textContent=row.name+' × '+row.quantity;
    const meta=document.createElement('span');meta.className='bite-reorder-line-meta';
    if(!row.available){li.classList.add('is-unavailable');meta.textContent='Unavailable now — not added';}
    else if(row.previousUnit===null)meta.textContent='Current '+rupees(row.currentLine)+' · previous price unavailable';
    else if(row.changed)meta.textContent='Was '+rupees(row.previousLine)+' · now '+rupees(row.currentLine);
    else meta.textContent='Current '+rupees(row.currentLine)+' · unchanged';
    li.append(label,meta);list.append(li);
   }
   content.append(list);
   const totals=document.createElement('p');totals.className='bite-reorder-total';
   totals.textContent='Current available items subtotal: '+rupees(review.currentSubtotal);
   content.append(totals);
   const hint=document.createElement('p');hint.className='bite-reorder-hint';
   hint.textContent='Delivery fees, taxes, customization and final payable are verified again before checkout. No payment is made by Reorder.';
   content.append(hint);
   if(review.hasExistingCart){
    const warning=document.createElement('p');warning.className='bite-reorder-warning';
    warning.textContent='Continuing will replace items in your current cart. Keeping the cart leaves everything unchanged.';
    content.append(warning);
   }
   const actions=document.createElement('footer');actions.className='bite-reorder-actions';
   const back=document.createElement('button');back.type='button';back.className='secondary';
   back.textContent=review.hasExistingCart?'Keep existing cart':'Cancel';
   const go=document.createElement('button');go.type='button';go.className='primary';
   go.textContent=review.hasExistingCart?'Replace cart':'Continue to cart';
   actions.append(back,go);dialog.append(heading,content,actions);document.body.append(dialog);
   let accepted=false,finished=false;
   function finish(){
    if(finished)return;
    finished=true;dialog.remove();resolve(accepted);
   }
   dialog.addEventListener('close',finish,{once:true});
   dialog.addEventListener('cancel',()=>{accepted=false;});
   back.addEventListener('click',()=>{accepted=false;dialog.close();});
   go.addEventListener('click',()=>{accepted=true;dialog.close();});
   try{dialog.showModal();back.focus({preventScroll:true});}
   catch{accepted=false;finish();}
  });
 }
 return {amount,summary,rupees,promptReview};
});
