'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Search=require('../assets/customer-menu-search.js');
const html=fs.readFileSync('customer.html','utf8');
const addon=fs.readFileSync('assets/customer-menu-cart-premium.js','utf8');
const food=[
 {id:'thali',name:'Paneer Thali',description:'Fresh roti',category_id:'mains',is_vegetarian:true,price:180,is_available:true},
 {id:'dosa',name:'Masala Dosa',description:'Paneer optional',category_id:'breakfast',is_vegetarian:true,price:99,is_available:true},
 {id:'snack',name:'Paneer Tikka',description:'Spiced starter',category_id:'starters',is_vegetarian:true,price:120,is_available:true},
 {id:'chicken',name:'Chicken Tikka',description:'Grilled',category_id:'starters',is_vegetarian:false,price:220,is_available:true},
 {id:'disabled',name:'Lassi',description:'Cold',category_id:'drinks',is_vegetarian:true,price:40,is_available:false},
 {id:'zero',name:'Water',description:'Drinking',category_id:'drinks',is_vegetarian:true,price:0,is_available:true}
];

test('cached search preserves original order for empty query and category/veg filters',()=>{
 assert.deepEqual(Search.selectMenu(food,{}).map(i=>i.id),food.map(i=>i.id));
 assert.deepEqual(Search.selectMenu(food,{category:'starters',vegOnly:true}).map(i=>i.id),['snack']);
 assert.deepEqual(Search.selectMenu(food,{query:'tikka',vegOnly:true}).map(i=>i.id),['snack']);
 assert.deepEqual(Search.selectMenu(food,{query:'   '}).map(i=>i.id),food.map(i=>i.id));
});

test('dish name matches outrank description matches without changing prices',()=>{
 const matches=Search.selectMenu(food,{query:'paneer'});
 assert.deepEqual(matches.map(i=>i.id),['thali','snack','dosa']);
 assert.equal(matches[0].price,180);
 assert.deepEqual(Search.selectMenu(food,{query:'paneer tikka'}).map(i=>i.id),['snack']);
 assert.deepEqual(Search.selectMenu(food,{query:'masala'}).map(i=>i.id),['dosa']);
});

test('Unicode and Hindi token matching are preserved',()=>{
 const items=[
  {id:'h1',name:'पनीर मसाला',description:'ताज़ा',category_id:null,is_vegetarian:true},
  {id:'h2',name:'दाल चावल',description:'स्वादिष्ट',category_id:null,is_vegetarian:true}
 ];
 assert.deepEqual(Search.selectMenu(items,{query:'पनीर मसाला'}).map(i=>i.id),['h1']);
 assert.deepEqual(Search.selectMenu(items,{query:'मसाला पनीर'}).map(i=>i.id),['h1']);
 assert.deepEqual(Search.selectMenu(items,{query:'चावल'}).map(i=>i.id),['h2']);
});

test('cart suggestions use only real available same-restaurant menu items, stable category variety and veg preference',()=>{
 assert.deepEqual(Search.selectAddOns(food,{thali:1}).map(i=>i.id),
  ['dosa','snack','zero','disabled'].filter(x=>x!=='disabled').concat(['chicken']));
 // One completed vegetarian cart may still expose nonveg only after vegetarian choices.
 const suggestions=Search.selectAddOns(food,{thali:1});
 assert.deepEqual(suggestions.slice(0,3).map(i=>i.id),['dosa','snack','zero']);
 assert.equal(suggestions.at(-1).id,'chicken');
 assert.ok(!suggestions.some(i=>i.id==='disabled'||i.id==='thali'));
 assert.deepEqual(Search.selectAddOns(food,{thali:1},2).map(i=>i.id),['dosa','snack']);
 assert.deepEqual(Search.selectAddOns(food,{}),[]);
 assert.deepEqual(Search.selectAddOns(food,{thali:1},0),[]);
});

test('invalid and missing prices never appear, and zero rupee real items remain eligible',()=>{
 const choices=Search.selectAddOns([...food,{id:'bad',name:'Invalid',price:null,category_id:'x'}],{thali:1});
 assert.ok(choices.some(i=>i.id==='zero'));
 assert.ok(!choices.some(i=>i.id==='bad'));
});

test('integration stays in existing restaurant menu and cart without payment or backend changes',()=>{
 assert.match(html,/src="assets\/customer-menu-search\.js\?v=20261114-search1"/);
 assert.match(html,/BiteMenuSearch\.selectMenu\(menuItems,/);
 assert.match(html,/setTimeout\(\(\)=>renderMenuItems\(\),70\)/);
 assert.match(addon,/BiteMenuSearch\.selectAddOns\(currentItems,currentCart,6\)/);
 assert.match(addon,/renderCart\(\)/);
 assert.match(addon,/refreshMenuQuantityControl\(id\)/);
 assert.doesNotMatch(addon,/fetch\(|sb\.|Cashfree|service_role|payment_/);
 assert.doesNotThrow(()=>new vm.Script(addon));
 assert.match(html,/sb\.from\('menu_items'\)/);
 assert.match(html,/sb\.rpc\('check_restaurant_delivery_area'/);
});
