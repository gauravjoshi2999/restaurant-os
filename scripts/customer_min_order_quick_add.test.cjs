const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {foodSubtotal,amountRemaining,recommend}=require('../assets/customer-min-order-quick-add.js');

const dishes=[
 {id:'dal',name:'Dal fry',price:90,is_vegetarian:true},
 {id:'roti',name:'Butter Roti',price:20,is_vegetarian:true},
 {id:'thali',name:'Veg Thali',price:160,is_vegetarian:true},
 {id:'curry',name:'Chicken curry',price:110,is_vegetarian:false},
];
const html=fs.readFileSync(path.join(__dirname,'../customer.html'),'utf8');
const code=fs.readFileSync(path.join(__dirname,'../assets/customer-min-order-quick-add.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../assets/customer-min-order-quick-add.css'),'utf8');

test('minimum order uses food value only, excluding delivery and coupon',()=>{
 assert.equal(foodSubtotal(dishes,{dal:1,roti:2}),130);
 assert.equal(amountRemaining(199,130),69);
 assert.equal(amountRemaining(130,130),0);
 assert.equal(amountRemaining(50,130),0);
 assert.equal(amountRemaining(100.5,90.25),10.25);
});
test('recommendations are limited to real restaurant menu with valid prices and quantity capacity',()=>{
 const choices=recommend([...dishes,{id:'free',name:'Promo',price:0}],{roti:99,dal:1},69);
 assert.equal(choices.some(x=>x.id==='roti'),false);
 assert.equal(choices.some(x=>x.id==='free'),false);
 assert.ok(choices.length>0);
 assert.ok(choices.every(x=>dishes.some(item=>item.id===x.id)));
});
test('search finds actual available dishes without changing restaurant, session or cart',()=>{
 const cart={dal:1};
 assert.deepEqual(recommend(dishes,cart,70,'THALI').map(x=>x.id),['thali']);
 assert.deepEqual(cart,{dal:1});
 assert.deepEqual(recommend(dishes,cart,70,'not listed'),[]);
});
test('customer checkout wires minimum order rescue without changing Cashfree payment implementation',()=>{
 assert.match(html,/customer-min-order-quick-add\.js\?v=/);
 assert.match(html,/customer-min-order-quick-add\.css\?v=/);
 assert.match(html,/error\.code='BITE_MINIMUM_ORDER'/);
 assert.match(html,/window\.BiteMinOrderQuickAdd\?\.open\(error,\{focus:true\}\)/);
 assert.match(html,/if\(mode==='delivery'\)await getCheckoutDeliveryZone\(\)/);
 assert.match(html,/const minimum=Number\(activeRestaurant\?\.minimum_order_amount\|\|0\)/);
 assert.match(html,/if\(minimum>0\)/);
 assert.match(html,/window\.BiteMinOrderQuickAdd\?\.isVisible\?\.\(\)/);
 assert.doesNotMatch(code,/Cashfree\(|bite_prepare_checkout_v2|localStorage\.clear|sb\.functions\.invoke/);
});
test('quick add retains manual intent and accessible mobile controls',()=>{
 assert.match(code,/renderCart\(\)/);
 assert.match(code,/renderCheckoutSummary\(state\.fee\)/);
 assert.match(code,/refreshCheckoutZoneEstimate\(\)/);
 assert.match(code,/button\.disabled=\!\!disabled/);
 assert.match(code,/state\.restaurantId/);
 assert.match(code,/pendingPayment\(\)/);
 assert.match(code,/aria-label/);
 assert.match(code,/aria-live/);
 assert.match(code,/byId\('placeOrderBtn'\)\.click\(\)/);
 assert.match(css,/@media\(max-width:600px\)/);
 assert.match(css,/#biteMinimumQuickAdd\[hidden\]/);
});
