'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const uploader=fs.readFileSync('assets/owner-menu-dish-upload.js','utf8');
const editor=fs.readFileSync('assets/owner-menu-editor.js','utf8');
test('B008 Owner picker is isolated to saved item and does not expand Manager upload policy',()=>{
 const start=html.indexOf('<div class="modal" id="menuItemModal"'),end=html.indexOf('<div class="modal" id="restaurantModal"',start);
 assert.ok(start>=0&&end>start);
 const modal=html.slice(start,end);
 for(const field of ['menuItemDishTools','menuItemDishFile','menuItemDishRights','menuItemDishStatus','menuItemDishPreview'])assert.match(modal,new RegExp('id="'+field+'"'));
 assert.match(html,/m\.role==='owner'/);
 assert.match(html,/BiteMenuDishUpload\?\.open/);
 assert.match(html,/await globalThis\.BiteMenuDishUpload\?\.prepare/);
 assert.match(html,/\.eq\('id',id\)\.eq\('restaurant_id',rid\)\.select\('id'\)/);
 assert.match(editor,/BiteMenuDishUpload\?\.hasSelection/);
 assert.match(uploader,/\.eq\('role','owner'\)/);
 assert.doesNotMatch(uploader,/service_role|upsert:true/);
});
test('B008 validates actual file format/dimensions and unique scoped Storage path',()=>{
 for(const fragment of ['5*1024*1024','image/jpeg','image/png','image/webp','file.slice(0,16)','naturalWidth','naturalHeight','32000000','crypto.randomUUID()','upsert:false','restaurant_members','sb.auth.getUser()','image_url']) {
  assert.ok(uploader.includes(fragment)||html.includes(fragment),fragment);
 }
 assert.match(uploader,/rid\+'\/menu\/\'\+id\+'\/\'/);
 assert.match(uploader,/return \{path,url:publicUrl,storage\}/);
});
test('B008 helper gates unsaved, Manager, or malformed files before Storage write',async()=>{
 const controls={menuItemDishFile:{files:[],value:'',disabled:false,addEventListener(){}},menuItemDishRights:{checked:false,disabled:false},menuItemDishStatus:{textContent:''},menuItemDishPreview:{hidden:true,removeAttribute(){},src:''},menuItemDishTools:{hidden:true}};
 const ctx={document:{getElementById:id=>controls[id]},URL:{revokeObjectURL(){}},crypto:{randomUUID:()=> '0d764c20-9376-4ea4-b9e1-7f0527e88b1c'},console,Image:class{}};ctx.globalThis=ctx;
 vm.runInNewContext(uploader,ctx);
 const helper=ctx.BiteMenuDishUpload;helper.open(false,true);assert.equal(controls.menuItemDishFile.disabled,true);
 helper.open(true,false);assert.equal(controls.menuItemDishFile.disabled,true);
 helper.open(true,true);assert.equal(controls.menuItemDishFile.disabled,false);
 let writes=0;
 controls.menuItemDishFile.files=[{type:'text/html',size:10}];
 await assert.rejects(helper.prepare({sb:{storage:{from(){writes++;throw Error('unexpected write')}}},rid:'bad',id:'bad',userId:'a',stillValid:()=>true}),/verification pending/);
 assert.equal(writes,0);
});

test('Uncertain menu saves never delete uploaded photos without definitive reconciliation',()=>{
 assert.doesNotMatch(html,/if\(result\.error\)\{await globalThis\.BiteMenuDishUpload\?\.cleanup\(uploaded\)/);
 assert.match(html,/Dish photo retained for reconciliation: menu save result not confirmed/);
 assert.match(html,/Save not confirmed\. Refresh menu; uploaded object requires audit before cleanup/);
});
