/* R14: protect the existing item editor; preview changes never write to the server. */
(function(root){
 'use strict';
 const doc=root.document;
 const fields=['id','name','category_id','price','image_url','is_vegetarian','is_available','is_kids_choice','description'];
 const form=doc.getElementById('menuItemForm'),modal=doc.getElementById('menuItemModal');
 const get=id=>doc.getElementById(id);
 let context=()=>false,active=false,baseline='',originalPhoto='',pending=false,version=0,photoVersion=0,photoState='empty',loadedPhoto='',timer;
 let disabled=[],returnFocus=null;
 function snapshot(){return JSON.stringify(fields.map(name=>String(form.elements[name]?.value??'')));}
 function valid(){return active&&context(form.dataset.menuRestaurant,form.dataset.menuUser);}
 function dirty(){return active&&snapshot()!==baseline;}
 function source(value){
  const text=String(value||'').trim();if(!text)return '';
  if(text.startsWith('//')||text.includes('\\'))return null;
  try{
   const relative=/^(?:\.{1,2}\/|\/(?!\/)|assets\/)/.test(text);
   if(!relative&&!/^https:\/\//i.test(text))return null;
   const url=new URL(text,root.location.href);
   if(url.username||url.password||url.hash||(!relative&&url.protocol!=='https:'))return null;
   if(relative&&url.origin!==root.location.origin)return null;
   return url.href;
  }catch{return null;}
 }
 function release(){
  for(const [control,wasDisabled] of disabled)control.disabled=wasDisabled;disabled=[];pending=false;
  for(const id of ['menuItemCloseSave','menuItemCloseDiscard','menuItemCloseKeep'])get(id).disabled=false;
 }
 function clear(){
  version++;photoVersion++;root.clearTimeout(timer);release();active=false;baseline='';originalPhoto='';
  get('menuItemCloseChoice').hidden=true;get('menuItemPhotoPreview').removeAttribute('src');get('menuItemPhotoPreview').hidden=true;
 }
 function sync(){
  if(active&&!valid()){clear();form.reset();modal.classList.remove('show');return false;}
  return true;
 }
 function preview(){
  if(!sync()||!active)return;
  root.clearTimeout(timer);
  const sequence=++photoVersion,img=get('menuItemPhotoPreview'),message=get('menuItemPhotoStatus');
  const value=String(form.elements.image_url.value||'').trim(),url=source(value);
  img.onload=null;img.onerror=null;img.removeAttribute('src');img.hidden=true;loadedPhoto='';
  get('menuItemPhotoRestore').hidden=!originalPhoto||value===originalPhoto;
  get('menuItemPhotoRemove').disabled=pending||!value;
  get('menuItemPhotoRetry').disabled=pending||!url;
  if(!value){photoState='empty';message.textContent='No photo selected. Changes apply only after Save item.';return;}
  if(!url){photoState='invalid';message.textContent='Use a valid HTTPS image URL without credentials or a fragment.';return;}
  photoState='loading';message.textContent='Loading photo preview… Nothing has been saved.';
  const current=()=>sequence===photoVersion&&valid();
  img.onload=()=>{
   if(!current())return;
   if(!img.naturalWidth){failed();return;}
   photoState='ready';loadedPhoto=value;img.hidden=false;message.textContent='Preview loaded. Check the dish and food type before saving.';
  };
  function failed(){if(!current())return;photoState='failed';img.hidden=true;message.textContent='Photo did not load. Retry or restore the saved photo. Nothing has been saved.';}
  img.onerror=failed;img.src=url;
 }
 function start(){
  clear();active=true;baseline=snapshot();originalPhoto=String(form.elements.image_url.value||'').trim();returnFocus=doc.activeElement;
  get('menuItemCloseStatus').textContent='';preview();
 }
 function beforeClose(){
  if(!active)return true;
  if(!sync())return true;
  if(pending){get('menuItemCloseStatus').textContent='Saving… Please wait for confirmation.';return false;}
  if(dirty()){
   returnFocus=doc.activeElement;get('menuItemCloseChoice').hidden=false;get('menuItemCloseSave').focus();return false;
  }
  clear();return true;
 }
 function validate(){
  if(!sync()||!valid())return false;
  const value=String(form.elements.image_url.value||'').trim();
  // An unchanged old URL must not block unrelated corrections when a remote host is down.
  if(value&&value!==originalPhoto&&(source(value)===null||photoState!=='ready'||loadedPhoto!==value)){
   get('menuItemError').textContent='New photo preview confirm nahi hua. Retry karein ya saved photo restore karein.';
   form.elements.image_url.focus();return false;
  }
  return true;
 }
 function saving(value,token){
  if(value){
   if(!valid())return null;
   pending=true;disabled=Array.from(form.elements).map(control=>[control,control.disabled]);
   for(const [control] of disabled)control.disabled=true;
   for(const id of ['menuItemCloseSave','menuItemCloseDiscard','menuItemCloseKeep'])get(id).disabled=true;
   return version;
  }
  if(token!==version)return !active;
  release();
  get('menuItemCloseStatus').textContent='';return true;
 }
 function saved(token){
  if(token!==version||!valid())return false;
  release();baseline=snapshot();get('menuItemCloseChoice').hidden=true;return true;
 }
 function keep(){
  if(pending)return;
  get('menuItemCloseChoice').hidden=true;(returnFocus?.isConnected?returnFocus:form.elements.name).focus();
 }
 form.elements.image_url.addEventListener('input',()=>{photoVersion++;loadedPhoto='';photoState='loading';root.clearTimeout(timer);timer=root.setTimeout(preview,250);});
 get('menuItemPhotoRetry').addEventListener('click',preview);
 get('menuItemPhotoRemove').addEventListener('click',()=>{if(valid()&&!pending){form.elements.image_url.value='';preview();}});
 get('menuItemPhotoRestore').addEventListener('click',()=>{if(valid()&&!pending){form.elements.image_url.value=originalPhoto;preview();}});
 get('menuItemCloseKeep').addEventListener('click',keep);
 get('menuItemCloseSave').addEventListener('click',()=>{if(sync()&&!pending&&valid()){get('menuItemCloseChoice').hidden=true;form.requestSubmit();}});
 get('menuItemCloseDiscard').addEventListener('click',()=>{
  if(!sync()||pending||!valid())return;
  clear();form.reset();root.closeModal('menuItemModal');
 });
 modal.addEventListener('click',event=>{if(event.target===modal)root.closeModal('menuItemModal');});
 doc.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!modal.classList.contains('show'))return;
  event.preventDefault();event.stopPropagation();
  if(!get('menuItemCloseChoice').hidden&&!pending)keep();else root.closeModal('menuItemModal');
 });
 root.addEventListener('beforeunload',event=>{if(valid()&&(dirty()||pending)){event.preventDefault();event.returnValue='';}});
 root.BiteOwnerMenuEditor={configure:check=>{context=check;},start,beforeClose,sync,validate,saving,saved,source,isDirty:dirty};
})(globalThis);
