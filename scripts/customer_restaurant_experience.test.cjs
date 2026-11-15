'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const details=require('../assets/customer-restaurant-experience.js');
const html=fs.readFileSync('customer.html','utf8');
const js=fs.readFileSync('assets/customer-restaurant-experience.js','utf8');
const css=fs.readFileSync('assets/customer-restaurant-experience.css','utf8');
test('closing-soon counts use actual Asia/Kolkata clock with no fabricated hours',()=>{
 const restaurant={opening_time:'09:00:00',closing_time:'22:00:00'};
 assert.equal(details.closingSoonMinutes(restaurant,Date.parse('2026-11-15T16:00:00Z')),30);
 assert.equal(details.closingSoonMinutes(restaurant,Date.parse('2026-11-15T16:20:00Z')),10);
 assert.equal(details.closingSoonMinutes(restaurant,Date.parse('2026-11-15T16:30:00Z')),null);
 assert.equal(details.closingSoonMinutes(restaurant,Date.parse('2026-11-15T10:00:00Z')),null);
 assert.equal(details.closingSoonMinutes({},Date.now()),null);
 assert.equal(details.closingSoonMinutes({...restaurant,is_temporarily_closed:true},Date.parse('2026-11-15T16:10:00Z')),null);
});
test('overnight restaurants are computed across midnight in IST',()=>{
 const restaurant={opening_time:'18:00',closing_time:'01:00'};
 assert.equal(details.minsUntilClosing(restaurant,Date.parse('2026-11-15T17:30:00Z')),120);
 assert.equal(details.closingSoonMinutes(restaurant,Date.parse('2026-11-15T19:15:00Z')),15);
 assert.equal(details.minsUntilClosing(restaurant,Date.parse('2026-11-15T10:00:00Z')),null);
});
test('vegetarian claim only appears for complete real list of all-vegan-tagged menu items',()=>{
 assert.equal(details.menuIsVegetarian([]),false);
 assert.equal(details.menuIsVegetarian([{is_vegetarian:true},{is_vegetarian:true}]),true);
 assert.equal(details.menuIsVegetarian([{is_vegetarian:true},{is_vegetarian:false}]),false);
 assert.equal(details.menuIsVegetarian([{is_vegetarian:true},{}]),false);
});
test('restaurant facts and category buttons are integrated without altering checkout',()=>{
 assert.match(html,/assets\/customer-restaurant-experience\.css\?v=20261115-details1/);
 assert.match(html,/assets\/customer-restaurant-experience\.js\?v=20261115-details1/);
 assert.match(html,/BiteRestaurantDetails\?\.render\(activeRestaurant,\[\]\)/);
 assert.match(html,/BiteRestaurantDetails\?\.render\(activeRestaurant,menuItems\)/);
 assert.match(js,/role="dialog" aria-modal="true"/);
 assert.match(js,/source\.click\(\)/);
 assert.match(js,/aria-current/);
 assert.match(js,/closingSoonMinutes\(restaurant\)/);
 assert.match(js,/BiteDiscovery\?\.distance/);
 assert.match(js,/Final charge confirmed during checkout/);
 assert.doesNotMatch(js,/Cashfree|sb\.rpc|checkoutArgs|free delivery above|personalized for you|No packaging charges/i);
 assert.match(css,/@media\(max-width:600px\)/);
 assert.match(css,/safe-area-inset-bottom/);
});
