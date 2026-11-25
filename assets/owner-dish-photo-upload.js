/* B008: Owner-only saved-dish photo upload. Server RLS remains authoritative. */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const MAX=5242880, TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
 const signatures={
  'image/jpeg':b=>b[0]===255&&b[1]===216&&b[2]===255,
  'image/png':b=>[137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n),
  'image/webp':b=>String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP'
 };
 const get=id=>root.document.getElementById(id);
 let api=null,serial=0,busy=false,verified=null;
 const status=(message,error=false)=>{const n=get('menuDishUploadStatus');if(n){n.textContent=message;n.style.color=error?'#b42318':'';}};
 function context(){const f=get('menuItemForm');return {rid:f?.dataset.menuRestaurant||'',uid:f?.dataset.menuUser||'',id:f?.elements.id.value||''};}
 function same(a,b){return a.rid===b.rid&&a.uid===b.uid&&a.id===b.id&&UUID.test(a.rid)&&UUID.test(a.id);}
 function allowed(c){return !!api&&!!api.getUser()?.id&&api.getUser().id===c.uid&&api.getRestaurantId()===c.rid&&same(c,c)&&api.isMenuEditable(c.rid)&&get('menuItemModal')?.classList.contains('show');}
 function show(){const c=context(),box=get('menuDishUploadBox');if(!box)return;const membership=api?.getAccess()?.memberships||[];
  const claimed=membership.some(m=>m.restaurant_id===c.rid&&m.role==='owner');
  box.hidden=!(allowed(c)&&claimed);get('menuDishUploadPick').disabled=busy;
  if(!box.hidden&&!busy)status('JPG, PNG or WebP; max 5 MB. Saved dish only. Upload is public.');
 }
 async function verifyOwner(c){
  const {data:{user},error:authError}=await api.sb.auth.getUser();
  if(authError||!user||user.id!==c.uid)throw Error('Owner login recheck failed.');
  const {data,error}=await api.sb.from('restaurant_members').select('restaurant_id,role').eq('restaurant_id',c.rid).eq('user_id',c.uid).eq('role','owner').limit(1);
  if(error||!data?.length)throw Error('This restaurant Owner alone can upload dish photos.');
  if(!allowed(c))throw Error('Menu context changed. Reopen the dish.');
 }
 async function checkFile(file){
  if(!file||!TYPES[file.type]||file.size<16||file.size>MAX)throw Error('Choose a JPEG, PNG or WebP photo up to 5 MB.');
  const b=new Uint8Array(await file.slice(0,16).arrayBuffer());
  if(!signatures[file.type](b))throw Error('File content does not match its photo type.');
  let bitmap;
  try{
   if(typeof root.createImageBitmap!=='function')throw Error('Image decoding unavailable in this browser.');
   bitmap=await root.createImageBitmap(file);
   if(!bitmap.width||!bitmap.height||bitmap.width>10000||bitmap.height>10000||bitmap.width*bitmap.height>50000000)throw Error('Photo dimensions are unsupported.');
  }catch(e){if(e.message==='Photo dimensions are unsupported.')throw e;throw Error('Photo could not be decoded. Choose another image.');}
  finally{bitmap?.close?.();}
  return TYPES[file.type];
 }
 async function cleanup(path){try{const result=await api.sb.storage.from('bite-menu').remove([path]);if(result.error)root.console?.warn('Dish upload cleanup needs review',result.error.message);}catch(e){root.console?.warn('Dish upload cleanup needs review',e.message);}}
 async function upload(){
  if(busy||!api)return;
  const c=context(),file=get('menuDishUploadPick').files?.[0],rights=get('menuDishPhotoRights');
  if(!allowed(c)){status('Reopen a saved dish with Owner access.',true);return;}
  if(api.isDirty()){status('Save or discard pending menu edits before uploading a photo.',true);return;}
  if(!rights.checked){status('Confirm you have rights to publish this dish photo.',true);return;}
  const request=++serial;busy=true;get('menuDishUploadPick').disabled=true;get('menuDishUploadButton').disabled=true;
  let path='',confirmed=false;
  try{
   const ext=await checkFile(file);if(!allowed(c)||api.isDirty()||request!==serial)throw Error('Dish changed or has unsaved edits.');
   await verifyOwner(c);
   const old=api.getSavedItem(c.rid,c.id);
   if(!old||old.restaurant_id!==c.rid)throw Error('Saved dish not found; refresh menu.');
   const oldUrl=old.image_url||null;
   if(!root.crypto?.randomUUID)throw Error('Secure upload path unavailable.');
   path=c.rid+'/menu/'+c.id+'/'+root.crypto.randomUUID()+'.'+ext;
   status('Uploading photo…');
   const storage=api.sb.storage.from('bite-menu');
   const result=await storage.upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'});
   if(result.error)throw result.error;
   if(!allowed(c)||api.isDirty()||request!==serial)throw Error('Owner session or dish changed after upload.');
   await verifyOwner(c);
   const url=storage.getPublicUrl(path)?.data?.publicUrl;
   if(!url||!url.startsWith('https://'))throw Error('Public photo URL unavailable.');
   status('Publishing photo to this dish…');
   let query=api.sb.from('menu_items').update({image_url:url,updated_at:new Date().toISOString()}).eq('id',c.id).eq('restaurant_id',c.rid);
   query=oldUrl===null?query.is('image_url',null):query.eq('image_url',oldUrl);
   const saved=await query.select('id,image_url');
   if(saved.error)throw saved.error;
   if(saved.data?.length!==1)throw Error('Dish changed elsewhere; photo not published.');
   confirmed=true;
   if(allowed(c)){
    get('menuItemForm').elements.image_url.value=url;
    api.restartEditor();status('Photo published. Refreshing menu…');await api.refresh();
   }
  }catch(e){status('Photo not published: '+(e.message||'Upload failed'),true);}
  finally{if(path&&!confirmed)await cleanup(path);busy=false;get('menuDishUploadPick').disabled=false;get('menuDishUploadButton').disabled=false;get('menuDishUploadPick').value='';rights.checked=false;}
 }
 root.BiteOwnerDishPhoto={
  init(settings){api=settings;get('menuDishUploadButton')?.addEventListener('click',upload);get('menuDishUploadPick')?.addEventListener('change',()=>status('Photo selected. Confirm rights, then Upload & Publish.'));},
  show
 };
})(globalThis);
