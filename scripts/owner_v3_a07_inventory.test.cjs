'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const api=require('../assets/owner-v3-inventory.js');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/owner-v3-inventory.css','utf8');
const stockSource=fs.readFileSync('assets/owner-v3-inventory.js','utf8');
const items=[
 {id:'rice',restaurant_id:'r1',is_active:true,name:'Rice',category:'Grains',unit:'kg',reorder_level:10},
 {id:'oil',restaurant_id:'r1',is_active:true,name:'Cooking oil',category:'Oils',unit:'litre',reorder_level:5},
 {id:'hidden',restaurant_id:'r1',is_active:false,name:'Old item',category:'Old',unit:'kg',reorder_level:2}
];
const balances={rice:25,oil:4,hidden:0};
test('A07 filters source-backed stock and counts low/zero without guessing diner or recipe usage',()=>{
 const all=api.stockView(items,balances);
 assert.equal(all.all,2);assert.equal(all.low,1);
 assert.equal(all.filtered.find(x=>x.id==='oil').stock,4);
 assert.deepEqual(api.stockView(items,balances,'rice').filtered.map(x=>x.id),['rice']);
 assert.deepEqual(api.stockView(items,balances,'OILS').filtered.map(x=>x.id),['oil']);
});
test('A07 mobile stock cards escape customer-owned item text and target existing stock selector',()=>{
 const host={innerHTML:'',onclick:null};
 const out=api.render(host,{items:[{...items[0],name:'Rice <script>alert(1)</script>'}],balances,query:'',onAdjust:()=>{}});
 assert.equal(out.all,1);assert.match(host.innerHTML,/&lt;script&gt;/);
 assert.doesNotMatch(host.innerHTML,/<script>/);
 assert.match(host.innerHTML,/data-biv3-adjust="rice"/);
});
test('A07 purchase is not an independent manual stock-in movement; adjustment requires reason',()=>{
 const base={type:'adjustment_out',quantity:1,cost:'',date:'2026-11-19',today:'2026-11-19',
  item:items[0],stock:25,reason:'Used for lunch',reference:'',movements:[]};
 assert.equal(api.reviewMovement(base).ok,true);
 for(const overrides of [{type:'purchase'},{reason:''},{reason:'a'}, {quantity:26},
  {quantity:0},{quantity:-1},{quantity:'NaN'}, {cost:-2},{date:'2026-11-20'},
  {date:'2026-02-30'},{item:null}]){
  assert.equal(api.reviewMovement({...base,...overrides}).ok,false,JSON.stringify(overrides));
 }
 assert.equal(api.reviewMovement({...base,type:'opening',reason:''}).ok,true);
});
test('A07 identical saved movements do not silently double post when history is visible',()=>{
 const row={inventory_item_id:'rice',movement_type:'adjustment_out',movement_date:'2026-11-19',
  quantity:1,notes:'Used for lunch',reference:''};
 assert.equal(api.reviewMovement({type:'adjustment_out',quantity:1,date:'2026-11-19',today:'2026-11-19',
  item:items[0],stock:25,reason:'Used for lunch',movements:[row]}).ok,false);
});
test('A07 stays within existing inventory, purchases, supplier payments and same role permissions',()=>{
 for(const term of ['id="inventoryV3Cards"','id="inventoryV3Search"','id="inventoryStockTable"',
  'BiteV3Inventory?.render?.','BiteV3Inventory?.reviewMovement?.','inventoryLoadSeq','loadInventory()',
  'restaurant_inventory_items','restaurant_inventory_balances','restaurant_stock_movements',
  "navigate('purchases')","sb.rpc('save_restaurant_purchase'"])
  assert.ok(html.includes(term),term);
 assert.doesNotMatch(html,/<option value="purchase">Purchase \/ Stock In<\/option>/);
 assert.match(html,/const rid=inventoryRestaurantId\(\),userId=currentUser\?\.id,seq=\+\+inventoryLoadSeq/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.doesNotMatch(stockSource,/\.from\(|\.rpc\(|\.insert\(|\.update\(/);
});

test('A07 missing stock is unverified and outward quantities are exact to three decimals',()=>{
 const snapshot=api.stockView(items,{rice:null,oil:'invalid'});
 assert.equal(snapshot.unknown,2);assert.equal(snapshot.low,0);assert.equal(snapshot.filtered[0].stock,null);
 const base={type:'adjustment_out',quantity:1,stock:25,item:items[0],date:'2026-11-19',today:'2026-11-19',reason:'Used stock'};
 for(const variant of [{stock:null},{stock:'bad'},{quantity:1.0001},{quantity:true},{cost:1.001}])assert.equal(api.reviewMovement({...base,...variant}).ok,false);
 const host={innerHTML:''};api.render(host,{items:[items[0]],balances:{}});
 assert.match(host.innerHTML,/Stock unverified/);assert.match(host.innerHTML,/disabled/);
});

test('A07 verifies exact snapshot count, tenant ownership, unique ids and balance coverage',()=>{
 const list=items.filter(x=>x.is_active),b=list.map(x=>({restaurant_id:'r1',inventory_item_id:x.id,current_stock:balances[x.id]}));
 const snapshot=(data)=>({data,count:data.length});
 assert.equal(api.verifySnapshot(snapshot(list),snapshot(b),'r1'),true);
 assert.equal(api.verifySnapshot({data:list,count:3},snapshot(b),'r1'),false);
 assert.equal(api.verifySnapshot(snapshot(list),snapshot(b.slice(0,1)),'r1'),false);
 assert.equal(api.verifySnapshot(snapshot(list),snapshot([...b,b[0]]),'r1'),false);
 assert.equal(api.verifySnapshot(snapshot(list),snapshot([{...b[0],restaurant_id:'other'},b[1]]),'r1'),false);
 assert.equal(api.verifySnapshot(snapshot(list),snapshot([{...b[0],current_stock:null},b[1]]),'r1'),false);
 assert.equal(api.verifySnapshot(snapshot([...list,list[0]]),snapshot(b),'r1'),false);
 assert.equal(api.verifySnapshot(snapshot([]),snapshot([]),'r1'),true);
});
