'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const start=html.indexOf("$('undoClearCartBtn').addEventListener('click',()=>{");
const handler=html.slice(start,html.indexOf('\n});',start)+4);
function setup({otherRestaurant=false,currentItems=false}={}){
 let click;const nodes=new Map(),menus=[],renders=[];
 const context=vm.createContext({
  $(id){if(!nodes.has(id))nodes.set(id,{value:'',focus(){},addEventListener(type,fn){click=fn;}});return nodes.get(id);},
  hideCartUndo(){vm.runInContext('biteCartUndoSnapshot=null',context);},
  cartEntries(){return Object.entries(vm.runInContext('cart',context));},
  renderCart(){renders.push(JSON.parse(vm.runInContext('JSON.stringify(cart)',context)));},
  renderMenuItems(){menus.push(JSON.parse(vm.runInContext('JSON.stringify(cart)',context)));},
  BiteItemNotes:{normalizeNotes:(notes,ids)=>Object.fromEntries(Object.entries(notes).filter(([id])=>ids.includes(id)))}
 });
 vm.runInContext(`let activeRestaurant={id:'A'},menuItems=[{id:'dish'},{id:'extra'}],cart=${currentItems?'{newDish:1}':'{}'},itemNotes={};let biteCartUndoSnapshot={restaurantId:'${otherRestaurant?'B':'A'}',items:{dish:2,extra:1},itemNotes:{dish:'Less spicy'},note:'No cutlery'};`,context);
 vm.runInContext(handler,context);
 return {click,menus,renders,nodes,state:()=>JSON.parse(vm.runInContext('JSON.stringify({cart,itemNotes})',context))};
}
test('full-cart Undo refreshes visible menu quantities from the restored cart',()=>{
 const f=setup();f.click();
 assert.deepEqual(f.state(),{cart:{dish:2,extra:1},itemNotes:{dish:'Less spicy'}});
 assert.deepEqual(f.menus,[{dish:2,extra:1}]);assert.deepEqual(f.renders,[{dish:2,extra:1}]);
 assert.equal(f.nodes.get('cartOrderNote').value,'No cutlery');
});
test('Undo from a different restaurant cannot change the current cart or menu',()=>{
 const f=setup({otherRestaurant:true});f.click();assert.deepEqual(f.state(),{cart:{},itemNotes:{}});assert.deepEqual(f.menus,[]);
});
test('an already edited cart is not overwritten or repainted by a stale full-cart Undo',()=>{
 const f=setup({currentItems:true});f.click();assert.deepEqual(f.state(),{cart:{newDish:1},itemNotes:{}});assert.deepEqual(f.menus,[]);
});
