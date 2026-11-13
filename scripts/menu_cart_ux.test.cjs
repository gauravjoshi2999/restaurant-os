'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Discovery=require('../assets/customer-discovery.js');

const items=[
 {id:'paneer',category_id:'mains',name:'Paneer Butter Masala',description:'Rich creamy gravy',is_vegetarian:true},
 {id:'roti',category_id:'breads',name:'Butter Roti',description:'Fresh tandoor bread',is_vegetarian:true},
 {id:'chai',category_id:'drinks',name:'चाय मसाला',description:'इलायची और अदरक',is_vegetarian:true},
 {id:'chicken',category_id:'mains',name:'Chicken Curry',description:'Spicy gravy',is_vegetarian:false}
];
const ids=options=>Discovery.selectMenu(items,options).map(item=>item.id);

test('menu search normalizes punctuation, spacing and out-of-order words',()=>{
 assert.deepEqual(ids({query:'  MASALA,   paneer  '}),['paneer']);
 assert.deepEqual(ids({query:'butter-roti'}),['roti']);
 assert.deepEqual(ids({query:'CREAMY Paneer'}),['paneer']);
 assert.deepEqual(ids({query:' --- '}),items.map(item=>item.id));
});

test('menu search preserves Hindi combining marks and combines category with veg filter',()=>{
 assert.deepEqual(ids({query:'चाय मसाला'}),['chai']);
 assert.deepEqual(ids({query:'इलायची'}),['chai']);
 assert.deepEqual(ids({category:'mains',query:'gravy',vegOnly:true}),['paneer']);
 assert.deepEqual(ids({category:'mains',query:'gravy',vegOnly:false}),['paneer','chicken']);
});

const customer=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-storefront.css','utf8');

test('direct order still has exactly one inline Menu CTA and no floating duplicate',()=>{
 assert.equal((customer.match(/id="biteMenuInlineCTA"/g)||[]).length,1);
 assert.doesNotMatch(customer,/biteMenuQuickNav/);
 assert.match(customer,/browse\.scrollIntoView\(\{/);
});

test('menu search has explicit recovery, keyboard clearing and horizontal-only category centering',()=>{
 assert.match(customer,/id="menuClearSearch" aria-label="Clear menu search" hidden/);
 assert.match(customer,/menuClearSearch'\)\.addEventListener\('click',clearMenuSearch\)/);
 assert.match(customer,/e\.key==='Escape'&&\$\('menuSearchInput'\)\.value/);
 assert.match(customer,/data-clear-menu-search>Clear search/);
 assert.match(customer,/data-reset-menu>Show all dishes/);
 assert.match(customer,/bar\.scrollBy\(\{left:/);
 assert.match(css,/\.categorybar \.chip\{min-height:44px/);
 assert.match(css,/\.menu-search input\{font-size:16px/);
});

test('cart supports Undo for a single removed line and price-change review before checkout',()=>{
 assert.match(customer,/id="cartUndoMessage"/);
 assert.match(customer,/const removed=!!dec&&Number\(cart\[id\]\|\|0\)===1/);
 assert.match(customer,/if\(saved\.removedItemId\)/);
 assert.match(customer,/saved\.restaurantId!==activeRestaurant\?\.id/);
 assert.match(customer,/if\(priceChanged\)\{openCartModal\(\);alert\(/);
 assert.match(css,/#cartModal \.cart-qty button\{min-width:44px;min-height:44px/);
});
