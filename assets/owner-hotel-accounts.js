/* Hotel register, clean guest bills and the shared Daily Book. Financial writes use scoped RPCs. */
(function(root){
 'use strict';
 let ctx,active=0,generation=0,report=null,reportScope='',reportVersion=0,month='',collectionFocusDay='',viewPeriod=null;
 const H=()=>root.BiteHospitality,p=()=>H()?.prop(),db=()=>H()?.getWorkspace()||{};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const field=(n,label,type='text',value='',extra='')=>'<label class="bh-field"><span>'+esc(label)+'</span><input name="'+n+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';
 const option=(v,label,selected=false)=>'<option value="'+esc(v)+'" '+(selected?'selected':'')+'>'+esc(label)+'</option>';
 const select=(n,label,values,extra='')=>'<label class="bh-field"><span>'+esc(label)+'</span><select name="'+n+'" '+extra+'>'+values+'</select></label>';
 const button=(a,label,id='',extra='')=>'<button type="button" class="btn secondary" data-ha-action="'+a+'" data-id="'+esc(id)+'" '+extra+'>'+esc(label)+'</button>';
 const check=(n,label,extra='')=>'<label class="bh-check"><input name="'+n+'" type="checkbox" '+extra+'> '+esc(label)+'</label>';
 const message=()=>'<p class="bh-message" role="status" aria-live="polite"></p>';
 const today=()=>root.BiteOwner.day(),scope=()=>ctx?.getUser()?.id+':'+p()?.id;
 const enabled=()=>db().register_version===1;
 const manager=()=>['owner','manager'].includes(p()?.role);
 const methods=()=>['Cash','UPI','Bank Transfer','Card'].map(x=>option(x,x)).join('');
 function assertScope(key,version){if(key!==scope()||version!==generation)throw Error('Account or property changed. Reopen this action.')}
 function clear(){generation++;reportVersion++;report=null;reportScope='';month='';collectionFocusDay='';viewPeriod=null;root.BiteCheckinFlow?.clear();root.BiteHotelBilling?.clear()}
 function init(context){ctx=context;root.BiteHotelBilling?.init(context);document.querySelector('#mainApp .content')?.addEventListener('click',click);document.querySelector('#mainApp .content')?.addEventListener('submit',submit)}
 const fieldError=(field,text)=>Object.assign(Error(text),{field});
 const validArrivalTime=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
 function currentArrivalTime(at=new Date(),timeZone=p()?.timezone||'Asia/Kolkata'){
  return new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at);
 }
 function clearFieldError(input){
  if(!input?.name)return;
  const label=input.type==='file'?input.closest('[data-ha-id-card]')?.querySelector('.ha-id-capture-row'):input.closest('label'),error=[...(label?.querySelectorAll('[data-ha-field-error]')||[])].find(el=>el.id==='ha-error-'+input.name);if(!error)return;
  const ids=(input.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==error.id);
  if(ids.length)input.setAttribute('aria-describedby',ids.join(' '));else input.removeAttribute('aria-describedby');
  input.removeAttribute('aria-invalid');error.remove();if(!label.querySelector('[data-ha-field-error]'))label.classList.remove('ha-invalid');
 }
 function showRegisterError(form,error){
  if(form.dataset.enhanced!=='true')return false;
  let name=error.field;
  if(!name&&error.details){try{name=JSON.parse(error.details).field}catch{}}
  const input=form.elements.namedItem(name||''),label=input?.type==='file'?input.closest('[data-ha-id-card]')?.querySelector('.ha-id-capture-row'):input?.closest?.('label');
  if(!input||input.disabled||!label||label.hidden)return false;
  root.BiteCheckinGuard?.revealField(input);clearFieldError(input);
  for(let parent=label.parentElement;parent&&parent!==form;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  const notice=document.createElement('small');notice.id='ha-error-'+input.name;notice.dataset.haFieldError='';notice.className='ha-field-error';notice.setAttribute('role','alert');notice.textContent=error.message||String(error);
  label.append(notice);label.classList.add('ha-invalid');input.setAttribute('aria-invalid','true');
  input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),notice.id].filter(Boolean).join(' '));
  const summary=form.querySelector('.bh-message');if(summary)summary.textContent='';
  const focus=input.hidden?input.closest('[data-ha-id-card]')?.querySelector('[data-id-open]'):input;if(input.hidden&&focus)focus.dataset.haFocus=input.name;
  (focus||input).focus({preventScroll:true});label.scrollIntoView({block:'center',behavior:'instant'});
  return true;
 }
 function validateRegistration(f){
  const male=Number(f.male),female=Number(f.female),children=Number(f.children);
  for(const key of ['male','female','children'])if(!Number.isInteger(Number(f[key]))||Number(f[key])<0||Number(f[key])>20)throw fieldError(key,'Enter valid male, female and child counts.');
  if(male+female<1||male+female>20)throw fieldError('male','Enter valid guest counts; at least one adult is required, with a maximum of 20 adults.');
  for(const [key,label] of [['full_name','guest name'],['address','permanent address'],['arrived_from','arrival place'],['next_destination','destination']])if(!String(f[key]||'').trim())throw fieldError(key,'Enter the '+label+'.');
  if(!/^[+\d][\d ()-]{6,19}$/.test(String(f.phone||'').trim()))throw fieldError('phone','Enter a valid mobile number.');
  if(!['Car','Bike','Bus','Train','Other'].includes(f.transport))throw fieldError('transport','Choose how the guest arrived.');
  if(['Car','Bike'].includes(f.transport)&&String(f.vehicle_number||'').trim().length<4)throw fieldError('vehicle_number','Vehicle registration number is required for a car or bike.');
  const rate=Number(f.nightly_rate);if(!String(f.nightly_rate??'').trim()||!Number.isFinite(rate)||rate<0||rate>9999999999.99||Math.abs(Math.round(rate*100)-rate*100)>0.000001)throw fieldError('nightly_rate','Enter the agreed room rent with at most two decimals.');
  return {male,female,adults:male+female,children,arrived_from:String(f.arrived_from).trim(),next_destination:String(f.next_destination).trim(),transport:f.transport,vehicle_number:['Car','Bike'].includes(f.transport)?String(f.vehicle_number).trim().toUpperCase():''};
 }
 function wireMoneyFields(form,methodName='method',noteName='account_note',verifyName='verified',refName='reference'){
  const method=form?.elements[methodName];if(!method)return;
  const update=()=>{const online=['UPI','Card','Bank Transfer'].includes(method.value);
   for(const name of [noteName,verifyName,refName]){const input=form.elements[name];if(input)input.closest('label')?.toggleAttribute('hidden',!online)}
   if(!online&&form.elements[verifyName])form.elements[verifyName].checked=false;
  };method.addEventListener('change',update);update();
 }
 function decorateRegister(form,draft={},guest){
  if(!enabled())return;
  const booking=form.querySelector('#biteRegistrationOperations');booking?.remove();
  form.dataset.enhanced='true';form.noValidate=true;
  const rooms=db().rooms||[],guests=db().guests||[];
  const roomId=draft.room_id||'',room=rooms.find(r=>r.id===roomId),saved=!!draft.id_front_id;
  form.innerHTML='<div class="ha-register-meta">'+field('serial_number','Serial number','text',db().next_register_number||1,'readonly')+field('register_date','Entry date','date',today(),'readonly')+'</div>'+
   '<h2>1 · Guest details</h2><div class="bh-form-grid ha-guest-counts">'+field('male','Male','number',draft.male??1,'required min="0" max="20" step="1"')+field('female','Female','number',draft.female??0,'required min="0" max="20" step="1"')+field('children','Children','number',draft.children??0,'required min="0" max="20" step="1"')+'</div><input type="hidden" name="adults" value="1">'+
   '<details class="ha-returning"><summary>Returning guest</summary>'+field('guest_search','Find by name or mobile','search','','data-guest-search autocomplete="off"')+select('guest_id','Use saved guest',option('','New guest')+guests.map(g=>option(g.id,g.full_name+' · '+g.phone,g.id===(guest?.id||draft.guest_id))).join(''),'data-guest-picker')+'</details>'+
   '<div class="bh-form-grid">'+field('full_name','Guest name *','text',guest?.full_name||draft.full_name||'','required maxlength="120" autocomplete="name"')+field('phone','Mobile number *','tel',guest?.phone||draft.phone||'','required minlength="7" maxlength="20" autocomplete="tel"')+
   field('address','Permanent address *','text',guest?.address||draft.address||'','required maxlength="500" autocomplete="street-address"')+field('arrived_from','Arriving from *','text',draft.arrived_from||'','required maxlength="120"')+field('next_destination','Next destination *','text',draft.next_destination||'','required maxlength="120"')+
   select('transport','Arrived by *',['Car','Bike','Bus','Train','Other'].map(x=>option(x,x,x===(draft.transport||'Bus'))).join(''),'required')+
   field('vehicle_number','Vehicle registration number *','text',draft.vehicle_number||'','maxlength="30" data-ha-vehicle')+'</div>'+
   '<div class="ha-id-section"><h3>Guest ID</h3><div class="bh-form-grid"><label class="bh-field"><span>ID front — Required</span><input type="file" name="id_front" accept="image/jpeg,image/png,application/pdf" '+(saved?'':'required')+'><small data-front-status>'+esc(saved?'Previously saved front will be checked again.':'Take a clear photo or choose a file · Up to 4 MB')+'</small></label><label class="bh-field"><span>ID back — Optional, if available</span><input type="file" name="id_back" accept="image/jpeg,image/png,application/pdf"><small>JPEG, PNG or PDF · Up to 4 MB</small></label></div>'+
   '<input type="hidden" name="id_front_id" value="'+esc(draft.id_front_id||'')+'"><input type="hidden" name="id_back_id" value="'+esc(draft.id_back_id||'')+'">'+
   check('id_checked','I checked that the ID copy is necessary and masked where required.','required')+'<p class="bh-note">ID copies are private to authorized property staff and are excluded from bills.</p></div>'+
   '<details><summary>Additional guest details</summary><div class="bh-form-grid">'+field('country','Nationality / country','text',guest?.country||draft.country||'India','required maxlength="60"')+field('email','Email · Optional','email',guest?.email||draft.email||'','maxlength="120"')+field('id_type','ID type','text',guest?.id_type||draft.id_type||'','maxlength="40"')+field('id_last4','Last 4 ID characters only','text',guest?.id_last4||draft.id_last4||'','maxlength="4" autocomplete="off"')+field('compliance_note','Arrival note · Optional','text',draft.compliance_note||'','maxlength="250"')+'</div></details>'+
   '<h2>2 · Room allocation</h2><div class="ha-arrival-fields">'+field('arrival','Check-in date *','date',draft.arrival||today(),'required')+field('arrival_time','Arrival time *','time',draft.arrival_time??currentArrivalTime(),'required step="60"')+'</div><div class="bh-form-grid">'+field('departure','Expected checkout *','date',draft.departure||root.BiteOwner.day(new Date(Date.now()+86400000)),'required')+
   select('room_id','Room number *',option('','Select a room')+rooms.filter(r=>r.active&&r.housekeeping!=='blocked').map(r=>option(r.id,r.number+' · '+r.room_type,r.id===roomId)).join(''),'required')+
   field('nightly_rate','Agreed room rent / night (₹) *','number',draft.nightly_rate??'','required min="0" step="0.01" inputmode="decimal" placeholder="Enter this guest’s agreed rent"')+'</div>'+
   select('mode','Arrival',option('checkin','Check in now',draft.mode!=='reserve')+option('reserve','Reserve for later',draft.mode==='reserve'))+
   '<input type="hidden" name="upload_requests" value="'+esc(draft.upload_requests||'{}')+'"><div data-ha-booking></div>'+message()+'<div class="bh-form-actions">'+button('draft','Save draft')+'<button type="submit" class="btn">Review check-in</button></div>';
  if(booking){
   booking.querySelector('h3').textContent='3 · Advance payment · Optional';
   booking.insertAdjacentHTML('beforeend',field('advance_account','Online account · Short note','text',draft.advance_account||p().tax_profile?.primary_account||'','maxlength="80" placeholder="Owner account / second account"'));
   form.querySelector('[data-ha-booking]').append(booking);
   wireMoneyFields(form,'advance_method','advance_account','advance_verified','advance_reference');
  }
  function counts(){form.elements.adults.value=Number(form.elements.male.value||0)+Number(form.elements.female.value||0)}
  function vehicle(){const yes=['Car','Bike'].includes(form.elements.transport.value);const input=form.elements.vehicle_number;input.required=yes;input.closest('label').hidden=!yes}
  counts();vehicle();
  const clearEditedError=event=>{
   clearFieldError(event.target);
   if(['arrival','departure'].includes(event.target.name)&&form.elements.departure.value>form.elements.arrival.value)clearFieldError(form.elements.departure);
  };
  form.addEventListener('input',clearEditedError);form.addEventListener('change',clearEditedError);
  form.addEventListener('input',counts);
  form.elements.transport.addEventListener('change',vehicle);
  form.elements.guest_id.addEventListener('change',()=>{
   form.__haGuestVersion=(form.__haGuestVersion||0)+1;form.__haIdTouched=new Set();
   for(const side of ['front','back']){form.elements['id_'+side].value='';form.elements['id_'+side+'_id'].value=''}
   form.elements.id_front.required=true;form.elements.id_back.required=true;form.elements.id_checked.checked=false;
  });
  async function loadSavedIDs(){
   const guestId=form.elements.guest_id.value,key=scope(),version=generation,selection=form.__haGuestVersion;if(!guestId)return;
   const status=form.querySelector('[data-saved-id-status]');if(status)status.textContent='Checking saved ID photos…';
   try{
    const result=await ctx.sb.rpc('bite_guest_document_list',{p_property:p().id,p_guest:guestId});
    assertScope(key,version);if(!form.isConnected||form.elements.guest_id.value!==guestId||form.__haGuestVersion!==selection)return;if(result.error)throw result.error;
    const ready=(result.data||[]).filter(d=>d.status==='ready'&&d.kind==='masked_id');
    root.BiteCheckinFlow?.reuseDocuments(form,guestId,ready);form.dispatchEvent(new Event('input',{bubbles:true}));
   }catch(e){if(key!==scope()||version!==generation||!form.isConnected||form.elements.guest_id.value!==guestId||form.__haGuestVersion!==selection)return;if(status)status.innerHTML='Saved ID photos could not load. <button type="button" class="ha-text-button" data-retry-saved-ids>Retry saved IDs</button> or take new photos.';}
  }
  form.elements.guest_id.addEventListener('change',()=>void loadSavedIDs());
  form.addEventListener('click',e=>{if(e.target.closest('[data-retry-saved-ids]'))void loadSavedIDs()});
  if(draft.stay_id){for(const key of ['male','female','transport','vehicle_number','arrived_from','next_destination','id_front','id_back','nightly_rate'])form.elements[key].disabled=true;form.elements.id_checked.required=false}
  root.BiteCheckinFlow?.decorate(form,draft);
  root.BiteCheckinGuard?.decorate(form,draft,guest);
  root.BiteHotelBilling?.decorateRegister(form,draft);
 }
 function prepareRegister(form,f){
  if(form.dataset.enhanced!=='true')return;
  for(const input of form.elements)clearFieldError(input);
  // Native constraints still apply; explicit validation lets us reveal details and place errors inline.
  for(const input of form.elements)if(input.willValidate&&!input.validity.valid)throw fieldError(input.name,input.validationMessage||'Complete this field to continue.');
  if(!validArrivalTime(f.arrival_time))throw fieldError('arrival_time','Enter a valid arrival time.');
  if(f.departure<=f.arrival)throw fieldError('departure','Departure must be after arrival.');
  root.BiteCheckinFlow?.prepare(form);
  root.BiteCheckinGuard?.prepare(form,f);
  if(!form.dataset.stayId){
   const r=validateRegistration(f);f.adults=r.adults;form.elements.adults.value=r.adults;
   if(!form.elements.id_front.files[0]&&!form.elements.id_front_id.value)throw fieldError('id_front','Upload the ID front to continue.');
   if(!form.elements.id_checked.checked)throw fieldError('id_checked','Check the guest ID before continuing.');
   if(f.booking_source==='external_booking'&&!String(f.booking_reference||'').trim())throw fieldError('booking_reference','Enter the external booking reference.');
   if(Number(f.advance_amount)>0&&['UPI','Card','Bank Transfer'].includes(f.advance_method)&&f.advance_verified==='on'&&!String(f.advance_reference||'').trim())throw fieldError('advance_reference','Enter the bank or receipt reference for the verified advance.');
  }
 }
 async function saveDocuments(guest,form){
  if(form.dataset.enhanced!=='true')return null;
  const key=scope(),version=generation,out={};active++;
  try{
   const subjects=root.BiteCheckinFlow?.subjects(form)||[{key:null,names:{front:'id_front',back:'id_back',frontId:'id_front_id',backId:'id_back_id'}}];
   for(const subject of subjects)for(const side of ['front','back']){
    const name=subject.names[side],input=form.elements[name],hidden=form.elements[subject.names[side+'Id']],original=input.files[0];
    if(!original){if(!subject.key)out['id_'+side]=hidden.value||null;continue}
    let file;try{file=await root.BiteGuestDocuments.prepare(original)}catch(error){throw fieldError(name,error.message||String(error))}assertScope(key,version);
    const hash=[...new Uint8Array(await root.crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');assertScope(key,version);
    let requests={};try{requests=JSON.parse(form.elements.upload_requests.value||'{}')}catch{}
    const prior=requests[name],id=prior?.guest===guest&&prior?.sha256===hash?prior.id:root.crypto.randomUUID();
    requests[name]={id,guest,sha256:hash};form.elements.upload_requests.value=JSON.stringify(requests);H().persistRegistration(form);
    async function doc(action,details={}){
     const r=await ctx.sb.rpc('bite_guest_document_command',{p_property:p().id,p_guest:guest,p_document:id,p_action:action,p_details:details});assertScope(key,version);if(r.error)throw fieldError(name,r.error.message||'ID copy could not be saved. Reconnect and retry the same photo.');return r.data;
    }
    const record=await doc('begin',{kind:'masked_id',mime_type:file.type,byte_size:file.size,redacted_confirmed:form.elements.id_checked.checked,...(subject.key?{subject_key:subject.key}:{})});
    if(record.status!=='ready'){
     const upload=await ctx.sb.storage.from('bite-guest-documents').upload(record.object_path,file,{contentType:file.type,cacheControl:'0',upsert:false});
     assertScope(key,version);
     try{await doc('finish')}catch(e){throw fieldError(name,upload.error?.message||e.message||'ID copy could not be confirmed. Retry the same photo.')}
    }
    hidden.value=id;if(!subject.key)out['id_'+side]=id;root.BiteCheckinFlow?.sync(form);H().persistRegistration(form);
   }
   root.BiteCheckinFlow?.sync(form);out.additional_ids=root.BiteCheckinFlow?.additional(form)||[];
   if(!out.id_front||!out.id_back)throw Error('Both ID front and back are required.');return out;
  }finally{active--}
 }
 function registration(form,f,docs){
  if(form.dataset.enhanced!=='true'||form.dataset.stayId)return {};
  const r=validateRegistration(f),foreign=root.BiteCheckinGuard?.readForeign(form);return {terms_at_checkin:true,arrival_time:f.arrival_time,nightly_rate:Number(f.nightly_rate),advance_account:f.advance_account||'',...(f.booking_stay_id?{booking_stay_id:f.booking_stay_id}:{}),registration:{...r,...docs,guest_snapshot:Object.fromEntries(['full_name','phone','address','country','email','id_type','id_last4'].map(k=>[k,String(f[k]||'').trim()])),flow_version:3,...(foreign?{foreign_details:foreign}:{})}};
 }
 function decorateFolio(target,folio,stay){
  if(!enabled())return;
  target.querySelector('h1').textContent='Guest Khata';
  const actions=target.querySelector('.bh-guest-bill-buttons');
  if(folio.status==='open'&&['owner','manager','receptionist'].includes(p()?.role)){
   if(H().has('hotel_incidentals'))actions?.insertAdjacentHTML('beforeend',button('extra','＋ Add extra charge',folio.id));
   const old=target.querySelector('[data-hotel-action="checkout"]');
   if(old){old.remove();actions?.insertAdjacentHTML('beforeend',button('checkout','Checkout & collect balance',folio.id))}
  }
  root.BiteHotelBilling?.decorateFolio(target,folio,stay);
  if(stay?.register_number)target.querySelector('.bh-stay-dates')?.insertAdjacentHTML('beforeend',' · Register #'+esc(stay.register_number));
  if(stay?.arrival_time)target.querySelector('.bh-stay-dates')?.insertAdjacentHTML('beforeend',' · Arrival '+esc(String(stay.arrival_time).slice(0,5)));
 }
 function decoratePayment(form){
  if(!enabled()||!form||(!form.elements.method&&form.dataset.action!=='payment_confirm')||form.elements.account_note)return;
  form.querySelector('.bh-actions')?.insertAdjacentHTML('beforebegin',field('account_note','Online account · Short note','text',p()?.tax_profile?.primary_account||'','maxlength="80" placeholder="Owner account / second account"'));
  wireMoneyFields(form);
 }
 function billToolbar(){const back=new URL('./index.html',root.location?.href||'https://gauravjoshi2999.github.io/restaurant-os/index.html').href;return '<nav class="bill-toolbar"><a href="'+esc(back)+'" onclick="window.close();return true">← Back to Partner</a><button onclick="window.print()">Print / Save PDF</button></nav>'}
 function billTaxGroups(entries){const map=new Map();for(const e of entries){const category=e.category||'incidental',rate=Number(e.tax_rate??(Number(e.amount)>0?Number(e.tax_amount||0)*100/Number(e.amount):0)),key=category+':'+rate,sign=['discount','reversal'].includes(e.kind)?-1:1;const group=map.get(key)||{category,rate,taxable:0,tax:0,sac:category==='room'?'996311':category==='food'?'996331':''};group.taxable+=sign*Number(e.amount);group.tax+=sign*Number(e.tax_amount||0);map.set(key,group)}return [...map.values()].map(g=>({...g,cgst:Math.round(g.tax*50)/100,sgst:Math.round((g.tax-Math.round(g.tax*50)/100)*100)/100}))}
 function combinedBillHTML(snapshots){const bills=snapshots.map(billHTML),template=bills[0]||billHTML({}),head=template.slice(0,template.indexOf('<body>')+6);return head+billToolbar()+'<h1>'+esc(snapshots[0]?.property?.name)+'</h1><h2>Booking statement · '+snapshots.length+' rooms</h2><p>Individual room invoices are attached below.</p><table><tr><th>Room / Bill</th><th>Total</th></tr>'+snapshots.map(s=>'<tr><td>Room '+esc(s.room?.number)+' · '+esc(s.number)+'</td><td>'+money(s.totals?.charges)+'</td></tr>').join('')+'<tr><th>Combined total</th><th>'+money(snapshots.reduce((n,s)=>n+Number(s.totals?.charges||0),0))+'</th></tr><tr><th>Balance due</th><th>'+money(snapshots.reduce((n,s)=>n+Number(s.totals?.balance||0),0))+'</th></tr></table>'+bills.map(h=>'<article class="invoice-page">'+h.split('<body>')[1].split('</body>')[0].replace(/<nav class="bill-toolbar">[\s\S]*?<\/nav>/,'')+'</article>').join('')+'</body></html>'}
 function billHTML(s){
  const entries=(s.entries||[]).filter(e=>e.status==='confirmed'&&['charge','discount','reversal'].includes(e.kind));
  const lines=cat=>entries.filter(e=>(cat==='extras'?!['room','food'].includes(e.category):e.category===cat)).map(e=>{
   const sign=['discount','reversal'].includes(e.kind)?-1:1;
   const description=e.category==='food'?'Restaurant food':e.category==='room'&&e.service_from&&e.service_to?Math.round((new Date(e.service_to)-new Date(e.service_from))/86400000)+' night(s) · Room '+(s.room?.number||''):e.description;
   return '<tr><td>'+esc(description)+(e.source_items||[]).map(i=>'<br><small>'+esc(i.quantity)+' × '+esc(i.name)+' @ '+money(i.unit_price)+'</small>').join('')+'</td><td>'+money(sign*Number(e.amount))+'</td></tr>';
  }).join('');
  const groups=s.gst||billTaxGroups(entries);
  const tax=groups.length?groups.reduce((n,g)=>n+Number(g.cgst)+Number(g.sgst),0):entries.reduce((n,e)=>n+(['discount','reversal'].includes(e.kind)?-1:1)*Number(e.tax_amount||0),0);
  const draft=String(s.number||'').startsWith('DRAFT'),registered=!!s.tax_profile?.gstin&&s.tax_profile?.reviewed;
  const section=(title,body)=>body?'<h3>'+title+'</h3><table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>'+body+'</tbody></table>':'';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+esc(s.number)+'</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:800px;margin:32px auto;padding:0 20px;color:#202020}h1{margin-bottom:4px;font-size:28px;line-height:1.2}.bill-toolbar{display:flex;gap:10px;position:sticky;top:0;background:#fff;padding:12px 0;border-bottom:1px solid #ddd;z-index:2}.bill-toolbar a{padding:10px 14px;border:1px solid #e2b78e;border-radius:10px;color:#753c18;text-decoration:none;font-weight:700}.invoice-page{break-after:page}h2,h3{margin-top:22px}table{width:100%;border-collapse:collapse;margin:10px 0 18px}th,td{padding:9px 2px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top}th:last-child,td:last-child{text-align:right;white-space:nowrap}small{color:#555}.totals{margin-left:auto;max-width:360px}.sign{margin-top:45px;text-align:right}button{padding:12px 20px}@media print{button,.bill-toolbar{display:none}body{margin:0;max-width:none}tr{break-inside:avoid}}@page{size:A4;margin:16mm}</style></head><body>'+billToolbar()+'<h1>'+esc(s.property?.name)+'</h1><div>'+esc(s.property?.address||'')+'<br>'+esc(s.property?.phone||'')+(registered?'<br>GSTIN: '+esc(s.tax_profile.gstin):'')+'</div><h2>'+(draft?'Bill estimate':registered?'Tax invoice':'Guest bill')+'</h2><p>Bill no. '+esc(s.number)+' · Date '+esc(s.issued_at?root.BiteOwner.day(s.issued_at):today())+'</p><p>'+esc(s.guest?.name)+'<br>'+esc(s.guest?.address||'')+'</p><p>Room '+esc(s.room?.number)+' · '+esc(s.stay?.arrival)+' to '+esc(s.stay?.departure)+'</p>'+
   section('Room rent',lines('room'))+section('Food bill',lines('food'))+section('Extra charges',lines('extras'))+
   '<table class="totals"><tbody><tr><td>Subtotal</td><td>'+money(Number(s.totals?.charges||0)-tax)+'</td></tr>'+
   (registered?'<tr><td>CGST'+(groups.length===1?' '+Number(groups[0].rate)/2+'%':'')+'</td><td>'+money(groups.length?groups.reduce((n,g)=>n+Number(g.cgst),0):Math.round(tax*50)/100)+'</td></tr><tr><td>SGST'+(groups.length===1?' '+Number(groups[0].rate)/2+'%':'')+'</td><td>'+money(groups.length?groups.reduce((n,g)=>n+Number(g.sgst),0):tax-Math.round(tax*50)/100)+'</td></tr>':'')+
   '<tr><td><strong>Bill total</strong></td><td><strong>'+money(s.totals?.charges)+'</strong></td></tr><tr><td>Payments received</td><td>'+money(s.totals?.paid)+'</td></tr><tr><td><strong>Balance due</strong></td><td><strong>'+money(s.totals?.balance)+'</strong></td></tr></tbody></table>'+
   (registered&&groups.length?'<table><thead><tr><th>Service / SAC</th><th>Taxable</th><th>GST breakdown</th></tr></thead><tbody>'+groups.map(g=>'<tr><td>'+esc(({room:'Room rent',food:'Food',incidental:'Extras'})[g.category]||g.category)+'<br><small>'+esc(g.sac)+'</small></td><td>'+money(g.taxable)+'</td><td>CGST '+Number(g.rate)/2+'% · '+money(g.cgst)+'<br>SGST '+Number(g.rate)/2+'% · '+money(g.sgst)+'</td></tr>').join('')+'</tbody></table><small>Place of supply: '+esc(s.place_of_supply||String(s.tax_profile.gstin).slice(0,2))+' · Reverse charge: No</small>':'')+
   '<p class="sign">For '+esc(s.property?.name)+'<br><br>Authorized signatory</p></body></html>';
 }
 function printStatement(s){const win=root.open('','_blank');if(!win)throw Error('Allow pop-ups to print the bill.');win.opener=null;win.document.write(billHTML(s));win.document.close();return true}

 function reportRows(v){
  const heading=['Date','POS sales','Room + food bills','Other income','Total billed sales','Output GST','Net sales','Expenses / salary cost','Staff advance paid','Cash received','Cash paid','Cash closing','Online received','Online paid','Online closing','Recorded profit / loss'];
  const days=v.days||[],sum=k=>days.reduce((n,d)=>n+Number(d[k]||0),0),last=days.at(-1)||{};
  const rows=days.map(d=>[d.day,d.pos_sales,d.hotel_sales,d.other_income,d.gross_sales,d.tax,d.net_sales,d.expenses,d.staff_advance,d.cash_in,d.cash_out,d.cash_balance,d.online_in,d.online_out,d.online_balance,d.profit]);
  return [heading,...rows,['TOTAL',sum('pos_sales'),sum('hotel_sales'),sum('other_income'),sum('gross_sales'),sum('tax'),sum('net_sales'),sum('expenses'),sum('staff_advance'),sum('cash_in'),sum('cash_out'),Number(last.cash_balance||0),sum('online_in'),sum('online_out'),Number(last.online_balance||0),sum('profit')]];
 }
 function gstRows(v){
  const rows=[['Bill date','Bill number','Guest','Hotel GSTIN','Room taxable','Food taxable','Extra taxable','Total taxable','SAC codes','CGST rate(s)','CGST amount','SGST rate(s)','SGST amount','Bill total']];
  for(const bill of v.gst_invoices||[]){
   const lines=bill.tax_lines?.length?bill.tax_lines:[{category:'other',sac:'',taxable:bill.total,rate:0,cgst:0,sgst:0}];
   const sum=fn=>lines.reduce((n,g)=>n+fn(g),0),rates=[...new Set(lines.map(g=>Number(g.rate)/2+'%'))].join(' / '),sac=[...new Set(lines.map(g=>g.sac).filter(Boolean))].join(', ');
   rows.push([bill.date,bill.number,bill.guest,bill.gstin||'',sum(g=>g.category==='room'?Number(g.taxable):0),sum(g=>g.category==='food'?Number(g.taxable):0),sum(g=>!['room','food'].includes(g.category)?Number(g.taxable):0),sum(g=>Number(g.taxable)),sac,rates,sum(g=>Number(g.cgst)),rates,sum(g=>Number(g.sgst)),Number(bill.total)]);
  }
  const total=Array(14).fill('');total[0]='TOTAL';for(const i of [4,5,6,7,10,12,13])total[i]=rows.slice(1).reduce((n,row)=>n+Number(row[i]||0),0);
  return [...rows,total];
 }
 // H02/H03 read-only Home metrics, served by the existing authorized Daily Book.
 // Do not treat cash opening balances, transfers, refundable security holds,
 // or pending UPI collections as customer revenue/receipts.
 async function reportOwnerHomeDay(day){
  const property=p(),user=ctx?.getUser?.(),key=scope(),version=generation;
  if(!property?.id||!user?.id||!enabled())throw Error('Owner Daily Book access is not ready.');
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||
     (!Number.isFinite(Date.parse(day+'T12:00:00Z'))||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day))
   throw Error('Choose a valid business date.');
  const result=await ctx.sb.rpc('bite_daily_book',{p_property:property.id,p_from:day,p_to:day});
  assertScope(key,version);
  if(result.error)throw Error(result.error.message||'Daily Book unavailable.');
  const daily=(result.data?.days||[]).find(row=>row.day===day);
  if(!daily)throw Error('The verified Daily Book did not return the selected day.');
  const sales=Number(daily.gross_sales),expenses=Number(daily.expenses);
  if(daily.gross_sales==null||daily.expenses==null||!Number.isFinite(sales)||!Number.isFinite(expenses))
   throw Error('The selected day has incomplete accounting values.');
  const eligible=(result.data.journal||[]).filter(entry=>{
   if(entry.day!==day||entry.direction!=='in'||!['Cash','UPI','Card','Bank Transfer'].includes(entry.method))return false;
   if(['order_payment','customer_ledger_payment'].includes(entry.source_type))return true;
   if(entry.source_type==='folio')return ['payment','advance'].includes(entry.category);
   if(entry.source_type==='daybook')return entry.category==='income';
   return false;
  });
  const received=eligible.reduce((sum,entry)=>sum+Number(entry.amount),0);
  if(eligible.some(entry=>entry.amount==null)||!Number.isFinite(received))throw Error('The selected day has an invalid receipt.');
  return {propertyId:property.id,day,sales,expenses,received,receiptCount:eligible.length,
   source:'bite_daily_book',receivedBasis:'Confirmed POS/guest receipts and recorded other income. Excludes deposits, transfers and opening balances.'};
 }
 function selectOwnerHomeMonth(day){
  if(!enabled()||!p()?.id||typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
  month=day.slice(0,7);collectionFocusDay=day;viewPeriod={mode:'day',day};
  return true;
 }
 // Open the matching source already present in the signed-in property report.
 // Never create a second receipt or infer a bill from a payment amount.
 async function openCollectionSource(entry){
  if(!entry||!report||reportScope!==scope()||!p()?.id||!ctx?.getUser?.()?.id)return;
  if(!report.journal?.some(x=>x.id===entry.id&&x.source_type===entry.source_type&&x.day===entry.day))return;
  const originalScope=scope(),rid=ctx.getAccess?.()?.restaurantId,state=ctx.getState?.()||{};
  if(entry.source_type==='order_payment'){
   const payment=(state.orderPayments||[]).find(x=>x.id===entry.id&&x.restaurant_id===rid&&x.payment_date===entry.day);
   const order=payment&&(state.orders||[]).find(x=>x.id===payment.order_id&&x.restaurant===rid&&String(x.channel||'').startsWith('POS - '));
   if(order&&typeof root.printOwnerInvoice==='function'){root.printOwnerInvoice(order.id);return}
   if(originalScope===scope()&&rid&&typeof ctx.navigate==='function'){
    await ctx.navigate('pos');
    if(originalScope===scope())root.alert?.('Receipt exists, but original bill is not loaded in this session. Search its code in POS History.');
   }
   return;
  }
  if(entry.source_type==='folio'){
   const line=(db().entries||[]).find(x=>x.id===entry.id);
   const folio=line&&(db().folios||[]).find(x=>x.id===line.folio_id);
   if(originalScope!==scope())return;
   if(folio&&H().has?.('folios')){await H().openFolio(folio.id);return}
   if(H().has?.('folios'))await ctx.navigate('folios');
   return;
  }
  if(entry.source_type==='customer_ledger_payment'){if(rid)await ctx.navigate('khata');return}
  if(['expense','property_expense'].includes(entry.source_type)){await ctx.navigate('expenses');return}
 }
 async function renderDailyBook(target){
  if(!target||!p())return;
  const key=scope(),version=++reportVersion;
  month=month||today().slice(0,7);
  const picker=root.BiteV3Period;
  if(!picker){target.textContent='Date picker unavailable. Reload Bite to view accounts.';return}
  const chosen=picker.normalize(viewPeriod||{mode:'month',month},today()),from=chosen.from,to=chosen.to;
  target.innerHTML='<div class="bh-heading"><div><p class="bh-eyebrow">'+esc(p().name)+'</p><h1>Daily Book</h1><p>Sales, expenses, staff advances and cash / online balances.</p></div></div>'+
   '<div id="haPeriod" aria-label="Daily Book period"></div><div id="haBookBody" role="status">Loading recorded accounts…</div>';
  picker.mount(target.querySelector('#haPeriod'),{value:chosen,today,
   basis:'Sales: bill / service date · Collections: money movement date',
   isCurrent:()=>key===scope()&&version===reportVersion,
   onApply:async next=>{
    if(key!==scope()||version!==reportVersion)throw Error('Property changed. Reopen Daily Book.');
    viewPeriod=next;month=next.from.slice(0,7);collectionFocusDay=next.mode==='day'?next.from:'';
    await renderDailyBook(target);
   }});
  const r=await ctx.sb.rpc('bite_daily_book',{p_property:p().id,p_from:from,p_to:to});
  if(key!==scope()||version!==reportVersion||!target.isConnected)return;
  const body=target.querySelector('#haBookBody');if(r.error){body.textContent='Daily Book unavailable: '+r.error.message;return}
  report=r.data;reportScope=key;
  const sum=k=>(report.days||[]).reduce((n,d)=>n+Number(d[k]||0),0),last=report.days?.at(-1)||{};
  body.innerHTML='<div class="ha-book-actions">'+(manager()?button('income','＋ Other income')+button('expense','＋ Expense')+button('staff_advance','＋ Staff advance')+button('salary','Staff salary')+button('accounts','Opening / transfer'):'')+'</div>'+
   '<div class="bh-metrics">'+[['Billed sales',sum('gross_sales')],['Recorded expenses',sum('expenses')],['Staff advances paid',sum('staff_advance')],['Cash balance',last.cash_balance],['Online balance',last.online_balance],['Recorded profit / loss',sum('profit')]].map(([label,value])=>'<div class="bh-metric"><span>'+esc(label)+'</span><strong>'+money(value)+'</strong></div>').join('')+'</div>'+
   '<p class="bh-note">Existing POS, room receipts and expenses appear automatically; add only missing entries. Sales follow issued bills. Advances and partial receipts change money balances; they do not create another sale. Add the starting balance for each account. Record earned salary once, then its payout after advances. Profit uses recorded sales less output GST and recorded costs.</p>'+
   '<section class="bh-panel" id="haCollections" aria-label="Source-linked Collections"></section>'+
   '<section class="bh-panel"><div class="bh-heading"><h2>Daily totals</h2><div class="bh-actions">'+button('excel','Export period Excel')+button('gst','Bill-wise GST Excel')+'</div></div><div class="ha-table-wrap"><table class="ha-book-table"><thead><tr><th>Date</th><th>Sale</th><th>Expense</th><th>Staff advance</th><th>Cash balance</th><th>Online balance</th><th>Profit / loss</th></tr></thead><tbody>'+
   (report.days||[]).map(d=>'<tr><td>'+esc(d.day)+'</td><td>'+money(d.gross_sales)+'</td><td>'+money(d.expenses)+'</td><td>'+money(d.staff_advance)+'</td><td>'+money(d.cash_balance)+'</td><td>'+money(d.online_balance)+'</td><td>'+money(d.profit)+'</td></tr>').join('')+'</tbody><tfoot><tr><th>Period total / closing</th><th>'+money(sum('gross_sales'))+'</th><th>'+money(sum('expenses'))+'</th><th>'+money(sum('staff_advance'))+'</th><th>'+money(last.cash_balance)+'</th><th>'+money(last.online_balance)+'</th><th>'+money(sum('profit'))+'</th></tr></tfoot></table></div></section>'+
   '<section class="bh-panel"><h2>Cash & online accounts</h2>'+((report.accounts||[]).map(a=>'<div class="bh-room-line"><span>'+esc(a.account)+' · '+esc(a.method)+'</span><strong>'+money(a.balance)+'</strong></div>').join('')||'<p>No money recorded yet.</p>')+'</section>'+
   '<details class="bh-panel"><summary>Staff salary & advances</summary><p class="bh-note">Earned salary is the expense. An advance and the remaining salary payout are money movements.</p>'+((report.staff||[]).map(s=>'<article class="bh-record"><div><strong>'+esc(s.staff_name)+'</strong><p>Earned salary '+money(s.earned_salary)+' · Advances '+money(s.advances)+' · Salary paid '+money(s.salary_paid)+'</p><p>Recorded balance: '+money(Number(s.earned_salary||0)-Number(s.advances||0)-Number(s.salary_paid||0))+'</p></div></article>').join('')||'<p>No staff salary entries yet.</p>')+'</details>'+
   '<details class="bh-panel"><summary>Original ledger and account notes</summary>'+((report.journal||[]).map(j=>'<article class="bh-record"><div><strong>'+esc(j.description)+'</strong><p>'+esc(j.day)+' · '+esc(j.category)+' · '+esc(j.method)+(j.method!=='Cash'&&j.account_note?' · '+esc(j.account_note):'')+'</p></div><strong>'+(j.direction==='out'?'−':j.direction==='noncash'?'':'+')+money(j.amount)+'</strong>'+(manager()&&['UPI','Card','Bank Transfer'].includes(j.method)&&j.source_type!=='property_expense'?button('note','Account note',j.id,'data-source="'+esc(j.source_type)+'"'):'')+'</article>').join('')||'<p>No transactions for this period.</p>')+'</details>';
  root.BiteV3Collections?.render?.(body.querySelector('#haCollections'),report,{scope:key,day:chosen.mode==='day'?chosen.from:'',onOpen:openCollectionSource});
 }

 function settings(target){
  target?.querySelector('#haBillingSettings')?.remove();if(!target||!enabled()||!p()?.can_configure)return;
  const tax=p().tax_profile||{},s=db().invoice_series||{},box=document.createElement('section');box.id='haBillingSettings';box.className='bh-panel';
  box.innerHTML='<form class="bh-form" data-ha-form="billing"><h2>Hotel bills & GST</h2><p>Continue your current bill sequence by setting the next number. Issued bills keep their original number.</p><div class="bh-form-grid">'+
   field('gstin','Hotel GSTIN · Leave blank if unregistered','text',tax.gstin||'','maxlength="15" autocomplete="off"')+
   field('prefix','Bill prefix','text',s.prefix||'B','required pattern="[A-Za-z0-9]{1,3}" maxlength="3"')+
   field('next_number','Next bill number','number',s.next_number||1,'required min="'+(Number(s.last_number||0)+1)+'" max="999999" step="1"')+
   '<p class="bh-note">Room GST is calculated from the agreed rent: 5% up to ₹7,500 per room / day, and 18% above it. No GST is charged without registration.</p>'+
   '<input type="hidden" name="room_rate" value="5">'+
   select('food_rate','Restaurant GST · Total %',[5,18].map(x=>option(x,x+'%',Number(tax.food_rate||5)===x)).join(''))+
   field('incidental_rate','Extra charges GST · Total %','number',tax.incidental_rate||0,'required min="0" max="100" step="0.01"')+
   field('primary_account','Usual online account · Short label','text',tax.primary_account||'','maxlength="80" placeholder="Owner account"')+'</div>'+
   '<p class="bh-note">5% is shown as 2.5% CGST + 2.5% SGST. Confirm the restaurant and extra-charge rates with your CA. Issued bills stay unchanged; an open bill uses the reviewed settings when previewed or checked out.</p>'+
   check('reviewed','I reviewed this property’s GST registration, rates and invoice series.','required')+message()+'<button class="btn" type="submit">Save billing settings</button></form>';
  target.append(box);
 }
 function entryEditor(kind){
  const headings={income:'Other income',expense:'Record expense',staff_advance:'Staff advance',salary_expense:'Earned monthly salary',salary_payment:'Pay remaining salary',opening:'Opening balance',transfer_in:'Money transferred in',transfer_out:'Money transferred out'};
  const staff=['staff_advance','salary_expense','salary_payment'].includes(kind);
  H().editor('<form class="bh-form" data-ha-form="book" data-kind="'+kind+'"><h2>'+headings[kind]+'</h2><div class="bh-form-grid">'+
   field('entry_date','Date','date',today(),'required max="'+today()+'"')+
   field('category','Category','text',kind==='expense'?'':headings[kind],'required maxlength="80" list="haExpenseTypes"')+
   '<datalist id="haExpenseTypes">'+['Kirana','Flour / Atta','Vegetables','Gas','Electricity','Milk','Newspaper','Repairs','Internet','Rent','Laundry'].map(x=>'<option value="'+esc(x)+'">').join('')+'</datalist>'+
   (staff?field('staff_name','Staff name','text','','required maxlength="120"'):'')+
   field('amount','Amount (₹)','number','','required min="0.01" step="0.01"')+
   (kind==='salary_expense'?'<input type="hidden" name="method" value="Non-cash">':select('method','Cash / Online',methods()))+
   field('account_note','Online account · Short note','text',p().tax_profile?.primary_account||'','maxlength="80"')+
   field('description','Reason / detail','text','','required maxlength="250"')+'</div>'+
   (kind==='salary_expense'?'<p class="bh-note">Enter the full earned salary for this month, including advances already paid. This records the expense; it does not pay money again.</p>':kind==='salary_payment'?'<p class="bh-note">Record earned salary first. Pay only the remaining amount after advances; this payout does not add salary expense again.</p>':'')+
   (kind!=='salary_expense'?check('verified','For online entries, I verified this movement in the account.'):'')+message()+'<div class="bh-actions">'+button('close','Cancel')+'<button class="btn" type="submit">Save entry</button></div></form>');
  wireMoneyFields(document.querySelector('#bhActionEditor form'));
 }

 async function click(e){
  const b=e.target.closest('[data-ha-action]');if(!b||active)return;
  const a=b.dataset.haAction,id=b.dataset.id;
  try{
   if(a==='draft'){
    const form=document.getElementById('bhCheckinForm'),fields=Object.fromEntries(Array.from(new FormData(form)).filter(([,v])=>typeof v==='string'));fields.stay_id=form.dataset.stayId||'';
    localStorage.setItem('bite_register_draft:'+scope(),JSON.stringify({savedAt:Date.now(),fields}));form.querySelector('.bh-message').textContent='Draft saved. Unuploaded ID files must be selected again.';return;
   }
   if(a==='close'){document.getElementById('bhActionEditor')?.remove();return}
   if(['income','expense','staff_advance','salary_expense','salary_payment','opening','transfer_in','transfer_out'].includes(a)){entryEditor(a);return}
   if(a==='salary'){H().editor('<h2>Staff salary</h2><div class="bh-actions">'+button('salary_expense','Record earned monthly salary')+button('salary_payment','Pay remaining salary')+'</div><p class="bh-note">Record salary cost once, then its remaining payout after advances.</p>');return}
   if(a==='accounts'){H().editor('<h2>Opening balance & transfers</h2><div class="bh-actions">'+button('opening','Add opening balance')+button('transfer_in','Transfer in / settlement')+button('transfer_out','Transfer out / withdrawal')+'</div><p class="bh-note">These change money balances and do not create sales or expenses. Record both sides when moving between your own accounts.</p>');return}
   if(a==='excel'||a==='gst'){
    if(!report||reportScope!==scope())throw Error('Reload this property’s report.');
    root.BiteExports.download(root.BiteExports.workbook(a==='excel'?reportRows(report):gstRows(report)),'Bite-'+(a==='excel'?'Accounts-':'GST-Bills-')+(report.from||month)+'_to_'+(report.to||month)+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return;
   }
   if(a==='note'){
    const row=report?.journal.find(x=>x.id===id);if(!row)return;
    H().editor('<form class="bh-form" data-ha-form="note" data-id="'+esc(id)+'" data-source="'+esc(b.dataset.source)+'"><h2>Online account note</h2>'+field('account_note','Received / paid through','text',row.account_note||'','required maxlength="80" placeholder="Owner account / second account"')+message()+'<button class="btn" type="submit">Save account note</button></form>');return;
   }
   if(a==='extra'){document.querySelector('#folios [data-hotel-action="entry"][data-id="charge"]')?.click();return}
   if(a==='checkout'&&root.BiteHotelBilling){await root.BiteHotelBilling.checkout(id);return}
   if(a==='checkout'){
    const f=db().folios.find(x=>x.id===id),t=f?.totals;if(!f||!t)return;
    H().editor('<form class="bh-form" data-ha-form="checkout" data-id="'+esc(id)+'"><h2>Checkout</h2><div class="ha-checkout-summary"><span>Total bill <strong>'+money(t.charges)+'</strong></span><span>Already received <strong>'+money(t.paid)+'</strong></span><span>To collect <strong>'+money(t.balance)+'</strong></span></div>'+
     '<input name="amount" type="hidden" value="'+Number(t.balance)+'">'+(Number(t.balance)>0?select('method','Receive payment by',methods())+field('account_note','Online account · Short note','text',p().tax_profile?.primary_account||'','maxlength="80"')+field('reference','Online transaction reference','text','','maxlength="100"')+check('verified','I verified the online payment in the selected account.'):'')+
     (Number(t.pending)||Number(t.deposit_held)?'<p class="bh-note">Verify pending receipts and resolve the security deposit before checkout.</p>':'')+message()+'<div class="bh-actions">'+button('close','Cancel')+'<button class="btn" type="submit" '+(Number(t.pending)||Number(t.deposit_held)||Number(t.balance)<0?'disabled':'')+'>Confirm checkout & bill</button></div></form>');wireMoneyFields(document.querySelector('[data-ha-form=checkout]'));return;
   }
  }catch(err){const m=document.querySelector('.page.active .bh-message');if(m)m.textContent=err.message;else root.alert(err.message)}
 }
 async function submit(e){
  const form=e.target.closest('[data-ha-form]');if(!form)return;e.preventDefault();e.stopPropagation();
  const type=form.dataset.haForm,f=Object.fromEntries(new FormData(form)),b=form.querySelector('button[type="submit"]'),msg=form.querySelector('.bh-message');
  if(b?.disabled)return;if(b)b.disabled=true;
  try{
   if(type==='month'){if(!/^\d{4}-\d{2}$/.test(f.month))throw Error('Choose a month.');month=f.month;collectionFocusDay='';await renderDailyBook(document.getElementById('daily-book'));return}
   if(msg)msg.textContent='Saving…';
   if(type==='billing'){
    if(!form.elements.reviewed.checked)throw Error('Review billing settings first.');
    await H().command('billing_settings',{prefix:f.prefix,next_number:Number(f.next_number),primary_account:f.primary_account,tax_profile:{gstin:f.gstin.trim().toUpperCase(),reviewed:true,room_rate:f.gstin.trim()?5:0,food_rate:f.gstin.trim()?Number(f.food_rate):0,incidental_rate:f.gstin.trim()?Number(f.incidental_rate):0}});
    await H().refreshContext();await H().reload();settings(document.getElementById('settings'));return;
   }
   if(type==='book')await H().command('daybook_entry',{...f,kind:form.dataset.kind,amount:Number(f.amount),verified:f.verified==='on'});
   if(type==='note')await H().command('account_note',{id:form.dataset.id,source_type:form.dataset.source,account_note:f.account_note});
   if(type==='checkout'){
    await H().command('checkout_collect',{...f,folio_id:form.dataset.id,amount:Number(f.amount),verified:f.verified==='on'});
    await H().reload();H().redraw();return;
   }
   await renderDailyBook(document.getElementById('daily-book'));
  }catch(err){if(msg)msg.textContent=err.message||String(err)}
  finally{if(b)b.disabled=false}
 }
 const api={init,clear,enabled,busy:()=>active>0||root.BiteCheckinFlow?.busy()||root.BiteHotelBilling?.busy(),decorateRegister,prepareRegister,showRegisterError,saveDocuments,registration,decorateFolio,decoratePayment,renderDailyBook,reportOwnerHomeDay,selectOwnerHomeMonth,settings,printStatement,validateRegistration,currentArrivalTime,validArrivalTime,reportRows,gstRows,billHTML,billTaxGroups,combinedBillHTML};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.BiteHotelAccounts=api;
})(typeof window!=='undefined'?window:globalThis);
