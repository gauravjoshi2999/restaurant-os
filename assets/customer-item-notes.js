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
 const PRESETS=Object.freeze([
  Object.freeze({id:'less-spicy',label:'Less spicy',phrase:'Less spicy'}),
  Object.freeze({id:'no-onion',label:'No onion',phrase:'No onion'}),
  Object.freeze({id:'no-garlic',label:'No garlic',phrase:'No garlic'}),
  Object.freeze({id:'extra-spicy',label:'Extra spicy',phrase:'Extra spicy'})
 ]);
 const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
 function presetTokens(note){
  return clean(note).split(/\s*,\s*/).map(clean).filter(Boolean);
 }
 function hasPreset(note,id){
  const preset=PRESETS.find(p=>p.id===id);
  return !!preset&&presetTokens(note).some(token=>token.toLowerCase()===preset.phrase.toLowerCase());
 }
 function togglePreset(note,id){
  const preset=PRESETS.find(p=>p.id===id);
  const current=clean(note);
  if(!preset)return {note:current,changed:false,tooLong:false};
  const tokens=presetTokens(current);
  const present=hasPreset(current,id);
  const opposite=id==='less-spicy'?'Extra spicy':id==='extra-spicy'?'Less spicy':null;
  const nextTokens=tokens.filter(token=>token.toLowerCase()!==preset.phrase.toLowerCase()&&(!opposite||token.toLowerCase()!==opposite.toLowerCase()));
  if(!present)nextTokens.push(preset.phrase);
  const next=nextTokens.join(', ');
  if(next.length>MAX_ITEM_NOTE)return {note:current,changed:false,tooLong:true};
  return {note:next,changed:next!==current,tooLong:false};
 }
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
   itemCount:lines.length,hasDishNotes:lines.length>0,dishLines:lines};
 }
 return {MAX_ITEM_NOTE,MAX_ORDER_NOTE,PRESETS,clean,hasPreset,togglePreset,normalizeNotes,compose};
});
