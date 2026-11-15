'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const customer=fs.readFileSync('customer.html','utf8');
const begin=html.indexOf('async function adjustOwnerKitchenPrep(delta){');
const end=html.indexOf("document.getElementById('ownerRestaurantSettingsForm')?.addEventListener",begin);
const rush=html.slice(begin,end);
test('Rush controls are Owner-only, manual, and do not auto-pause paid orders',()=>{
 assert.ok(begin>0&&end>begin);
 assert.match(html,/id="ownerRushPlus15" type="button" onclick="adjustOwnerKitchenPrep\(15\)"/);
 assert.match(html,/id="ownerRushMinus15" type="button" onclick="adjustOwnerKitchenPrep\(-15\)"/);
 assert.match(rush,/access\.role!=='owner'/);
 assert.match(rush,/!confirm\(/);
 assert.match(rush,/\!\[15,-15\]\.includes\(delta\)/);
 assert.doesNotMatch(rush,/delivery_paused\s*:/);
 assert.doesNotMatch(rush,/is_temporarily_closed\s*:/);
 assert.doesNotMatch(rush,/sb\.from\('orders'\)\.(update|delete)/);
});
test('One-field Rush update stays within 5..240 and enforces tenant + stale-device guard',()=>{
 assert.match(rush,/Math\.max\(5,Math\.min\(240,current\+delta\)\)/);
 assert.match(rush,/\.update\(\{estimated_prep_minutes:next\}\)/);
 assert.match(rush,/\.eq\('id',restaurantId\)\.eq\('estimated_prep_minutes',current\)/);
 assert.match(rush,/\.select\('id,estimated_prep_minutes'\)\.maybeSingle\(\)/);
 assert.match(rush,/if\(!data\|\|data\.id!==restaurantId\)throw/);
 assert.match(rush,/ownerKitchenPrepChangeBusy=true/);
 assert.match(rush,/ownerKitchenPrepChangeBusy=false/);
});
test('Busy kitchen is a recommendation only; actual Owner interaction remains necessary',()=>{
 assert.match(html,/id="ownerKitchenRushShortcut"/);
 assert.match(html,/kitchenActiveCount>=4/);
 assert.match(html,/kitchenShortcut\.hidden=access\.role!=='owner'\|\|kitchenActiveCount<4/);
 assert.match(html,/\['Received','Accepted','Preparing'\]\.includes\(o\.status\)/);
 assert.match(html,/id="ownerRushStatus"/);
 assert.match(customer,/estimated_prep_minutes/);
});
