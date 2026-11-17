/* Check-in interactions: saved guest suggestions and private, sequential party-ID capture. */
(function(root){
 'use strict';
 let dialog=null,dialogForm=null;const urls=new Set(),previews=new WeakMap();
 const H=()=>root.BiteHospitality;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uuid=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s||'');
 const fail=(field,text)=>Object.assign(Error(text),{field});
 const field=(n,label,value='',extra='')=>'<label class="bh-field"><span>'+esc(label)+'</span><input name="'+n+'" value="'+esc(value)+'" '+extra+'></label>';
 const count=form=>['male','female','children'].reduce((n,key)=>n+Number(form.elements[key]?.value||0),0);
 function matches(guests,query){
  const q=String(query||'').trim().toLocaleLowerCase(),digits=/^[+\d ()-]+$/.test(q)?q.replace(/\D/g,''):'';if(!q)return [];
  return guests.filter(g=>String(g.full_name).toLocaleLowerCase().includes(q)||(digits&&String(g.phone).replace(/\D/g,'').includes(digits))).sort((a,b)=>Number(String(b.full_name).toLocaleLowerCase().startsWith(q))-Number(String(a.full_name).toLocaleLowerCase().startsWith(q))).slice(0,6);
 }
 function profile(guest,stays){
  const prior=stays.filter(s=>s.guest_id===guest.id&&s.registration).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]?.registration||{};
  return {...Object.fromEntries(['full_name','phone','address','country','email','id_type','id_last4'].map(k=>[k,guest[k]||''])),...Object.fromEntries(['arrived_from','next_destination','transport','vehicle_number'].map(k=>[k,prior[k]||'']))};
 }
 function close(){
  if(dialog){dialog.close();dialog.remove()}dialog=null;dialogForm=null;
 }
 function clear(){close();for(const url of urls)root.URL.revokeObjectURL(url);urls.clear()}
 function names(key){return key?{front:'party_'+key+'_front',back:'party_'+key+'_back',frontId:'party_'+key+'_front_id',backId:'party_'+key+'_back_id',name:'party_'+key+'_name'}:{front:'id_front',back:'id_back',frontId:'id_front_id',backId:'id_back_id',name:'full_name'}}
 function card(key,data={}){
  const n=names(key),front=!!data.id_front;
  return '<div class="ha-id-card" data-ha-id-card="'+esc(key||'lead')+'">'+(key?'<div class="ha-id-person">'+field(n.name,'Guest name on ID *',data.name||'','required maxlength="120" autocomplete="off"')+'<button type="button" class="ha-text-button" data-id-remove="'+key+'" aria-label="Remove this additional guest ID">Remove</button></div>':'<div class="ha-id-person"><strong>Lead guest ID</strong><span class="ha-required-tag">Required</span></div>')+
   '<input type="file" name="'+n.front+'" accept="image/jpeg,image/png,application/pdf" hidden '+(front?'':'required')+'><input type="file" name="'+n.back+'" accept="image/jpeg,image/png,application/pdf" hidden '+(data.id_back?'':'required')+'>'+
   '<input type="hidden" name="'+n.frontId+'" value="'+esc(data.id_front||'')+'"><input type="hidden" name="'+n.backId+'" value="'+esc(data.id_back||'')+'">'+
   '<div class="ha-id-capture-row"><span class="ha-id-symbol" aria-hidden="true">▣</span><div><strong data-id-title>'+esc(front?'ID front saved':'Add ID photos')+'</strong><small '+(!key?'data-front-status':'')+' data-id-status>Front and back required</small></div><button type="button" class="btn secondary" data-id-open="'+esc(key||'lead')+'" data-ha-focus="'+n.front+'">'+(front?'Review ID':'Add photos')+'</button></div></div>';
 }
 function extraRows(form){return [...form.querySelectorAll('[data-ha-party-list] [data-ha-id-card]')]}
 function additional(form){return extraRows(form).map(row=>{const key=row.dataset.haIdCard,n=names(key),foreign=root.BiteCheckinGuard?.readForeign(form,key);return{subject_key:key,name:form.elements[n.name].value.trim(),id_front:form.elements[n.frontId].value||null,id_back:form.elements[n.backId].value||null,...(foreign?{foreign_details:foreign}:{})}})}
 function sync(form){
  form.elements.additional_ids.value=JSON.stringify(additional(form));
  for(const row of form.querySelectorAll('[data-ha-id-card]')){
   const key=row.dataset.haIdCard==='lead'?null:row.dataset.haIdCard,n=names(key),front=form.elements[n.front].files[0]||form.elements[n.frontId].value,back=form.elements[n.back].files[0]||form.elements[n.backId].value;
   row.querySelector('[data-id-title]').textContent=front?'ID front added':'Add ID photos';
   row.querySelector('[data-id-status]').textContent=front?(back?'Front and back added':'Add the required back photo'):'Front and back required';
   row.querySelector('[data-id-open]').textContent=front?(back?'Review ID':'Add back photo'):'Add photos';form.elements[n.front].required=!form.elements[n.frontId].value;form.elements[n.back].required=!form.elements[n.backId].value;
   row.querySelector('[data-id-open]').dataset.haFocus=front&&!back?n.back:n.front;
  }
  const counter=form.querySelector('[data-id-counter]');if(counter)counter.textContent=(1+extraRows(form).length)+' ID '+(1+extraRows(form).length===1?'record':'records')+' · '+count(form)+' guests';
 }
 function changed(form){sync(form);form.dispatchEvent(new Event('input',{bubbles:true}))}
 function picture(file){
  if(!file)return '';if(file.type==='application/pdf')return '<div class="ha-id-preview-pdf">PDF copy selected</div>';
  let url=previews.get(file);if(!url){url=root.URL.createObjectURL(file);previews.set(file,url);urls.add(url)}
  return '<img class="ha-id-preview" src="'+url+'" alt="Selected private ID photo">';
 }
 function open(form,key){
  close();const n=names(key),row=form.querySelector('[data-ha-id-card="'+(key||'lead')+'"]'),trigger=row.querySelector('[data-id-open]');
  if(key&&!form.elements[n.name].value.trim()){root.BiteHotelAccounts.showRegisterError(form,fail(n.name,'Enter the guest name on this ID.'));return}
  dialog=document.createElement('dialog');dialog.className='ha-id-dialog';dialogForm=form;
  dialog.innerHTML='<div class="ha-id-dialog-head"><div><p class="bh-eyebrow">'+esc(key?form.elements[n.name].value:'Lead guest')+'</p><h2>ID photos</h2></div><button type="button" class="ha-dialog-close" aria-label="Close ID photos">×</button></div><div data-id-stage></div><input type="file" data-id-camera accept="image/jpeg,image/png" capture="environment" hidden><input type="file" data-id-upload accept="image/jpeg,image/png,application/pdf" hidden>';
  document.body.append(dialog);let stage=(form.elements[n.front].files[0]||form.elements[n.frontId].value)&&!(form.elements[n.back].files[0]||form.elements[n.backId].value)?'back':'front',checking=false;const box=dialog,body=box.querySelector('[data-id-stage]'),camera=box.querySelector('[data-id-camera]'),upload=box.querySelector('[data-id-upload]');
  const done=()=>{close();if(form.isConnected)trigger.focus({preventScroll:true})};
  box.querySelector('.ha-dialog-close').addEventListener('click',done);box.addEventListener('cancel',e=>{e.preventDefault();done()});
  function draw(){
   const input=form.elements[n[stage]],saved=!!form.elements[n[stage+'Id']].value,file=input.files[0],front=stage==='front';
   body.innerHTML='<div class="ha-id-progress"><span class="'+(front?'active':'complete')+'">1 · Front</span><span class="'+(!front?'active':'')+'">2 · Back · Required</span></div><h3>'+ (front?'Capture the ID front':'Add the ID back')+'</h3><p>'+ (front?'Keep the photo clear and mask information that is not needed. Large JPEG / PNG photos are resized on this device.':'Take a clear photo of the ID back to finish.')+'</p>'+picture(file)+(saved&&!file?'<p class="ha-saved-id">Copy already saved privately</p>':'')+'<p class="ha-camera-error" role="alert"></p><div class="ha-id-choice"><button type="button" class="btn" data-capture>Take photo</button><button type="button" class="btn secondary" data-upload>Upload from device</button></div><div class="ha-id-dialog-actions">'+(!front?'<button type="button" class="btn secondary" data-prev>Back</button>':'')+'<button type="button" class="btn" data-next '+(!file&&!saved?'disabled':'')+'>'+(front?'Continue':'Done')+'</button></div>';
   body.querySelector('[data-capture]').onclick=()=>{camera.value='';camera.click()};body.querySelector('[data-upload]').onclick=()=>{upload.value='';upload.click()};
   body.querySelector('[data-prev]')?.addEventListener('click',()=>{stage='front';draw()});
   body.querySelector('[data-next]').onclick=()=>{if(checking)return;if(stage==='back'){changed(form);done();return}stage='back';draw();camera.value='';camera.click()};
  }
  async function choose(input){
   const original=input.files[0];if(!original||checking)return;const chosenStage=stage;checking=true;body.querySelectorAll('button').forEach(b=>b.disabled=true);body.querySelector('.ha-camera-error').textContent='Preparing a clear ID copy…';
   try{
    const file=await root.BiteGuestDocuments.prepare(original);if(dialog!==box||!form.isConnected)return;
    const transfer=new DataTransfer();transfer.items.add(file);form.elements[n[chosenStage]].files=transfer.files;
    form.elements[n[chosenStage+'Id']].value='';
    if(chosenStage==='front'){form.elements[n.back].value='';form.elements[n.backId].value=''}
    form.elements[n[chosenStage]].dispatchEvent(new Event('change',{bubbles:true}));changed(form);draw();
   }catch(error){if(dialog===box)body.querySelector('.ha-camera-error').textContent=error.message||String(error)}
   finally{checking=false;if(dialog===box){body.querySelectorAll('button').forEach(b=>b.disabled=false);body.querySelector('[data-next]').disabled=!form.elements[n[stage]].files[0]&&!form.elements[n[stage+'Id']].value}}
  }
  camera.onchange=()=>void choose(camera);upload.onchange=()=>void choose(upload);draw();box.showModal();
 }
 function decorate(form,draft={}){
  const db=H().getWorkspace(),picker=form.elements.guest_id,returning=form.querySelector('.ha-returning');
  picker.hidden=true;picker.setAttribute('aria-hidden','true');picker.tabIndex=-1;returning.before(picker);returning.remove();
  const chip=document.createElement('div');chip.className='ha-saved-guest';chip.hidden=true;chip.innerHTML='<span data-selected-guest></span><button type="button" class="ha-text-button">Change guest</button>';
  form.elements.full_name.closest('label').before(chip);
  let selected=db.guests.find(g=>g.id===picker.value)||null;
  function selection(){chip.hidden=!selected;chip.querySelector('span').textContent=selected?'Saved guest · '+selected.full_name:''}
  function detach(edited){
   selected=null;picker.value='';picker.dispatchEvent(new Event('change',{bubbles:true}));
   for(const key of ['full_name','phone','address','country','email','id_type','id_last4','arrived_from','next_destination','vehicle_number'])if(key!==edited)form.elements[key].value=key==='country'?'India':'';
   form.elements.transport.value='Bus';form.elements.transport.dispatchEvent(new Event('change',{bubbles:true}));root.BiteCheckinGuard?.selectedGuest(form,null);selection();
  }
  chip.querySelector('button').onclick=()=>{detach();changed(form);form.elements.full_name.focus()};
  for(const key of ['full_name','phone']){
   const input=form.elements[key],label=input.closest('label'),wrapper=document.createElement('div');wrapper.className='ha-guest-lookup';label.before(wrapper);wrapper.append(label);
   const list=document.createElement('div');list.className='ha-guest-matches';list.id='ha-guests-'+key;list.setAttribute('role','listbox');list.setAttribute('aria-label','Saved guest suggestions');list.hidden=true;wrapper.append(list);
   input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');input.autocomplete='off';
   if(key==='full_name')input.dataset.guestSearch='';
   let results=[],index=-1;
   const hide=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');index=-1};
   function choose(id){
    const guest=db.guests.find(g=>g.id===id);if(!guest)return;
    picker.innerHTML='<option value=""></option>'+db.guests.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.full_name)+'</option>').join('');picker.value=id;picker.dispatchEvent(new Event('change',{bubbles:true}));
    for(const [name,value]of Object.entries(profile(guest,db.stays||[])))form.elements[name].value=value||(name==='country'?'India':name==='transport'?'Bus':'');
    form.elements.transport.dispatchEvent(new Event('change',{bubbles:true}));selected=guest;selection();hide();root.BiteCheckinGuard?.selectedGuest(form,guest);changed(form);
   }
   form.__haSelectGuest=choose;
   function show(){
    results=matches(db.guests,input.value);index=-1;
    if(!input.value.trim()||selected){hide();return}
    list.innerHTML=results.length?'<small class="ha-suggestion-title">Saved guests</small>'+results.map((g,i)=>'<button type="button" role="option" aria-selected="false" tabindex="-1" id="'+list.id+'-'+i+'" data-guest-suggestion="'+esc(g.id)+'"><span class="ha-guest-avatar" aria-hidden="true">'+esc(String(g.full_name).trim().charAt(0).toUpperCase())+'</span><span><strong>'+esc(g.full_name)+'</strong><small>'+esc(g.phone)+(g.address?' · '+esc(g.address):'')+'</small></span><span aria-hidden="true">↗</span></button>').join(''):'<p class="ha-no-guests">No saved guest found. Continue with these details.</p>';
    list.hidden=false;input.setAttribute('aria-expanded','true');
    const rect=input.getBoundingClientRect(),vv=root.visualViewport,top=Math.max(vv?.offsetTop||0,document.querySelector('#mainApp>.main>.top')?.getBoundingClientRect().bottom||0),bottom=(vv?.offsetTop||0)+(vv?.height||root.innerHeight),below=bottom-rect.bottom-16,above=rect.top-top-16;
    const upward=below<150&&above>below;list.style.top=upward?'auto':'calc(100% - 10px)';list.style.bottom=upward?'calc(100% + 6px)':'auto';list.style.maxHeight=Math.max(70,Math.min(300,upward?above:below))+'px';
   }
   input.addEventListener('input',()=>{if(selected)detach(key);show()});input.addEventListener('focus',show);
   input.addEventListener('keydown',e=>{
    if(e.key==='Escape'){hide();return}
    if(['ArrowDown','ArrowUp'].includes(e.key)&&results.length){e.preventDefault();if(list.hidden)show();index=index<0?(e.key==='ArrowDown'?0:results.length-1):(index+(e.key==='ArrowDown'?1:-1)+results.length)%results.length;list.querySelectorAll('[role=option]').forEach((el,i)=>el.setAttribute('aria-selected',String(i===index)));input.setAttribute('aria-activedescendant',list.id+'-'+index);list.children[index+1]?.scrollIntoView({block:'nearest'});}
    if(e.key==='Enter'&&!list.hidden&&index>=0){e.preventDefault();choose(results[index].id)}
   });
   list.addEventListener('pointerdown',e=>e.preventDefault());list.addEventListener('click',e=>{const b=e.target.closest('[data-guest-suggestion]');if(b)choose(b.dataset.guestSuggestion)});
   input.addEventListener('blur',()=>{root.setTimeout(()=>{if(!wrapper.contains(document.activeElement))hide()},100)});
  }
  selection();
  let extras=[];try{const parsed=JSON.parse(draft.additional_ids||'[]');if(Array.isArray(parsed))extras=parsed.filter(x=>uuid(x.subject_key)).slice(0,39)}catch{}
  const section=form.querySelector('.ha-id-section'),consent=section.querySelector('.bh-check');
  section.innerHTML='<div class="ha-id-heading"><div><h3>Guest IDs</h3><p>Add both sides of each guest’s ID.</p></div><small data-id-counter></small></div>'+card(null,{id_front:draft.id_front_id,id_back:draft.id_back_id})+'<div data-ha-party-list>'+extras.map(x=>card(x.subject_key,x)).join('')+'</div><input type="hidden" name="additional_ids" value=""><button type="button" class="btn secondary ha-add-id" data-add-id>＋ Add another guest ID</button>';
  section.append(consent);section.insertAdjacentHTML('beforeend','<small class="ha-id-private-note">ID copies stay private to authorized hotel staff.</small>');
  const holder=section.querySelector('[data-ha-party-list]');
  form.addEventListener('click',e=>{
   const opener=e.target.closest('[data-id-open]');if(opener){e.preventDefault();open(form,opener.dataset.idOpen==='lead'?null:opener.dataset.idOpen)}
   if(e.target.closest('[data-add-id]')){
    if(extraRows(form).length>=Math.min(39,count(form)-1)){root.BiteHotelAccounts.showRegisterError(form,fail('male','Increase the guest count before adding another guest ID.'));return}
    const key=root.crypto.randomUUID();holder.insertAdjacentHTML('beforeend',card(key));root.BiteCheckinGuard?.person(form,key);changed(form);const input=form.elements[names(key).name];input.focus({preventScroll:true});input.closest('[data-ha-id-card]').scrollIntoView({block:'center'});
   }
   const remove=e.target.closest('[data-id-remove]');if(remove){remove.closest('[data-ha-id-card]').remove();changed(form)}
  });
  form.addEventListener('input',()=>sync(form));form.addEventListener('change',e=>{if(e.target.type==='file'&&e.target.files[0]){const name=e.target.name;if(form.elements[name+'_id'])form.elements[name+'_id'].value=''}sync(form)});
  picker.addEventListener('change',()=>{selected=db.guests.find(g=>g.id===picker.value)||null;for(const extra of extraRows(form)){const n=names(extra.dataset.haIdCard);form.elements[n.frontId].value='';form.elements[n.backId].value=''}selection();sync(form)});
  if(draft.stay_id){section.querySelectorAll('button,input:not([type=hidden])').forEach(el=>el.disabled=true);chip.querySelector('button').disabled=true}
  sync(form);
 }
 function prepare(form){
  if(extraRows(form).length>count(form)-1)throw fail('male','The number of guest IDs exceeds the guest count. Update the count or remove an extra ID.');
  if(form.dataset.stayId)return;
  for(const row of extraRows(form)){const n=names(row.dataset.haIdCard);if(!form.elements[n.name].value.trim())throw fail(n.name,'Enter the guest name on this ID.');if(!form.elements[n.front].files[0]&&!form.elements[n.frontId].value)throw fail(n.front,'Add the ID front for this guest.');if(!form.elements[n.back].files[0]&&!form.elements[n.backId].value)throw fail(n.back,'Add the ID back for this guest.');}
 }
 function subjects(form){return [null,...extraRows(form).map(row=>row.dataset.haIdCard)].map(key=>({key,names:names(key)}))}
 const api={decorate,prepare,additional,subjects,sync,clear,busy:()=>!!dialog,guestMatches:matches,savedProfile:profile};
 root.BiteCheckinFlow=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
