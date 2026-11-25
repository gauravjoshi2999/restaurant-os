/* Restaurant-declared food metadata. Never infer egg/meat from names/photos,
   or a restaurant-wide Pure Veg claim from its currently available dishes. */
(function(root){
 'use strict';
 function typeOf(item){
  if(!item)return 'unknown';
  const explicit=item.dietary_type;
  if(explicit!==null&&explicit!==undefined&&explicit!==''){
   if(!['veg','egg','nonveg'].includes(explicit))return 'unknown';
   if(item.is_vegetarian!==(explicit==='veg'))return 'unknown';
   return explicit;
  }
  return item.is_vegetarian===true?'veg':item.is_vegetarian===false?'nonveg':'unknown';
 }
 function declaredPureVeg(restaurant){
  const tags=Array.isArray(restaurant?.cuisine_tags)?restaurant.cuisine_tags:[];
  const parts=tags.flatMap(tag=>String(tag).normalize('NFKC').split(/[•|,;]/)).map(p=>p.trim());
  if(parts.some(p=>/^(?:mixed|non[ -]?veg(?:etarian)?|egg(?:etarian)?|veg\s*(?:and|&)\s*egg|मांसाहारी)$/i.test(p)))return false;
  return parts.some(part=>
   /^(?:100\s*%\s*)?(?:pure\s+veg(?:etarian)?(?:\s*\(\s*शुद्ध\s+शाकाहारी\s*\))?|शुद्ध\s+शाकाहारी)$/i.test(part.trim()));
 }
 function pureVegMenu(restaurant,items){
  return declaredPureVeg(restaurant)&&Array.isArray(items)&&items.length>0&&items.length<1000&&items.every(i=>typeOf(i)==='veg');
 }
 function matches(item,diet='all'){
  return diet==='all'||['veg','egg','nonveg'].includes(diet)&&typeOf(item)===diet;
 }
 function label(item){return {veg:'Vegetarian',egg:'Egg',nonveg:'Non-vegetarian',unknown:'Dietary details not provided'}[typeOf(item)];}
 async function readMenu(run,columns){
  const result=await run(columns);
  const error=result?.error;
  // Safe additive rollout/rollback: retry only a missing optional metadata
  // column, using the exact same restaurant/availability filters. Never retry
  // permission, network, validation or other schema errors with broader reads.
  if(['42703','PGRST204'].includes(error?.code)&&/\bdietary_type\b/i.test(String(error.message||'')))
   return run(columns.split(',').filter(c=>c!=='dietary_type').join(','));
  return result;
 }
 const api={typeOf,declaredPureVeg,pureVegMenu,matches,label,readMenu};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BiteFoodTypes=api;
})(typeof window!=='undefined'?window:globalThis);
