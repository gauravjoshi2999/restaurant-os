'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const options=require('../assets/owner-menu-options.js');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/owner-menu-options.css','utf8');
const moduleSource=fs.readFileSync('assets/owner-menu-options.js','utf8');
const customer=fs.readFileSync('customer.html','utf8');

test('Owner Size/Add-on choice input accepts valid names and exact two-decimal charges',()=>{
 assert.deepEqual(options.validateChoice('Full','40.50'),{name:'Full',price_delta:40.5});
 assert.deepEqual(options.validateChoice('Half','0'),{name:'Half',price_delta:0});
 assert.deepEqual(options.validateChoice(' Extra Cheese ','10000.00'),{name:'Extra Cheese',price_delta:10000});
});

test('Owner cannot save invalid money values or confusing option labels',()=>{
 for(const price of ['-1','0.001','2e3','Infinity','NaN','','10000.01','12,50']){
  assert.throws(()=>options.validateChoice('Extra Cheese',price));
 }
 for(const name of ['', ' ', 'a'.repeat(81)]){
  assert.throws(()=>options.validateChoice(name,'10'));
 }
});

test('Owner Size required and Extras optional selections obey database limits',()=>{
 assert.deepEqual(options.validateGroup('Size','1','1',2),{name:'Size',min_select:1,max_select:1});
 assert.deepEqual(options.validateGroup('Extras','0','3',5),{name:'Extras',min_select:0,max_select:3});
 for(const [min,max] of [['-1','1'],['2','1'],['1','0'],['0','9'],['1.5','3']]){
  assert.throws(()=>options.validateGroup('Size',min,max,5));
 }
 assert.throws(()=>options.validateGroup('Size',2,2,1));
 assert.throws(()=>options.validateGroup('Size',1,1,0));
});

test('Multiple options are capped and names unique, case-insensitively',()=>{
 assert.equal(options.validateDraftChoices([{name:'Half',price_delta:0},{name:'Full',price_delta:40}]).length,2);
 assert.throws(()=>options.validateDraftChoices([{name:'Full',price_delta:0},{name:'full',price_delta:40}]),/same naam/);
 assert.throws(()=>options.validateDraftChoices([]));
 assert.throws(()=>options.validateDraftChoices(Array.from({length:31},(_,n)=>({name:'Choice '+n,price_delta:0}))));
});

test('Owner Menu and Prices contains visible Size/Add-on entry tied to actual dish',()=>{
 assert.match(html,/data-menu-options="'\+esc\(i\.id\)\+'"/);
 assert.match(html,/window\.BiteMenuOptions\.open\(button\.dataset\.menuOptions\)/);
 assert.match(html,/id="menuOptionsModal"/);
 assert.match(html,/id="menuOptionsGroupForm"/);
 assert.match(html,/id="menuOptionsGroupList"/);
 assert.match(html,/id="menuOptionsDraftChoices"/);
 assert.match(html,/Owner menu setup/);
 assert.match(html,/paid selection OFF/);
 assert.match(html,/owner-menu-options\.js\?v=20261113-size1/);
 assert.match(html,/owner-menu-options\.css\?v=20261113-size1/);
 assert.match(css,/#menuOptionsModal \.bite-option-choice-row/);
 assert.match(css,/@media\(max-width:700px\)/);
});

test('Owner manager checks selected restaurant before every read or write',()=>{
 assert.match(html,/getRestaurantId:menuRestaurantId,getMenuItems:\(\)=>menuItems,canEditRestaurant/);
 assert.match(html,/access\.memberships\.some\(m=>m\.restaurant_id===rid&&\['owner','manager'\]/);
 assert.match(moduleSource,/deps\.getRestaurantId\(\)!==selected\.restaurantId/);
 assert.match(moduleSource,/deps\.canEditRestaurant\(selected\.restaurantId\)/);
 assert.match(moduleSource,/deps\.getMenuItems\(\)\.some\(item=>item\.id===selected\.itemId\)/);
 assert.match(moduleSource,/\.eq\('restaurant_id',ctx\.restaurantId\)/);
 assert.match(moduleSource,/\.eq\('menu_item_id',ctx\.itemId\)/);
});

test('New option groups are created Paused, before choices and tenant link are saved',()=>{
 assert.match(moduleSource,/\.insert\(\{\.\.\.payload,restaurant_id:ctx\.restaurantId,is_available:false\}\)/);
 assert.match(moduleSource,/menu_option_choices/);
 assert.match(moduleSource,/menu_item_option_groups/);
 assert.match(moduleSource,/option_group_id:createdId,is_available:false/);
 assert.match(moduleSource,/cleanup=await deps\.sb\.from\('menu_option_groups'\)/);
 assert.match(moduleSource,/validateDraftChoices\(readDraftChoices\(\)\)/);
 assert.match(moduleSource,/Enable for this dish/);
});

test('The owner can edit/pause options but live customer payment remains V2',()=>{
 assert.match(moduleSource,/async function editChoice/);
 assert.match(moduleSource,/async function saveGroup/);
 assert.match(moduleSource,/async function toggleChoice/);
 assert.match(moduleSource,/async function toggleLink/);
 assert.match(moduleSource,/remaining<g\.min_select/);
 assert.match(moduleSource,/Customer paid checkout abhi OFF hai/);
 assert.match(customer,/bite_prepare_checkout_v2/);
 assert.doesNotMatch(customer,/bite_prepare_checkout_v3_priced_candidate/);
 assert.doesNotMatch(html,/service_role_key|secret_key/);
});
