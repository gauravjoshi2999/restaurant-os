/* Optional private guest copies inside the existing Owner workspace. */
(function(root){
 'use strict';
 const BUCKET='bite-guest-documents',MAX_BYTES=4*1024*1024;
 const kinds={masked_id:'Masked identity copy',travel_record:'Travel supporting copy',supporting_record:'Other necessary copy'};
 const extensions={'image/jpeg':'.jpg','image/png':'.png','application/pdf':'.pdf'};
 let ctx,generation=0,active=0;const urls=new Set();
 const H=()=>root.BiteHospitality,property=()=>H()?.prop();
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const identity=()=>ctx?.getUser()?.id+':'+property()?.id;
 const button=(a,label,id='')=>'<button type="button" class="btn secondary" data-doc-action="'+a+'" data-document="'+esc(id)+'">'+esc(label)+'</button>';
 function supported(file){
  if(!file||!Number.isInteger(file.size)||file.size<1||file.size>MAX_BYTES)throw Error('Choose a copy up to 4 MB.');
  if(!Object.hasOwn(extensions,file.type))throw Error('Choose a JPEG, PNG or PDF copy.');
  return file.type;
 }
 function matchesHeader(bytes,mime){
  const b=Array.from(bytes);
  if(mime==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255;
  if(mime==='image/png')return [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v);
  if(mime==='application/pdf')return [37,80,68,70,45].every((v,i)=>b[i]===v);
  return false;
 }
 async function validate(file,mime=file?.type){
  supported({size:file?.size,type:mime});
  if(!matchesHeader(new Uint8Array(await file.slice(0,16).arrayBuffer()),mime))throw Error('File contents do not match its type. Choose a valid JPEG, PNG or PDF.');
  return mime;
 }
 async function prepare(file){
  if(!file||file.size<1||file.size>24*1024*1024)throw Error('Choose an ID photo up to 24 MB, or a PDF up to 4 MB.');
  const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer()),mime=Object.keys(extensions).find(type=>matchesHeader(bytes,type));
  if(!mime){if(Object.hasOwn(extensions,file.type)||file.type==='image/jpg')throw Error('File contents do not match its type. Choose a valid JPEG, PNG or PDF.');throw Error('Choose a valid JPEG, PNG or PDF. HEIC and other formats must be converted first.')}
  const declared=file.type==='image/jpg'?'image/jpeg':file.type;
  if(declared&&!['application/octet-stream',mime].includes(declared))throw Error('File contents do not match its type. Choose a valid ID copy.');
  if(file.size<=MAX_BYTES)return declared===mime&&file.type===mime?file:new File([file],'guest-id'+extensions[mime],{type:mime,lastModified:file.lastModified||Date.now()});
  if(mime==='application/pdf')throw Error('Choose a PDF up to 4 MB. A clear JPEG or PNG photo can be resized here.');
  if(!root.createImageBitmap||!root.document)throw Error('This browser cannot resize the photo. Choose a smaller JPEG or PNG.');
  let bitmap;try{
   bitmap=await root.createImageBitmap(file,{imageOrientation:'from-image'});
   if(bitmap.width*bitmap.height>50000000)throw Error('Use a normal-resolution camera photo for a readable ID copy.');
   const scale=Math.min(1,2200/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
   const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   for(const quality of [.9,.8,.7]){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=MAX_BYTES){const out=new File([blob],'guest-id.jpg',{type:'image/jpeg',lastModified:file.lastModified||Date.now()});await validate(out);return out}}
   throw Error('The resized photo is still too large. Take a closer, clear ID photo.');
  }catch(error){throw Error(error.message||'Photo could not be read. Retake it or upload a JPEG / PNG.')}finally{bitmap?.close()}
 }
 function clear(){generation++;for(const u of urls)root.URL.revokeObjectURL(u);urls.clear();document.getElementById('biteGuestDocuments')?.closest('#bhActionEditor')?.remove()}
 function init(context){ctx=context;const content=document.querySelector('#mainApp .content');content?.addEventListener('click',click);content?.addEventListener('submit',submit)}
 function guard(scope,version){if(scope!==identity()||version!==generation)throw Error('Account or property changed. Reopen copies in the current property.')}
 async function call(name,guest,args,scope,version){
  guard(scope,version);if(root.navigator?.onLine===false)throw Error('Offline. No document change has been confirmed. Reconnect and retry.');
  const r=await ctx.sb.rpc(name,{p_property:property().id,p_guest:guest,...args});
  guard(scope,version);if(r.error)throw r.error;return r.data;
 }
 async function command(guest,id,action,details,scope,version){return call('bite_guest_document_command',guest,{p_document:id,p_action:action,p_details:details||{}},scope,version)}
 async function readCopy(guest,id){
  const scope=identity(),version=generation;active++;
  try{
   const list=await call('bite_guest_document_list',guest,{},scope,version),d=list.find(row=>row.id===id&&row.status==='ready');
   if(!d)throw Error('Copy no longer available. Retake it or ask the manager.');
   const r=await ctx.sb.functions.invoke('guest-document-copy',{body:{p_property:property().id,p_guest:guest,p_document:id}});guard(scope,version);
   if(r.error)throw Error('Could not open this private copy. Check your access and retry.');
   if(r.data?.size!==d.byte_size)throw Error('Saved copy size differs. Contact the property owner.');
   await validate(r.data,d.mime_type);guard(scope,version);
   return new Blob([r.data],{type:d.mime_type});
  }finally{active--}
 }
 function copyLabel(d){
  for(const stay of H().getWorkspace().stays||[])for(const person of stay.registration?.additional_ids||[]){
   if([person.id_front,person.id_back].includes(d.id))return person.name+' · ID '+(person.id_front===d.id?'front':'back');
  }
  return d.subject_key?'Additional guest ID':kinds[d.kind]||'Guest copy';
 }
 function canRemove(role){return role==='owner'}
 function rowActions(d,role){
  return (d.status==='ready'?button('download','Download copy',d.id):d.can_finish?button('finish','Check saved upload',d.id):'')+
   (canRemove(role)?button('remove','Remove',d.id):'');
 }
 function panel(){return document.getElementById('biteGuestDocuments')}
 function setMessage(text){const m=panel()?.querySelector('[data-document-message]');if(m)m.textContent=text}
 async function refresh(guest,scope,version){
  const rows=await call('bite_guest_document_list',guest,{},scope,version),box=panel();if(!box||box.dataset.guest!==guest)return;
  box.__documents=rows;
  box.querySelector('[data-document-list]').innerHTML=rows.map(d=>'<article class="bh-record"><div><strong>'+esc(copyLabel(d))+'</strong><p>'+esc(d.status==='ready'?'Saved privately':'Upload unfinished')+' · '+Math.ceil(d.byte_size/1024)+' KB</p></div><div class="bh-actions">'+
   rowActions(d,property()?.role)+'</div></article>').join('')||'<p class="bh-empty">No copies retained for this guest.</p>';
 }
 async function open(guest){
  clear();const scope=identity(),version=generation,g=H().getWorkspace().guests.find(g=>g.id===guest);
  if(!g||!H().has('guest_register'))return;
  H().editor('<section id="biteGuestDocuments" data-guest="'+esc(guest)+'"><div class="bh-heading"><div><h2>Private guest copies</h2><p>'+esc(g.full_name)+'</p></div>'+button('close','Close')+'</div><p>Keep only necessary, masked copies. These are accessible to this property’s authorized front desk; they are separate from guest bill links. '+(canRemove(property()?.role)?'Remove copies when the property no longer needs them.':'Only the property owner can permanently remove retained copies. Ask the owner to remove an unnecessary copy.')+'</p><p data-document-message class="bh-message" role="status" aria-live="polite">Loading retained copies…</p><div data-document-list></div><form class="bh-form" data-document-upload><h3>Add an optional copy</h3><label class="bh-field"><span>Copy purpose</span><select name="kind">'+Object.entries(kinds).map(([k,v])=>'<option value="'+k+'">'+esc(v)+'</option>').join('')+'</select></label><label class="bh-field"><span>JPEG, PNG or PDF · up to 4 MB</span><input type="file" name="copy" accept="image/jpeg,image/png,application/pdf" required></label><label class="bh-check"><input type="checkbox" name="redacted_confirmed" required> I checked that this copy is necessary and redacted. Full Aadhaar, payment-card and bank details are excluded.</label><p>Up to five copies per person. Additional guest IDs are named in the check-in record. Remove copies when your property no longer needs to retain them.</p><div class="bh-form-actions"><button class="btn" type="submit">Save private copy</button></div></form></section>');
  try{await refresh(guest,scope,version);guard(scope,version);setMessage('')}catch(e){if(scope===identity()&&version===generation)setMessage(e.message||String(e))}
 }
 async function submit(e){
  const form=e.target.closest('form[data-document-upload]');if(!form)return;e.preventDefault();e.stopPropagation();
  if(active)return;const box=panel(),guest=box?.dataset.guest;if(!guest)return;
  const scope=identity(),version=generation,original=form.elements.copy.files[0],kind=form.elements.kind.value;
  const signature=original&&[original.name,original.size,original.lastModified,original.type,kind].join(':');
  if(form.__signature!==signature){form.__signature=signature;form.__request=root.crypto.randomUUID()}
  const id=form.__request,b=form.querySelector('button[type=submit]');active++;b.disabled=true;setMessage('Checking and saving private copy…');
  try{
   if(!form.elements.redacted_confirmed.checked)throw Error('Check that the copy is necessary and redacted first.');
   const file=await prepare(original),mime=await validate(file);guard(scope,version);
   const d=await command(guest,id,'begin',{kind,mime_type:mime,byte_size:file.size,redacted_confirmed:true},scope,version);
   if(d.status!=='ready'){
    const uploaded=await ctx.sb.storage.from(BUCKET).upload(d.object_path,new Blob([file],{type:mime}),{contentType:mime,cacheControl:'0',upsert:false});
    guard(scope,version);
    // An interrupted/duplicate upload can already exist. Finish verifies its
    // actual size, type and uploader before reporting success.
    try{await command(guest,id,'finish',{},scope,version)}catch(error){throw uploaded.error||error}
   }
   await refresh(guest,scope,version);guard(scope,version);form.reset();delete form.__signature;delete form.__request;setMessage('Private copy saved.');
  }catch(error){if(scope===identity()&&version===generation){try{await refresh(guest,scope,version)}catch{}if(scope===identity()&&version===generation)setMessage((error.message||String(error))+' Retry uses the same copy request.');}}
  finally{active--;b.disabled=false}
 }
 async function click(e){
  const opener=e.target.closest('[data-doc-guest]');if(opener){e.preventDefault();if(!active)void open(opener.dataset.docGuest);return}
  const b=e.target.closest('[data-doc-action]');if(!b)return;e.preventDefault();
  if(b.dataset.docAction==='close'){if(!active)clear();return}if(active)return;
  const box=panel(),guest=box?.dataset.guest,d=box?.__documents?.find(d=>d.id===b.dataset.document);if(!d||!guest)return;
  const scope=identity(),version=generation,action=b.dataset.docAction;
  if(action==='remove'&&!root.confirm('Permanently remove this retained copy? The guest profile and bill will remain.'))return;
  active++;b.disabled=true;setMessage(action==='download'?'Checking access and downloading…':'Checking private copy…');
  try{
   if(action==='finish')await command(guest,d.id,'finish',{},scope,version);
   if(action==='remove'){
    const r=await ctx.sb.storage.from(BUCKET).remove([d.object_path]);guard(scope,version);if(r.error)throw r.error;
    await command(guest,d.id,'forget',{},scope,version);
   }
   if(action==='download'){
    const list=await call('bite_guest_document_list',guest,{},scope,version);
    if(!list.some(row=>row.id===d.id&&row.status==='ready'))throw Error('Copy no longer available.');
    const r=await ctx.sb.functions.invoke('guest-document-copy',{body:{p_property:property().id,p_guest:guest,p_document:d.id}});guard(scope,version);
    if(r.error){let message='Could not download this private copy. Recheck your access and retry.';try{message=(await r.error.context.json()).message||message}catch{}throw Error(message)}
    if(r.data.size!==d.byte_size)throw Error('Saved copy size differs. Contact the property owner.');
    await validate(r.data,d.mime_type);guard(scope,version);
    const url=root.URL.createObjectURL(new Blob([r.data],{type:d.mime_type}));urls.add(url);
    const a=document.createElement('a');a.href=url;a.download='Bite-'+d.kind+'-'+d.id.slice(0,8)+extensions[d.mime_type];a.hidden=true;document.body.append(a);a.click();a.remove();
    root.setTimeout(()=>{root.URL.revokeObjectURL(url);urls.delete(url)},10000);
   }
   await refresh(guest,scope,version);guard(scope,version);setMessage(action==='remove'?'Copy removed.':action==='download'?'Private download started.':'Saved upload confirmed.');
  }catch(error){if(scope===identity()&&version===generation)setMessage(error.message||String(error));}
  finally{active--;b.disabled=false}
 }
 const api={init,clear,open,readCopy,busy:()=>active>0,rowActions,canRemove,button:guest=>'<button type="button" class="btn secondary" data-doc-guest="'+esc(guest)+'">Private copies</button>',supported,matchesHeader,validate,prepare,MAX_BYTES};
 root.BiteGuestDocuments=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
