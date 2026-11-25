'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const js=fs.readFileSync('assets/owner-dish-photo-upload.js','utf8');
const editor=fs.readFileSync('assets/owner-menu-editor.js','utf8');
test('B008 is part of existing R14 modal, only saved item IDs are uploadable',()=>{
 assert.match(html,/id="menuItemModal"[\s\S]*?id="menuDishUploadBox"/);
 assert.match(html,/id="menuDishUploadPick" type="file" accept="image\/jpeg,image\/png,image\/webp"/);
 assert.match(js,/UUID\.test\(a\.id\)/);
 assert.match(js,/getSavedItem\(c\.rid,c\.id\)/);
 assert.match(html,/owner-dish-photo-upload\.js/);
});
test('Owner role is checked from database and Supabase Auth, not a client role claim',()=>{
 assert.match(js,/sb\.auth\.getUser\(\)/);
 assert.match(js,/from\('restaurant_members'\)/);
 assert.match(js,/eq\('restaurant_id',c\.rid\)/);
 assert.match(js,/eq\('user_id',c\.uid\)/);
 assert.match(js,/eq\('role','owner'\)/);
 assert.match(js,/if\(error\|\|!data\?\.length\)/);
});
test('File input is protected against invalid type, size, signature and decode/dimension failures',()=>{
 for(const marker of ['5242880','image/jpeg','image/png','image/webp','signatures[file.type]','createImageBitmap','bitmap.width*bitmap.height>50000000'])assert.ok(js.includes(marker),marker);
 assert.match(html,/id="menuDishPhotoRights"/);
 assert.match(js,/if\(!rights\.checked\)/);
});
test('Upload never overwrites another file, touches one scoped item only, and cleans up failure',()=>{
 assert.match(js,/c\.rid\+'\/menu\/'\+c\.id\+'\/'\+root\.crypto\.randomUUID\(\)/);
 assert.match(js,/upsert:false/);
 assert.match(js,/from\('menu_items'\)\.update\(\{image_url:url,updated_at:/);
 assert.match(js,/\.eq\('id',c\.id\)\.eq\('restaurant_id',c\.rid\)/);
 assert.match(js,/oldUrl===null\?query\.is\('image_url',null\):query\.eq\('image_url',oldUrl\)/);
 assert.match(js,/saved\.data\?\.length!==1/);
 assert.match(js,/if\(path&&!confirmed\)await cleanup\(path\)/);
 assert.doesNotMatch(js,/upsert:true/);
});
test('R14 draft protection remains wired; cash, refunds, guest docs are untouched',()=>{
 assert.match(js,/api\.isDirty\(\)/);
 assert.match(editor,/isDirty:dirty/);
 assert.match(html,/isDirty:\(\)=>globalThis\.BiteOwnerMenuEditor\?\.isDirty\(\)===true/);
 assert.doesNotMatch(js,/bite-guest-documents|Cashfree|refund|storage\.update/);
});
