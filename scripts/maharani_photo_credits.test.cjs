'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const page=fs.readFileSync('maharani-photo-credits.html','utf8');
const customer=fs.readFileSync('customer.html','utf8');
const builder=fs.readFileSync('scripts/build_static_site.py','utf8');
const manifest=JSON.parse(fs.readFileSync('docs/launch/maharani-image-snapshot-20261116.json','utf8'));

test('credits page covers all current linked Maharani images, not stale 112 labels',()=>{
  const names=[...page.matchAll(/<li class="entry" data-search=/g)];
  assert.equal(manifest.images.length,91);
  assert.equal(names.length,91);
  for(const entry of manifest.images){
    assert.ok(page.includes('<h2>'+entry.name.replace(/&/g,'&amp;').replace(/'/g,'&#39;')+'</h2>'),entry.name);
  }
  assert.match(page,/illustrative food photographs sourced from Wikimedia Commons/);
  assert.match(page,/not photographs taken of meals cooked at Hotel Maharani Palace/);
});
test('external sources are individually linked safely and no secret leaks exist',()=>{
  assert.equal((page.match(/Wikimedia file · author &amp; license details/g)||[]).length,91);
  assert.equal((page.match(/rel="noopener noreferrer"/g)||[]).length,91);
  assert.doesNotMatch(page,/sb_secret_|service_role|cashfree_secret|SUPABASE_KEY|api_secret/);
});
test('customer link is restaurant-scoped, with accessible subtle layout',()=>{
  assert.match(customer,/id="biteMenuPhotoCredits"[^>]+hidden/);
  assert.match(customer,/href="maharani-photo-credits\.html"/);
  assert.match(customer,/photoCredits\.hidden=activeRestaurant\?\.id!=='262aaba7-f48b-4fa5-9ff6-b334ededca84'/);
  assert.match(page,/@media\(max-width:690px\)/);
  assert.match(page,/id="search" type="search"/);
});
test('credits are packaged into actual public GitHub Pages build',()=>{
  assert.match(builder,/'maharani-photo-credits\.html'/);
});
