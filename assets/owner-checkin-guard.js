/* Check-in availability, explicit draft decisions and foreign guest details. */
(function(root){
 'use strict';
 const H=()=>root.BiteHospitality,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fail=(field,message)=>Object.assign(Error(message),{field});
 const domestic=value=>['india','indian','bharat','भारत'].includes(String(value||'India').trim().toLowerCase());
 const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
 function draftState(raw,stays,now=Date.now()){
  if(!raw||!raw.fields||typeof raw.fields!=='object'||Array.isArray(raw.fields)||!Number.isFinite(raw.savedAt)||now-raw.savedAt>=86400000||now<raw.savedAt)return{kind:'none'};
  const f=raw.fields;if(!f.stay_id)return{kind:'draft',fields:f};
  const stay=stays.find(s=>s.id===f.stay_id);
  return stay?.status==='reserved'?{kind:'reserved',fields:f}:{kind:'stale',fields:f,stay};
 }
 function roomAvailability(room,stays,arrival,departure,mode='checkin',ignore='',today=root.BiteOwner.day(),property={}){
  if(!room.active)return'Inactive';if(room.housekeeping==='blocked')return'Unavailable';
  if(!validDate(arrival)||!validDate(departure)||departure<=arrival)return'Choose valid dates';
  const active=stays.filter(s=>s.room_id===room.id&&s.id!==ignore&&['reserved','in_house'].includes(s.status));
  if(mode==='checkin'&&active.some(s=>s.status==='in_house'))return'Occupied';
  if(active.some(s=>s.arrival<departure&&arrival<s.departure))return'Reserved for these dates';
  if(mode==='checkin'&&arrival>today)return'Choose Reserve for a future date';
  if(mode==='checkin'&&property.housekeeping_enabled!==false&&room.housekeeping!=='ready')return'Not released for check-in';
  const start=Date.parse(arrival+'T'+String(property.checkin_time||'12:00').slice(0,5)+':00+05:30'),end=Date.parse(departure+'T'+String(property.checkout_time||'11:00').slice(0,5)+':00+05:30');
  const turnover=Number(property.hotel_policy?.turnover_minutes??30)*60000;
  if(active.some(s=>s.departure===arrival&&s.expected_checkout_at&&Date.parse(s.expected_checkout_at)+turnover>start||s.arrival===departure&&s.scheduled_arrival_at&&end+turnover>Date.parse(s.scheduled_arrival_at)))return'Arrival / checkout timing conflict';
  return'';
 }
 function rooms(form){
  if(!form?.isConnected||!form.elements.room_id)return;
  const db=H().getWorkspace(),p={...H().prop(),housekeeping_enabled:H().housekeepingVisible()},picker=form.elements.room_id,selected=picker.value;
  if(!validDate(form.elements.arrival.value)||!validDate(form.elements.departure.value)||form.elements.departure.value<=form.elements.arrival.value){const info=form.querySelector('[data-room-availability]');if(info)info.textContent='Choose a checkout date after arrival to check rooms.';return}
  const choices=(db.rooms||[]).filter(r=>r.active).map(r=>({r,reason:roomAvailability(r,db.stays||[],form.elements.arrival.value,form.elements.departure.value,form.elements.mode.value,form.dataset.stayId||'',root.BiteOwner.day(),p)}));
  const available=choices.filter(x=>!x.reason).length;
  picker.innerHTML='<option value="">'+(available?'Select an available room':'No available rooms')+'</option>'+choices.map(({r,reason})=>'<option value="'+esc(r.id)+'" '+(reason?'disabled':'')+'>'+esc(r.number+' · '+(reason||r.room_type+' · Available'))+'</option>').join('');
  picker.value=choices.some(x=>x.r.id===selected&&!x.reason)?selected:'';
  const info=form.querySelector('[data-room-availability]');if(info)info.textContent=available?available+' '+(available===1?'room is':'rooms are')+' available for these dates.':'No room is available for this arrival. Change dates, choose Reserve for later, or finish the earlier guest’s checkout.';
  const release=form.querySelector('[data-room-release]');if(release)release.hidden=H().housekeepingVisible()||!['owner','manager'].includes(p?.role)||!choices.some(x=>x.reason==='Not released for check-in');
  if(selected&&!picker.value){form.dataset.reviewed='';form.querySelector('.bh-review')?.remove();form.dispatchEvent(new Event('input',{bubbles:true}))}
 }
 const foreignKeys=['nationality','date_of_birth','document_type','document_last4','document_expiry','visa_status','permission_last4','visa_expiry','india_arrival','entry_port','purpose'];
 const prefix=key=>key?'party_'+key+'_foreign_':'foreign_';
 function readForeign(form,key=null){
  const pre=prefix(key);if(form.elements[pre+'enabled']?.value!=='1')return null;
  const out={};for(const k of foreignKeys)out[k]=String(form.elements[pre+k]?.value||'').trim();
  if(!key)out.nationality=form.elements.country.value.trim();
  out.document_no_expiry=out.document_type==='travel_document'&&!!form.elements[pre+'document_no_expiry']?.checked;if(out.document_no_expiry)out.document_expiry='';
  out.document_last4=out.document_last4.toUpperCase();out.permission_last4=out.permission_last4.toUpperCase();
  if(out.visa_status!=='visa')out.visa_expiry='';if(out.visa_status==='exempt')out.permission_last4='';return out;
 }
 function validateForeign(v,arrival,pre='foreign_'){
  if(!v)return;
  if(!v.nationality||domestic(v.nationality))throw fail(pre==='foreign_'?'country':pre+'nationality','Enter the foreign nationality / country.');
  if(!validDate(v.date_of_birth)||v.date_of_birth>arrival)throw fail(pre+'date_of_birth','Recheck the date of birth.');
  if(!['passport','travel_document'].includes(v.document_type))throw fail(pre+'document_type','Choose the travel document type.');
  if(!/^[A-Z0-9]{4}$/i.test(v.document_last4))throw fail(pre+'document_last4','Enter only the last 4 travel document characters.');
  if(!(v.document_type==='travel_document'&&v.document_no_expiry)&&(!validDate(v.document_expiry)||v.document_expiry<arrival))throw fail(pre+'document_expiry','The document expiry is before check-in. Recheck the current document.');
  if(!['visa','oci','exempt'].includes(v.visa_status))throw fail(pre+'visa_status','Choose visa, OCI or visa exempt.');
  if(v.visa_status!=='exempt'&&!/^[A-Z0-9]{4}$/i.test(v.permission_last4))throw fail(pre+'permission_last4','Enter the last 4 visa / OCI characters.');
  if(v.visa_status==='visa'&&(!validDate(v.visa_expiry)||v.visa_expiry<arrival))throw fail(pre+'visa_expiry','Recheck the visa / permission expiry date.');
  if(!validDate(v.india_arrival)||v.india_arrival>arrival)throw fail(pre+'india_arrival','Arrival in India must be on or before hotel check-in.');
  for(const k of ['entry_port','purpose'])if(!v[k]||v[k].length>120)throw fail(pre+k,'Enter the '+(k==='entry_port'?'place of entry into India':'purpose of visit')+'.');
 }
 const input=(n,label,type='text',value='',extra='')=>'<label class="bh-field"><span>'+esc(label)+'</span><input name="'+n+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';
 const choose=(n,label,values,value)=>'<label class="bh-field"><span>'+esc(label)+'</span><select name="'+n+'">'+values.map(([v,l])=>'<option value="'+v+'" '+(value===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label>';
 function person(form,key=null,initial=null){
  const pre=prefix(key);if(form.elements[pre+'enabled'])return;
  const extra=!!key,anchor=extra?form.querySelector('[data-ha-id-card="'+key+'"]'):form.querySelector('.ha-id-section');if(!anchor)return;
  const card=document.createElement('section');card.className='ha-foreign-card';card.dataset.foreignCard=key||'lead';
  const v=initial||{};
  card.innerHTML='<input type="hidden" name="'+pre+'enabled" value="0"><button type="button" class="btn secondary ha-foreign-toggle" aria-expanded="false">Foreign / OCI guest</button><div data-foreign-body hidden><h3>Foreign guest details</h3><button type="button" class="ha-text-button" data-indian-guest>Use Indian guest form</button><div class="bh-form-grid">'+
   (extra?input(pre+'nationality','Nationality / country *','text',v.nationality||'','maxlength="60"'): '<div data-nationality-slot></div>')+
   input(pre+'date_of_birth','Date of birth *','date',v.date_of_birth||'')+choose(pre+'document_type','Travel document',[['passport','Passport'],['travel_document','Other travel document']],v.document_type||'passport')+
   input(pre+'document_last4','Travel document · Last 4 characters *','text',v.document_last4||'','maxlength="4" autocomplete="off"')+input(pre+'document_expiry','Document expiry *','date',v.document_expiry||'')+'<label class="bh-check"><input type="checkbox" name="'+pre+'document_no_expiry" '+(v.document_no_expiry?'checked':'')+'> No expiry printed on this travel document</label>'+ 
   choose(pre+'visa_status','Permission to stay',[['visa','Visa'],['oci','OCI card'],['exempt','Visa exempt']],v.visa_status||'visa')+input(pre+'permission_last4','Visa / OCI · Last 4 characters *','text',v.permission_last4||'','maxlength="4" autocomplete="off"')+
   input(pre+'visa_expiry','Visa / permission expiry *','date',v.visa_expiry||'')+input(pre+'india_arrival','Arrival in India *','date',v.india_arrival||'')+
   input(pre+'entry_port','Place of entry into India *','text',v.entry_port||'','maxlength="120"')+input(pre+'purpose','Purpose of visit *','text',v.purpose||'','maxlength="120"')+'</div><p class="ha-foreign-note">Hotel register details only. Keep full document numbers in the private ID copies. Complete the required <a href="https://indianfrro.gov.in/frro/FormC/login.isp" target="_blank" rel="noopener">Form III reporting</a> separately; Bite does not submit it.</p></div>';
  if(extra)anchor.append(card);else anchor.before(card);
  const body=card.querySelector('[data-foreign-body]'),toggle=card.querySelector('button');
  if(!extra){const country=form.elements.country,label=country.closest('label');card.querySelector('[data-nationality-slot]').replaceWith(label);country.value=v.nationality||country.value;const oci=form.elements.is_oci;if(oci)oci.closest('label').hidden=true}
  function permission(){
   const active=form.elements[pre+'enabled'].value==='1',mode=form.elements[pre+'visa_status'].value;
   for(const name of ['permission_last4','visa_expiry']){const el=form.elements[pre+name],show=active&&(name==='permission_last4'?mode!=='exempt':mode==='visa');el.disabled=!show;el.required=show;el.closest('label').hidden=!show;if(!show)el.value=''}
   const noExpiry=form.elements[pre+'document_no_expiry'],other=form.elements[pre+'document_type'].value==='travel_document';noExpiry.disabled=!active||!other;noExpiry.required=false;noExpiry.closest('label').hidden=!active||!other;if(!other)noExpiry.checked=false;
   const expiry=form.elements[pre+'document_expiry'];expiry.disabled=!active||other&&noExpiry.checked;expiry.required=active&&!expiry.disabled;expiry.closest('label').hidden=active&&other&&noExpiry.checked;if(expiry.disabled)expiry.value='';
   if(!extra&&form.elements.is_oci)form.elements.is_oci.checked=active&&mode==='oci';
  }
  function set(on,scroll=false){
   form.elements[pre+'enabled'].value=on?'1':'0';body.hidden=!on;toggle.setAttribute('aria-expanded',String(on));toggle.textContent=on?'Foreign / OCI guest · Added':'Foreign / OCI guest';
   body.querySelectorAll('input,select').forEach(el=>{el.disabled=!on;el.required=on});
   if(!extra){const country=form.elements.country;country.disabled=false;country.required=on;if(!on)country.value='India';else if(domestic(country.value))country.value=''}
   permission();if(scroll&&on){card.scrollIntoView({block:'start',behavior:'instant'});(extra?form.elements[pre+'nationality']:form.elements.country).focus({preventScroll:true})}
   root.BiteCheckinFlow?.sync(form);
  }
  toggle.addEventListener('click',()=>{set(true,true);form.dispatchEvent(new Event('input',{bubbles:true}))});
  card.querySelector('[data-indian-guest]').addEventListener('click',()=>{set(false);form.dispatchEvent(new Event('input',{bubbles:true}))});
  for(const name of ['visa_status','document_type','document_no_expiry'])form.elements[pre+name].addEventListener('change',permission);card.__set=set;set(!!initial);
  if(form.dataset.stayId){toggle.disabled=true;body.querySelectorAll('input,select').forEach(el=>el.disabled=true)}
 }
 function selectedGuest(form,guest){
  const prior=(H().getWorkspace().stays||[]).filter(s=>s.guest_id===guest?.id&&s.registration?.foreign_details).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]?.registration.foreign_details;
  const card=form.querySelector('[data-foreign-card=lead]');if(!card)return;
  if(guest&&!domestic(guest.country)){for(const k of foreignKeys){const el=form.elements[prefix()+k];if(el)el.value=prior?.[k]||''}form.elements.country.value=guest.country;form.elements.foreign_document_type.value=prior?.document_type||'passport';form.elements.foreign_document_no_expiry.checked=!!prior?.document_no_expiry;form.elements.foreign_visa_status.value=guest.is_oci?'oci':prior?.visa_status||'visa';card.__set(true)}else{for(const k of foreignKeys){const el=form.elements[prefix()+k];if(el)el.value=k==='document_type'?'passport':k==='visa_status'?'visa':''}card.__set(false);}
 }
 function decorate(form,draft={},guest){
  let saved=null;try{saved=JSON.parse(draft.foreign_details||'null')}catch{}
  if(!saved&&draft.foreign_enabled==='1'){saved={};for(const k of foreignKeys)saved[k]=draft['foreign_'+k]||'';saved.nationality=draft.country||'';saved.document_no_expiry=draft.foreign_document_no_expiry==='on'}
  person(form,null,saved||(!domestic(guest?.country)?{nationality:guest.country,visa_status:guest.is_oci?'oci':'visa'}:null));
  let extras=[];try{extras=JSON.parse(draft.additional_ids||'[]')}catch{}for(const row of form.querySelectorAll('[data-ha-party-list] [data-ha-id-card]'))person(form,row.dataset.haIdCard,extras.find(x=>x.subject_key===row.dataset.haIdCard)?.foreign_details);
  const slot=document.createElement('div');slot.className='ha-room-feedback';slot.innerHTML='<p data-room-availability role="status"></p><button type="button" class="ha-text-button" data-refresh-rooms>Refresh rooms</button><button type="button" class="ha-text-button" data-room-release hidden>Release a vacant room</button>';
  form.elements.room_id.closest('label').after(slot);
  form.addEventListener('input',e=>{if(['arrival','departure','mode'].includes(e.target.name))rooms(form)});form.addEventListener('change',e=>{if(['arrival','departure','mode'].includes(e.target.name))rooms(form)});
  form.addEventListener('click',async e=>{
   if(e.target.closest('[data-refresh-rooms]')){const b=e.target.closest('button');b.disabled=true;try{await H().refreshRegistration(form);rooms(form)}catch(error){form.querySelector('[data-room-availability]').textContent='Rooms could not refresh. Reconnect and try again.'}finally{b.disabled=false}}
   if(e.target.closest('[data-room-release]')){
    const db=H().getWorkspace(),rows=db.rooms.filter(r=>r.active&&['dirty','cleaning'].includes(r.housekeeping)&&!db.stays.some(s=>s.room_id===r.id&&s.status==='in_house'));
    H().editor('<h2>Release a vacant room</h2><p>Mark a room available only after checking it is ready for the guest.</p>'+rows.map(r=>'<button type="button" class="btn secondary" data-hotel-action="room-release" data-id="'+esc(r.id)+'">Make room '+esc(r.number)+' available</button>').join(''));
   }
  });rooms(form);root.BiteCheckinFlow?.sync(form);
 }
 function prepare(form,f){
  if(f.mode==='checkin'&&f.arrival>root.BiteOwner.day())throw fail('arrival','For a future arrival, choose Reserve for later.');
  const db=H().getWorkspace(),room=(db.rooms||[]).find(r=>r.id===f.room_id);if(!room)throw fail('room_id','Choose an available room.');
  const reason=roomAvailability(room,db.stays||[],f.arrival,f.departure,f.mode,form.dataset.stayId||'',root.BiteOwner.day(),{...H().prop(),housekeeping_enabled:H().housekeepingVisible()});if(reason)throw fail('room_id','This room is '+reason.toLowerCase()+'. Choose another room or update the dates.');
  validateForeign(readForeign(form),f.arrival);for(const row of form.querySelectorAll('[data-ha-party-list] [data-ha-id-card]'))validateForeign(readForeign(form,row.dataset.haIdCard),f.arrival,prefix(row.dataset.haIdCard));
 }
 const api={domestic,validDate,draftState,roomAvailability,rooms,decorate,prepare,readForeign,validateForeign,person,selectedGuest};root.BiteCheckinGuard=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
