'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

const html=fs.readFileSync('customer.html','utf8');
const completion=fs.readFileSync('assets/customer-completion.js','utf8');
const start=html.indexOf('async function openRestaurant(');
const end=html.indexOf('\nfunction renderRestaurantReviews(',start);
assert.ok(start>=0&&end>start,'real restaurant-opening source must be present');
const source=html.slice(start,end);

function setup({menuError=false,confirmSwitch=true,matchingMenu=true}={}){
 const previousRestaurant={id:'restaurant-old',name:'Old Restaurant',cuisine_tags:['Indian'],city:'Jaipur',accepts_delivery:true};
 const nextRestaurant={id:'restaurant-next',name:'Next Restaurant',cuisine_tags:['Indian'],city:'Jaipur',accepts_delivery:true};
 const oldItems=[{id:'old-dish',price:100,name:'Old meal'}];
 const newItems=[{id:'new-dish',price:140,name:'New meal'}];
 const fields={};
 const field=id=>fields[id]??=( {value:'',checked:false,textContent:'',innerHTML:'',style:{removeProperty(){}},
   classList:{add(){},remove(){},toggle(){},contains(){return false}}});
 field('customerNote').value='no onions';
 field('cartOrderNote').value='no onions';
 field('checkoutCutlery').checked=true;
 const calls={requests:0,renderCart:0,confirm:0,view:null,homeSync:0};
 const persistent={items:{'old-dish':2},notes:{'old-dish':'less spicy'}};
 const ctx={
  BITE_DIRECT_MODE:false,BITE_DIRECT_RESTAURANT_ID:null,
  activeRestaurant:previousRestaurant,restaurants:[previousRestaurant,nextRestaurant],
  menuItems:oldItems,cart:{...persistent.items},itemNotes:{...persistent.notes},
  appliedCheckoutCoupon:{code:'PREVIOUS'},checkoutRequestKey:'previous-key',
  biteCheckoutOpenSequence:0,biteRestaurantOpenSequence:0,
  publicMenuSearch:[],SUPABASE_URL:'https://example.test',
  cartEntries(){return Object.entries(ctx.cart).filter(([,q])=>q>0);},
  confirm(){calls.confirm++;return confirmSwitch;},
  readSavedCustomerCart(){return {restaurantId:previousRestaurant.id,items:{...persistent.items},itemNotes:{...persistent.notes}};},
  BiteItemNotes:{normalizeNotes:(notes)=>({...notes})},
  BiteDiscovery:{isClosed:()=>false},
  BiteRestaurantCovers:{choose:()=>({})},
  setCustomerCoverImage(){},refreshCustomerCoverPhotos(){},
  renderMenu(){},renderMenuItems(){},renderRestaurantReviews(){},
  renderCart(){calls.renderCart++;persistent.items={...ctx.cart};},
  showCustomerView(view){calls.view=view;},
  $:field,console:{error(){},warn(){}},
  window:{scrollTo(){},BiteMenuPersonalization:{reset(){}},
   BiteRestaurantDetails:{render(){}},BiteCustomerExtras:{renderFavouriteButton(){}},
   BiteHomeCart:{sync(){calls.homeSync++;}}},
  sb:{from(table){
   calls.requests++;
   const answer=table==='menu_categories'?{data:[],error:null}:
    table==='menu_items'?{data:matchingMenu?newItems:[],error:menuError?new Error('Network down'):null}:
    {data:[],error:null};
   const chain={select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},
    then(resolve,reject){return Promise.resolve(answer).then(resolve,reject);}};
   return chain;
  }}
 };
 vm.createContext(ctx);
 vm.runInContext(source+'\nglobalThis.openRestaurantTest=openRestaurant;',ctx);
 return {ctx,calls,persistent,oldItems,previousRestaurant,nextRestaurant,field};
}

test('refusing a restaurant switch preserves the existing cart without a network request',async()=>{
 const x=setup({confirmSwitch:false});
 assert.equal(await x.ctx.openRestaurantTest('restaurant-next'),false);
 assert.equal(x.calls.confirm,1);
 assert.equal(x.calls.requests,0);
 assert.deepEqual({...x.ctx.cart},{'old-dish':2});
 assert.equal(x.ctx.activeRestaurant.id,'restaurant-old');
});

test('failed menu request restores old restaurant, quantity, notes and draft without persisting an empty cart',async()=>{
 const x=setup({menuError:true});
 assert.equal(await x.ctx.openRestaurantTest('restaurant-next'),false);
 assert.equal(x.ctx.activeRestaurant.id,'restaurant-old');
 assert.deepEqual({...x.ctx.cart},{'old-dish':2});
 assert.deepEqual({...x.ctx.itemNotes},{'old-dish':'less spicy'});
 assert.equal(x.field('customerNote').value,'no onions');
 assert.equal(x.field('checkoutCutlery').checked,true);
 assert.equal(x.ctx.checkoutRequestKey,'previous-key');
 assert.equal(x.ctx.appliedCheckoutCoupon.code,'PREVIOUS');
 assert.deepEqual(x.persistent.items,{'old-dish':2});
 assert.equal(x.calls.renderCart,0,'failure must not write a cleared cart to storage');
 assert.equal(x.calls.view,'home');
});

test('confirmed switch commits replacement only after published menu succeeds',async()=>{
 const x=setup();
 assert.equal(await x.ctx.openRestaurantTest('restaurant-next'),true);
 assert.equal(x.ctx.activeRestaurant.id,'restaurant-next');
 assert.deepEqual({...x.ctx.cart},{});
 assert.equal(x.calls.renderCart,1);
 assert.deepEqual(x.persistent.items,{});
});

test('reorder preflight mismatch cannot wipe an existing cart',async()=>{
 const x=setup();
 assert.equal(await x.ctx.openRestaurantTest('restaurant-next',{
  cartSwitchConfirmed:true,requiredMenuIds:['unavailable-dish']
 }),false);
 assert.equal(x.calls.confirm,0,'reorder already obtained an explicit replacement confirmation');
 assert.equal(x.ctx.activeRestaurant.id,'restaurant-old');
 assert.deepEqual({...x.ctx.cart},{'old-dish':2});
 assert.deepEqual(x.persistent.items,{'old-dish':2});
 assert.equal(x.calls.renderCart,0);
});

test('reorder never clears the original cart before awaiting the restaurant menu',()=>{
 assert.doesNotMatch(completion,/clearCustomerCart\(\);await openRestaurant\(data\.restaurant_id\)/);
 assert.match(completion,/await openRestaurant\(data\.restaurant_id,\{cartSwitchConfirmed:true,requiredMenuIds:/);
 assert.match(completion,/if\(!opened\|\|activeRestaurant\?\.id!==data\.restaurant_id\)/);
});
