/* Operational extensions to the existing property workspace. SQL authorizes every write. */
(function(root){
 'use strict';
 let ctx,linkScope='',links=new Map();
 const H=()=>root.BiteHospitality,p=()=>H().prop(),db=()=>H().getWorkspace();
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 const button=(a,label,id='',extra='')=>`<button type="button" class="btn secondary" data-ops-action="${a}" data-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
 const field=(n,label,type='text',v='',extra='')=>`<label class="bh-field"><span>${esc(label)}</span><input name="${n}" type="${type}" value="${esc(v)}" ${extra}></label>`;
 const check=(n,label,on=false)=>`<label class="bh-check"><input type="checkbox" name="${n}" ${on?'checked':''}> ${esc(label)}</label>`;
 const option=(v,label,on=false)=>`<option value="${esc(v)}" ${on?'selected':''}>${esc(label)}</option>`;
 const select=(n,label,rows)=>`<label class="bh-field"><span>${esc(label)}</span><select name="${n}">${rows}</select></label>`;
 const methods=()=>['Cash','UPI','Card','Bank Transfer','Other'].map(v=>option(v,v)).join('');
 const message=()=>'<p class="bh-message" role="status" aria-live="polite"></p>';
 const manager=()=>['owner','manager'].includes(p()?.role);
 const edit=html=>H().editor(html);
 function clear(){links.clear();linkScope=''}
 function scope(){const next=ctx.getUser()?.id+':'+p()?.id;if(next!==linkScope){clear();linkScope=next}return next}
 async function rpc(name,args){const id=p()?.id,r=await ctx.sb.rpc(name,{p_property:id,...args});if(r.error)throw r.error;if(id!==p()?.id)throw Error('Property changed. Open this action in the current property.');return r.data}
 function init(context){ctx=context;document.querySelector('#mainApp .content')?.addEventListener('click',click);document.querySelector('#mainApp .content')?.addEventListener('submit',submit)}
 function tasks(target,kind,embedded=false){
  const all=(db().tasks||[]).filter(t=>t.kind===kind),active=all.filter(t=>!['completed','cancelled'].includes(t.status));
  const card=t=>{const room=db().rooms.find(r=>r.id===t.room_id),staff=(db().task_members||[]).find(m=>m.user_id===t.assigned_to);
   const next=t.status==='requested'||t.status==='assigned'?'in_progress':t.status==='in_progress'?(kind==='cleaning'?'completed':'ready'):t.status==='ready'?'completed':null;
   const label={in_progress:kind==='cleaning'?'Start cleaning':'Start preparing',ready:'Ready for delivery',completed:kind==='cleaning'?'Cleaning finished':'Mark delivered'}[next];
   return `<article class="bh-record"><div><strong>Room ${esc(room?.number||t.room_number||'—')} · ${kind==='cleaning'?'Cleaning':'Room service'}</strong><p>${esc(t.status.replaceAll('_',' '))}${staff?' · '+esc(staff.name):''}</p>${room?.do_not_disturb?'<p class="bh-note">Do Not Disturb — confirm guest permission before starting.</p>':''}<p>${esc(t.note)}</p>${(t.items||[]).map(i=>'<p>'+esc(i.quantity)+' × '+esc(i.name)+'</p>').join('')}${t.status==='completed'&&kind==='cleaning'?'<p class="bh-note">Supervisor must inspect and mark the room Ready.</p>':''}</div><div class="bh-actions">${next?button('task-step',label,t.id,'data-next="'+next+'"'):''}${manager()&&['requested','assigned'].includes(t.status)?button('task-assign','Assign staff',t.id):''}</div></article>`;
  };
  target.innerHTML=(embedded?'<h2>Cleaning tasks</h2>':'<div class="bh-heading"><div><p class="bh-eyebrow">'+esc(p().name)+'</p><h1>Room service</h1><p>Food bills stay in POS and the guest folio. This queue tracks preparation and delivery.</p></div></div>')+message()+button('refresh','Refresh current property')+(active.map(card).join('')||'<p class="bh-empty">No outstanding '+(kind==='cleaning'?'cleaning tasks':'room-service orders')+'.</p>')+(all.length>active.length?'<details><summary>Finished tasks ('+(all.length-active.length)+')</summary>'+all.filter(t=>['completed','cancelled'].includes(t.status)).slice(-50).reverse().map(card).join('')+'</details>':'');
 }
 function decorateRooms(target){if(target.id!=='housekeeping')return;const box=document.createElement('section');box.className='bh-panel';tasks(box,'cleaning',true);target.append(box)}
 function decorateFolio(target,folio,stay,guest){
  const box=document.createElement('section');box.className='bh-panel';box.id='biteGuestOperations';
  const jobs=(db().refund_requests||[]).filter(j=>j.folio_id===folio.id),open=folio.status==='open';
  const foreign=guest&&(guest.is_oci||!['india','indian','bharat','भारत'].includes(String(guest.country||'India').trim().toLowerCase()));
  if(!stay?.policy_snapshot?.reviewed&&!jobs.length&&Number(folio.totals?.balance)>=0&&!foreign)return;
  box.innerHTML='<h2>Guest services</h2>'+message()+
   (open&&stay?.status==='in_house'&&manager()&&stay.policy_snapshot?.reviewed?'<div class="bh-actions">'+button('policy-review','Review checkout policy',folio.id)+button('late-checkout','Approve late checkout',stay.id)+'</div>':'')+
   (folio.checkout_policy?'<p>Checkout policy agreed: unused-night credit '+money(folio.checkout_policy.early_credit)+' · late fee '+money(folio.checkout_policy.late_fee)+'.</p>':'')+
   (stay?.expected_checkout_at?'<p>Expected departure: '+esc(new Date(stay.expected_checkout_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))+'</p>':'')+
   '<h3>Hotel refunds</h3><p class="bh-note">These track money returned by the property. Online food refunds remain in the existing payment system.</p>'+
   jobs.map(j=>'<article class="bh-record"><div><strong>'+money(j.amount)+' · '+esc(j.status)+'</strong><p>'+esc(j.method)+' · '+esc(j.reason)+'</p>'+(j.reference?'<p>Reference ending '+esc(j.reference.slice(-4))+'</p>':'')+'</div>'+(open&&manager()&&!['paid','cancelled'].includes(j.status)?button('refund-progress','Update return',j.id):'')+'</article>').join('')+
   (open&&manager()&&Number(folio.totals?.balance)<0?button('refund-request','Create refund request',folio.id):'')+
   (guest&&(guest.is_oci||!['india','indian','bharat','भारत'].includes(String(guest.country||'India').trim().toLowerCase()))?'<h3>Foreign / OCI guest reporting</h3><p>Arrival and departure reporting must be completed in the official system. Record the acknowledgment here.</p>'+complianceSummary(stay)+(['owner','manager','receptionist'].includes(p().role)?button('compliance','Reporting checklist',stay.id):''):'');
  target.querySelector('#bhFolioEditor')?.before(box);
  const old=target.querySelector('[data-hotel-action="entry"][data-id="refund"]');if(old)old.remove();
 }
 function complianceSummary(stay){
  const c=(db().compliance||[]).find(c=>c.stay_id===stay.id),due=[];
  for(const [label,at,reference] of [['Arrival',stay.checked_in_at,c?.arrival_reference],['Departure',stay.checked_out_at,c?.departure_reference]]){
   if(at&&!reference){const deadline=new Date(Date.parse(at)+24*3600000);due.push('<p class="bh-note" role="status">'+label+' reporting '+(deadline.getTime()<Date.now()?'overdue — follow up now':'due by '+esc(deadline.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})))+'. Complete it in the official portal and record the acknowledgment.</p>')}
  }
  return '<p>Arrival: '+(c?.arrival_reference?'Acknowledgment recorded':'Not recorded')+' · Departure: '+(c?.departure_reference?'Acknowledgment recorded':'Not recorded')+'</p>'+due.join('');
 }

 function registerFields(form,draft,guest){
  const box=document.createElement('section');box.className='bh-panel';box.id='biteRegistrationOperations';
  box.innerHTML=check('is_oci','Guest is an Overseas Citizen of India (OCI)',guest?.is_oci||draft.is_oci==='on')+
   '<h3>Booking & advance</h3><div class="bh-form-grid">'+select('booking_source','Booking source',['walk_in','phone','external_booking'].map(v=>option(v,{walk_in:'Walk-in',phone:'Phone reservation',external_booking:'External / prepaid booking'}[v],v===(draft.booking_source||'walk_in'))).join(''))+
   field('booking_reference','Booking reference (required for external booking)','text',draft.booking_reference||'','maxlength="120"')+
   field('advance_amount','Already received room advance (₹)','number',draft.advance_amount||0,'min="0" step="0.01"')+select('advance_method','Advance received by',methods())+field('advance_reference','Bank / receipt reference','text',draft.advance_reference||'','maxlength="100"')+'</div>'+
   (manager()?check('advance_verified','I verified receipt in the bank (required reference)',draft.advance_verified==='on'):'')+
   '<p class="bh-note">Enter money already received. This does not charge the guest. Bank/UPI/card amounts remain pending unless a manager verifies receipt. External bookings are entered manually.</p>';
  form.querySelector('.bh-form-actions').before(box);if(draft.advance_method)box.querySelector('[name=advance_method]').value=draft.advance_method;
  if(draft.stay_id)box.querySelectorAll('input,select').forEach(e=>e.disabled=true);
 }
 async function reservationQuote(fields,stayId){return rpc('bite_reservation_quote',{p_details:{room_id:fields.room_id,arrival:fields.arrival,departure:fields.departure,adults:Number(fields.adults),children:Number(fields.children||0),mode:fields.mode,...(fields.nightly_rate!==undefined&&!stayId?{nightly_rate:Number(fields.nightly_rate),terms_at_checkin:true}:{}),...(stayId?{stay_id:stayId}:{})}})}
 function settings(target){
  target.querySelector('#biteOperationalSettings')?.remove();if(!p()?.can_configure)return;
  const box=document.createElement('div');box.className='bh-workspace';box.id='biteOperationalSettings';
  const cfg=p().hotel_policy||{};
  box.innerHTML=(H().has('hotel_rooms')?'<form class="bh-panel bh-form" data-ops-form="policy"><h2>Arrival & checkout policy</h2><p>New reservations retain the reviewed policy. Existing stays keep their agreed terms.</p><div class="bh-form-grid">'+
   field('checkin_time','Standard check-in (India time)','time',(p().checkin_time||'14:00').slice(0,5),'required')+field('checkout_time','Standard checkout (India time)','time',(p().checkout_time||'11:00').slice(0,5),'required')+
   [['early_checkin_fee','Early arrival fee (₹)',0,1000000],['late_fee_per_hour','Late checkout per started hour (₹)',0,1000000],['grace_minutes','Late checkout grace (minutes)',30,240],['turnover_minutes','Room cleaning / turnover (minutes)',30,240],['max_late_hours','Maximum late hours before extension',12,24],['unused_night_credit_percent','Unused room nights credited (%)',0,100],['fee_tax_rate','Reviewed fee tax (%)',0,100]].map(([n,label,v,max])=>field(n,label,'number',cfg[n]??v,'required min="0" max="'+max+'" step="'+(n.includes('minutes')||n==='max_late_hours'?'1':'0.01')+'"')).join('')+'</div>'+check('reviewed','I reviewed these terms and applicable tax settings for this property',cfg.reviewed)+message()+'<button class="btn" type="submit">Save reviewed policy</button></form>':'')+
   (H().has('restaurant_menu')?outletSettings():'');
  target.append(box);
 }
 function outletSettings(){
  const d=db(),apps=d.outlet_applications||[],available=d.available_outlets||[];
  return '<section class="bh-panel"><h2>Restaurant outlet</h2><p>Restaurant approval and publication stay in the existing Bite Admin workflow.</p>'+message()+apps.map(a=>'<article class="bh-record"><div><strong>'+esc(a.name)+'</strong><p>'+esc(a.onboarding_status)+' · '+esc(a.status)+'</p><p>'+esc(a.reason||'')+'</p></div>'+(['pending','rejected'].includes(a.onboarding_status)?button('application-edit','Request name/address correction',a.restaurant_id):'')+'</article>').join('')+
   available.map(a=>'<article class="bh-record"><div><strong>'+esc(a.name)+'</strong><p>'+esc(a.city)+' · '+(a.eligible?'Approved':'Awaiting approval')+'</p></div>'+(a.eligible?button('attach-outlet','Connect this outlet',a.id):'')+'</article>').join('')+
   (!apps.some(a=>['pending','rejected'].includes(a.onboarding_status))?button('apply-outlet','Apply for a restaurant outlet'):'')+'</section>';
 }
 async function share(folioId){
  scope();const prior=links.get(folioId);
  if(prior&&Date.parse(prior.expires_at)>Date.now()){showLink(folioId,prior);return}
  edit('<h2>Guest bill & refund link</h2><p>The link shows this folio and refund progress for 72 hours. Anyone holding it can read the bill. A new link revokes the earlier link.</p>'+message()+button('issue-link','Create private guest link',folioId));
 }
 function showLink(id,data){const url=new URL('customer.html',root.location.href);url.hash='stay='+data.token;edit('<h2>Guest bill & refund link</h2><label class="bh-field"><span>Share only with the authorized guest · expires '+esc(new Date(data.expires_at).toLocaleString('en-IN'))+'</span><textarea readonly data-guest-bill-link>'+esc(url.href)+'</textarea></label><p>Creating a new link revokes this one. A lost response requires creating a fresh link.</p>'+message()+'<div class="bh-actions">'+button('copy-link','Copy link',id)+button('share-link','Share link',id)+button('revoke-link','Revoke guest access',id)+button('issue-link','Replace link',id)+'</div>')}
 async function click(event){
  const b=event.target.closest('[data-ops-action]');if(!b||b.disabled)return;b.disabled=true;scope();
  const a=b.dataset.opsAction,id=b.dataset.id,identity=linkScope;
  try{
   if(a==='refresh'){await H().reload();return}
   if(a==='task-step'){await H().command('task_update',{id,status:b.dataset.next});await H().reload()}
   if(a==='task-assign'){
    const t=(db().tasks||[]).find(t=>t.id===id);if(!t)throw Error('Refresh the task list.');
    const members=(db().task_members||[]).filter(m=>['owner','manager',t.kind==='cleaning'?'housekeeping':'cashier'].includes(m.role));
    edit('<form class="bh-form" data-ops-form="task-assign" data-id="'+esc(id)+'"><h2>Assign property staff</h2>'+select('assigned_to','Staff member',members.map(m=>option(m.user_id,m.name+' · '+m.role,m.user_id===t.assigned_to)).join(''))+message()+'<button class="btn" type="submit">Assign task</button></form>');
   }
   if(a==='policy-review'){
    const f=db().folios.find(f=>f.id===id),s=db().stays.find(s=>s.id===f?.stay_id);if(!s)throw Error('Refresh this folio.');
    const q=await rpc('bite_checkout_policy_quote',{p_stay:s.id});
    edit('<form class="bh-form" data-ops-form="apply-policy" data-id="'+esc(id)+'"><h2>Review checkout policy</h2><input type="hidden" name="quote_hash" value="'+esc(q.quote_hash)+'"><p>Unused-night credit: '+money(q.early_credit)+' + '+money(q.early_credit_tax)+' tax adjustment.<br>Late fee: '+money(q.late_fee)+' + '+money(q.late_tax)+' tax.</p><p>Review with the guest before settlement. Applying fixes the checkout terms for this folio.</p>'+message()+'<button class="btn" type="submit" '+(f.checkout_policy?'disabled':'')+'>Apply agreed adjustments once</button></form>');
   }
   if(a==='late-checkout'){
    const s=db().stays.find(s=>s.id===id);edit('<form class="bh-form" data-ops-form="late-checkout" data-id="'+esc(id)+'"><h2>Approve late checkout</h2>'+field('until','Departure date & time (India)','datetime-local',s.departure+'T13:00','required')+field('reason','Approval reason','text','','required minlength="3" maxlength="250"')+check('waive_fee','Manager waives the late checkout fee')+'<p>Incoming arrivals and cleaning time are checked again. Use Extend stay for another night.</p>'+message()+'<button class="btn" type="submit">Approve departure time</button></form>');
   }
   if(a==='refund-request'){
    const f=db().folios.find(f=>f.id===id);edit('<form class="bh-form" data-ops-form="refund-request" data-id="'+esc(id)+'"><h2>Hotel refund request</h2><p>Available credit: '+money(Math.max(0,-Number(f?.totals?.balance||0)))+'. Outstanding requests also reserve this credit.</p>'+field('amount','Amount to return (₹)','number','','required min="0.01" step="0.01"')+select('method','Return method',methods())+field('reason','Reason','text','','required maxlength="250"')+message()+'<button class="btn" type="submit">Create return request</button></form>');
   }
   if(a==='refund-progress'){
    const j=(db().refund_requests||[]).find(j=>j.id===id);edit('<form class="bh-form" data-ops-form="refund-progress" data-id="'+esc(id)+'"><h2>Update hotel return · '+money(j.amount)+'</h2>'+select('status','Progress',['processing','failed','paid','cancelled'].map(v=>option(v,v,v===j.status)).join(''))+field('reference','Actual return / receipt reference (required for paid)','text','','maxlength="100"')+check('return_verified','I verified that the property actually returned this money')+'<p>No payment is sent by this form. Mark paid only after verifying the actual return.</p>'+message()+'<button class="btn" type="submit">Save return progress</button></form>');
   }
   if(a==='compliance'){
    const c=(db().compliance||[]).find(c=>c.stay_id===id)||{};
    edit('<form class="bh-form" data-ops-form="compliance" data-id="'+esc(id)+'"><h2>Foreign / OCI reporting checklist</h2><p>Complete arrival and departure reporting in the official <a href="https://indianfrro.gov.in/formIII/" target="_blank" rel="noopener noreferrer">FRRO portal</a>. Keep the required records externally. Bite records acknowledgments and does not file on your behalf.</p>'+check('travel_document_checked','Travel document / OCI card checked',c.travel_document_checked)+check('permission_checked','Visa / permission checked where applicable',c.permission_checked)+check('record_retained_externally','Required register and supporting record retained externally',c.record_retained_externally)+'<div class="bh-form-grid">'+[['arrived_from','Arrived from',120],['previous_stay','Previous place of stay',250],['purpose','Purpose of visit',80],['next_destination','Next destination',250],['arrival_reference','Official arrival acknowledgment',120],['departure_reference','Official departure acknowledgment',120]].map(([n,label,max])=>field(n,label,'text',c[n]||'','maxlength="'+max+'"')).join('')+'</div><p class="bh-note">Do not enter passport numbers or upload identity scans here. Arrival and departure acknowledgments remain separate.</p>'+message()+'<button class="btn" type="submit">Save checklist</button></form>');
   }
   if(a==='apply-outlet'||a==='application-edit'){
    const prior=(db().outlet_applications||[]).find(x=>x.restaurant_id===id);
    edit('<form class="bh-form" data-ops-form="'+(a==='apply-outlet'?'application':'application-edit')+'" data-id="'+esc(id)+'"><h2>'+(prior?'Request application correction':'Restaurant approval application')+'</h2>'+field('name','Restaurant name','text',prior?.name||p().name,'required maxlength="120"')+field('address','Full address','text',p().address||'','required minlength="3" maxlength="500"')+(prior?'':field('city','City','text','','required maxlength="100"')+field('phone','Contact phone','tel',p().phone||'','required minlength="7" maxlength="20"')+field('contact_person','Contact person','text','','maxlength="120"'))+'<p>'+ (prior?'A profile correction request goes to the existing Admin review queue.':'Bite Admin reviews this application before it is linked. Applying does not publish the restaurant.')+'</p>'+message()+'<button class="btn" type="submit">Submit for review</button></form>');
   }
   if(a==='attach-outlet'){if(!root.confirm('Connect this approved restaurant to '+p().name+'?'))return;await H().command('attach_outlet',{restaurant_id:id});await H().refreshContext(true)}
   if(a==='issue-link'){const result=await rpc('bite_guest_link',{p_folio:id});if(identity!==linkScope)return;links.set(id,result);showLink(id,result)}
   if(a==='copy-link'){await navigator.clipboard.writeText(document.querySelector('[data-guest-bill-link]').value);document.querySelector('#bhActionEditor .bh-message').textContent='Private guest link copied.'}
   if(a==='share-link'){const url=document.querySelector('[data-guest-bill-link]').value;if(navigator.share)await navigator.share({title:p().name+' guest bill',url});else{await navigator.clipboard.writeText(url);document.querySelector('#bhActionEditor .bh-message').textContent='Private guest link copied.'}}
   if(a==='revoke-link'){await H().command('guest_link_revoke',{folio_id:id});links.delete(id);edit('<h2>Guest link revoked</h2><p>The previous link can no longer open this bill.</p>')}
  }catch(error){const m=document.querySelector('#bhActionEditor .bh-message')||b.closest('.bh-panel,.page')?.querySelector('.bh-message');if(m)m.textContent=error.message||String(error)}finally{b.disabled=false}
 }
 async function submit(event){
  const form=event.target.closest('[data-ops-form]');if(!form)return;event.preventDefault();const b=form.querySelector('button[type=submit]');if(b.disabled)return;b.disabled=true;
  const f=Object.fromEntries(new FormData(form)),type=form.dataset.opsForm,id=form.dataset.id,identity=scope();
  try{
   let action,payload;
   if(type==='policy'){
    action='policy_save';payload={checkin_time:f.checkin_time,checkout_time:f.checkout_time,policy:Object.fromEntries(['early_checkin_fee','late_fee_per_hour','grace_minutes','turnover_minutes','max_late_hours','unused_night_credit_percent','fee_tax_rate'].map(k=>[k,Number(f[k])]))};payload.policy.reviewed=f.reviewed==='on';
   }
   if(type==='task-assign'){action='task_update';payload={id,status:'assigned',assigned_to:f.assigned_to}}
   if(type==='apply-policy'){action='apply_checkout_policy';payload={folio_id:id,quote_hash:f.quote_hash}}
   if(type==='late-checkout'){action='late_checkout';payload={id,...f,waive_fee:f.waive_fee==='on'}}
   if(type==='refund-request'){action='refund_request';payload={folio_id:id,...f,amount:Number(f.amount)}}
   if(type==='refund-progress'){action='refund_update';payload={id,...f,return_verified:f.return_verified==='on'}}
   if(type==='compliance'){action='compliance_save';payload={id,...f,...Object.fromEntries(['travel_document_checked','permission_checked','record_retained_externally'].map(k=>[k,f[k]==='on']))}}
   if(type==='application'){action='outlet_application';payload=f}
   if(type==='application-edit'){action='outlet_application_edit';payload={...f,restaurant_id:id}}
   if(!action)throw Error('Unknown operation.');await H().command(action,payload);if(identity!==scope())return;
   if(type==='policy'||type==='application'){await H().refreshContext(false)}
   await H().reload();H().redraw();
   if(type==='policy'){settings(document.getElementById('settings'));document.querySelector('#biteOperationalSettings .bh-message').textContent='Policy saved for new reservations.'}
   else{document.getElementById('bhActionEditor')?.remove();const m=document.querySelector('.page.active .bh-message');if(m)m.textContent=type==='application-edit'?'Correction submitted for Admin review.':'Saved.';if(document.querySelector('#settings.active'))settings(document.getElementById('settings'))}
  }catch(error){form.querySelector('.bh-message').textContent=error.message||String(error)}finally{b.disabled=false}
 }
 root.BiteOwnerOperations={init,clear,tasks,decorateRooms,decorateFolio,registerFields,reservationQuote,settings,share};
})(typeof window!=='undefined'?window:globalThis);
