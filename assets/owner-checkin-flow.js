/* Check-in interactions: saved guest suggestions and private, sequential party-ID capture. */
(function(root){
 'use strict';
 let dialog=null,dialogForm=null,viewer=null,dialogCleanup=null;const urls=new Set(),previews=new WeakMap();
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
 function closeViewer(){if(viewer){viewer.close();viewer.remove()}viewer=null}
 function close(){
  closeViewer();dialogCleanup?.();dialogCleanup=null;
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
 function sideValue(form,n,side){return {file:form.elements[n[side]].files[0]||null,id:form.elements[n[side+'Id']].value||''}}
 function forget(file){const url=file&&previews.get(file);if(url){root.URL.revokeObjectURL(url);urls.delete(url);previews.delete(file)}}
 function removePhoto(form,key,side){
  const n=names(key),input=form.elements[n[side]],saved=!!form.elements[n[side+'Id']].value;forget(input.files[0]);input.value='';form.elements[n[side+'Id']].value='';
  if(form.elements.id_checked)form.elements.id_checked.checked=false;
  input.dispatchEvent(new Event('change',{bubbles:true}));changed(form);return saved;
 }
 function thumbnail(file,side){return file?.type==='application/pdf'?'<span class="ha-id-pdf-thumb">PDF</span>':file?picture(file,true,side+' ID photo'):'<span class="ha-id-empty-thumb" aria-hidden="true">▣</span>'}
 function sync(form){
  form.elements.additional_ids.value=JSON.stringify(additional(form));
  for(const row of form.querySelectorAll('[data-ha-id-card]')){
   const key=row.dataset.haIdCard==='lead'?null:row.dataset.haIdCard,n=names(key),front=sideValue(form,n,'front'),back=sideValue(form,n,'back'),hasFront=!!(front.file||front.id),hasBack=!!(back.file||back.id);
   row.querySelector('[data-id-title]').textContent=hasFront||hasBack?'Guest ID photos':'Add ID photos';
   row.querySelector('[data-id-status]').textContent=hasFront?(hasBack?'Front and back added':'Add the required back photo'):hasBack?'Add the required front photo':'Front and back required';
   row.querySelector('[data-id-open]').textContent=hasFront?(hasBack?'Review ID':'Add back photo'):'Add photos';
   form.elements[n.front].required=!front.id;form.elements[n.back].required=!back.id;row.querySelector('[data-id-open]').dataset.haFocus=hasFront&&!hasBack?n.back:n.front;
   const files=[front.file,back.file];for(const old of row.__photoFiles||[])if(old&&!files.includes(old))forget(old);row.__photoFiles=files;
   let tiles=row.querySelector('[data-id-thumbnails]');if(!tiles){tiles=document.createElement('div');tiles.dataset.idThumbnails='';tiles.className='ha-id-thumbnails';row.append(tiles)}
   tiles.hidden=!hasFront&&!hasBack;
   const signature=[front.file,front.id,back.file,back.id];if(!row.__photoSignature||signature.some((v,i)=>row.__photoSignature[i]!==v)){
    row.__photoSignature=signature;tiles.innerHTML=['front','back'].map(side=>{const v=side==='front'?front:back,has=!!(v.file||v.id),label=side==='front'?'Front':'Back';return '<div class="ha-id-side"><button type="button" class="ha-id-thumb" data-id-side="'+side+'" data-id-key="'+esc(key||'lead')+'" aria-label="'+(has?'View ':'Add ')+side+' photo">'+thumbnail(v.file,side)+'<strong>'+label+'</strong><small>'+(has?(v.id?'Saved copy · View':'View photo'):'Required · Add photo')+'</small></button>'+(has?'<button type="button" class="ha-text-button ha-id-remove-photo" data-id-remove-side="'+side+'" data-id-key="'+esc(key||'lead')+'" aria-label="Remove '+side+' photo">Remove'+(v.id?' from check-in':'')+'</button>':'')+'</div>'}).join('');
   }
  }
  const counter=form.querySelector('[data-id-counter]');if(counter)counter.textContent=(1+extraRows(form).length)+' ID '+(1+extraRows(form).length===1?'record':'records')+' · '+count(form)+' guests';
 }
 function changed(form){sync(form);form.dispatchEvent(new Event('input',{bubbles:true}))}
 function picture(file,small=false,label='Selected private ID photo'){
  if(!file)return '';if(file.type==='application/pdf')return '<div class="ha-id-preview-pdf">PDF copy ready · View larger to inspect</div>';
  let url=previews.get(file);if(!url){url=root.URL.createObjectURL(file);previews.set(file,url);urls.add(url)}
  return '<img class="'+(small?'ha-id-thumb-image':'ha-id-preview')+'" src="'+url+'" alt="'+esc(label)+'">';
 }
 function enlarge(file,side,returnTo){
  closeViewer();viewer=document.createElement('dialog');viewer.className='ha-photo-viewer';viewer.setAttribute('aria-label',(side==='front'?'Front':'Back')+' ID photo');
  picture(file);const url=previews.get(file)||root.URL.createObjectURL(file);if(!previews.has(file)){previews.set(file,url);urls.add(url)}
  viewer.innerHTML='<div class="ha-photo-viewer-head"><strong>'+(side==='front'?'Front':'Back')+' photo</strong><button type="button" class="btn secondary" data-viewer-close>Back to ID photos</button></div><div class="ha-photo-zoom-area">'+(file.type==='application/pdf'?'<iframe src="'+url+'" title="Private ID PDF" sandbox></iframe>':'<img src="'+url+'" alt="Private '+side+' ID photo">')+'</div>'+(file.type!=='application/pdf'?'<button type="button" class="btn secondary" data-photo-zoom aria-pressed="false">Zoom in</button>':'');
  const box=viewer;document.body.append(box);box.querySelector('[data-viewer-close]').onclick=()=>{closeViewer();if(returnTo?.isConnected)returnTo.focus()};box.addEventListener('cancel',e=>{e.preventDefault();closeViewer();if(returnTo?.isConnected)returnTo.focus()});
  box.querySelector('[data-photo-zoom]')?.addEventListener('click',e=>{const zoom=!box.classList.contains('zoomed');box.classList.toggle('zoomed',zoom);e.target.textContent=zoom?'Fit photo':'Zoom in';e.target.setAttribute('aria-pressed',String(zoom))});box.showModal();
 }
 function open(form,key,preferred){
  close();const n=names(key),row=form.querySelector('[data-ha-id-card="'+(key||'lead')+'"]'),trigger=row.querySelector('[data-id-open]');
  if(key&&!form.elements[n.name].value.trim()){root.BiteHotelAccounts.showRegisterError(form,fail(n.name,'Enter the guest name on this ID.'));return}
  dialog=document.createElement('dialog');dialog.className='ha-id-dialog';dialog.setAttribute('aria-label','Guest ID photos');dialogForm=form;
  dialog.innerHTML='<div class="ha-id-dialog-head"><div><p class="bh-eyebrow">'+esc(key?form.elements[n.name].value:'Lead guest')+'</p><h2>ID photos</h2></div><button type="button" class="ha-dialog-close" aria-label="Close ID photos">×</button></div><div data-id-stage></div><input type="file" data-id-camera accept="image/jpeg,image/png" capture="environment" hidden><input type="file" data-id-upload accept="image/jpeg,image/png,application/pdf" hidden>';
  document.body.append(dialog);let stage=preferred||((sideValue(form,n,'front').file||sideValue(form,n,'front').id)&&!(sideValue(form,n,'back').file||sideValue(form,n,'back').id)?'back':'front'),checking=false,message='';
  const box=dialog,body=box.querySelector('[data-id-stage]'),camera=box.querySelector('[data-id-camera]'),upload=box.querySelector('[data-id-upload]'),cache=new Map(),loading=new Set(),failed=new Map(),guest=form.elements.guest_id.value,property=H().prop().id;
  const current=()=>dialog===box&&form.isConnected&&form.elements.guest_id.value===guest&&H().prop()?.id===property;
  const value=side=>{const v=sideValue(form,n,side);return {...v,photo:v.file||cache.get(v.id),has:!!(v.file||v.id)}};
  dialogCleanup=()=>{for(const photo of cache.values())forget(photo);cache.clear()};
  const done=()=>{close();if(form.isConnected)trigger.focus({preventScroll:true})};box.querySelector('.ha-dialog-close').addEventListener('click',done);box.addEventListener('cancel',e=>{e.preventDefault();done()});
  async function loadSaved(side){const id=sideValue(form,n,side).id;if(!id||cache.has(id)||loading.has(id)||failed.has(id))return;loading.add(id);
   try{const file=await root.BiteGuestDocuments.readCopy(guest,id);if(!current()||sideValue(form,n,side).id!==id)return;cache.set(id,file)}catch(e){if(current())failed.set(id,e.message||'Photo unavailable. Retry or retake it.')}finally{loading.delete(id);if(current())draw()}
  }
  function draw(){
   if(!current())return;const v=value(stage),front=stage==='front',both=value('front').has&&value('back').has;
   body.innerHTML='<p class="ha-id-flow-note">Front → Back → Check both photos</p><div class="ha-id-review-pair">'+['front','back'].map(side=>{const x=value(side);return '<button type="button" class="ha-id-review-tab '+(stage===side?'active':'')+'" data-select-side="'+side+'" aria-pressed="'+(stage===side)+'">'+thumbnail(x.photo,side)+'<strong>'+(side==='front'?'1 · Front':'2 · Back')+'</strong><small>'+(x.has?(x.photo?'View / change':'Saved privately'):'Required')+'</small></button>'}).join('')+'</div><h3>'+(front?(v.has?'Check the ID front':'Capture the ID front'):'Add the ID back')+'</h3><p>'+(front?'Check the photo before continuing to the back.':'Check both photos above. You can change either side before finishing.')+'</p>'+
    (v.photo?'<button type="button" class="ha-id-large-preview" data-enlarge aria-label="View '+stage+' photo enlarged">'+picture(v.photo)+'</button>':v.id?'<p class="ha-saved-id" role="status">'+esc(failed.get(v.id)||'Opening saved private photo…')+'</p>':'')+
    (v.id&&failed.has(v.id)?'<button type="button" class="btn secondary" data-retry-photo>Retry saved photo</button>':'')+'<p class="ha-camera-error" role="status">'+esc(checking?'Preparing a clear ID copy…':message)+'</p><div class="ha-id-choice"><button type="button" class="btn" data-capture>'+(v.has?'Retake photo':'Take photo')+'</button><button type="button" class="btn secondary" data-upload>'+(v.has?'Replace from device':'Upload from device')+'</button></div>'+
    (v.has?'<div class="ha-id-photo-tools">'+(v.photo?'<button type="button" class="ha-text-button" data-view-large>View larger</button>':'')+'<button type="button" class="ha-text-button ha-id-remove-photo" data-remove-photo>'+(v.id?'Remove from this check-in':'Remove photo')+'</button></div>':'')+
    '<div class="ha-id-dialog-actions">'+(!front?'<button type="button" class="btn secondary" data-prev>Back to front</button>':'')+'<button type="button" class="btn" data-next '+(!(front?v.has:both)||checking?'disabled':'')+'>'+(front?'Continue to back':'Use these photos')+'</button></div>';
   body.querySelectorAll('[data-select-side]').forEach(b=>b.onclick=()=>{stage=b.dataset.selectSide;message='';draw()});
   body.querySelector('[data-capture]').onclick=()=>{camera.value='';camera.click()};body.querySelector('[data-upload]').onclick=()=>{upload.value='';upload.click()};
   const zoom=b=>enlarge(v.photo,stage,b);body.querySelector('[data-enlarge]')?.addEventListener('click',e=>zoom(e.currentTarget));body.querySelector('[data-view-large]')?.addEventListener('click',e=>zoom(e.currentTarget));
   body.querySelector('[data-remove-photo]')?.addEventListener('click',()=>{if(checking)return;closeViewer();const saved=removePhoto(form,key,stage);if(v.id&&cache.has(v.id)){forget(cache.get(v.id));cache.delete(v.id)}message=saved?'Removed from this check-in. The saved copy remains in guest history.':'Photo removed. Add the correct photo to continue.';draw()});
   body.querySelector('[data-retry-photo]')?.addEventListener('click',()=>{failed.delete(v.id);void loadSaved(stage);draw()});
   body.querySelector('[data-prev]')?.addEventListener('click',()=>{stage='front';message='';draw()});
   body.querySelector('[data-next]').onclick=()=>{if(checking)return;if(stage==='back'){if(!both)return;changed(form);done();return}stage='back';message='';draw();if(!value('back').has){camera.value='';camera.click()}};
   if(checking)body.querySelectorAll('button').forEach(b=>b.disabled=true);
   for(const side of ['front','back'])if(sideValue(form,n,side).id)void loadSaved(side);
  }
  async function choose(input){
   const original=input.files[0];if(!original||checking)return;const chosenStage=stage;checking=true;message='';draw();
   try{const file=await root.BiteGuestDocuments.prepare(original);if(!current())return;const transfer=new DataTransfer();transfer.items.add(file);forget(form.elements[n[chosenStage]].files[0]);form.elements[n[chosenStage]].files=transfer.files;form.elements[n[chosenStage+'Id']].value='';if(form.elements.id_checked)form.elements.id_checked.checked=false;form.elements[n[chosenStage]].dispatchEvent(new Event('change',{bubbles:true}));changed(form);if(chosenStage==='front'&&!value('back').has)stage='back'}catch(error){if(current())message=error.message||String(error)}finally{checking=false;if(current())draw()}
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
   const side=e.target.closest('[data-id-side]');if(side){e.preventDefault();open(form,side.dataset.idKey==='lead'?null:side.dataset.idKey,side.dataset.idSide);return}
   const removeSide=e.target.closest('[data-id-remove-side]');if(removeSide){e.preventDefault();removePhoto(form,removeSide.dataset.idKey==='lead'?null:removeSide.dataset.idKey,removeSide.dataset.idRemoveSide);return}
   const opener=e.target.closest('[data-id-open]');if(opener){e.preventDefault();open(form,opener.dataset.idOpen==='lead'?null:opener.dataset.idOpen)}
   if(e.target.closest('[data-add-id]')){
    if(extraRows(form).length>=Math.min(39,count(form)-1)){root.BiteHotelAccounts.showRegisterError(form,fail('male','Increase the guest count before adding another guest ID.'));return}
    const key=root.crypto.randomUUID();holder.insertAdjacentHTML('beforeend',card(key));root.BiteCheckinGuard?.person(form,key);changed(form);const input=form.elements[names(key).name];input.focus({preventScroll:true});input.closest('[data-ha-id-card]').scrollIntoView({block:'center'});
   }
   const remove=e.target.closest('[data-id-remove]');if(remove){const card=remove.closest('[data-ha-id-card]');for(const file of card.__photoFiles||[])forget(file);card.remove();changed(form)}
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
