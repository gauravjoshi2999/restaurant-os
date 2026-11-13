/* Bite restaurant image selection: owner controls their cover, Bite fills every gap. */
(function(root){
 'use strict';
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const pathRx=/^[0-9a-f-]{36}\/covers\/[a-z0-9-]+\.webp$/;
 const defaults=Object.freeze({
  meal:'assets/food/meal-1100.jpg',curry:'assets/food/curry-800.jpg',
  dosa:'assets/food/dosa-800.jpg',burger:'assets/food/burger-800.jpg',
  pizza:'assets/food/pizza-800.jpg',dessert:'assets/food/dessert-800.jpg',
  noodles:'assets/food/noodles-800.jpg'
 });
 const clean=value=>String(value??'').toLowerCase();
 function isPureVeg(restaurant){
  const t=[...(restaurant?.cuisine_tags||[]),restaurant?.public_description||'',restaurant?.name||''].join(' ').toLowerCase();
  return /pure[\s-]*veg|100%\s*veg|veg[\s-]*only|शुद्ध\s*शाकाहारी|शाकाहारी|vegetarian/.test(t);
 }
 function suggestedKey(r={}){
  const t=clean([...(r.cuisine_tags||[]),r.name||''].join(' '));
  // Pure-veg must never pick non-veg or egg visuals even if mixed cuisine tags.
  if(isPureVeg(r))return 'meal';
  if(/south indian|dosa|idli/.test(t))return 'dosa';
  if(/pizza/.test(t))return 'pizza';
  if(/sweet|dessert|bakery|mithai|ice.?cream/.test(t))return 'dessert';
  if(/chinese|noodle|hakka/.test(t))return 'noodles';
  if(/burger|fast food|snack|sandwich/.test(t))return 'burger';
  if(/north indian|paneer|punjabi|curry|spice/.test(t))return 'curry';
  return 'meal';
 }
 function expectedPrefix(id){return String(id||'').toLowerCase()+'/covers/'}
 function ownCoverPath(r){
  const id=String(r?.id||'').toLowerCase(),path=String(r?.cover_image_path||'');
  return uuid.test(id)&&pathRx.test(path)&&path.startsWith(expectedPrefix(id))?path:null;
 }
 function coverUrl(r,origin){
  const path=ownCoverPath(r);
  if(!path||!/^https:\/\//.test(String(origin||'')))return null;
  const url=new URL('/storage/v1/object/public/bite-menu/'+path,origin);
  if(r.cover_image_updated_at){const stamp=Date.parse(r.cover_image_updated_at);if(Number.isFinite(stamp))url.searchParams.set('v',String(stamp));}
  return url.toString();
 }
 function choose(r,items=[],origin='https://wedbgpybbgsszcmffoha.supabase.co'){
  const cover=coverUrl(r,origin),suggested=defaults[suggestedKey(r)];
  if(cover)return {src:cover,fallback:suggested,source:'owner',label:'Restaurant photo',alt:r.name+' restaurant cover photo'};
  // A Pure Veg restaurant gets Bite's curated vegetarian meal image; do not
  // trust automated dish/egg matching to certify its photo.
  if(!isPureVeg(r)){
   const owned=items.find(i=>i.restaurant_id===r.id&&i.image_url&&
     (/^https:\/\//i.test(i.image_url)||/^assets\/[a-z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/i.test(i.image_url)));
   if(owned)return {src:owned.image_url,fallback:suggested,source:'menu',label:'Menu photo',alt:owned.name+' — restaurant menu photo'};
  }
  return {src:suggested,fallback:'assets/food/meal-1100.jpg',source:'bite',label:'Bite suggested photo',alt:'Bite food serving suggestion'};
 }
 const api=Object.freeze({defaults,isPureVeg,suggestedKey,ownCoverPath,coverUrl,choose});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.BiteRestaurantCovers=api;
})(typeof window!=='undefined'?window:globalThis);
