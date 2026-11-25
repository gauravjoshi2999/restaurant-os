'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/owner-menu-dish-upload.js','utf8');
const JPEG=new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1]);
function harness(){
 const events={},controls={
  menuItemForm:{},menuItemDishFile:{files:[],_value:'',disabled:true,get value(){return this._value},set value(v){this._value=v;if(v==='')this.files=[]},addEventListener(name,fn){events[name]=fn}},
  menuItemDishRights:{checked:false,disabled:true},menuItemDishStatus:{textContent:''},
  menuItemDishPreview:{hidden:true,src:'',removeAttribute(name){if(name==='src')this.src=''}},
  menuItemDishTools:{hidden:true}
 };
 let objects=0,uploads=0,removes=0,auths=0,queries=0,lastPath;
 const ImageMock=class{constructor(){this.naturalWidth=300;this.naturalHeight=200;}set src(_){queueMicrotask(()=>this.onload?.());}};
 const root={document:{getElementById:id=>controls[id]},URL:{createObjectURL(){objects++;return 'blob:mock/'+objects},revokeObjectURL(){}},Image:ImageMock,crypto:{randomUUID:()=> '36f071a4-a326-43a5-8b97-8e20aa783bd1'},console};
 root.globalThis=root;vm.runInNewContext(source,root);
 const rid='12345678-1234-4234-9234-123456789abc',id='87654321-4321-4321-8321-abcdefabcdef',userId='owner-1';
 const file={size:JPEG.byteLength,type:'image/jpeg',slice(){return {arrayBuffer:async()=>JPEG.buffer.slice(0)}}};
 let membership=[{restaurant_id:rid,role:'owner'}],itemRows=[{id}],uploadError=null,authUser=userId,valid=true;
 const storage={upload:async(path,blob,options)=>{uploads++;lastPath=path;assert.equal(blob,file);assert.equal(options.upsert,false);return {error:uploadError}},getPublicUrl:path=>({data:{publicUrl:'https://example.supabase.co/storage/v1/object/public/bite-menu/'+path}}),remove:async(paths)=>{removes++;assert.equal(paths[0],lastPath);return {error:null}}};
 const sb={auth:{getUser:async()=>{auths++;return {data:{user:{id:authUser}},error:null}}},from(table){assert.ok(['restaurant_members','menu_items'].includes(table));return {select(columns){assert.equal(columns,table==='restaurant_members'?'restaurant_id,role':'id');return {eq(){return this},then(ok){queries++;return Promise.resolve({data:table==='restaurant_members'?membership:itemRows,error:null}).then(ok)}}}}},storage:{from(bucket){assert.equal(bucket,'bite-menu');return storage}}};
 return {root,controls,events,rid,id,userId,file,sb,prepare:()=>root.BiteMenuDishUpload.prepare({sb,rid,id,userId,stillValid:()=>valid}),choose:async()=>{controls.menuItemDishFile.files=[file];await events.change();await new Promise(resolve=>setImmediate(resolve))},stats:()=>({uploads,removes,auths,queries,lastPath}),setMembership:v=>membership=v,setItemRows:v=>itemRows=v,setAuth:v=>authUser=v,setValid:v=>valid=v,setUploadError:v=>uploadError=v};
}
test('Manager and new unsaved item cannot receive R14 file picker',()=>{
 const h=harness();h.root.BiteMenuDishUpload.open(false,true);assert.equal(h.controls.menuItemDishTools.hidden,true);
 h.root.BiteMenuDishUpload.open(true,false);assert.equal(h.controls.menuItemDishFile.disabled,true);
 h.root.BiteMenuDishUpload.open(true,true);assert.equal(h.controls.menuItemDishFile.disabled,false);
});
test('Confirmed owner uploads verified JPEG to unique own restaurant/item path without upsert',async()=>{
 const h=harness();h.root.BiteMenuDishUpload.open(true,true);await h.choose();
 assert.equal(h.controls.menuItemDishPreview.hidden,false);
 await assert.rejects(h.prepare(),/Confirm karein/);
 assert.equal(h.stats().uploads,0);
 h.controls.menuItemDishRights.checked=true;
 const result=await h.prepare();
 assert.match(result.url,/^https:\/\//);
 assert.match(h.stats().lastPath,new RegExp('^'+h.rid+'/menu/'+h.id+'/[0-9a-f-]+\\.jpg$'));
 assert.equal(h.stats().uploads,1);assert.equal(h.stats().auths,1);assert.equal(h.stats().queries,2);
 await h.root.BiteMenuDishUpload.cleanup(result);assert.equal(h.stats().removes,1);
});
test('Wrong authenticated user is rejected before role query or upload',async()=>{
 const h=harness();h.root.BiteMenuDishUpload.open(true,true);await h.choose();h.controls.menuItemDishRights.checked=true;
 h.setAuth('another-user');await assert.rejects(h.prepare(),/Owner session recheck failed/);
 assert.equal(h.stats().uploads,0);assert.equal(h.stats().queries,0);
});
test('Manager or missing owner membership is rejected before Storage upload',async()=>{
 const h=harness();h.root.BiteMenuDishUpload.open(true,true);await h.choose();h.controls.menuItemDishRights.checked=true;
 h.setMembership([{restaurant_id:h.rid,role:'manager'}]);await assert.rejects(h.prepare(),/Only current restaurant Owner/);
 assert.equal(h.stats().uploads,0);
});
test('Changed restaurant context is rejected without upload',async()=>{
 const h=harness();h.root.BiteMenuDishUpload.open(true,true);await h.choose();h.controls.menuItemDishRights.checked=true;
 h.setValid(false);await assert.rejects(h.prepare(),/Saved dish\/Owner session unavailable/);
 assert.equal(h.stats().uploads,0);
});
test('Storage rejection does not return a published URL',async()=>{
 const h=harness();h.root.BiteMenuDishUpload.open(true,true);await h.choose();h.controls.menuItemDishRights.checked=true;
 h.setUploadError({message:'permission denied'});
 await assert.rejects(h.prepare(),/Storage upload failed: permission denied/);
 assert.equal(h.stats().uploads,1);assert.equal(h.stats().removes,0);
});
test('Invalid file content does not pass picker selection',async()=>{
 const h=harness();h.root.BiteMenuDishUpload.open(true,true);h.controls.menuItemDishFile.files=[{size:5,type:'image/jpeg',slice(){return {arrayBuffer:async()=>new Uint8Array([60,104,116,109,108]).buffer}}}];
 await h.events.change();assert.match(h.controls.menuItemDishStatus.textContent,/File content image format/);
 assert.equal(h.root.BiteMenuDishUpload.hasSelection(),false);
 assert.equal(h.stats().uploads,0);
});

test('Foreign or deleted item row fails before Storage write',async()=>{
 const h=harness();h.root.BiteMenuDishUpload.open(true,true);await h.choose();h.controls.menuItemDishRights.checked=true;
 h.setItemRows([]);await assert.rejects(h.prepare(),/Saved item no longer belongs/);
 assert.equal(h.stats().uploads,0);
});
