'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Cart=require('../assets/customer-option-cart.js');
const foundation=fs.readFileSync('supabase/migrations/20261113135056_bite_priced_options_foundation_guarded.sql','utf8');
const quote=fs.readFileSync('supabase/migrations/20261113135449_bite_priced_options_read_only_quote.sql','utf8');
const anonGuard=fs.readFileSync('supabase/migrations/20261113135618_bite_quote_anon_role_guard.sql','utf8');
const customer=fs.readFileSync('customer.html','utf8');
const menu='b0a5892d-839a-4261-8dad-a31ba8f31300';
const one='00000000-0000-4000-8000-000000000001';
const two='00000000-0000-4000-8000-000000000002';

test('option choice IDs are sorted for a stable canonical cart key',()=>{
 assert.equal(Cart.lineKey(menu,[two,one]),Cart.lineKey(menu,[one,two]));
 assert.notEqual(Cart.lineKey(menu,[one]),Cart.lineKey(menu,[two]));
 assert.notEqual(Cart.lineKey(menu,[one],'Less spicy'),Cart.lineKey(menu,[one],'No onion'));
 assert.notEqual(Cart.lineKey(menu,[one]),Cart.lineKey(menu,[one],'No onion'));
});

test('same item+size+note merges; different size or cooking note stays separate',()=>{
 const input=[
 {menu_item_id:menu,option_choice_ids:[two,one],quantity:1,note:'No onion'},
 {menu_item_id:menu,option_choice_ids:[one,two],quantity:2,note:'No onion'},
 {menu_item_id:menu,option_choice_ids:[two],quantity:1,note:'No onion'},
 {menu_item_id:menu,option_choice_ids:[one,two],quantity:1,note:'Extra spicy'}
 ];
 const lines=Cart.mergeLines(input);
 assert.equal(lines.length,3);
 assert.equal(lines.find(x=>x.note==='No onion'&&x.option_choice_ids.length===2).quantity,3);
});

test('existing v1 carts can migrate without losing quantities, notes or restaurant identity',()=>{
 const migrated=Cart.migrate({restaurantId:menu,items:{[one]:2,[two]:1},
   itemNotes:{[one]:'No onion'},generalNote:'Call at gate'});
 assert.equal(migrated.cart_schema_version,2);
 assert.equal(migrated.restaurantId,menu);
 assert.equal(migrated.generalNote,'Call at gate');
 assert.equal(migrated.lines.length,2);
 assert.equal(migrated.lines.find(x=>x.menu_item_id===one).note,'No onion');
 assert.equal(migrated.lines.find(x=>x.menu_item_id===one).quantity,2);
 assert.deepEqual(migrated.lines.find(x=>x.menu_item_id===two).option_choice_ids,[]);
});

test('v2 cart roundtrip retains distinct variants',()=>{
 const lines=Cart.mergeLines([{menu_item_id:menu,option_choice_ids:[one],quantity:1,note:'Less spicy'},
 {menu_item_id:menu,option_choice_ids:[two],quantity:1,note:'Extra spicy'}]);
 const saved={restaurantId:menu,cart_schema_version:2,lines,generalNote:'Doorbell'};
 assert.deepEqual(Cart.migrate(JSON.parse(JSON.stringify(saved))),saved);
});

test('untrusted price, duplicate choices and out-of-range quantities never enter a cart line',()=>{
 assert.throws(()=>Cart.normalizeLine({menu_item_id:menu,quantity:1,unit_price:1}),/prices are not allowed/);
 assert.throws(()=>Cart.normalizeLine({menu_item_id:menu,quantity:1,option_choice_ids:[one,one]}),/Duplicate option/);
 assert.throws(()=>Cart.normalizeLine({menu_item_id:menu,quantity:0}),/Quantity/);
 assert.throws(()=>Cart.mergeLines([{menu_item_id:menu,quantity:70},{menu_item_id:menu,quantity:30}]),/Quantity/);
 assert.throws(()=>Cart.normalizeLine({menu_item_id:menu,quantity:1,note:'a'.repeat(101)}),/100 characters/);
});

test('live database migration enforces restaurant ownership through composite foreign keys',()=>{
 assert.match(foundation,/menu_items_restaurant_id_id_unique unique \(restaurant_id,id\)/);
 assert.match(foundation,/menu_option_choices_group_tenant_fk foreign key \(restaurant_id,option_group_id\)/);
 assert.match(foundation,/menu_item_option_groups_item_tenant_fk foreign key \(restaurant_id,menu_item_id\)/);
 assert.match(foundation,/menu_item_option_groups_group_tenant_fk foreign key \(restaurant_id,option_group_id\)/);
 assert.match(foundation,/constraint menu_option_group_limits check \(min_select <= max_select\)/);
});

test('new exposed tables have RLS, explicit grants and tenant-scoped write checks',()=>{
 for(const table of ['menu_option_groups','menu_option_choices','menu_item_option_groups']){
  assert.match(foundation,new RegExp('alter table public\\.'+table+' enable row level security'));
 }
 assert.match(foundation,/revoke all on public\.menu_option_groups/);
 assert.match(foundation,/to anon, authenticated/);
 assert.match(foundation,/public\.has_restaurant_role\(restaurant_id,array\['owner','manager'\]\)/);
 assert.match(foundation,/public\.is_restaurant_public\(restaurant_id\)/);
});

test('quote is read-only, invoker-scoped and explicitly cannot authorise payment',()=>{
 assert.match(quote,/stable security invoker set search_path = ''/);
 assert.match(quote,/'quote_only',true,'authorizes_payment',false/);
 assert.match(quote,/Duplicate option choices are not allowed/);
 assert.match(quote,/Selection limit not met for option group/);
 assert.match(quote,/prices must be calculated by the server/);
 assert.doesNotMatch(quote,/insert into public\.orders|cashfree|payment_session_id/i);
 assert.match(anonGuard,/if not public\.is_restaurant_public\(p_restaurant_id\) then/);
 assert.match(anonGuard,/if auth\.uid\(\) is null then/);
});

test('existing v1 checkout contract stays unchanged and paid options are not advertised',()=>{
 assert.match(customer,/const items=entries\.map\(\(\[id,quantity\]\)=>\(\{menu_item_id:id,quantity\}\)\)/);
 assert.match(customer,/bite_prepare_checkout_v2/);
 assert.doesNotMatch(customer,/src="assets\/customer-option-cart\.js/);
});

test('customer can see that the estimated total is verified before money is collected',()=>{
 const css=fs.readFileSync('assets/customer-transactions.css','utf8');
 assert.match(customer,/Final payable amount is verified securely before payment/);
 assert.match(customer,/customer-transactions\.css\?v=20261113-priced-foundation1/);
 assert.match(css,/\.checkout-secure-price-note\{/);
});

test('cart re-render retains an expanded dish-request editor during live hours refresh',()=>{
 assert.match(customer,/const expandedNotes=new Set/);
 assert.match(customer,/editorExpanded=expandedNotes\.has\(id\)/);
 assert.match(customer,/aria-expanded="'\+String\(editorExpanded\)/);
 assert.match(customer,/editor\.focus\(\{preventScroll:true\}\)/);
 assert.match(customer,/editor\.setSelectionRange\(previousSelection\.start,previousSelection\.end\)/);
});
