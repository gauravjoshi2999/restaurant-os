const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const script=fs.readFileSync('assets/customer-home-cart.js','utf8');
const html=fs.readFileSync('customer.html','utf8');
function harness(){
 const ids=['cartFloating','floatingCartRemovePanel','floatingCartRestaurant','floatingCartCount',
  'floatingCartTotal','floatingCartRemove','floatingCartConfirmRemove','floatingCartKeep',
  'floatingCartRemovedStatus','customerNote','cartOrderNote','checkoutCutlery'];
 const elements={};
 for(const id of ids){
  const classes=new Set();
  elements[id]={hidden:id==='floatingCartRemovePanel',textContent:'',value:'',checked:false,
   handlers:{},classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},
    contains(name){return classes.has(name)}},
   addEventListener(name,handler){this.handlers[name]=handler;},focus(){}};
 }
 let saved=null,clearCount=0;
 const rows=[{id:'dish-1',name:'Poha',price:50},{id:'dish-2',name:'Tea',price:20}];
 const ctx={
  document:{body:{dataset:{view:'home'}},getElementById:id=>elements[id]},
  window:{},restaurants:[{id:'restaurant-1',name:'Hotel Maharani Palace'}],
  activeRestaurant:{id:'restaurant-1',name:'Hotel Maharani Palace'},menuItems:rows,
  cart:{'dish-1':2,'dish-2':1},itemNotes:{},
  BiteItemNotes:{normalizeNotes:()=>({})},BITE_DIRECT_MODE:false,
  biteRestaurantOpenSequence:0,console,
  money:n=>'₹'+n,
  cartEntries(){return Object.entries(ctx.cart).filter(([,q])=>q>0);},
  readSavedCustomerCart(){return saved;},
  clearCustomerCart(){ctx.cart={};saved=null;clearCount++;},
  renderCart(){ctx.window.BiteHomeCart.sync();},
  sb:{from:()=>({select(){return this},eq(){return this},order(){
   return Promise.resolve({data:rows,error:null});
  }})}
 };
 vm.runInNewContext(script,ctx);
 return {ctx,elements,rows,setSaved:value=>{saved=value},clearCount:()=>clearCount};
}

test('home and menu show a single current-cart dock; other views hide it',()=>{
 const {ctx,elements}=harness();
 assert.equal(elements.cartFloating.classList.contains('show'),true);
 assert.equal(elements.floatingCartRestaurant.textContent,'Hotel Maharani Palace');
 assert.equal(elements.floatingCartCount.textContent,'3 items');
 assert.equal(elements.floatingCartTotal.textContent,'₹120');
 ctx.document.body.dataset.view='menu';ctx.window.BiteHomeCart.sync();
 assert.equal(elements.cartFloating.classList.contains('show'),true);
 ctx.document.body.dataset.view='orders';ctx.window.BiteHomeCart.sync();
 assert.equal(elements.cartFloating.classList.contains('show'),false);
});

test('X asks for confirmation; Keep does not clear; Remove clears only unplaced cart',()=>{
 const {ctx,elements,clearCount}=harness();
 elements.floatingCartRemove.handlers.click();
 assert.equal(elements.floatingCartRemovePanel.hidden,false);
 elements.floatingCartKeep.handlers.click();
 assert.equal(elements.floatingCartRemovePanel.hidden,true);
 assert.equal(clearCount(),0);
 elements.floatingCartRemove.handlers.click();
 elements.floatingCartConfirmRemove.handlers.click();
 assert.equal(clearCount(),1);
 assert.equal(elements.cartFloating.classList.contains('show'),false);
 assert.equal(elements.floatingCartRemovedStatus.textContent.includes('Cart removed'),true);
});

test('restores saved dish quantities from published menu without making a payment request',async()=>{
 const {ctx,elements,setSaved}=harness();
 ctx.activeRestaurant=null;ctx.menuItems=[];ctx.cart={};
 setSaved({restaurantId:'restaurant-1',items:{'dish-1':2,'unavailable':5},
  itemNotes:{},generalNote:'less spicy',cutleryRequested:true});
 await ctx.window.BiteHomeCart.restore();
 assert.equal(ctx.activeRestaurant.id,'restaurant-1');
 assert.equal(ctx.cart['dish-1'],2);
 assert.equal(ctx.cart.unavailable,undefined);
 assert.equal(elements.floatingCartCount.textContent,'2 items');
 assert.equal(elements.customerNote.value,'less spicy');
 assert.equal(elements.checkoutCutlery.checked,true);
});

test('customer integration preserves existing checkout and has explicit line-level Remove',()=>{
 assert.match(html,/window\.BiteHomeCart\?\.restore\?\.\(\)/);
 assert.match(html,/window\.BiteHomeCart\?\.sync\?\.\(\)/);
 assert.match(html,/data-cart-remove=/);
 assert.match(html,/removedQuantity/);
 assert.match(html,/floatingCartConfirmRemove/);
 assert.match(html,/customer-home-cart\.css/);
 assert.match(html,/customer-home-cart\.js/);
 assert.match(html,/function openCheckout\(/);
});
