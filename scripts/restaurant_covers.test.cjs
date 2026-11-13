'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Covers=require('../assets/bite-restaurant-covers.js');
const A='262aaba7-f48b-4fa5-9ff6-b334ededca84';
const B='97012f3c-19c5-4347-b1d3-4534f887b401';
const pure={id:A,name:'Hotel Maharani Palace',cuisine_tags:['Pure Vegetarian (शुद्ध शाकाहारी) • North Indian • Fast Food']};
const spicy={id:B,name:'Bajrang Food Court',cuisine_tags:['North Indian']};
test('All missing-cover restaurants have a non-empty curated Bite food photograph',()=>{
 for(const restaurant of [pure,spicy,{id:B,name:'Pizza Corner',cuisine_tags:['Pizza']},{id:B,name:'Sweet Shop',cuisine_tags:['Desserts']},{id:B,name:'South Indian Eatery',cuisine_tags:['South Indian']} ]){
  const cover=Covers.choose(restaurant);
  assert.match(cover.src,/^assets\/food\/(?:meal-1100|curry-800|dosa-800|pizza-800|dessert-800)\.jpg$/);
  assert.equal(cover.source,'bite');
 }
});
test('Pure Veg is prioritized over mixed fast-food, Chinese or any meat image',()=>{
 assert.equal(Covers.isPureVeg(pure),true);
 assert.equal(Covers.suggestedKey(pure),'meal');
 const c=Covers.choose(pure,[{restaurant_id:A,name:'Egg curry',image_url:'https://images.invalid/egg.jpg',is_vegetarian:true}]);
 assert.equal(c.src,'assets/food/meal-1100.jpg');
 assert.equal(c.source,'bite');
});
test('Existing real restaurant menu photo can supply relevant safe cover, but never another tenant',()=>{
 const items=[{restaurant_id:A,name:'Maharani Paneer',image_url:'https://example.test/paneer.webp',is_vegetarian:true},
  {restaurant_id:B,name:'Paneer curry',image_url:'https://example.test/curry.webp',is_vegetarian:true}];
 assert.equal(Covers.choose(spicy,items).src,'https://example.test/curry.webp');
 assert.equal(Covers.choose(spicy,items).source,'menu');
 assert.equal(Covers.choose(spicy,[items[0]]).source,'bite');
});
test('Owner cover overrides defaults and is only valid in its restaurant folder',()=>{
 const path=A+'/covers/1f298b87-b2b5-4934-9755-0f4bfe2e245e.webp';
 const owner={...pure,cover_image_path:path,cover_image_updated_at:'2026-11-13T11:11:00+05:30'};
 const display=Covers.choose(owner);
 assert.equal(display.source,'owner');
 assert.equal(display.alt,'Hotel Maharani Palace restaurant cover photo');
 assert.equal(new URL(display.src).pathname,'/storage/v1/object/public/bite-menu/'+path);
 assert.ok(new URL(display.src).searchParams.has('v'));
 assert.equal(Covers.ownCoverPath({...owner,cover_image_path:B+'/covers/1f298b87-b2b5-4934-9755-0f4bfe2e245e.webp'}),null);
 assert.equal(Covers.choose({...owner,cover_image_path:'https://attacker.invalid/image.webp'}).source,'bite');
});
test('Invalid paths or dangerous menu image URLs cannot become public restaurant cover',()=>{
 const dangerous=[
  B+'/covers/../../secret.webp',B+'/covers/pic.jpg',B+'/private/file.webp',
  'javascript:alert(1)',A+'/covers/not-my-image.webp'
 ];
 for(const path of dangerous)assert.equal(Covers.ownCoverPath({...spicy,cover_image_path:path}),null);
 for(const url of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','http://example.test/i.webp']){
  assert.equal(Covers.choose(spicy,[{restaurant_id:B,image_url:url}]).source,'bite');
 }
});
test('Customer uses cover module for homepage cards, direct hero, and only its own published restaurant RPC',()=>{
 const customer=fs.readFileSync('customer.html','utf8');
 assert.match(customer,/BiteRestaurantCovers\.choose\(r,publicMenuSearch,SUPABASE_URL\)/);
 assert.match(customer,/BiteRestaurantCovers\.choose\(activeRestaurant,publicMenuSearch,SUPABASE_URL\)/);
 assert.match(customer,/id="biteRestaurantHeroImage"/);
 assert.match(customer,/id="biteRestaurantCoverLabel"/);
 assert.match(customer,/image_url'\)\.eq\('is_available'/);
 assert.match(customer,/bite_storefront/);
});
test('Owner upload is correctly authorized, WebP compressed, with scoped database path and safe rollback',()=>{
 const owner=fs.readFileSync('index.html','utf8');
 const block=owner.slice(owner.indexOf("async function compressOwnerCoverImage"),owner.indexOf("async function loadOwnerSettings(){"));
 assert.match(block,/access\.role!=='owner'/);
 assert.match(block,/crypto\.randomUUID\(\)\+'\.webp'/);
 assert.match(block,/from\('bite-menu'\)/);
 assert.match(block,/contentType:'image\/webp'/);
 assert.match(block,/select\('id,cover_image_path,cover_image_updated_at'\)\.single\(\)/);
 assert.match(block,/if\(uploadedPath\)/);
 assert.match(block,/renderOwnerRestaurantCover\(\)/);
 assert.match(owner,/id="ownerRestaurantCoverUpload"/);
 assert.match(owner,/id="ownerRestaurantCoverReset"/);
});
test('Migration preserves existing tenant RLS and limits assigned cover path to same restaurant UUID',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261113130000_restaurant_cover_images.sql','utf8');
 assert.match(sql,/add column if not exists cover_image_path text/);
 assert.match(sql,/cover_image_path ~ \('\^'\|\|id::text/);
 assert.match(sql,/public\.list_public_restaurants\(\) r/);
 assert.match(sql,/'cover_image_path',\(select cr\.cover_image_path/);
 assert.doesNotMatch(sql,/drop policy|disable row level security/i);
});
