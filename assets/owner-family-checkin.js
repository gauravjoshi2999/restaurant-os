/* Bite Family Check-in: one lead registration, many atomic room allocations.
   Existing guest-ID capture, quotes, room folios, POS and checkout remain authoritative. */
(function(root){
 'use strict';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2,minimumFractionDigits:2});
 const fail=(field,message)=>Object.assign(Error(message),{field});
 const today=()=>root.BiteOwner?.day?.()||new Date().toISOString().slice(0,10);
 const formData=form=>new FormData(form);
 const selectedIDs=form=>formData(form).getAll('family_room_ids').map(String);
 const prop=()=>root.BiteHospitality?.prop?.();
 function canUse(form){return !!(form&&!form.dataset.stayId&&prop()?.business_type!=='restaurant');}
 function totalPeople(form){
  const regular=['male','female','children'].reduce((sum,key)=>sum+Number(form.elements[key]?.value||0),0);
  if(!form?.elements?.family_enabled?.checked)return regular;
  return regular+selectedIDs(form).reduce((sum,id)=>sum+Number(form.elements['family_adults_'+id]?.value||0)+Number(form.elements['family_children_'+id]?.value||0),0);
 }
 function decorate(form,draft={},workspace={}){
  if(!canUse(form)||form.querySelector('#biteFamilyRooms'))return;
  const rooms=(workspace.rooms||[]).filter(r=>r.active&&r.housekeeping!=='blocked');
  let previous=[];
  try{const saved=JSON.parse(draft.family_selected||'[]');if(Array.isArray(saved))previous=saved.map(String)}catch{}
  const enabled=draft.family_enabled==='on';
  const holder=root.document.createElement('section');
  holder.id='biteFamilyRooms';holder.className='bf-family';
  holder.innerHTML='<label class="bf-family-toggle"><input name="family_enabled" type="checkbox" '+(enabled?'checked':'')+'><span><strong>Family / Multiple Rooms</strong><small>One family, several rooms · linked bills and one checkout summary</small></span></label>'+
   '<div class="bf-family-body" data-family-fields '+(enabled?'':'hidden')+'>'+
   '<label class="bh-field"><span>Booking / family name</span><input name="family_name" maxlength="120" value="'+esc(draft.family_name||'')+'" placeholder="e.g. Sharma family"></label>'+
   '<p class="bf-family-note">First choose the lead room above. Add other rooms below. Each room will keep a separate GST/guest bill; the combined statement summarizes them without doubling food or payments.</p>'+
   '<div data-family-choices>'+rooms.map(r=>{
    const id=String(r.id),checked=previous.includes(id),capAdults=Math.min(20,Math.max(1,Number(r.adults)||20)),capChildren=Math.min(20,Math.max(0,Number(r.children??20)));
    return '<div class="bf-room" data-family-room="'+esc(id)+'"><label class="bf-room-switch"><input type="checkbox" name="family_room_ids" value="'+esc(id)+'" '+(checked?'checked':'')+'><span><strong>Room '+esc(r.number)+'</strong><small>'+esc(r.room_type||'Room')+' · '+money(r.nightly_rate)+'/night</small></span></label>'+
     '<div class="bf-room-fields" '+(checked?'':'hidden')+'><label>Adults<input name="family_adults_'+esc(id)+'" type="number" min="1" max="'+capAdults+'" step="1" value="'+esc(draft['family_adults_'+id]||1)+'"></label>'+
     '<label>Women (included in adults)<input name="family_female_'+esc(id)+'" type="number" min="0" max="'+capAdults+'" step="1" value="'+esc(draft['family_female_'+id]||0)+'"></label>'+ 
     '<label>Children<input name="family_children_'+esc(id)+'" type="number" min="0" max="'+capChildren+'" step="1" value="'+esc(draft['family_children_'+id]||0)+'"></label>'+
     '<label>Rate / night (₹)<input name="family_rate_'+esc(id)+'" type="number" min="0" step=".01" value="'+esc(draft['family_rate_'+id]??r.nightly_rate)+'" inputmode="decimal"></label>'+
     '<label class="bf-room-name">Guests staying in this room (optional)<input name="family_note_'+esc(id)+'" type="text" maxlength="120" value="'+esc(draft['family_note_'+id]||'')+'" placeholder="e.g. Parents and children"></label></div>'+
     '<p class="bf-room-status" data-family-room-status></p></div>';
   }).join('')+'</div><p class="bf-family-totals" data-family-total aria-live="polite"></p>'+
   '<p class="bf-family-note">Before Check in now, verify 2 guest IDs for this family (front and back). More IDs are optional. Any advance entered here is allocated once across the room folios. Food can be charged to the selected room from Restaurant POS; the combined statement includes each linked room bill once.</p></div>';
  const mode=form.elements.mode;
  mode?.closest('label')?.before(holder);
  const update=()=>{
   const on=form.elements.family_enabled.checked;
   holder.querySelector('[data-family-fields]').hidden=!on;
   const primary=form.elements.room_id.value,arrival=form.elements.arrival.value,departure=form.elements.departure.value;
   const d=workspace.stays||[],guard=root.BiteCheckinGuard?.roomAvailability,checkoutMode=form.elements.mode.value;
   let count=1,base=Number(form.elements.nightly_rate?.value??rooms.find(r=>String(r.id)===primary)?.nightly_rate??0),adult=Number(form.elements.male?.value||0)+Number(form.elements.female?.value||0)||Number(form.elements.adults?.value||0),children=Number(form.elements.children?.value||0);
   for(const row of holder.querySelectorAll('[data-family-room]')){
    const id=row.dataset.familyRoom,room=rooms.find(x=>String(x.id)===id),box=row.querySelector('input[type=checkbox]'),fields=row.querySelector('.bf-room-fields');
    const reason=id===primary?'Lead room already selected':(guard&&arrival&&departure?guard(room,d,arrival,departure,checkoutMode,'',today(),{...prop(),housekeeping_enabled:root.BiteHospitality?.housekeepingVisible?.()}):'');
    const unavailable=!!reason;
    if(unavailable&&box.checked)box.checked=false;
    box.disabled=unavailable;row.querySelector('[data-family-room-status]').textContent=reason||'';
    fields.hidden=!box.checked;
    if(on&&box.checked){count++;base+=Number(form.elements['family_rate_'+id]?.value||0);adult+=Number(form.elements['family_adults_'+id]?.value||0);children+=Number(form.elements['family_children_'+id]?.value||0);}
   }
   const nights=Math.max(0,Math.round((Date.parse(departure)-Date.parse(arrival))/86400000)||0);
   holder.querySelector('[data-family-total]').textContent=on?count+' rooms · '+adult+' adults · '+children+' children · '+(adult+children)+' guests · Estimated room rent '+money(base*nights)+(nights>0?' for '+nights+' night(s)':'')+' (tax/fees shown at review)':'';
   if(form.elements.additional_ids&&form.querySelector('[data-ha-id-card]'))root.BiteCheckinFlow?.sync?.(form);
  };
  holder.addEventListener('change',e=>{
   update();form.dataset.reviewed='';form.querySelector('.bh-review')?.remove();
   if(e.target?.name?.startsWith('family_'))root.BiteHospitality?.persistRegistration?.(form);
  });
  holder.addEventListener('input',e=>{
   if(e.target?.name?.startsWith('family_')){update();form.dataset.reviewed='';form.querySelector('.bh-review')?.remove();}
  });
  for(const key of ['room_id','arrival','departure','mode','male','female','children','nightly_rate']){
   form.elements[key]?.addEventListener('change',update);
  }
  update();
 }
 function saveDraft(form,fields){
  if(form?.elements?.family_enabled?.checked){
   fields.family_selected=JSON.stringify(selectedIDs(form));
   fields.family_enabled='on';
  }else{
   fields.family_selected='[]';fields.family_enabled='';
  }
 }
 function plan(form,f,workspace){
  if(!form.elements.family_enabled?.checked)return null;
  if(form.dataset.stayId)throw fail('room_id','A saved single-room stay cannot be changed into a new group. Start a fresh family check-in.');
  const selected=selectedIDs(form),roomById=new Map((workspace.rooms||[]).map(r=>[String(r.id),r]));
  if(!f.room_id)throw fail('room_id','Choose the lead room first.');
  if(!selected.length)throw fail('family_room_ids','Select at least one additional room.');
  if(selected.length>14)throw fail('family_room_ids','Maximum 15 rooms can share one booking.');
  if(new Set([f.room_id,...selected]).size!==selected.length+1)throw fail('family_room_ids','Each room can appear only once.');
  const names=[f.full_name,f.family_name].filter(Boolean);
  const name=String(f.family_name||names[0]+' family').trim().slice(0,120);
  const rows=[{room_id:f.room_id,adults:Number(f.male||0)+Number(f.female||0)||Number(f.adults||0),children:Number(f.children||0),nightly_rate:Number(f.nightly_rate??roomById.get(f.room_id)?.nightly_rate),note:'Lead guest: '+f.full_name}];
  for(const id of selected){
   const room=roomById.get(id);
   if(!room||!room.active||room.housekeeping==='blocked')throw fail('family_room_ids','A selected room is unavailable. Refresh rooms.');
   const guard=root.BiteCheckinGuard?.roomAvailability;
   const reason=guard?.(room,workspace.stays||[],f.arrival,f.departure,f.mode,'',today(),{...prop(),housekeeping_enabled:root.BiteHospitality?.housekeepingVisible?.()});
   if(reason)throw fail('family_room_ids','A selected room is unavailable: '+reason+'. Refresh rooms.');
   const readNumber=key=>{const value=form.elements[key+'_'+id]?.value;return typeof value==='string'&&value.trim()!==''?Number(value):NaN;};
   const adults=readNumber('family_adults'),children=readNumber('family_children'),rate=readNumber('family_rate');
   if(!Number.isInteger(adults)||adults<1||adults>Number(room.adults??20))throw fail('family_adults_'+id,'Check the adult occupancy limit.');
   if(!Number.isInteger(children)||children<0||children>Number(room.children??20))throw fail('family_children_'+id,'Check the child occupancy limit.');
   if(!Number.isFinite(rate)||rate<0||rate>9999999999.99||Math.abs(Math.round(rate*100)-rate*100)>0.000001)throw fail('family_rate_'+id,'Enter a valid room rate with two decimal places.');
   const female=readNumber('family_female');
   if(!Number.isInteger(female)||female<0||female>adults)throw fail('family_female_'+id,'Women count cannot exceed adult guests.');
   rows.push({room_id:id,adults,children,female,nightly_rate:rate,note:String(form.elements['family_note_'+id]?.value||'').trim().slice(0,120)});
  }
  const adults=rows.reduce((n,r)=>n+r.adults,0),people=rows.reduce((n,r)=>n+r.adults+r.children,0);
  if(people>40)throw fail('family_room_ids','For groups above 40 people, make separate registered bookings.');
  if(f.mode==='checkin'){
   const copies=form.querySelectorAll('[data-ha-party-list] [data-ha-id-card]').length;
   if(copies<Math.min(2,adults)-1)throw fail('family_room_ids','This family needs 2 guest IDs in total. Add one additional guest ID; further IDs are optional.');
  }
  return {name,mode:f.mode,arrival:f.arrival,departure:f.departure,arrival_time:f.arrival_time||'',
   booking_source:f.booking_source||'walk_in',booking_reference:f.booking_reference||'',advance_amount:Number(f.advance_amount||0),advance_method:f.advance_method||'Cash',advance_reference:f.advance_reference||'',advance_account:f.advance_account||'',advance_verified:f.advance_verified==='on',rooms:rows};
 }

 // Guest-ID photos are uploaded once to the lead's protected guest-document profile.
 // Each room gets its own register entry, the verified payer ID, the correct
 // male/female counts, and a bounded subset of additional guest IDs.
 // Full family IDs remain referenced in the first register's private snapshot.
 function withRoomRegistrations(payload){
  if(!payload?.registration||!Array.isArray(payload.rooms))return payload;
  const reg=payload.registration,party=Array.isArray(reg.additional_ids)?reg.additional_ids:[];
  let cursor=0;
  const rows=payload.rooms.map((room,index)=>{
   const adult=Number(room.adults||0),capacity=adult+Number(room.children||0);
   const take=Math.max(0,Math.min(capacity-1,party.length-cursor));
   const roomPeople=party.slice(cursor,cursor+take);cursor+=take;
   const women=index===0?Number(reg.female||0):Number(room.female||0);
   const roomReg={...reg,male:adult-women,female:women,children:Number(room.children||0),
    additional_ids:roomPeople,
    guest_snapshot:{...reg.guest_snapshot,room_occupants:room.note||''},
    room_occupants:room.note||'',
    ...(index===0?{family_guest_ids:party}:{}),
   };
   return {...room,registration:roomReg};
  });
  return {...payload,rooms:rows,registration:undefined};
 }
 function canonical(value){return JSON.stringify((function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x})(value));}
 async function commit(payload,propertyId,identity,sb){
  if(root.navigator?.onLine===false)throw Error('Offline. Family draft is saved; no rooms were reserved. Reconnect and retry.');
  const key='bite_family_request:'+identity;
  const signature=canonical(withRoomRegistrations(payload));
  let attempt;
  try{attempt=JSON.parse(root.localStorage.getItem(key)||'null')}catch{throw Error('Saved family request unreadable. Do not repeat booking; contact support.')}
  if(attempt&&attempt.signature!==signature)throw Error('Earlier family booking confirmation is pending. Resume the same guest/rooms before changing details.');
  if(!attempt){attempt={id:root.crypto.randomUUID(),signature};
   root.localStorage.setItem(key,JSON.stringify(attempt));}
  const request=withRoomRegistrations(payload);
  const result=await sb.rpc('bite_family_booking',{p_property:propertyId,p_payload:request,p_request:attempt.id});
  if(result.error){
   if(['P0001','42501','P0002'].includes(result.error.code)||/^(22|23)/.test(result.error.code||''))root.localStorage.removeItem(key);
   throw Error(result.error.message||'Family booking was not confirmed. Retry the same details.');
  }
  return {booking:result.data,requestKey:key};
 }
 function clearAttempt(key){if(key)root.localStorage?.removeItem(key);}
 const api={decorate,saveDraft,plan,commit,clearAttempt,totalPeople,canonical,withRoomRegistrations};
 root.BiteFamilyCheckin=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
