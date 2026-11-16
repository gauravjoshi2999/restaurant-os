'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const preview=require('../assets/owner-menu-options-preview.js');
const owner=fs.readFileSync('assets/owner-menu-options.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const g='33333333-3333-4333-8333-333333333333',r='22222222-2222-4222-8222-222222222222';
const item='11111111-1111-4111-8111-111111111111';
const half='44444444-4444-4444-8444-444444444444',full='55555555-5555-4555-8555-555555555555';
const optGroups=[{id:g,name:'Size',min_select:1,max_select:1,is_available:true}];
const links=[{option_group_id:g,is_available:true}];
const choices=[{id:half,name:'Half',option_group_id:g,is_available:true,price_delta:0},
 {id:full,name:'Full',option_group_id:g,is_available:true,price_delta:75}];
test('enabled group price preview is selectable and server verified',()=>{
 const active=preview.activeGroups(optGroups,links,choices);
 assert.equal(active.length,1);
 assert.deepEqual(preview.validateSelections(active,[full]),[full]);
 const quote={quote_only:true,authorizes_payment:false,currency:'INR',restaurant_id:r,
  food_subtotal:175,lines:[{menu_item_id:item,quantity:1,final_unit_price:175,
   base_unit_price:100,option_unit_total:75,options:[{choice_id:full,name:'Full',price_delta:75}]}]};
 assert.equal(preview.verifyServerQuote(quote,r,item,[full]).total,175);
 assert.equal(preview.amount(175),'₹175.00');
});
test('required size must be selected and a second choice from max-one group is rejected',()=>{
 const active=preview.activeGroups(optGroups,links,choices);
 assert.throws(()=>preview.validateSelections(active,[]),/Size: choose/);
 assert.throws(()=>preview.validateSelections(active,[half,full]),/Size: choose/);
});
test('unavailable or unlinked options are rejected, with no fallback fake pricing',()=>{
 const active=preview.activeGroups(optGroups,links,[{...choices[0],is_available:false},choices[1]]);
 assert.throws(()=>preview.validateSelections(active,[half]),/unavailable/);
 assert.equal(preview.activeGroups(optGroups,[{...links[0],is_available:false}],choices).length,0);
 assert.equal(preview.activeGroups([{...optGroups[0],is_available:false}],links,choices).length,0);
});
test('quote must be immutable read-only evidence for the exact dish and choices',()=>{
 const q={quote_only:true,authorizes_payment:false,currency:'INR',restaurant_id:r,
  food_subtotal:175,lines:[{menu_item_id:item,quantity:1,final_unit_price:175,
   options:[{choice_id:full,name:'Full'}]}]};
 for(const altered of [{...q,authorizes_payment:true},{...q,restaurant_id:g},
  {...q,lines:[{...q.lines[0],menu_item_id:g}]},
  {...q,lines:[{...q.lines[0],options:[{choice_id:half}]}]},
  {...q,food_subtotal:174}]){
  assert.throws(()=>preview.verifyServerQuote(altered,r,item,[full]));
 }
});
test('owner preview reads secure database quote; no payment or order writes',()=>{
 assert.match(owner,/sb\.rpc\('bite_quote_menu_options_v2'/);
 assert.match(owner,/BiteOwnerOptionPreview\.verifyServerQuote/);
 assert.match(html,/id="menuOptionsPreviewForm"/);
 assert.match(html,/owner-menu-options-preview\.js\?v=20261116-preview1/);
 assert.doesNotMatch(owner,/sb\.rpc\('bite_prepare_checkout_v3'/);
 assert.doesNotMatch(owner,/functions\.invoke\('bite-live-checkout'/);
});
test('item switching and selection changes must invalidate any previous quote',()=>{
 assert.match(owner,/previewSelection\.clear\(\)/);
 assert.match(owner,/renderPricePreview\(\)/);
 assert.match(owner,/previewResult\.replaceChildren\(\)/);
 assert.match(owner,/data-option-preview-choice/);
});
