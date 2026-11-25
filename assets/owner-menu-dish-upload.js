/* B008: Owner-only menu dish photo upload. Never grant Manager Storage write. */
(function(root){
 'use strict';
 const doc=root.document,form=doc.getElementById('menuItemForm'),input=doc.getElementById('menuItemDishFile'),rights=doc.getElementById('menuItemDishRights'),status=doc.getElementById('menuItemDishStatus'),preview=doc.getElementById('menuItemDishPreview');
 const MAX=5*1024*1024,types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
 let selected=null,previewUrl='',generation=0;
 const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));
 function message(s){status.textContent=s}
 function reset(){generation++;selected=null;input.value='';rights.checked=false;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';preview.hidden=true;preview.removeAttribute('src');message('Existing saved item ke liye Owner dish photo upload kar sakta hai.');}
 function open(isOwner,hasSavedItem){reset();const enabled=!!isOwner&&!!hasSavedItem;doc.getElementById('menuItemDishTools').hidden=!enabled;input.disabled=!enabled;rights.disabled=!enabled;}
 async function checkImage(file){
  if(!file||!types[file.type]||file.size===0||file.size>MAX)throw Error('JPEG, PNG ya WebP image 5 MiB tak choose karein.');
  const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const png=[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
  const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(!(file.type==='image/jpeg'&&jpeg||file.type==='image/png'&&png||file.type==='image/webp'&&webp))throw Error('File content image format se match nahi karta.');
  const url=URL.createObjectURL(file);
  try{
   const img=new Image();img.decoding='async';img.src=url;
   await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Image open nahi ho saki.'));});
   if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth>8192||img.naturalHeight>8192||img.naturalWidth*img.naturalHeight>32000000)throw Error('Invalid ya bahut badi image dimensions.');
  }finally{URL.revokeObjectURL(url);}
 }
 input.addEventListener('change',async()=>{
  const token=++generation;selected=null;rights.checked=false;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';preview.hidden=true;
  const file=input.files?.[0];if(!file){message('No file selected.');return;}
  message('Photo verify ho rahi hai…');
  try{await checkImage(file);if(token!==generation)return;selected=file;previewUrl=URL.createObjectURL(file);preview.src=previewUrl;preview.hidden=false;message('Photo ready. Rights confirmation ke baad Save item dabayein.');}
  catch(error){if(token!==generation)return;input.value='';message(error.message);}
 });
 function hasSelection(){return !!input.files?.length||!!selected;}
 async function prepare({sb,rid,id,userId,stillValid}){
  if(!hasSelection())return null;
  if(!selected||selected!==input.files?.[0])throw Error('Photo verification pending ya failed. Dubara file choose karein.');
  if(!rights.checked)throw Error('Confirm karein ki aapko is dish photo ko public use karne ka adhikar hai.');
  if(!uuid(rid)||!uuid(id)||!userId||!stillValid())throw Error('Saved dish/Owner session unavailable.');
  const {data:auth,error:authError}=await sb.auth.getUser();
  if(authError||auth?.user?.id!==userId)throw Error('Owner session recheck failed.');
  const {data:membership,error:memberError}=await sb.from('restaurant_members').select('restaurant_id,role').eq('restaurant_id',rid).eq('user_id',userId).eq('role','owner');
  if(memberError||!Array.isArray(membership)||membership.length!==1||membership[0]?.restaurant_id!==rid||membership[0]?.role!=='owner'||!stillValid())throw Error('Only current restaurant Owner can upload a dish photo.');
  const {data:items,error:itemError}=await sb.from('menu_items').select('id').eq('id',id).eq('restaurant_id',rid);
  if(itemError||!Array.isArray(items)||items.length!==1||items[0]?.id!==id||!stillValid())throw Error('Saved item no longer belongs to this restaurant. Refresh menu.');
  await checkImage(selected);
  if(!stillValid())throw Error('Restaurant context changed.');
  const path=rid+'/menu/'+id+'/'+crypto.randomUUID()+'.'+types[selected.type];
  const storage=sb.storage.from('bite-menu');
  message('Uploading dish image…');
  const {error}=await storage.upload(path,selected,{contentType:selected.type,cacheControl:'3600',upsert:false});
  if(error)throw Error('Storage upload failed: '+error.message);
  const publicUrl=storage.getPublicUrl(path).data?.publicUrl;
  if(!publicUrl||!publicUrl.startsWith('https://')||!stillValid()){
   // Authorization/context may have changed after a successful upload: leave object for later audit.
   throw Error('Upload hua, lekin session/context confirm nahi hua. No menu change; support se cleanup verify karayein.');
  }
  message('Upload complete; menu save confirm ho raha hai…');
  return {path,url:publicUrl,storage};
 }
 async function cleanup(record){
  if(!record)return;
  try{const {error}=await record.storage.remove([record.path]);if(error)console.warn('Dish upload cleanup needs review',error.message);}
  catch(error){console.warn('Dish upload cleanup needs review',error.message);}
 }
 root.BiteMenuDishUpload={open,reset,hasSelection,prepare,cleanup};
})(globalThis);
