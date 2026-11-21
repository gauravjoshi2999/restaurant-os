/* Bite Owner V3 A07 — one stock view on existing restaurant inventory sources.
 * Presentation + client-side entry review only; no new ledger or Supabase writes. */
(function(root){
 'use strict';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const numeric=n=>{if(typeof n!=='number'&&!(typeof n==='string'&&n.trim()))return null;const value=Number(n);return Number.isFinite(value)?value:null;};
 const decimal=n=>n===null?'Unverified':Number(n).toLocaleString('en-IN',{maximumFractionDigits:3});
 const dayValid=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 function stockView(items,balances,query=''){
  const find=String(query||'').trim().toLocaleLowerCase();
  const list=(Array.isArray(items)?items:[]).filter(i=>i&&i.is_active!==false).map(i=>{
   const stock=numeric(balances?.[i.id]),minimum=numeric(i.reorder_level);
   return {...i,stock,minimum:minimum!==null&&minimum>=0?minimum:null};
  });
  return {all:list.length,low:list.filter(x=>x.stock!==null&&x.minimum!==null&&x.stock<=x.minimum).length,unknown:list.filter(x=>x.stock===null||x.minimum===null).length,
   filtered:list.filter(x=>[x.name,x.category,x.unit].some(y=>String(y??'').toLocaleLowerCase().includes(find)))};
 }
 function render(target,{items=[],balances={},query='',onAdjust}={}){
  if(!target)return;
  const result=stockView(items,balances,query);
  target.innerHTML='<div class="biv3-summary" role="status">'+
   '<strong>'+result.filtered.length+'</strong> matching items · '+result.low+' low stock in '+result.all+' items'+(result.unknown?' · '+result.unknown+' unverified':'')+'</div>'+
   (result.filtered.length?'<div class="biv3-list">'+result.filtered.map(i=>
    '<article class="biv3-card'+(i.stock!==null&&i.minimum!==null&&i.stock<=i.minimum?' is-low':'')+'"><div class="biv3-item">'+
    '<strong>'+esc(i.name)+'</strong><small>'+esc(i.category||'Uncategorized')+'</small></div>'+
    '<div class="biv3-values"><strong>'+decimal(i.stock)+' '+esc(i.unit)+'</strong>'+
    '<small>Alert at '+decimal(i.minimum)+' '+esc(i.unit)+'</small></div>'+
    '<div class="biv3-actions"><span class="biv3-stock-label">'+(i.stock===null||i.minimum===null?'Stock unverified':i.stock<=i.minimum?'Low stock':'In stock')+'</span>'+
    '<button type="button" data-biv3-adjust="'+esc(i.id)+'" aria-label="Adjust '+esc(i.name)+'"'+(i.stock===null?' disabled':'')+'>Adjust</button></div></article>'
   ).join('')+'</div>':'<p class="biv3-empty">'+(result.all?'No matching stock items. Try another search.':'No inventory items yet. Add a stock item below.')+'</p>');
  target.onclick=event=>{
   const button=event.target.closest?.('[data-biv3-adjust]');
   const item=button&&result.filtered.find(i=>i.id===button.dataset.biv3Adjust);
   if(item&&item.stock!==null&&typeof onAdjust==='function')onAdjust(item.id);
  };
  return result;
 }
 function reviewMovement({type,quantity,cost='',date,today,item,stock,reason='',reference='',movements=[]}={}){
  const allowed=['opening','adjustment_in','adjustment_out','wastage'];
  if(!item?.id||!allowed.includes(type))return {ok:false,message:'Stock item aur movement choose karein. Purchases ko Purchases form se record karein.'};
  if(!dayValid(date)||!dayValid(today)||date>today)return {ok:false,message:'Valid past ya today date choose karein.'};
  if(numeric(quantity)===null||Number(quantity)<=0||Number(quantity)>10000000||Math.abs(Number(quantity)*1000-Math.round(Number(quantity)*1000))>0.00001)
   return {ok:false,message:'Valid quantity (0 se zyada) bharna zaroori hai.'};
  if(cost!==''&&cost!==null&&(numeric(cost)===null||Number(cost)<0||Number(cost)>100000000||Math.abs(Number(cost)*100-Math.round(Number(cost)*100))>0.00001))
   return {ok:false,message:'Unit cost valid hona chahiye.'};
  if(['adjustment_in','adjustment_out','wastage'].includes(type)&&String(reason).trim().length<3)
   return {ok:false,message:'Stock adjustment / wastage ke liye kam se kam 3 characters ka reason zaroori hai.'};
  if(['adjustment_out','wastage'].includes(type)&&numeric(stock)===null)return {ok:false,message:'Stock balance unverified. Refresh inventory before outward movement.'};
  if(['adjustment_out','wastage'].includes(type)&&Number(quantity)>Number(stock))
   return {ok:false,message:'Available stock se zyada outward / wastage nahi kar sakte.'};
  const ref=String(reference||'').trim(),note=String(reason||'').trim();
  const same=(Array.isArray(movements)?movements:[]).some(x=>x.inventory_item_id===item.id&&x.movement_type===type&&
   x.movement_date===date&&Number(x.quantity)===Number(quantity)&&String(x.reference||'').trim()===ref&&
   String(x.notes||'').trim()===note);
  if(same)return {ok:false,message:'Bilkul same stock movement pehle se saved hai. History check karein.'};
  return {ok:true};
 }
 const api={stockView,render,reviewMovement,dayValid};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.BiteV3Inventory=api;
})(typeof window!=='undefined'?window:globalThis);
