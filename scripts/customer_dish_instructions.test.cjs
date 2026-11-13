'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Notes=require('../assets/customer-item-notes.js');
const customer=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-transactions.css','utf8');
const menuItems=[
 {id:'paneer',name:'Paneer Butter Masala',price:180},
 {id:'chai',name:'मसाला चाय',price:30},
 {id:'other',name:'Another item',price:10}
];
const entries=[['paneer',2],['chai',1]];

test('dish instructions preserve Hindi text, clean control characters and keep item names',()=>{
 const result=Notes.compose({
  generalNote:'Ring bell\n at gate',itemNotes:{paneer:'  No onion\n extra spicy  ',chai:'कम चीनी',other:'IGNORE'},
  entries,menuItems
 });
 assert.match(result.note,/Ring bell at gate/);
 assert.match(result.note,/Paneer Butter Masala x2: No onion extra spicy/);
 assert.match(result.note,/मसाला चाय x1: कम चीनी/);
 assert.doesNotMatch(result.note,/IGNORE/);
 assert.equal(result.hasDishNotes,true);
 assert.equal(result.itemCount,2);
 assert.equal(result.tooLong,false);
 assert.equal(result.remaining,500-result.note.length);
});

test('only selected, valid menu item IDs retain notes; old carts without notes still work',()=>{
 assert.deepEqual(Notes.normalizeNotes(undefined,['paneer']),{});
 assert.deepEqual(Notes.normalizeNotes({paneer:'No onion',other:'not in cart'},['paneer']),{paneer:'No onion'});
 assert.deepEqual(Notes.normalizeNotes({paneer:12,chai:'   '},['paneer','chai']),{});
 assert.deepEqual(Notes.compose({entries:[['paneer',1]],menuItems}).dishLines,[]);
});

test('each dish request has a 100-character cap; combined note must fit 500',()=>{
 const raw='x'.repeat(120);
 assert.equal(Notes.normalizeNotes({paneer:raw},['paneer']).paneer.length,100);
 const tooLong=Notes.compose({generalNote:'a'.repeat(490),itemNotes:{paneer:'no onion'},entries,menuItems});
 assert.equal(tooLong.tooLong,true);
 assert.ok(tooLong.remaining<0);
 const fine=Notes.compose({generalNote:'a'.repeat(500),entries,menuItems});
 assert.equal(fine.tooLong,false);
 assert.equal(fine.remaining,0);
});

test('dish requests never change cart pricing or introduce client-priced add-ons',()=>{
 const result=Notes.compose({itemNotes:{paneer:'Extra spicy'},entries,menuItems});
 assert.ok(result.note.includes('Extra spicy'));
 assert.equal(entries.reduce((total,[id,q])=>total+menuItems.find(i=>i.id===id).price*q,0),390);
 assert.doesNotMatch(customer,/p_item_price|p_addon_price|p_variant_price/);
 assert.match(customer,/const items=entries\.map\(\(\[id,quantity\]\)=>\(\{menu_item_id:id,quantity\}\)\)/);
 assert.match(customer,/p_customer_note:instructions\.note\|\|null,p_items:items/);
});

test('restaurant-scoped cart notes persist and are restored only with matching cart',()=>{
 assert.match(customer,/const matchingCart=savedCart\?\.restaurantId===id/);
 assert.match(customer,/itemNotes=matchingCart\?BiteItemNotes\.normalizeNotes/);
 assert.match(customer,/itemNotes:BiteItemNotes|itemNotes:notes,generalNote/);
 assert.match(customer,/delete itemNotes\[id\]/);
 assert.match(customer,/removedItemNote:itemNotes\[id\]/);
 assert.match(customer,/if\(saved\.removedItemNote\)itemNotes\[saved\.removedItemId\]/);
 assert.match(customer,/itemNotes=BiteItemNotes\.normalizeNotes\(saved\.itemNotes,Object\.keys\(cart\)\)/);
});

test('cart note UI is accessible and checkout blocks overlong requests before server writes',()=>{
 assert.match(customer,/id="cartInstructionsStatus"[^>]*role="status"/);
 assert.match(customer,/id="checkoutDishInstructions"/);
 assert.match(customer,/data-cart-note-toggle/);
 assert.match(customer,/aria-controls="cart-note-editor-/);
 assert.match(customer,/aria-expanded="false"/);
 assert.match(customer,/data-cart-item-note/);
 assert.match(customer,/maxlength="100"/);
 assert.match(customer,/if\(instructions\.tooLong\)throw new Error/);
 assert.match(customer,/if\(cartInstructionSnapshot\(\)\.tooLong\)/);
 assert.match(css,/\.cart-item-note-editor textarea\{display:block;width:100%/);
 assert.match(customer,/id="biteMenuInlineCTA"/);
 assert.doesNotMatch(customer,/biteMenuQuickNav/);
});
