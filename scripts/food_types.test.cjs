'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const food=require('../assets/bite-food-types.js'),discovery=require('../assets/customer-discovery.js'),search=require('../assets/customer-menu-search.js'),sheet=require('../assets/customer-filter-sheet.js');
const veg={id:'v',is_vegetarian:true,dietary_type:'veg',category_id:'c',name:'Dosa',price:120};
const egg={id:'e',is_vegetarian:false,dietary_type:'egg',category_id:'c',name:'Special',price:150};
const meat={id:'m',is_vegetarian:false,dietary_type:'nonveg',category_id:'c',name:'Curry',price:200};
const pure={cuisine_tags:['Pure Vegetarian (शुद्ध शाकाहारी) • North Indian']};
test('explicit Egg, Veg and Non-veg remain distinct without changing prices',()=>{
 const rows=[veg,egg,meat],before=JSON.stringify(rows);
 assert.deepEqual(rows.map(food.typeOf),['veg','egg','nonveg']);
 assert.equal(food.label(egg),'Egg');assert.equal(JSON.stringify(rows),before);
});
test('legacy booleans remain compatible but names/photos never invent Egg or restaurant type',()=>{
 assert.equal(food.typeOf({is_vegetarian:true,name:'Egg photo test'}),'veg');
 assert.equal(food.typeOf({is_vegetarian:false,name:'Egg curry',image_url:'egg.jpg'}),'nonveg');
 assert.equal(food.pureVegMenu({name:'Pure Veg Restaurant'},[veg]),false);
});
test('missing, invalid or contradictory metadata is unknown, not a dietary guarantee',()=>{
 for(const row of [null,{}, {is_vegetarian:'true'}, {...egg,is_vegetarian:true},
  {...veg,is_vegetarian:false},{...veg,dietary_type:'vegan'}]){
  assert.equal(food.typeOf(row),'unknown');assert.equal(food.matches(row,'veg'),false);
 }
 assert.equal(food.label({}),'Dietary details not provided');
});
test('Pure Veg requires an explicit whole-restaurant declaration and a consistent menu',()=>{
 assert.equal(food.pureVegMenu(pure,[veg]),true);
 assert.equal(food.pureVegMenu({cuisine_tags:['North Indian']},[veg]),false);
 for(const rows of [[],[egg],[meat],[{}],[veg,egg],[veg,{}],Array(1000).fill(veg)])
  assert.equal(food.pureVegMenu(pure,rows),false);
});
test('negated, partial, descriptive and conflicting restaurant tags do not assert Pure Veg',()=>{
 for(const tags of [['Not Pure Veg'],['Pure Veg options'],['Mixed menu'],['Pure Veg','Non-veg'],
  ['Pure Veg','Egg'],['North Indian, not pure veg']])assert.equal(food.declaredPureVeg({cuisine_tags:tags}),false);
 for(const tag of ['Pure Veg','100% Pure Vegetarian','शुद्ध शाकाहारी',pure.cuisine_tags[0]])
  assert.equal(food.declaredPureVeg({cuisine_tags:[tag]}),true);
});
test('Egg and Non-veg discovery cannot substitute for each other or ignore delivery serviceability',()=>{
 const base={accepts_delivery:true,serviceable:true,opening_time:null,closing_time:null};
 const rows=[{...base,id:'pure',has_veg:true,has_pure_veg:true},{...base,id:'egg',has_egg:true},
  {...base,id:'meat',has_nonveg:true},{...base,id:'unverified',has_veg:true},
  {...base,id:'outside',has_egg:true,serviceable:false}];
 const ids=diet=>discovery.selectRestaurants(rows,[],{diet,pin:'313324'}).map(x=>x.restaurant.id);
 assert.deepEqual(ids('pureveg'),['pure']);assert.deepEqual(ids('egg'),['egg']);assert.deepEqual(ids('nonveg'),['meat']);
 assert.equal(sheet.normalized({diet:'egg'}).diet,'egg');assert.equal(sheet.normalized({diet:'pureveg'}).diet,'pureveg');
});
test('dish Egg/Non-veg/Veg filters combine with category/search and preserve quantities/prices',()=>{
 const rows=[veg,egg,meat],before=JSON.stringify(rows);
 for(const engine of [discovery,search]){
  assert.deepEqual(engine.selectMenu(rows,{diet:'egg'}).map(i=>i.id),['e']);
  assert.deepEqual(engine.selectMenu(rows,{diet:'nonveg'}).map(i=>i.id),['m']);
  assert.deepEqual(engine.selectMenu(rows,{vegOnly:true,diet:'egg'}).map(i=>i.id),['v']);
  assert.deepEqual(engine.selectMenu(rows,{diet:'egg',query:'Special',category:'other'}),[]);
 }
 assert.equal(JSON.stringify(rows),before);
});
test('client entrypoints all load the same versioned food classifier before using it',()=>{
 for(const path of ['customer.html','index.html','menu-qr.html']){
  const s=fs.readFileSync(path,'utf8');assert.match(s,/bite-food-types\.js\?v=20261125-diet1/);
  assert.match(s,/bite-food-types\.css\?v=20261125-diet1/);
 }
 const sql=fs.readFileSync('supabase/menu_dietary_classification.sql','utf8').replace(/--[^\n]*/g,'');
 assert.match(sql,/add column if not exists dietary_type text/);
 assert.match(sql,/dietary_type is null/);
 assert.doesNotMatch(sql,/\b(update|insert|delete|grant|drop)\b|create policy/i);
});
test('optional-column rollout fallback preserves all query predicates and never retries denied or unrelated errors',async()=>{
 const columns='id,is_vegetarian,dietary_type',calls=[];
 const r=await food.readMenu(async selected=>{calls.push(selected);return calls.length===1?
  {data:null,error:{code:'42703',message:'column menu_items.dietary_type does not exist'}}:{data:[veg],error:null};},columns);
 assert.deepEqual(calls,[columns,'id,is_vegetarian']);assert.deepEqual(r.data,[veg]);
 for(const error of [{code:'42501',message:'denied dietary_type'},{code:'42703',message:'different column missing'},
  {code:'503',message:'dietary_type network unavailable'}]){
  let count=0;const result=await food.readMenu(async()=>{count++;return{error};},columns);
  assert.equal(count,1);assert.equal(result.error,error);
 }
});

async function saveOwner({type='egg',rid='r-1',activeRid=rid,formRid=rid,allowed=true,id='dish',response=[{id:'dish'}]}={}){
 const html=fs.readFileSync('index.html','utf8'),start=html.indexOf("document.getElementById('menuItemForm').addEventListener('submit',"),end=html.indexOf('\n',start);
 assert.ok(start>=0&&end>start);let handler,payload;const calls=[];
 const nodes={menuItemForm:{addEventListener(_event,fn){handler=fn;}},menuItemSaveBtn:{disabled:false},menuItemError:{textContent:''}};
 const q={eq(k,v){calls.push([k,v]);return q;},async select(){return{data:response,error:null};}};
 const values={id,name:'Special',price:'150',category_id:'cat',description:'Owner supplied',image_url:'',is_vegetarian:type,is_kids_choice:'false',is_available:'true'};
 const ctx={document:{getElementById:key=>nodes[key]},FormData:class{get(k){return values[k];}},
  currentUser:{id:'owner'},menuRestaurantId:()=>rid,activeMenuRestaurant:activeRid,menuEditScope:()=>allowed,
  sb:{from(table){assert.equal(table,'menu_items');return{update(p){payload=p;return q;},insert(p){payload=p;return q;}};}},
  closeModal:()=>calls.push(['close']),fetchMenuData:async()=>calls.push(['refresh'])};
 vm.runInNewContext(html.slice(start,end),ctx);
 await handler({preventDefault(){},target:{dataset:{menuRestaurant:formRid,menuUser:'owner'}}});
 return {payload,calls,error:nodes.menuItemError.textContent};
}
test('actual Owner save handler persists Egg with legacy false and scoped item/restaurant filters',async()=>{
 const r=await saveOwner();assert.equal(r.payload.dietary_type,'egg');assert.equal(r.payload.is_vegetarian,false);
 assert.equal(r.payload.price,150);assert.deepEqual(r.calls.slice(0,2),[['id','dish'],['restaurant_id','r-1']]);
 assert.ok(r.calls.some(c=>c[0]==='refresh'));
});
test('Owner save maps Veg/Non-veg consistently and fails closed on invalid type/scope or zero affected rows',async()=>{
 for(const [type,expected]of [['true','veg'],['false','nonveg']]){
  const r=await saveOwner({type});assert.equal(r.payload.dietary_type,expected);assert.equal(r.payload.is_vegetarian,type==='true');
 }
 for(const options of [{type:'bogus'},{allowed:false},{activeRid:'r-2'},{formRid:'r-2'}])assert.equal((await saveOwner(options)).payload,undefined);
 const r=await saveOwner({response:[]});assert.match(r.error,/Save not confirmed/);assert.ok(!r.calls.some(c=>c[0]==='close'));
});

test('Channel reads accept a legacy database only when the requested column is absent',async()=>{
 const {readChannel}=require('../assets/bite-food-types.js');
 const cases=[
  [{code:'42703',message:'column menu_items.available_online does not exist'},[true,false]],
  [{code:'42703',message:'column menu_items.available_qr does not exist'},[true]],
  [{code:'PGRST204',message:'available_online missing in the schema cache'},[true]],
  [{code:'42501',message:'available_online permission denied'},[true]],
 ];
 for(const [error,expected] of cases){
  const calls=[];
  await readChannel('available_online',filtered=>{calls.push(filtered);return filtered?{error}:{data:[]};});
  assert.deepEqual(calls,expected);
 }
});
