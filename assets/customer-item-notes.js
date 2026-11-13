/* Dish-level cooking requests are informational, never price modifiers. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteItemNotes=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MAX_ITEM_NOTE=100;
 const MAX_ORDER_NOTE=500;
 const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
 function normalizeNotes(notes,allowedIds=[]){
  if(!notes||typeof notes!=='object'||Array.isArray(notes))return {};
  const allowed=new Set(allowedIds.map(String));
  return Object.fromEntries(Object.entries(notes)
   .filter(([id,value])=>allowed.has(id)&&typeof value==='string')
   .map(([id,value])=>[id,clean(value).slice(0,MAX_ITEM_NOTE)])
   .filter(([,value])=>value));
 }
 function compose({generalNote='',itemNotes={},entries=[],menuItems=[]}={}){
  const items=new Map(menuItems.map(item=>[String(item.id),item]));
  const allowed=entries.filter(([id,q])=>items.has(String(id))&&Number.isInteger(Number(q))&&Number(q)>0);
  const notes=normalizeNotes(itemNotes,allowed.map(([id])=>id));
  const lines=allowed.filter(([id])=>notes[id]).map(([id,q])=>{
   const name=clean(items.get(String(id)).name).slice(0,80);
   return '- '+name+' x'+Number(q)+': '+notes[id];
  });
  const general=clean(generalNote);
  const note=[general,...(lines.length?['Dish requests (apply to every unit):',...lines]:[])].filter(Boolean).join('\n');
  return {note,tooLong:note.length>MAX_ORDER_NOTE,remaining:MAX_ORDER_NOTE-note.length,
   itemCount:lines.length,hasDishNotes:lines.length>0};
 }
 return {MAX_ITEM_NOTE,MAX_ORDER_NOTE,clean,normalizeNotes,compose};
});
