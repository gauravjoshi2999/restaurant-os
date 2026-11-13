/* Pure canonical v2 cart-line helpers. No price computation or checkout mutation here. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteOptionCart=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const CART_SCHEMA_VERSION=2,MAX_QUANTITY=99,MAX_NOTE=100;
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 function identifier(value){
  const id=String(value||'').trim().toLowerCase();
  if(!UUID.test(id))throw new Error('Invalid menu item or option ID');
  return id;
 }
 function choices(value=[]){
  if(!Array.isArray(value)||value.length>24)throw new Error('Invalid option choices');
  const ids=value.map(identifier).sort();
  if(new Set(ids).size!==ids.length)throw new Error('Duplicate option choice');
  return ids;
 }
 function noteText(value=''){
  if(typeof value!=='string')throw new Error('Invalid dish request');
  const text=value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  if(text.length>MAX_NOTE)throw new Error('Dish request exceeds 100 characters');
  return text;
 }
 // Cooking requests are part of identity: same size + different requests stay separate.
 function lineKey(menu_item_id,option_choice_ids=[],note=''){
  return identifier(menu_item_id)+'|'+choices(option_choice_ids).join(',')+'|'+encodeURIComponent(noteText(note));
 }
 function normalizeLine(line){
  if(!line||typeof line!=='object'||Array.isArray(line))throw new Error('Invalid cart line');
  if(['price','unit_price','line_total','option_price','amount'].some(key=>key in line))
   throw new Error('Client-calculated prices are not allowed');
  const menu_item_id=identifier(line.menu_item_id);
  const option_choice_ids=choices(line.option_choice_ids||[]);
  const note=noteText(line.note||'');
  const quantity=Number(line.quantity);
  if(!Number.isInteger(quantity)||quantity<1||quantity>MAX_QUANTITY)
   throw new Error('Quantity must be 1 to 99');
  return {line_key:lineKey(menu_item_id,option_choice_ids,note),
    menu_item_id,option_choice_ids,quantity,note};
 }
 function mergeLines(lines){
  if(!Array.isArray(lines)||lines.length>100)throw new Error('Invalid cart');
  const result=new Map();
  for(const raw of lines){
   const line=normalizeLine(raw),existing=result.get(line.line_key);
   if(existing){
    if(existing.quantity+line.quantity>MAX_QUANTITY)throw new Error('Quantity must be 1 to 99');
    existing.quantity+=line.quantity;
   }else result.set(line.line_key,line);
  }
  return Array.from(result.values());
 }
 function migrate(saved){
  if(!saved||typeof saved!=='object'||typeof saved.restaurantId!=='string')
    throw new Error('Invalid restaurant cart');
  if(saved.cart_schema_version===CART_SCHEMA_VERSION){
   return {cart_schema_version:CART_SCHEMA_VERSION,restaurantId:identifier(saved.restaurantId),
     generalNote:String(saved.generalNote||''),lines:mergeLines(saved.lines||[])};
  }
  if(!saved.items||typeof saved.items!=='object'||Array.isArray(saved.items))
   throw new Error('Invalid legacy cart');
  const notes=saved.itemNotes&&typeof saved.itemNotes==='object'?saved.itemNotes:{};
  const lines=Object.entries(saved.items).filter(([,q])=>Number(q)>0)
   .map(([menu_item_id,quantity])=>({menu_item_id,quantity,option_choice_ids:[],note:notes[menu_item_id]||''}));
  return {cart_schema_version:CART_SCHEMA_VERSION,restaurantId:identifier(saved.restaurantId),
   generalNote:String(saved.generalNote||''),lines:mergeLines(lines)};
 }
 return {CART_SCHEMA_VERSION,MAX_QUANTITY,identifier,choices,noteText,lineKey,normalizeLine,mergeLines,migrate};
});
