/* Optional cutlery preference travels to the restaurant as an order instruction.
   It never changes the food price or promises availability. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteCutleryPreference=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const REQUEST='Please include disposable spoon/fork if available.';
 function composeGeneralNote(raw,requested){
  const general=String(raw??'');
  if(!requested)return general;
  // Backend order instructions have a 500-character combined limit. The
  // existing BiteItemNotes.compose enforces it for all notes together.
  if(general.trim().toLowerCase().includes(REQUEST.toLowerCase()))return general;
  return [general.trim(),REQUEST].filter(Boolean).join('\n');
 }
 return {REQUEST,composeGeneralNote};
});
