'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('assets/owner-dish-photo-upload.js','utf8');
const RID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';
const UID = 'owner-user';
const PNG = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82];

function photo(type='image/png',size=4096,bytes=PNG) {
 return {
  type,size,
  slice() { return {async arrayBuffer(){return Uint8Array.from(bytes).buffer;}}; }
 };
}
function harness(options={}) {
 const nodes = new Map();
 function el(id) {
  if (!nodes.has(id)) {
   const handlers = new Map();
   nodes.set(id,{
    hidden:true,disabled:false,value:'',checked:false,textContent:'',style:{},files:[],
    classList:{contains(name){return name==='show';}},
    addEventListener(type,cb){handlers.set(type,cb);},
    fire(type){return handlers.get(type)?.();}
   });
  }
  return nodes.get(id);
 }
 const form=el('menuItemForm');
 form.dataset={menuRestaurant:options.rid||RID,menuUser:UID};
 form.elements={id:{value:ITEM},image_url:{value:'https://old.example/menu.jpg'}};
 const editorCalls=[], uploads=[],removed=[], updates=[];
 let dirty=false, owner=options.owner!==false, session=options.session!==false;
 let rid=options.activeRestaurant||RID, rowUrl='https://old.example/menu.jpg';
 const row={id:ITEM,restaurant_id:RID,image_url:rowUrl};
 el('menuDishUploadPick').files=[options.file || photo()];
 el('menuDishPhotoRights').checked=options.rights!==false;
 const doc={getElementById:el};
 const storage={
  async upload(path,file,params){
   uploads.push({path,file,params});
   if(options.uploadFails)return {error:new Error('Storage denied')};
   return {data:{path},error:null};
  },
  getPublicUrl(path){return {data:{publicUrl:'https://cdn.example/'+path}};},
  async remove(paths){removed.push(...paths);return {error:null};}
 };
 function chain(table,mode,initial){
  const filters=[];
  const obj={
   eq(col,value){filters.push([col,value]);return this;},
   is(col,value){filters.push([col,value]);return this;},
   select(cols){
    if(mode==='update'){
     updates.push({payload:initial,filters:filters.slice()});
     if(options.updateFails)return Promise.resolve({data:null,error:new Error('Database rejected')});
     const photoMatch=filters.some(([col,val])=>col==='image_url'&&val===rowUrl);
     const scoped=filters.some(([col,val])=>col==='restaurant_id'&&val===RID)
       &&filters.some(([col,val])=>col==='id'&&val===ITEM);
     if(!scoped||!photoMatch||options.concurrentChange)return Promise.resolve({data:[],error:null});
     rowUrl=initial.image_url;
     row.image_url=rowUrl;
     if(options.ambiguousWrite)return Promise.reject(new Error('Network timeout after commit'));
     return Promise.resolve({data:[{id:ITEM,image_url:rowUrl}],error:null});
    }
    return this;
   },
   limit(){
    return Promise.resolve({data:owner?[{restaurant_id:RID,role:'owner'}]:[],error:null});
   },
   single(){return Promise.resolve({data:{image_url:rowUrl},error:null});}
  };
  return obj;
 }
 const sb={
  auth:{async getUser(){return {data:{user:session?{id:UID}:null},error:null};}},
  from(table){
   if(table==='restaurant_members')return chain(table,'read');
   if(table==='menu_items')return {
    update(values){return chain(table,'update',values);},
    select(){return chain(table,'read');}
   };
   throw new Error('Unexpected database table '+table);
  },
  storage:{from(bucket){assert.equal(bucket,'bite-menu');return storage;}}
 };
 const root={
  document:doc,crypto:{randomUUID(){return '44444444-4444-4444-8444-444444444444';}},
  console:{warn(){}},
  async createImageBitmap(){
   if(options.decodeFails)throw Error('Decode failed');
   return {width:options.width||640,height:options.height||480,close(){}};
  },
  BiteOwnerMenuEditor:{saving(value){editorCalls.push(value);return 7;}}
 };
 vm.runInNewContext(source,root,{filename:'owner-dish-photo-upload.js'});
 let refreshed=0,restarted=0;
 root.BiteOwnerDishPhoto.init({
  sb,
  getUser:()=>session?{id:UID}:null,
  getRestaurantId:()=>rid,
  getAccess:()=>({memberships:owner?[{restaurant_id:RID,role:'owner'}]:[{restaurant_id:RID,role:'manager'}]}),
  isMenuEditable:()=>true,
  getSavedItem:(restaurant,item)=>restaurant===RID&&item===ITEM?row:null,
  isDirty:()=>dirty,
  restartEditor(){restarted++;},
  async refresh(){refreshed++;}
 });
 return {
  root,el,uploads,removed,updates,editorCalls,
  get rowUrl(){return rowUrl;},
  get refreshed(){return refreshed;},
  get restarted(){return restarted;},
  setDirty(v){dirty=v;},
  setOwner(v){owner=v;},
  setSession(v){session=v;},
  setRestaurant(v){rid=v;},
  async click(){return el('menuDishUploadButton').fire('click');}
 };
}
test('valid restaurant Owner publishes only one scoped saved-dish photo',async()=>{
 const h=harness();
 h.root.BiteOwnerDishPhoto.show();
 assert.equal(h.el('menuDishUploadBox').hidden,false);
 await h.click();
 assert.equal(h.uploads.length,1);
 assert.equal(h.updates.length,1);
 assert.match(h.uploads[0].path,new RegExp('^'+RID+'/menu/'+ITEM+'/'));
 assert.equal(h.uploads[0].params.upsert,false);
 assert.equal(h.updates[0].payload.image_url,h.rowUrl);
 assert.equal(h.removed.length,0);
 assert.equal(h.refreshed,1);
 assert.equal(h.restarted,1);
 assert.deepEqual(h.editorCalls,[true,false]);
 assert.equal(h.el('menuDishPhotoRights').checked,false);
});
test('Manager and signed-out users cannot upload, despite editable menu metadata',async()=>{
 const manager=harness({owner:false});
 manager.root.BiteOwnerDishPhoto.show();
 assert.equal(manager.el('menuDishUploadBox').hidden,true);
 await manager.click();
 assert.equal(manager.uploads.length,0);
 assert.equal(manager.updates.length,0);
 const anon=harness({session:false});
 await anon.click();
 assert.equal(anon.uploads.length,0);
});
test('cross-tenant selection, unpublished item and pending edits fail closed',async()=>{
 const other=harness({activeRestaurant:OTHER});
 await other.click();assert.equal(other.uploads.length,0);
 const h=harness();h.setDirty(true);await h.click();
 assert.equal(h.uploads.length,0);
 assert.match(h.el('menuDishUploadStatus').textContent,/Save or discard/);
 const newItem=harness();newItem.el('menuItemForm').elements.id.value='';
 await newItem.click();assert.equal(newItem.uploads.length,0);
});
test('photo-rights confirmation, spoofed header and overlimit files block write',async()=>{
 for(const options of [
  {rights:false},
  {file:photo('image/png',4096,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])},
  {file:photo('image/png',5242881)},
  {decodeFails:true}
 ]) {
  const h=harness(options);
  await h.click();
  assert.equal(h.uploads.length,0);
  assert.equal(h.updates.length,0);
 }
});
test('Storage failure does not mutate saved menu URL and releases editor lock',async()=>{
 const h=harness({uploadFails:true});
 await h.click();
 assert.equal(h.rowUrl,'https://old.example/menu.jpg');
 assert.equal(h.updates.length,0);
 assert.equal(h.editorCalls.at(-1),false);
 assert.match(h.el('menuDishUploadStatus').textContent,/not published/);
});
test('single-row compare-and-swap conflict does not overwrite existing photo',async()=>{
 const h=harness({concurrentChange:true});
 await h.click();
 assert.equal(h.updates.length,1);
 assert.equal(h.rowUrl,'https://old.example/menu.jpg');
 assert.equal(h.removed.length,1,'Only newly uploaded path may be cleaned');
});
test('ambiguous network timeout after server update retains referenced photo',async()=>{
 const h=harness({ambiguousWrite:true});
 await h.click();
 assert.equal(h.updates.length,1);
 assert.match(h.rowUrl,/cdn\.example/);
 assert.equal(h.removed.length,0,'Do not delete a possibly referenced photo');
 assert.match(h.el('menuDishUploadStatus').textContent,/Photo saved/);
});
