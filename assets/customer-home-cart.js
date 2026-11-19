/* Bite customer cart visibility on home + menu. UI-only: never initiates payments. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const dock=$('cartFloating');
 if(!dock)return;
 const removePanel=$('floatingCartRemovePanel');
 let restoreVersion=0;

 function sync(){
  const entries=typeof cartEntries==='function'?cartEntries():[];
  const count=entries.reduce((total,[,quantity])=>total+Number(quantity||0),0);
  const view=document.body.dataset.view||($('menuView')?.classList.contains('hidden')?'home':'menu');
  const visible=count>0&&(view==='home'||view==='menu');
  dock.classList.toggle('show',visible);
  if(!visible)removePanel.hidden=true;
  $('floatingCartRestaurant').textContent=activeRestaurant?.name||'Your restaurant';
  $('floatingCartCount').textContent=count+' item'+(count===1?'':'s');
  $('floatingCartTotal').textContent=money(entries.reduce((total,[id,quantity])=>{
   const item=menuItems.find(row=>row.id===id);
   return total+Number(item?.price||0)*Number(quantity||0);
  },0));
 }

 /* Storefront discovery fetches dish names but not IDs. Restore cart only after
    checking the restaurant and available dish IDs against the published menu. */
 async function restore(){
  if(BITE_DIRECT_MODE||activeRestaurant){sync();return;}
  const saved=readSavedCustomerCart();
  if(!saved?.restaurantId||!saved.items||typeof saved.items!=='object')return;
  const restaurant=restaurants.find(row=>row.id===saved.restaurantId);
  if(!restaurant)return; // Keep the saved cart for a later eligible discovery area.
  const version=++restoreVersion;
  const openSequence=biteRestaurantOpenSequence;
  try{
   const {data,error}=await sb.from('menu_items')
    .select('id,category_id,name,description,price,is_vegetarian,is_kids_choice,image_url')
    .eq('restaurant_id',restaurant.id).eq('is_available',true).order('sort_order');
   if(error)throw error;
   if(version!==restoreVersion||openSequence!==biteRestaurantOpenSequence||activeRestaurant)return;
   // Do not resurrect a cart that was explicitly cleared while the request ran.
   const latest=readSavedCustomerCart();
   if(!latest||latest.restaurantId!==restaurant.id||
      JSON.stringify(latest.items)!==JSON.stringify(saved.items))return;
   const valid=Array.isArray(data)?data:[];
   const validIds=new Set(valid.map(item=>item.id));
   const restored=Object.fromEntries(Object.entries(latest.items).filter(([id,q])=>
    validIds.has(id)&&Number.isInteger(Number(q))&&Number(q)>0
   ).map(([id,q])=>[id,Math.min(99,Number(q))]));
   activeRestaurant=restaurant;
   menuItems=valid;
   cart=restored;
   itemNotes=BiteItemNotes.normalizeNotes(latest.itemNotes,Object.keys(restored));
   if($('customerNote'))$('customerNote').value=String(latest.generalNote||'').slice(0,500);
   if($('cartOrderNote'))$('cartOrderNote').value=$('customerNote')?.value||'';
   if($('checkoutCutlery'))$('checkoutCutlery').checked=latest.cutleryRequested===true;
   renderCart(); // Also persists sanitized unavailable/invalid lines.
  }catch(error){
   // A read failure must never erase the customer's saved cart.
   console.warn('Saved cart could not be restored yet',error);
  }
 }

 $('floatingCartRemove').addEventListener('click',()=>{
  if(!cartEntries().length)return;
  removePanel.hidden=false;
  $('floatingCartConfirmRemove').focus({preventScroll:true});
 });
 $('floatingCartKeep').addEventListener('click',()=>{
  removePanel.hidden=true;
  $('floatingCartRemove').focus({preventScroll:true});
 });
 $('floatingCartConfirmRemove').addEventListener('click',()=>{
  if(!cartEntries().length)return;
  removePanel.hidden=true;
  if(typeof hideCartUndo==='function')hideCartUndo();
  // Only the unplaced cart is cleared; no checkout intent or paid order is changed.
  clearCustomerCart();
  renderCart();
  $('floatingCartRemovedStatus').textContent='Cart removed. You can add new items anytime.';
 });
 dock.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!removePanel.hidden){
   event.preventDefault();removePanel.hidden=true;$('floatingCartRemove').focus();
  }
 });
 window.BiteHomeCart={sync,restore};
 sync();
 if(restaurants.length&&!activeRestaurant)void restore();
})();