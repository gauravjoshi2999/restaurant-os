/* Owner-only read-only preview for real menu option groups.
   Never calculates payable totals or authorizes a checkout. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteOwnerOptionPreview=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const amount=v=>'₹'+Number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 function activeGroups(groups=[],links=[],choices=[]){
  return links.filter(link=>link.is_available===true).map(link=>{
   const group=groups.find(g=>g.id===link.option_group_id);
   if(!group||group.is_available!==true)return null;
   const options=choices.filter(c=>c.option_group_id===group.id&&c.is_available===true);
   return {id:group.id,name:group.name,min_select:Number(group.min_select),
    max_select:Number(group.max_select),options};
  }).filter(Boolean);
 }
 function validateSelections(active=[],selected=[]){
  if(!Array.isArray(selected)||selected.length>24||new Set(selected).size!==selected.length)
   throw Error('Please select valid menu options');
  const allowed=new Set(active.flatMap(g=>g.options.map(c=>c.id)));
  if(selected.some(id=>!uuid.test(String(id))||!allowed.has(id)))
   throw Error('This option is unavailable. Refresh and choose again.');
  for(const group of active){
   const count=selected.filter(id=>group.options.some(c=>c.id===id)).length;
   if(count<group.min_select||count>group.max_select)
    throw Error(group.name+': choose '+group.min_select+'–'+group.max_select+' option(s).');
  }
  return selected.slice().sort();
 }
 function verifyServerQuote(quote,restaurantId,menuItemId,selected){
  if(!quote||quote.quote_only!==true||quote.authorizes_payment!==false||
     quote.currency!=='INR'||quote.restaurant_id!==restaurantId||
     !Array.isArray(quote.lines)||quote.lines.length!==1)
   throw Error('Trusted price quote is unavailable. No payment was started.');
  const line=quote.lines[0];
  const optionIds=Array.isArray(line.options)?line.options.map(o=>String(o.choice_id)).sort():null;
  if(line.menu_item_id!==menuItemId||Number(line.quantity)!==1||!optionIds||
     optionIds.join(',')!==selected.slice().sort().join(','))
   throw Error('Price quote no longer matches the choices. Please refresh.');
  const total=Number(line.final_unit_price),food=Number(quote.food_subtotal);
  if(!Number.isFinite(total)||!Number.isFinite(food)||total<0||total>1000000||
     Math.abs(total-food)>0.001)
   throw Error('Invalid server amount. No payment was started.');
  return {total,currency:'INR',labels:line.options.map(o=>String(o.name)),
   base:line.base_unit_price,extras:line.option_unit_total};
 }
 return {activeGroups,validateSelections,verifyServerQuote,amount};
});
