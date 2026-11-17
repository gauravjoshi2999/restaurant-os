/* POS Stage 2: one restaurant bill, explicit Dine-in/Takeaway and actual diners.
   Do not treat order quantity as diner count; old orders without a visit stay unknown. */
(function(root){
 'use strict';
 const doc=root.document;
 let scope=null,byOrder=new Map(),epoch=0;
 const $=id=>doc.getElementById(id);
 const valid=(type,count)=>{
  if(type==='takeaway')return {visitType:'takeaway',guestCount:null};
  const n=Number(count);
  if(type!=='dine_in'||!Number.isInteger(n)||n<1||n>200)
   throw Error('Dine-in ke liye 1 se 200 tak logon ki sahi sankhya bharein.');
  return {visitType:'dine_in',guestCount:n};
 };
 function activeType(){return $('posVisitTakeaway')?.getAttribute('aria-pressed')==='true'?'takeaway':'dine_in';}
 function paint(){
  const type=activeType(),dine=$('posVisitDineIn'),take=$('posVisitTakeaway'),count=$('posGuestCounter');
  if(!dine||!take||!count)return;
  dine.setAttribute('aria-pressed',String(type==='dine_in'));
  take.setAttribute('aria-pressed',String(type==='takeaway'));
  count.hidden=type!=='dine_in';
 }
 function syncPropertyType(){
  const select=doc.querySelector('#bitePOSOrderType [name="bite_order_type"]');
  if(!select)return;
  const wanted=activeType()==='takeaway'?'POS - Takeaway':'POS - Dine-in';
  if(![...select.options].some(o=>o.value===wanted))return;
  if(select.value!==wanted){select.value=wanted;select.dispatchEvent(new Event('change',{bubbles:true}));}
  else {$('orderChannel').value=wanted;const table=$('bitePOSTableField');if(table)table.hidden=wanted!=='POS - Dine-in';}
 }
 function set(type,count){
  const dine=$('posVisitDineIn'),take=$('posVisitTakeaway');if(!dine||!take)return;
  const choice=type==='takeaway'?'takeaway':'dine_in';
  dine.setAttribute('aria-pressed',String(choice==='dine_in'));take.setAttribute('aria-pressed',String(choice==='takeaway'));
  const field=$('posGuestCount');if(field)field.value=choice==='dine_in'?
   String(count!=null&&Number.isInteger(Number(count))&&Number(count)>0?count:1):'';
  paint();syncPropertyType();
 }
 function reset(){set('dine_in',1);}
 function selected(){const count=$('posGuestCount');return valid(activeType(),count?.value);}
 function detail(id){return byOrder.get(String(id))||null;}
 function label(orderId){const d=detail(orderId);if(!d)return '';return d.visit_type==='takeaway'?'Takeaway':('Dine-in · '+d.guest_count+' people');}
 function init(){
  const rootBox=$('bitePOSVisitControls');if(!rootBox||rootBox.dataset.bound==='true')return;
  rootBox.dataset.bound='true';
  rootBox.addEventListener('click',event=>{
   const toggle=event.target.closest('[data-visit-choice]');
   if(toggle){set(toggle.dataset.visitChoice,toggle.dataset.visitChoice==='dine_in'?($('posGuestCount')?.value||1):null);root.BitePOS?.touch?.();return;}
   const change=event.target.closest('[data-visit-step]');if(!change)return;
   const input=$('posGuestCount');if(!input)return;
   const raw=Number(input.value||1),next=Math.min(200,Math.max(1,raw+Number(change.dataset.visitStep)));
   input.value=String(next);input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  $('posGuestCount')?.addEventListener('input',()=>{
   const input=$('posGuestCount');const n=Number(input.value);
   input.setCustomValidity(!Number.isInteger(n)||n<1||n>200?'Enter 1–200 people':'');
  });
  reset();
 }
 async function refresh(sb,restaurantId,after){
  const id=String(restaurantId||'');
  if(!id||!sb)return;
  const request=++epoch;
  scope=id;
  const {data,error}=await sb.from('restaurant_pos_visit_details')
   .select('order_id,restaurant_id,visit_type,guest_count,created_at')
   .eq('restaurant_id',id).order('created_at',{ascending:false}).limit(2000);
  if(request!==epoch||scope!==id)return;
  if(error){root.console?.warn?.('POS visit details unavailable',error.message);return;}
  byOrder=new Map((data||[]).filter(r=>r.restaurant_id===id).map(r=>[String(r.order_id),r]));
  if(typeof after==='function')after();
 }
 function clear(){epoch++;scope=null;byOrder=new Map();}
 root.BitePOSVisits={init,set,reset,selected,valid,detail,label,syncPropertyType,refresh,clear};
})(window);
