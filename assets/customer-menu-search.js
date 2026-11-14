/* Bite menu discovery: cached, Unicode-safe food search + transparent cart add-ons.
 * Pure helpers; never fetch, store, charge, update an order or invent popularity.
 */
(function(root){
 'use strict';
 const cache=new WeakMap();
 const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('en-IN')
   .replace(/[^\p{L}\p{M}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
 function indexFor(items){
   if(!Array.isArray(items))return [];
   if(cache.has(items))return cache.get(items);
   const entries=items.map((item,position)=>({
     item,position,name:normalize(item?.name),description:normalize(item?.description)
   }));
   cache.set(items,entries);
   return entries;
 }
 function selectMenu(items,options={}){
   const q=normalize(options.query);
   const tokens=q.split(' ').filter(Boolean);
   const category=options.category||'all';
   const results=[];
   for(const row of indexFor(items)){
     const item=row.item;
     if(!item||(category!=='all'&&item.category_id!==category))continue;
     if(options.vegOnly&&item.is_vegetarian!==true)continue;
     if(tokens.length&&!tokens.every(token=>row.name.includes(token)||row.description.includes(token)))continue;
     let rank=0;
     if(tokens.length){
       rank=row.name===q?0:row.name.startsWith(q)?1:
         tokens.every(token=>row.name.includes(token))?2:
         tokens.some(token=>row.name.includes(token))?3:4;
     }
     results.push({item,position:row.position,rank});
   }
   // No search: preserve restaurant-defined menu ordering. For a query, put
   // dish-name matches above description-only matches; ties stay stable.
   if(tokens.length)results.sort((a,b)=>a.rank-b.rank||a.position-b.position);
   return results.map(row=>row.item);
 }
 function selectAddOns(items,cart={},limit=6){
   if(!Array.isArray(items)||!items.length||!cart||typeof cart!=='object')return [];
   const selected=items.filter(item=>item&&Number(cart[item.id]||0)>0);
   if(!selected.length)return [];
   const allVeg=selected.every(item=>item.is_vegetarian===true);
   const usedCategories=new Set(selected.map(item=>item.category_id).filter(Boolean));
   return items.map((item,position)=>({item,position})).filter(({item})=>
     item&&item.id&&!cart[item.id]&&item.is_available!==false&&
     item.price!==null&&item.price!==undefined&&
     Number.isFinite(Number(item.price))&&Number(item.price)>=0
   ).map(row=>({
     ...row,
     // First show a varied category, but do not prioritise a non-veg dish
     // when a customer has selected exclusively vegetarian food.
     score:(allVeg&&row.item.is_vegetarian!==true?2:0)+
       (usedCategories.has(row.item.category_id)?1:0)
   })).sort((a,b)=>a.score-b.score||a.position-b.position)
     .slice(0,Math.max(0,Math.min(6,Number(limit)||0))).map(row=>row.item);
 }
 const api={selectMenu,selectAddOns,normalize};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.BiteMenuSearch=api;
})(typeof window!=='undefined'?window:globalThis);
