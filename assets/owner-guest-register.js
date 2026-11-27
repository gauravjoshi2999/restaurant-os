/* Private hotel register: one row per saved stay, inside the existing Guests workspace. */
(function(root){
 'use strict';
 const H=()=>root.BiteHospitality,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function verifiedRent(value){
  if(typeof value!=='number'&&!(typeof value==='string'&&/^\d+(?:\.\d{1,2})?$/.test(value.trim())))return null;
  const amount=Number(value),cents=Math.round(amount*100);
  return Number.isFinite(amount)&&amount>=0&&Number.isSafeInteger(cents)&&Math.abs(amount*100-cents)<0.00001?cents/100:null;
 }
 const money=n=>{const rent=verifiedRent(n);return rent===null?'—': '₹'+rent.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})};
 function validEntryDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+'T12:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
 }
 const stamp=s=>{const d=new Date(s);return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'short',timeStyle:'short'})};
 const day=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')?s.slice(8)+'/'+s.slice(5,7)+'/'+s.slice(0,4):s||'—';
 const button=(a,label,id='',extra='')=>'<button type="button" class="btn secondary" data-gr-action="'+a+'" data-id="'+esc(id)+'" '+extra+'>'+esc(label)+'</button>';
 const foreignFields=[['nationality','Nationality'],['date_of_birth','Date of birth'],['document_type','Travel document'],['document_last4','Document last 4'],['document_expiry','Document expiry'],['visa_status','Visa / OCI'],['permission_last4','Permission last 4'],['visa_expiry','Permission expiry'],['india_arrival','Arrival in India'],['entry_port','Entry port'],['purpose','Purpose']];
 const status=s=>({in_house:'Staying',checked_out:'Checked out',reserved:'Reserved',cancelled:'Cancelled',no_show:'No-show'})[s]||s||'—';
 let ctx,bound=false,epoch=0,dialog=null,query='',period=null,state='',page=1,active=0,periodControl=null,historyEpoch=0,registerTab='stays',sheetOpen=false,historyExport=null;const urls=new Set(),copies=new Map(),loading=new Set();
 const scope=()=>ctx?.getUser()?.id+':'+H()?.prop()?.id;
 function init(context){ctx=context;if(bound)return;bound=true;document.addEventListener('click',click);document.addEventListener('input',filter);document.addEventListener('change',filter)}
 function close(){epoch++;root.BiteCheckinFlow?.closePreview();if(dialog){dialog.close();dialog.remove()}dialog=null;for(const url of urls)root.URL.revokeObjectURL(url);urls.clear();copies.clear();loading.clear()}
 function clear(){historyEpoch++;historyExport=null;registerTab='stays';sheetOpen=false;close();periodControl?.dispose();periodControl=null;query='';period=null;state='';page=1}
 function records(db){
  const guests=new Map((db.guests||[]).map(g=>[g.id,g])),rooms=new Map((db.rooms||[]).map(r=>[r.id,r])),groups=new Map((db.groups||[]).map(g=>[g.id,g])),folios=new Map((db.folios||[]).map(f=>[f.stay_id,f]));
  return(db.stays||[]).map(s=>{const r=s.registration||{},g=guests.get(s.guest_id)||{},f=folios.get(s.id),snap=r.guest_snapshot||{},issued=f?.invoice_snapshot?.guest||{};
   const allIds=[...(Array.isArray(r.additional_ids)?r.additional_ids:[]),...(Array.isArray(r.family_guest_ids)?r.family_guest_ids:[])];
   const uniqueIds=[...new Map(allIds.filter(person=>person&&typeof person==='object').map((person,i)=>[person.subject_key||person.id_front||'legacy-'+i,person])).values()];
   return {id:s.id,guest_id:s.guest_id,group_name:groups.get(s.group_id)?.name||'',room_occupants:r.room_occupants||'',serial:s.register_number??'',entry_date:r.entry_date||(r.registered_at?root.BiteOwner?.day(r.registered_at):'')||s.arrival,arrival:s.arrival,arrival_time:String(s.arrival_time||'').slice(0,5),departure:s.departure,checkout_at:s.checked_out_at||'',name:snap.full_name||issued.name||g.full_name||'Guest',phone:snap.phone??g.phone??'',address:snap.address??issued.address??g.address??'',country:snap.country||r.foreign_details?.nationality||g.country||'India',email:snap.email||g.email||'',id_type:snap.id_type||g.id_type||'',id_last4:snap.id_last4||g.id_last4||'',room:rooms.get(s.room_id)?.number||'—',male:r.male??null,female:r.female??null,children:r.children??s.children??0,arrived_from:r.arrived_from||'',next_destination:r.next_destination||'',transport:r.transport||'',vehicle_number:r.vehicle_number||'',nightly_rate:s.nightly_rate,status:s.status,id_front:r.id_front||'',id_back:r.id_back||'',additional_ids:uniqueIds,foreign:r.foreign_details||null,snapshot:!!r.guest_snapshot,folio_id:f?.id||''};
  }).sort((a,b)=>Number(b.serial||0)-Number(a.serial||0)||String(b.arrival).localeCompare(String(a.arrival)));
 }
 function inPeriod(row,value){
  if(!value)return true;
  const d=String(row.entry_date||'');
  return validEntryDate(d)&&validEntryDate(value.from)&&validEntryDate(value.to)&&value.from<=value.to&&d>=value.from&&d<=value.to;
 }
 function filtered(rows){const q=query.trim().toLocaleLowerCase();return rows.filter(r=>inPeriod(r,period)&&(!state||r.status===state)&&(!q||[r.serial,r.name,r.phone,r.address,r.room,r.arrived_from,r.next_destination,r.vehicle_number,r.group_name,r.room_occupants,...r.additional_ids.map(p=>p.name)].join(' ').toLocaleLowerCase().includes(q)))}
 function exportRows(rows){return [['Serial number','Entry date','Guest name','Mobile','Permanent address','Country','Email','ID type','ID last 4','Check-in date','Arrival time','Expected checkout','Actual checkout','Room','Male','Female','Children','Arriving from','Next destination','Transport','Vehicle number','Agreed rent / night','Status','Lead ID front recorded','Lead ID back recorded','Additional guest names',...foreignFields.map(([,label])=>'Foreign guest · '+label),'Additional guest travel details'],...rows.map(r=>[r.serial,r.entry_date,r.name,r.phone,r.address,r.country,r.email,r.id_type,r.id_last4,r.arrival,r.arrival_time,r.departure,r.checkout_at,r.room,r.male,r.female,r.children,r.arrived_from,r.next_destination,r.transport,r.vehicle_number,verifiedRent(r.nightly_rate)??'',status(r.status),r.id_front?'Yes':'No',r.id_back?'Yes':'No',r.additional_ids.map(p=>p.name).join(', '),...foreignFields.map(([key])=>r.foreign?.[key]||''),r.additional_ids.filter(p=>p.foreign_details).map(p=>p.name+': '+foreignFields.filter(([key])=>p.foreign_details[key]).map(([key,label])=>label+' '+p.foreign_details[key]).join('; ')).join(' | ')])]}
 function render(target){
  periodControl?.dispose();periodControl=null;
  if(!H().has('guest_register')){target.replaceChildren();return}
  target.innerHTML=H().header('Guest register','')+
   '<section class="bh-panel gr-register gr-compact"><div class="gr-title-row"><h2>Guest Register</h2>'+button('new','+ Check-in','','data-gr-primary="true"')+(['owner','manager'].includes(H().prop()?.role)?button('add-past','+ Add old entry','','data-gr-primary="true" hidden'):'')+'</div>'+
   '<nav class="gr-view-tabs" aria-label="Register views">'+[['stays','Guests'],['drafts','Drafts'],['past','Old entries']].map(([value,label])=>button('tab',label,value,'aria-pressed="'+(registerTab===value)+'"')).join('')+'</nav>'+
   '<div class="gr-tools"><label class="bh-field gr-search"><span class="gr-sr-only">Search guests</span><input type="search" data-gr-filter="query" value="'+esc(query)+'" placeholder="Name / mobile / room"></label>'+
   '<div class="gr-period-control" data-gr-period aria-label="Guest register record period"></div>'+
   '<label class="bh-field gr-status-filter"><span class="gr-sr-only">Status</span><select aria-label="Status" data-gr-filter="state"><option value="">All stays</option>'+
   ['in_house','checked_out','reserved','cancelled','no_show'].map(s=>'<option value="'+s+'" '+(state===s?'selected':'')+'>'+status(s)+'</option>').join('')+
   '</select></label><div class="gr-tool-buttons">'+button('reset','All dates')+button('excel','Excel')+button('print','Print')+button('load-history','Refresh','','hidden')+
   '</div></div><div data-gr-table></div><div data-gr-drafts hidden><h3>Unfinished check-in</h3></div><section data-gr-past hidden><h3 class="gr-sr-only">Old guest register</h3><div data-gr-past-editor></div><div data-gr-history role="status"></div></section><div class="gr-bottom-actions">'+button('sheet',sheetOpen?'Hide table':'View table')+'</div></section><details class="bh-panel gr-profiles" '+((H().getWorkspace().stays||[]).length?'':'open')+
   '><summary>Saved guest profiles</summary><div data-gr-profiles></div></details>';
  const picker=root.BiteV3Period,periodBox=target.querySelector('[data-gr-period]');
  if(period&&picker){
   const selectedScope=scope();
   periodControl=picker.mount(periodBox,{
    value:period,today:()=>root.BiteOwner.day(),
    basis:'Entry date',
    isCurrent:()=>target.isConnected&&scope()===selectedScope,
    onApply:async next=>{
     if(!target.isConnected||scope()!==selectedScope)return;
     period=next;page=1;paint(target);
    }
   });
  }else{
   periodBox.innerHTML='<div class="gr-period-all"><div><strong>All dates</strong></div>'+
    (picker?button('choose-period','Select dates'):'<span>Date filter unavailable.</span>')+'</div>';
  }
  paint(target);const profiles=target.querySelector('[data-gr-profiles]'),db=H().getWorkspace();
  profiles.innerHTML=(db.guests||[]).map(g=>'<article class="bh-record"><div><strong>'+esc(g.full_name)+'</strong><p>'+esc(g.phone)+' · '+esc(g.address||g.country)+'</p></div><div class="bh-actions">'+button('repeat','Check in again',g.id)+'<button type="button" class="btn secondary" data-hotel-action="edit-guest" data-id="'+esc(g.id)+'">Edit profile</button>'+(root.BiteGuestDocuments?.button(g.id)||'')+'</div></article>').join('')||'<p>No saved guest profiles yet.</p>';
 }
 function paint(target){historyEpoch++;historyExport=null;target.dataset.grView=registerTab;
  const table=target.querySelector('[data-gr-table]'),drafts=target.querySelector('[data-gr-drafts]'),pastTab=target.querySelector('[data-gr-past]');
  if(table)table.hidden=registerTab!=='stays';
  if(drafts)drafts.hidden=registerTab!=='drafts';
  if(pastTab)pastTab.hidden=registerTab!=='past';
  for(const b of target.querySelectorAll('[data-gr-action="excel"],[data-gr-action="print"],[data-gr-action="sheet"]'))b.hidden=registerTab!=='stays';
  for(const b of target.querySelectorAll('.gr-title-row [data-gr-action="new"]'))b.hidden=registerTab==='past';
  for(const b of target.querySelectorAll('.gr-title-row [data-gr-action="add-past"],[data-gr-action="load-history"]'))b.hidden=registerTab!=='past';
  const statusFilter=target.querySelector('[data-gr-filter="state"]');if(statusFilter)statusFilter.closest('label').hidden=registerTab!=='stays';
  for(const b of target.querySelectorAll('[data-gr-action="tab"]'))b.setAttribute('aria-pressed',String(b.dataset.id===registerTab));
  const past=target.querySelector('[data-gr-history]');if(past)past.replaceChildren();if(registerTab==='past'){void loadHistory(target);return}if(registerTab==='drafts'){
   let draft=null;try{draft=JSON.parse(root.localStorage.getItem('bite_register_draft:'+scope())||'null')}catch{}
   const draftState=root.BiteCheckinGuard?.draftState(draft,H().getWorkspace().stays)||{kind:draft?.fields?'draft':'none',fields:draft?.fields};
   const pending=H().registrationPending();
   drafts.innerHTML='<h3>Unfinished check-in</h3>'+(pending?'<p>Earlier check-in needs verification. Open the check-in form before making a new entry.</p>':['draft','reserved'].includes(draftState.kind)?'<p><strong>'+esc(draftState.fields?.full_name||'Saved guest details')+'</strong> · '+esc(day(draftState.fields?.arrival))+'</p><p>Saved on this device; not a new completed stay.</p>':'<p>No unfinished check-in on this device.</p>')+button('new',pending?'Verify & resume':['draft','reserved'].includes(draftState.kind)?'Open saved draft':'New check-in');return;
  }const all=records(H().getWorkspace()),rows=filtered(all),pages=Math.max(1,Math.ceil(rows.length/50));page=Math.min(page,pages);const visible=rows.slice((page-1)*50,page*50),box=target.querySelector('[data-gr-table]');if(!box)return;
  box.innerHTML='<div class="gr-stay-cards" '+(sheetOpen?'hidden':'')+'>'+visible.map(r=>'<article class="gr-stay-card"><div><button type="button" class="gr-name" data-gr-action="record" data-id="'+esc(r.id)+'">'+esc(r.serial?'ST-'+r.serial+' · ':'')+esc(r.name)+'</button><p>'+esc(day(r.arrival))+' → '+esc(day(r.departure))+' · Room '+esc(r.room)+'</p><small>'+esc(r.phone||'')+' · M / F / C '+esc([r.male,r.female,r.children].map(v=>v==null?'—':v).join(' / '))+'</small></div><span class="gr-status" data-gr-status="'+esc(r.status)+'">'+esc(r.status==='in_house'?'Active':status(r.status))+'</span></article>').join('')+'</div><div class="gr-register-summary"><strong>'+rows.length+' '+(rows.length===1?'entry':'entries')+'</strong><span>'+new Set(rows.map(r=>r.guest_id)).size+' guests</span><span>'+rows.filter(r=>r.status==='in_house').length+' staying</span></div><p class="gr-scroll-hint">Tap a guest for details.</p><div class="gr-sheet-scroll '+(sheetOpen?'gr-sheet-open':'')+'" tabindex="0" role="region" aria-label="Guest register sheet"><table class="gr-sheet"><thead><tr>'+['S.No.','Entry date','Guest / Mobile','Arrival','Checkout','Room','M / F / C','Permanent address','Arriving from','Next destination','Transport / Vehicle','Rent / night','ID photos','Status'].map(s=>'<th scope="col">'+s+'</th>').join('')+'</tr></thead><tbody>'+visible.map(r=>'<tr><td>'+esc(r.serial||'—')+'</td><td>'+esc(day(r.entry_date))+'</td><td><button type="button" class="gr-name" data-gr-action="record" data-id="'+esc(r.id)+'">'+esc(r.name)+'</button><small>'+esc(r.phone)+'</small></td><td>'+esc(day(r.arrival))+'<small>'+esc(r.arrival_time||'Not recorded')+'</small></td><td>'+esc(r.checkout_at?stamp(r.checkout_at):'Expected '+day(r.departure))+'</td><td><strong>'+esc(r.room)+'</strong></td><td>'+esc([r.male,r.female,r.children].map(v=>v==null?'—':v).join(' / '))+'</td><td class="gr-address">'+esc(r.address||'—')+'</td><td>'+esc(r.arrived_from||'—')+'</td><td>'+esc(r.next_destination||'—')+'</td><td>'+esc(r.transport||'—')+'<small>'+esc(r.vehicle_number)+'</small></td><td>'+money(r.nightly_rate)+'</td><td><div class="gr-photo-buttons">'+(r.id_front?button('photo-front','Front',r.id):'<span>Front not saved</span>')+(r.id_back?button('photo-back','Back',r.id):'<span>Back not saved</span>')+'</div></td><td><span class="gr-status">'+esc(status(r.status))+'</span></td></tr>').join('')+'</tbody></table></div>'+(!rows.length?'<p class="bh-empty">'+(all.length?(period?'No records for this period. Select other dates or All dates.':'No records match these filters.'):'No stays have been saved yet. New check-ins will appear here.')+'</p>':'')+'<div class="gr-pagination"><span>Page '+page+' of '+pages+'</span>'+button('previous','Previous','',''+(page===1?'disabled':''))+button('next','Next','',page===pages?'disabled':'')+'</div>';
 }
 function historicalRows(rows,selectedPeriod,search=''){
  if(!Array.isArray(rows))throw Error('Historical records unavailable.');
  if(rows.length>500)throw Error('More than 500 historical entries. Choose a shorter record period.');
  const ids=new Set(),q=String(search).trim().toLocaleLowerCase();
  return rows.filter(r=>{
   if(!r?.id||ids.has(r.id)||!validEntryDate(r.record_date))throw Error('Historical records could not be verified.');
   ids.add(r.id);
   return (!selectedPeriod||inPeriod({entry_date:r.record_date},selectedPeriod))&&(!q||[r.customer_name,r.customer_phone,r.room_number].join(' ').toLocaleLowerCase().includes(q));
  });
 }
 function historicalExportRows(rows){return [['Type','Entry date','Departure date','Guest','Mobile','Room','Guest count','Recorded bill','Recorded received','Payment method'],...rows.map(r=>['Historical',r.record_date,r.departure_date,r.customer_name,r.customer_phone,r.room_number,r.guest_count,verifiedRent(r.amount)??'',verifiedRent(r.received_amount)??'',r.payment_method])]}
 async function loadHistory(target){
  const panel=target?.querySelector('[data-gr-history]'),property=H()?.prop()?.id,user=ctx?.getUser()?.id;
  if(!panel||!property||!user||!H().has('guest_register')||!ctx.sb)return;
  if(!['owner','manager'].includes(H().prop()?.role)){panel.textContent='Historical entries are available to the property owner and manager.';return;}
  historyExport=null;const request=++historyEpoch,key=scope(),selected=period?{...period}:null,search=query;
  const current=()=>request===historyEpoch&&key===scope()&&H()?.has('guest_register')&&target.isConnected&&target.querySelector('[data-gr-history]')===panel;
  panel.textContent='Loading entries…';
  try{
   let q=ctx.sb.from('bite_owner_historical_entries').select('id,record_date,departure_date,customer_name,customer_phone,room_number,amount,received_amount,guest_count,payment_method').eq('entry_kind','room').eq('property_id',property);
   if(selected){if(!validEntryDate(selected.from)||!validEntryDate(selected.to)||selected.from>selected.to)throw Error('Choose a valid record period.');q=q.gte('record_date',selected.from).lte('record_date',selected.to);}
   const {data,error}=await q.order('record_date',{ascending:false}).order('id',{ascending:false}).limit(501);
   if(!current())return;
   if(error)throw Error('Historical records could not be loaded. Retry or check property permissions.');
   const rows=historicalRows(data,selected,search);
   const totalFor=field=>{let cents=0;for(const r of rows){const amount=verifiedRent(r[field]);if(amount===null)return '—';cents+=Math.round(amount*100);if(!Number.isSafeInteger(cents))return '—';}return rows.length?money(cents/100):money(0)};
   historyExport={key,request,rows};panel.innerHTML='<div class="gr-history-summary"><div><small>Entries</small><strong>'+rows.length+'</strong></div><div><small>Recorded bills</small><strong>'+totalFor('amount')+'</strong></div><div><small>Recorded paid</small><strong>'+totalFor('received_amount')+'</strong></div></div><div class="gr-history-head"><strong>'+rows.length+' old '+(rows.length===1?'entry':'entries')+'</strong>'+button('historical-excel','Excel')+'</div>'+
    (rows.length?rows.map(r=>'<article class="gr-old-card"><div class="gr-old-main"><span class="gr-avatar" aria-hidden="true">'+esc((r.customer_name||'Guest').trim().split(/\\s+/).slice(0,2).map(s=>s.charAt(0)).join('').toUpperCase())+'</span><div><strong>'+esc(r.customer_name||'Guest')+'</strong><p>Room '+esc(r.room_number||'—')+' · '+esc(day(r.record_date))+' – '+esc(day(r.departure_date))+'</p><small>'+esc(r.customer_phone||'')+' · '+esc(r.guest_count??'—')+' guests</small></div></div><div class="gr-old-money"><span>Bill <strong>'+money(r.amount)+'</strong></span><span>Paid <strong>'+money(r.received_amount)+'</strong></span></div></article>').join(''):'<div class="gr-empty"><strong>No old entries found.</strong><p>Select other dates or add an old entry.</p></div>');
  }catch(error){if(current())panel.textContent=error.message||'Historical records unavailable. Retry.';}
 }
 function filter(e){const input=e.target.closest('[data-gr-filter]');if(!input)return;const target=input.closest('#guests');if(!target)return;if(input.dataset.grFilter==='query')query=input.value;else if(input.dataset.grFilter==='state')state=input.value;page=1;paint(target)}
 function details(record,photoSide){
  close();const r=record,key=scope(),version=epoch;dialog=document.createElement('dialog');dialog.className='gr-record-dialog';dialog.setAttribute('aria-label','Guest register record');dialog.__record=r;
  const pair=(p,index)=>'<section class="gr-person"><h3>'+esc(p.name)+'</h3>'+(p.foreign_details?'<dl class="gr-record-fields">'+foreignFields.filter(([key])=>p.foreign_details[key]).map(([key,label])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(p.foreign_details[key])+'</dd></div>').join('')+'</dl>':'')+'<div class="gr-id-pair">'+['front','back'].map(side=>'<div class="gr-id-tile" data-gr-copy="'+esc(index+':'+side)+'"><strong>'+ (side==='front'?'Front':'Back')+'</strong><div data-gr-picture>'+(p['id_'+side]?'<span class="gr-photo-placeholder">Saved ID photo</span>':'<span>No copy recorded for this entry.</span>')+'</div>'+(p['id_'+side]?button('view-photo','View photo',p['id_'+side],'data-person="'+index+'" data-side="'+side+'"'):'')+'</div>').join('')+'</div></section>';
  const values=[['Register number',r.serial||'—'],['Entry date',day(r.entry_date)],['Mobile',r.phone||'—'],['Permanent address',r.address||'—'],['Country',r.country],['Email',r.email||'—'],['Room',r.room],['Check-in',day(r.arrival)+' · '+(r.arrival_time||'Time not recorded')],['Expected checkout',day(r.departure)],['Status',status(r.status)],['Male / Female / Children',[r.male,r.female,r.children].map(v=>v==null?'—':v).join(' / ')],['Arriving from',r.arrived_from||'—'],['Next destination',r.next_destination||'—'],['Arrived by',r.transport||'—'],['Vehicle number',r.vehicle_number||'—'],['Agreed rent / night',money(r.nightly_rate)],['ID type / last 4',[r.id_type,r.id_last4].filter(Boolean).join(' · ')||'—']];
  if(r.group_name)values.push(['Family / group booking',r.group_name]);
  if(r.room_occupants)values.push(['Guests staying in this room',r.room_occupants]);
  if(r.checkout_at)values.push(['Actual checkout',stamp(r.checkout_at)]);
  if(r.foreign)for(const [n,l]of[['nationality','Nationality'],['date_of_birth','Date of birth'],['document_type','Travel document'],['document_last4','Travel document last 4'],['document_expiry','Document expiry'],['visa_status','Visa / OCI'],['permission_last4','Permission last 4'],['visa_expiry','Visa expiry'],['india_arrival','Arrival in India'],['entry_port','Place of entry'],['purpose','Purpose']])if(r.foreign[n])values.push([l,r.foreign[n]]);
  dialog.innerHTML='<div class="gr-record-head"><div><small>REGISTER '+esc(r.serial||'ENTRY')+' · ROOM '+esc(r.room)+'</small><h2>'+esc(r.name)+'</h2></div>'+button('close-record','Close ×')+'</div><dl class="gr-record-fields">'+values.map(([l,v])=>'<div><dt>'+esc(l)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl><p class="gr-profile-source">'+(r.snapshot?'Guest details saved with this entry.':'Older entry · Missing personal details use the saved guest profile.')+'</p><h2>ID copies</h2>'+pair({name:r.name,id_front:r.id_front,id_back:r.id_back},0)+r.additional_ids.map((p,i)=>pair(p,i+1)).join('')+'<p class="gr-record-message" role="status"></p><div class="gr-record-footer">'+button('close-record','Back to register')+button('repeat','Check in again',r.guest_id)+(r.folio_id?button('bill','Open guest bill',r.folio_id):'')+button('edit','Edit guest profile',r.guest_id)+'</div>';
  const box=dialog;document.body.append(box);box.addEventListener('cancel',e=>{e.preventDefault();close()});box.showModal();
  for(const side of ['front','back']){const id=r['id_'+side];if(id)void loadPhoto(r,0,side,key,version,box,photoSide===side)}
 }
 function people(r){return[{name:r.name,id_front:r.id_front,id_back:r.id_back},...r.additional_ids]}
 async function loadPhoto(r,index,side,key,version,box,enlarge=false,trigger){
  const person=people(r)[index],id=person?.['id_'+side];if(!id)return;const tile=box.querySelector('[data-gr-copy="'+index+':'+side+'"]');
  if(copies.has(id)){if(enlarge)root.BiteCheckinFlow.viewPhoto(copies.get(id),person.name+' · '+side,trigger||tile?.querySelector('button'));return}
  const request=version+':'+id;if(loading.has(request))return;loading.add(request);active++;if(tile){tile.querySelector('[data-gr-picture]').textContent='Opening private photo…';tile.querySelector('button').disabled=true;}
  try{const file=await root.BiteGuestDocuments.readCopy(r.guest_id,id);if(key!==scope()||version!==epoch||dialog!==box)return;copies.set(id,file);const url=root.URL.createObjectURL(file);urls.add(url);if(tile)tile.querySelector('[data-gr-picture]').innerHTML=file.type==='application/pdf'?'<span class="gr-photo-placeholder">PDF copy · View photo</span>':'<img src="'+url+'" alt="Private '+esc(side)+' ID photo">';if(enlarge)root.BiteCheckinFlow.viewPhoto(file,person.name+' · '+side,trigger||tile?.querySelector('button'))}catch(e){if(key===scope()&&version===epoch&&dialog===box&&tile)tile.querySelector('[data-gr-picture]').textContent=e.message||'Could not open the photo. Retry View photo.'}finally{loading.delete(request);active--;if(dialog===box&&tile?.isConnected)tile.querySelector('button').disabled=false;}
 }
 function printSheet(rows){const win=root.open('','_blank');if(!win)throw Error('Allow pop-ups to print the register.');win.opener=null;const data=[['S.No.','Entry date','Guest','Mobile','Permanent address','Arrival / time','Checkout','Room','M / F / C','Arriving from','Next destination','Transport / vehicle','Rent / night','Status'],...rows.map(r=>[r.serial,r.entry_date,r.name,r.phone,r.address,r.arrival+' '+r.arrival_time,r.checkout_at?stamp(r.checkout_at):'Expected '+day(r.departure),r.room,[r.male,r.female,r.children].map(v=>v==null?'—':v).join('/'),r.arrived_from,r.next_destination,[r.transport,r.vehicle_number].filter(Boolean).join(' / '),money(r.nightly_rate),status(r.status)])];win.document.write('<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Guest register</title><style>body{font:10px system-ui;margin:20px;color:#2e2428}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}th{background:#f6ede5}nav{display:flex;gap:12px;margin-bottom:18px}a,button{padding:10px}@media print{nav{display:none}thead{display:table-header-group}tr{break-inside:avoid}}@page{size:A3 landscape;margin:12mm}</style></head><body><nav><a href="'+esc(new URL('./index.html',root.location.href).href)+'" onclick="window.close();return true">Back to Partner</a><button onclick="window.print()">Print / Save PDF</button></nav><h1>'+esc(H().prop().name)+'</h1><h2>Guest register · '+esc(period&&root.BiteV3Period?.label(period)||'All dates')+'</h2><p>'+rows.length+' entries · ID photos are available privately in Partner.</p><table><thead><tr>'+data[0].map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+data.slice(1).map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></body></html>');win.document.close()}
 function hasUnsavedCheckinChanges(form){
  if(!form)return false;
  return [...form.elements].some(input=>{
   if(!input.name||input.disabled||['hidden','button','submit','reset'].includes(input.type))return false;
   if(input.type==='file')return !!input.files?.length;
   if(input.type==='checkbox'||input.type==='radio')return input.checked!==input.defaultChecked;
   if(input.tagName==='SELECT'){
    const selected=[...input.options].findIndex(option=>option.defaultSelected);
    return input.selectedIndex!==(selected<0?0:selected);
   }
   return String(input.value??'')!==String(input.defaultValue??'');
  });
 }
 function closeCheckin(){const f=document.getElementById('bhCheckinForm');if(!f)return;const dirty=hasUnsavedCheckinChanges(f)||!!H().registrationPending();
  if(!dirty){void H().navigate('rooms');return}close();dialog=document.createElement('dialog');dialog.className='gr-record-dialog gr-close-checkin';dialog.setAttribute('aria-label','Close check-in');dialog.innerHTML='<h2>Close this check-in?</h2><p>Keep the typed details as a draft, or discard this unfinished form. Photos not yet saved must be selected again when resuming.</p><p class="gr-record-message" role="status"></p><div class="bh-actions">'+button('keep-editing','Keep editing')+button('draft-close','Keep draft & close')+(!H().registrationPending()?button('discard-close','Discard & close'):'')+'</div>';document.body.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();close()});dialog.showModal();
 }
 async function click(e){const b=e.target.closest('[data-gr-action]');if(!b)return;e.preventDefault();const action=b.dataset.grAction,id=b.dataset.id;
  try{
   if(action==='close-record'||action==='keep-editing'){close();return}
   if(action==='close-checkin'){closeCheckin();return}
   if(action==='draft-close'||action==='discard-close'){const form=document.getElementById('bhCheckinForm');if(action==='draft-close'){if(!H().persistRegistration(form))throw Error('Draft could not be saved. Keep the form open and retry.');}else H().discardRegistrationDraft();close();root.BiteCheckinFlow.clear();await H().navigate('rooms');return}
   if(action==='open-past'){
    const form=document.getElementById('bhCheckinForm');
    if(form&&hasUnsavedCheckinChanges(form)&&!H().persistRegistration(form))throw Error('Save your current draft before opening past records.');
    registerTab='past';await H().navigate('guests');return;
   }
   if(action==='register'){const form=document.getElementById('bhCheckinForm');if(form?.elements.full_name.value.trim())H().persistRegistration(form);await H().navigate('guests');return}
   if(action==='new'){close();await H().navigate('hotel-register');return}
   if(action==='repeat'){close();await H().useGuest(id);return}
   if(action==='bill'){close();await H().openFolio(id);return}
   if(action==='edit'){close();await H().navigate('guests');document.querySelector('#guests [data-hotel-action="edit-guest"][data-id="'+id+'"]')?.click();if(!document.querySelector('#bhActionEditor'))throw Error('Guest profile is unavailable. Refresh the register.');return}
   if(action==='view-photo'){const box=dialog;if(box?.__record)await loadPhoto(box.__record,Number(b.dataset.person),b.dataset.side,scope(),epoch,box,true,b);return}
   const target=document.getElementById('guests');if(action==='tab'){if(!['stays','drafts','past'].includes(id))return;registerTab=id;page=1;paint(target);return}
   if(action==='sheet'){registerTab='stays';sheetOpen=!sheetOpen;render(target);target.querySelector(sheetOpen?'.gr-sheet-scroll':'.gr-stay-cards')?.scrollIntoView({block:'nearest'});return}
   if(action==='add-past'){
    if(registerTab!=='past'||!['owner','manager'].includes(H().prop()?.role))throw Error('Past record access unavailable.');
    const editor=target.querySelector('[data-gr-past-editor]');
    if(!editor||!root.BiteOwnerHistory?.mountPastRoom)throw Error('Past record form unavailable. Reload Bite.');
    if(!editor.dataset.bheBound){editor.dataset.bheBound='true';editor.addEventListener('bite-past-saved',()=>{if(registerTab==='past')void loadHistory(target);});}
    root.BiteOwnerHistory.mountPastRoom(editor);editor.scrollIntoView({block:'start'});return;
   }
   if(action==='load-history'){await loadHistory(target);return}
   if(action==='historical-excel'){
    if(!historyExport||historyExport.key!==scope()||historyExport.request!==historyEpoch||registerTab!=='past'||!H().has('guest_register')||!['owner','manager'].includes(H().prop()?.role))throw Error('Refresh historical records before exporting.');
    const rows=historicalExportRows(historyExport.rows);
    root.BiteExports.download(root.BiteExports.workbook(rows),'Bite-Historical-Guest-Register-'+(period?period.from+'-'+period.to:'All')+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return;
   }if(action==='record'||action==='photo-front'||action==='photo-back'){const r=records(H().getWorkspace()).find(r=>r.id===id);if(r)details(r,action==='photo-front'?'front':action==='photo-back'?'back':null);return}
   if(action==='previous'||action==='next'){page+=action==='next'?1:-1;paint(target);return}
   if(action==='choose-period'){const picker=root.BiteV3Period,today=root.BiteOwner?.day?.();if(!picker||!today)throw Error('Record period picker is not ready.');period=picker.normalize({mode:'month',month:today.slice(0,7)},today);page=1;render(target);target.querySelector('[data-bv3-period-toggle]')?.click();return}
   if(action==='reset'){query='';period=null;state='';page=1;render(target);return}
   if(action==='excel'){root.BiteExports.download(root.BiteExports.workbook(exportRows(filtered(records(H().getWorkspace())))),'Bite-Guest-Register-'+(period?period.from+'-'+period.to:'All')+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return}
   if(action==='print')printSheet(filtered(records(H().getWorkspace())));
  }catch(error){if(dialog)dialog.querySelector('.gr-record-message')?.replaceChildren(document.createTextNode(error.message||String(error)));else root.alert(error.message||String(error))}
 }
 const api={init,clear,busy:()=>!!dialog||active>0,render,records,exportRows,inPeriod,verifiedRent,historicalRows,historicalExportRows,hasUnsavedCheckinChanges};root.BiteGuestRegister=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
