'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const html=fs.readFileSync('index.html','utf8');
const editor=fs.readFileSync('assets/owner-menu-editor.js','utf8');
const menuMigration=fs.readFileSync('supabase/migrations/20261109201541_bite_launch_completion.sql','utf8');
const guestMigration=fs.readFileSync('supabase/migrations/20261116164724_guest_document_privacy.sql','utf8');
const report=fs.readFileSync('docs/launch/R14_MENU_PHOTO_STORAGE_GATE_20261125.md','utf8');
const readOnlySql=fs.readFileSync('docs/sql/r14_menu_storage_permissions_readonly_20261125.sql','utf8');

test('B007 audit remains historical while B008 exposes an Owner-gated saved dish photo picker',()=>{
 const start=html.indexOf('<div class="modal" id="menuItemModal"');
 const end=html.indexOf('<div class="modal" id="restaurantModal"',start);
 assert.ok(start>0&&end>start);
 const modal=html.slice(start,end);
 assert.match(modal,/name="image_url" type="url"/);
 assert.match(modal,/id="menuItemPhotoPreview"/);
 assert.match(modal,/id="menuItemPhotoRestore"/);
 assert.match(modal,/id="menuDishUploadBox"[\s\S]*?type="file"/);
 assert.match(modal,/id="menuDishPhotoRights"/);
 assert.match(html,/assets\/owner-dish-photo-upload\.js/);
 assert.doesNotMatch(editor,/\.storage\.|\.upload\s*\(/);
 assert.match(report,/Current B007 result/);
 assert.match(fs.readFileSync('assets/owner-dish-photo-upload.js','utf8'),/eq\('role','owner'\)/);
});
test('Storage source has positive tenant-owned INSERT policy; manager is not an uploader',()=>{
 const match=menuMigration.match(/create policy bite_assets_insert[^;]+;/i);
 assert.ok(match,'Missing existing insert policy');
 assert.match(match[0],/to authenticated/i);
 assert.match(match[0],/bucket_id in \('bite-menu','bite-private'\)/);
 assert.match(match[0],/storage\.foldername\(name\)/);
 assert.match(match[0],/array\['owner'\]/);
 assert.doesNotMatch(match[0],/manager|staff|anon/);
 assert.match(html,/function menuEditScope\(rid\).*\['owner','manager'\]/);
 assert.match(report,/Manager upload BLOCKED/);
});
test('Guest document boundaries are restrictive, not permission grants for other buckets',()=>{
 for(const name of ['guest_docs_anon_boundary','guest_docs_insert_boundary','guest_docs_no_replace']){
  const regex=new RegExp('create policy '+name+' on storage\\.objects as restrictive','i');
  assert.match(guestMigration,regex);
 }
 assert.match(report,/RESTRICTIVE/);
 assert.match(report,/No inferred anonymous write vulnerability/);
});
test('Existing cover upload uses unique tenant path without overwrite; not a menu upload',()=>{
 assert.ok(html.includes("path=rid+'/covers/'+crypto.randomUUID()+'.webp'"),'cover uploads must use a fresh path under the current restaurant');
 assert.match(html,/\.storage\.from\('bite-menu'\)/);
 assert.match(html,/upsert:false/);
 assert.match(report,/no menu-photo file picker/i);
});
test('Audit SQL is reproducible and exclusively read-only',()=>{
 const stripped=readOnlySql.split('\n').filter(l=>!/^\s*--/.test(l)).join('\n');
 const statements=stripped.split(';').map(s=>s.trim()).filter(Boolean);
 assert.ok(statements.length>=5);
 for(const stmt of statements)assert.match(stmt,/^SELECT\b/i);
 assert.doesNotMatch(stripped,/\b(INSERT|UPDATE|DELETE|DROP|CREATE|GRANT|REVOKE|TRUNCATE|ALTER|CALL|DO)\b/i);
 assert.match(stripped,/permissive, cmd, roles::text/);
 assert.match(stripped,/bucket_id='bite-menu'/);
});
