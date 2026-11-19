'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Review=require('../assets/customer-reorder-review.js');

const html=fs.readFileSync('customer.html','utf8');
const handler=fs.readFileSync('assets/customer-completion.js','utf8');
const css=fs.readFileSync('assets/customer-reorder-review.css','utf8');
const sql=fs.readFileSync('supabase/migrations/20261119213000_customer_reorder_historical_price_review.sql','utf8');
const reorder=handler.slice(handler.indexOf('async function reorder(id)'),handler.indexOf('async function invoice('));

test('verified historical ₹460 order previews ₹260 current subtotal and skips unavailable food',()=>{
 const data=[
  {name:'Masala Dosa',quantity:2,previous_price:120,price:130,menu_item_id:'dosa',available:true},
  {name:'Paneer Tikka',quantity:1,previous_price:220,price:220,menu_item_id:'paneer',available:false}
 ];
 const result=Review.summary(data,{hasExistingCart:true});
 assert.equal(result.previousSubtotal,460);
 assert.equal(result.currentSubtotal,260);
 assert.equal(result.changedCount,1);
 assert.equal(result.missing.length,1);
 assert.equal(result.available.length,1);
 assert.equal(result.canContinue,true);
 assert.equal(result.hasExistingCart,true);
 assert.equal(result.rows[0].previousLine,240);
 assert.equal(result.rows[0].currentLine,260);
 assert.equal(result.rows[1].available,false);
});
test('unknown historical price is unknown, never silently invented',()=>{
 const r=Review.summary([{name:'Poha',quantity:1,price:55,menu_item_id:'poha',available:true}]);
 assert.equal(r.previousSubtotal,null);
 assert.equal(r.rows[0].previousUnit,null);
 assert.equal(r.rows[0].changed,false);
 assert.equal(r.currentSubtotal,55);
});
test('invalid current prices and missing menu IDs cannot become reorderable',()=>{
 const rows=[
  {name:'Invalid negative',quantity:1,previous_price:40,price:-5,menu_item_id:'x',available:true},
  {name:'No item',quantity:1,previous_price:20,price:25,menu_item_id:null,available:true},
  {name:'Null price',quantity:2,previous_price:20,price:null,menu_item_id:'z',available:true}
 ];
 const r=Review.summary(rows);
 assert.equal(r.canContinue,false);
 assert.equal(r.available.length,0);
 assert.equal(r.missing.length,3);
});
test('reorder preview is loaded before customer completion and confirmation precedes replacement',()=>{
 assert.match(html,/assets\/customer-reorder-review\.css\?v=20261119-reorder1/);
 const script='assets/customer-reorder-review.js?v=20261119-reorder1';
 assert.ok(html.includes(script));
 assert.ok(html.indexOf(script)<html.indexOf('assets/customer-completion.js'));
 assert.ok(reorder.indexOf('promptReview(data.items')>=0);
 assert.ok(reorder.indexOf('promptReview(data.items')<reorder.indexOf('openRestaurant(data.restaurant_id'));
 assert.match(reorder,/if\(!consent\)return/);
 assert.match(reorder,/cartSwitchConfirmed:true,requiredMenuIds/);
 assert.doesNotMatch(reorder,/clearCustomerCart\(\)/);
});
test('native review is customer-only, accessible, mobile responsive and cannot charge',()=>{
 for(const part of ['role','dialog','aria-labelledby','showModal','Keep existing cart',
  'Replace cart','Current available items subtotal','No payment is made by Reorder'])
  assert.ok(fs.readFileSync('assets/customer-reorder-review.js','utf8').includes(part));
 assert.match(css,/body\[data-bite-app="customer"\]/);
 assert.match(css,/@media\(max-width:360px\)/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.doesNotMatch(css,/Cashfree|payment_session|refun[d]|supabase|sb\.|fetch\(/i);
});
test('historical price RPC keeps customer ownership and existing authenticated scope',()=>{
 assert.match(sql,/create or replace function public\.bite_reorder_items\(p_order_id uuid\)/i);
 assert.match(sql,/where id=p_order_id and customer_id=auth\.uid\(\)/i);
 assert.match(sql,/'previous_price',i\.unit_price/);
 assert.match(sql,/'price',m\.price/);
 assert.match(sql,/'available',coalesce\(m\.is_available,false\)/);
 assert.match(sql,/revoke all on function public\.bite_reorder_items\(uuid\) from public,anon;/);
 assert.match(sql,/grant execute on function public\.bite_reorder_items\(uuid\) to authenticated;/);
 assert.doesNotMatch(sql,/update public\.|delete from public\.|cashfree|payment_|settlement/i);
});
