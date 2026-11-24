'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const start=html.indexOf("$('emptyCartBtn').addEventListener('click',()=>{");
assert.ok(start>0);
const handler=html.slice(start,html.indexOf('\n});',start)+4);
function setup({approved=false,empty=false}={}){
 const nodes=new Map(),calls={confirm:0,hide:0,clear:0,render:0,timers:0};let click;
 const $=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='cartOrderNote'?'Keep this instruction':'',textContent:'',classList:{remove(){}},focus(){},addEventListener(type,fn){click=fn;}});return nodes.get(id);};
 const context=vm.createContext({$,confirm(message){calls.confirm++;assert.match(message,/cart/i);return approved;},setTimeout(){calls.timers++;return 1;},
  cartEntries(){return Object.entries(vm.runInContext('cart',context));},
  hideCartUndo(){calls.hide++;},
  clearCustomerCart(){calls.clear++;vm.runInContext('cart={};itemNotes={}',context);$('cartOrderNote').value='';},
  renderCart(){calls.render++;}
 });
 vm.runInContext(`let cart=${empty?'{}':'{dish:2}'};let itemNotes={dish:'Less spicy'};let activeRestaurant={id:'restaurant-A'};let biteCartUndoSnapshot={previous:true};let biteCartUndoTimer=null;const pendingLiveCheckout={id:'immutable-existing-attempt',amount:240};`,context);
 vm.runInContext(handler,context);
 return {click,calls,$,state:()=>JSON.parse(vm.runInContext('JSON.stringify({cart,itemNotes,biteCartUndoSnapshot,pendingLiveCheckout})',context))};
}
test('Clear cart cancellation keeps items, notes, existing undo and payment context exactly intact',()=>{
 const f=setup(),before=f.state();f.click();
 assert.deepEqual(f.state(),before);assert.equal(f.$('cartOrderNote').value,'Keep this instruction');
 assert.deepEqual(f.calls,{confirm:1,hide:0,clear:0,render:0,timers:0});
});
test('explicit confirmation clears once and preserves the full undo snapshot',()=>{
 const f=setup({approved:true});f.click();const state=f.state();
 assert.deepEqual(state.cart,{});assert.equal(state.biteCartUndoSnapshot.restaurantId,'restaurant-A');
 assert.deepEqual(state.biteCartUndoSnapshot.items,{dish:2});assert.deepEqual(state.biteCartUndoSnapshot.itemNotes,{dish:'Less spicy'});
 assert.equal(state.biteCartUndoSnapshot.note,'Keep this instruction');
 assert.deepEqual(state.pendingLiveCheckout,{id:'immutable-existing-attempt',amount:240});
 f.click();assert.equal(f.calls.confirm,1);assert.equal(f.calls.clear,1);assert.equal(f.calls.render,1);
});
test('empty cart cannot open a destructive prompt or mutate existing history',()=>{
 const f=setup({empty:true,approved:true}),before=f.state();f.click();assert.deepEqual(f.state(),before);
 assert.deepEqual(f.calls,{confirm:0,hide:0,clear:0,render:0,timers:0});
});
