/* Bite food search must never inherit saved login email autofill. */
(function(root){
 'use strict';
 const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
 function isEmailAutofill(value){return EMAIL.test(String(value||'').trim());}
 function install(doc){
  const ids=['homeSearchInput','searchInput'];
  const inputs=ids.map(id=>doc.getElementById(id)).filter(Boolean);
  if(!inputs.length)return {sanitize:()=>false,stop:()=>{}};
  let disposed=false,focusTouched=false;
  function sanitize(){
   if(disposed)return false;
   // Search is exclusively for restaurants/dishes. Never reuse a saved
   // email identity from Chrome's username autofill or session restore.
   let changed=false;
   for(const input of inputs){
    if(!isEmailAutofill(input.value))continue;
    input.value='';
    changed=true;
    if(typeof input.dispatchEvent==='function'&&root.Event)
     input.dispatchEvent(new root.Event('input',{bubbles:true}));
   }
   return changed;
  }
  const onInput=()=>{sanitize();};
  const onFocus=()=>{focusTouched=true;sanitize();};
  const onPageShow=()=>{sanitize();};
  const onVisibility=()=>{if(doc.visibilityState==='visible')sanitize();};
  inputs.forEach(input=>{
   input.setAttribute('autocomplete','off');
   input.addEventListener('input',onInput);
   input.addEventListener('focus',onFocus);
  });
  doc.addEventListener('visibilitychange',onVisibility);
  root.addEventListener?.('pageshow',onPageShow);
  // Some browsers restore form values after scripts initialize.
  const timers=[75,350,1100,2300].map(ms=>root.setTimeout?.(sanitize,ms)).filter(t=>t!==undefined);
  sanitize();
  return {sanitize,stop(){
   disposed=true;
   inputs.forEach(input=>{input.removeEventListener('input',onInput);input.removeEventListener('focus',onFocus);});
   doc.removeEventListener('visibilitychange',onVisibility);
   root.removeEventListener?.('pageshow',onPageShow);
   timers.forEach(t=>root.clearTimeout?.(t));
  }};
 }
 const api={isEmailAutofill,install};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else {root.BiteSearchAutofillGuard=api;install(root.document);}
})(typeof window!=='undefined'?window:globalThis);
