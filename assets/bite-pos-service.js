/* Bite POS diner service: one existing itemized bill, no second payment pathway. */
(function(root){
 'use strict';
 const $=id=>root.document.getElementById(id);
 let options={restaurantId:null,tables:[],dineInAllowed:true,takeawayAllowed:true};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function ensure(){
  if($('bitePosServicePanel'))return $('bitePosServicePanel');
  const form=$('orderForm');if(!form)return null;
  const p=root.document.createElement('section');p.id='bitePosServicePanel';p.className='bps-form';p.setAttribute('aria-label','POS dining type and guest count');
  p.innerHTML='<div class="bps-mode" role="group" aria-label="Food service type">'+
   '<button type="button" data-bps-type="dine_in" aria-pressed="true">🍽 Dine-in</button>'+
   '<button type="button" data-bps-type="takeaway" aria-pressed="false">▣ Takeaway</button></div>'+
   '<input name="bite_service_type" id="biteServiceType" type="hidden" value="dine_in">'+
   '<div id="biteServiceDineFields" class="bps-details"><div class="bps-counter">'+
   '<span>Guests dining <small>Count people, not menu items</small></span>'+
   '<button type="button" data-bps-step="-1" aria-label="Decrease guests">−</button>'+
   '<input type="number" id="biteServiceGuestCount" name="bite_guest_count" min="1" max="100" step="1" value="1" inputmode="numeric" aria-label="Number of diners">'+
   '<button type="button" data-bps-step="1" aria-label="Increase guests">＋</button></div>'+
   '<label class="bps-table"><span>Table (optional)</span><select id="biteServiceTable" name="bite_service_table_id"><option value="">No table assigned</option></select></label></div>'+
   '<p class="bps-hint" id="bitePosServiceHint">One bill per dining group. People are counted once when a new bill is saved.</p>';
  const customer=form.querySelector('.form-row');
  if(customer)customer.insertAdjacentElement('beforebegin',p);
  else form.prepend(p);
  p.addEventListener('click',e=>{
   const type=e.target.closest('[data-bps-type]');
   if(type){setType(type.dataset.bpsType);root.BitePOS?.touch?.();return;}
   const step=e.target.closest('[data-bps-step]');
   if(step){const input=$('biteServiceGuestCount'),n=Number(input.value)||1;
    input.value=String(Math.max(1,Math.min(100,n+Number(step.dataset.bpsStep))));
    input.dispatchEvent(new Event('input',{bubbles:true}));}
  });
  $('biteServiceGuestCount').addEventListener('change',e=>{
   if(e.target.value){const n=Math.floor(Number(e.target.value));if(Number.isFinite(n))e.target.value=Math.max(1,Math.min(100,n));}
  });
  return p;
 }
 function setType(type,{silent=false}={}){
  ensure();
  const valid=['dine_in','takeaway'].includes(type)?type:'dine_in';
  const chosen=valid==='dine_in'&&!options.dineInAllowed?'takeaway':valid==='takeaway'&&!options.takeawayAllowed?'dine_in':valid;
  $('biteServiceType').value=chosen;
  $('biteServiceDineFields').hidden=chosen!=='dine_in';
  if(chosen!=='dine_in')$('biteServiceTable').value='';
  for(const b of $('bitePosServicePanel').querySelectorAll('[data-bps-type]')){
   b.setAttribute('aria-pressed',String(b.dataset.bpsType===chosen));
   b.disabled=b.dataset.bpsType==='dine_in'?!options.dineInAllowed:!options.takeawayAllowed;
  }
  $('bitePosServiceHint').textContent=chosen==='dine_in'
   ?'Dine-in: save one bill for the whole group. People count is recorded once.'
   :'Takeaway: no table or dine-in people count will be recorded.';
  const channel=chosen==='dine_in'?'POS - Dine-in':'POS - Takeaway';
  if($('orderChannel'))$('orderChannel').value=channel;
  const legacy=$('bitePOSOrderType')?.querySelector('[name=bite_order_type]');
  if(legacy&&[...legacy.options].some(x=>x.value===channel)){
   legacy.value=channel;
   if(!silent)legacy.dispatchEvent(new Event('change',{bubbles:true}));
   const oldTable=$('bitePOSOrderType')?.querySelector('[name=bite_table_id]');
   if(oldTable){oldTable.value=chosen==='dine_in'&&[...oldTable.options].some(x=>x.value===$('biteServiceTable').value)?$('biteServiceTable').value:'';}
  }
 }
 function prepare({restaurantId,tables,dineInAllowed=true,takeawayAllowed=true}={}){
  const panel=ensure();if(!panel)return;
  options={restaurantId,tables:Array.isArray(tables)?tables.filter(t=>t.restaurant_id===restaurantId&&t.is_active!==false):[],dineInAllowed:!!dineInAllowed,takeawayAllowed:!!takeawayAllowed};
  const select=$('biteServiceTable');select.innerHTML='<option value="">No table assigned</option>'+options.tables.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.table_name||'Table')+'</option>').join('');
  select.onchange=()=>{const old=$('bitePOSOrderType')?.querySelector('[name=bite_table_id]');if(old&&[...old.options].some(x=>x.value===select.value))old.value=select.value;root.BitePOS?.touch?.();};
  setType(options.dineInAllowed?'dine_in':'takeaway',{silent:true});
  if($('biteServiceGuestCount'))$('biteServiceGuestCount').value='1';
 }
 function syncLegacy(){if(!$('bitePosServicePanel'))return;setType($('biteServiceType').value);}
 function restore(data){
  if(!ensure())return;
  setType(data.serviceType==='takeaway'?'takeaway':'dine_in');
  const n=Number(data.guestCount);$('biteServiceGuestCount').value=Number.isInteger(n)&&n>=1&&n<=100?String(n):'1';
  const select=$('biteServiceTable'),value=String(data.serviceTableId||'');
  if([...select.options].some(x=>x.value===value))select.value=value;
  syncLegacy();
 }
 function read(){
  const type=$('biteServiceType')?.value;
  if(type!=='dine_in'&&type!=='takeaway')throw Error('Choose dine-in or takeaway');
  if(type==='dine_in'){
   const raw=String($('biteServiceGuestCount').value||''),guests=Number(raw);
   if(!/^[0-9]+$/.test(raw)||!Number.isInteger(guests)||guests<1||guests>100)throw Error('Dine-in: enter 1–100 people');
   const tableId=$('biteServiceTable').value||null;
   if(tableId&&!options.tables.some(t=>t.id===tableId))throw Error('Choose a valid table for this restaurant');
   return {serviceType:type,guestCount:guests,tableId,channel:'POS - Dine-in'};
  }
  return {serviceType:'takeaway',guestCount:null,tableId:null,channel:'POS - Takeaway'};
 }
 root.BitePOSService={prepare,setType,syncLegacy,restore,read};
})(window);
