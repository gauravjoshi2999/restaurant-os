'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const m=require('../assets/customer-menu-personalization.js');
const html=fs.readFileSync('customer.html','utf8');
const owner=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/customer-menu-personalization.css','utf8');
const cards=[
 {id:'a',name:'Paneer',price:110,is_available:true,category_id:'curry',is_vegetarian:true},
 {id:'b',name:'Roti',price:18,is_available:true,category_id:'bread',is_vegetarian:true,is_kids_choice:true},
 {id:'c',name:'Chicken',price:120,is_available:true,category_id:'curry',is_vegetarian:false},
 {id:'d',name:'Veg Rice',price:90,is_available:true,category_id:'rice',is_vegetarian:true,is_kids_choice:false},
 {id:'e',name:'Unavailable sweet',price:50,is_available:false,category_id:'sweet',is_vegetarian:true,is_kids_choice:true},
 {id:'f',name:'Free sample',price:0,is_available:true,category_id:'sweet',is_vegetarian:true}
];
test('Kids Choice only includes owner-approved available dishes',()=>{
 assert.deepEqual(m.selectKids(cards.filter(x=>x.is_available),true).map(x=>x.id),['b']);
 assert.equal(m.selectKids(cards,false),cards);
 assert.deepEqual(m.selectKids([],true),[]);
});
test('suggestions use only same supplied restaurant menu without fake popularity or mutation',()=>{
 const original={a:1},result=m.selectRecommendations(cards,original);
 assert.deepEqual(original,{a:1});
 assert.ok(result.length>0&&result.length<=6);
 assert.ok(result.every(item=>cards.includes(item)&&item.is_available!==false&&item.price>0&&item.id!=='a'));
 assert.ok(result.every(item=>item.is_vegetarian===true),'vegetarian cart must not suggest non-veg');
});
test('all-menu suggestions are available published items only',()=>{
 const result=m.selectRecommendations(cards,{});
 assert.ok(result.includes(cards[2]),'non-veg allowed when no veg-only cart constraint');
 assert.ok(!result.includes(cards[4])&&!result.includes(cards[5]));
});
test('owner can mark dish Kids Choice, and customer fetches the same field',()=>{
 assert.match(owner,/name="is_kids_choice"/);
 assert.match(owner,/is_kids_choice:f\.get\('is_kids_choice'\)==='true'/);
 assert.match(owner,/f\.elements\.is_kids_choice\.value=String\(item\.is_kids_choice===true\)/);
 assert.match(html,/assets\/customer-menu-personalization\.js\?v=20261115-kids1/);
 assert.match(html,/assets\/customer-menu-personalization\.css\?v=20261115-kids1/);
 assert.match(html,/select\('id,category_id,name,description,price,is_vegetarian,is_kids_choice,image_url'\)/);
 assert.match(html,/window\.BiteMenuPersonalization\?\.selectKids/);
 assert.match(html,/window\.BiteMenuPersonalization\?\.renderRecommendations/);
 assert.match(html,/i\.is_kids_choice===true\?'<span class="bite-kids-tag">/);
});
test('responsive and payment-independent recommendations',()=>{
 assert.match(css,/@media\(max-width:600px\)/);
 assert.match(css,/focus-visible/);
 const js=fs.readFileSync('assets/customer-menu-personalization.js','utf8');
 assert.doesNotMatch(js,/Cashfree|service_role|sb\.rpc|checkout|payment_session_id/);
 assert.match(js,/renderCart\(\);refreshMenuQuantityControl\(item\.id\)/);
 assert.match(js,/window\.BiteDiscovery\?\.safeImage/);
 assert.doesNotMatch(js,/[^.]root\.BiteDiscovery/);
});
