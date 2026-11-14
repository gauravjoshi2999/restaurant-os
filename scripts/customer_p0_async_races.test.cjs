'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
function extract(start,end){
 const a=html.indexOf(start);
 const b=html.indexOf(end,a+start.length);
 assert.ok(a!==-1&&b>a,'Source section missing: '+start);
 return html.slice(a,b);
}
const signature=extract('function biteCheckoutCartSignature(', 'function syncCheckoutPaymentButton(');
const checkoutGuard=extract('function biteCheckoutOpenMatches(', 'async function openCheckout()');
const checkout=extract('async function openCheckout(){', "$('savedAddress').addEventListener");
const orderGuard=extract('function biteCurrentOrderRequest(', 'function showCustomerView(');
const orders=extract('async function loadMyOrders(){', 'async function loadOrderDetail(');
const setSession=extract('function setCustomerSession(session){', 'async function submitCustomerAuth(');
const ctxOf=values=>vm.createContext({Promise,Set,Array,Object,JSON,console,...values});

test('checkout guard blocks stale restaurant, quantity and modal sessions',()=>{
 const ctx=ctxOf({
  biteCheckoutOpenSequence:3,
  activeRestaurant:{id:'a'},
  cart:{dish:1},
  cartEntries:()=>Object.entries(ctx.cart)
 });
 vm.runInContext(signature+checkoutGuard+'globalThis.check=biteCheckoutOpenMatches;globalThis.signature=biteCheckoutCartSignature;',ctx);
 const snap=ctx.signature('a',[['dish',1]]);
 assert.equal(ctx.check(3,'a',snap),true);
 ctx.cart.dish=2;
 assert.equal(ctx.check(3,'a',snap),false,'changing quantity must invalidate pending checkout');
 ctx.cart.dish=1;
 ctx.activeRestaurant={id:'b'};
 assert.equal(ctx.check(3,'a',snap),false,'switching restaurant must invalidate pending checkout');
 ctx.activeRestaurant={id:'a'};
 ctx.biteCheckoutOpenSequence=4;
 assert.equal(ctx.check(3,'a',snap),false,'closing or restarting checkout must invalidate response');
});

async function simulateStaleMenu(caseName){
 let releaseMenu,resolveReached;
 const reached=new Promise(resolve=>resolveReached=resolve);
 const menuResult=new Promise(resolve=>releaseMenu=resolve);
 const ctx=ctxOf({
  biteCheckoutOpenSequence:0,activeRestaurant:{id:'a'},
  menuItems:[{id:'dish-a',price:100}],cart:{'dish-a':1},itemNotes:{},
  cartEntries:()=>Object.entries(ctx.cart).filter(([,q])=>q>0),
  BiteDiscovery:{isClosed:()=>false},
  BITE_SANDBOX_CHECKOUT:false,
  window:{BiteCheckoutUX:{resetResult(){}}},
  pendingLiveCheckout:null,
  sb:{
   auth:{getSession:async()=>({data:{session:{user:{id:'customer-a'}}}})},
   from(table){
    assert.equal(table,'menu_items');
    const chain={
     select(){return chain;},
     eq(){return chain;},
     order(){resolveReached();return menuResult;}
    };
    return chain;
   }
  }
 });
 vm.runInContext(signature+checkoutGuard+checkout+'globalThis.openCheckoutTest=openCheckout;',ctx);
 const task=ctx.openCheckoutTest();
 await reached;
 if(caseName==='restaurant'){
  ctx.activeRestaurant={id:'b'};
  ctx.menuItems=[{id:'dish-b',price:75}];
  ctx.cart={'dish-b':1};
  ctx.biteCheckoutOpenSequence++;
 }else{
  ctx.cart={'dish-a':2};
 }
 releaseMenu({data:[{id:'dish-a',price:200}],error:null});
 await task;
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.menuItems)),
   caseName==='restaurant'?[{id:'dish-b',price:75}]:[{id:'dish-a',price:100}]);
}
test('late restaurant A menu response never overwrites new restaurant B menu/cart',async()=>{
 await simulateStaleMenu('restaurant');
});
test('a quantity change during asynchronous price refresh prevents stale checkout overwrite',async()=>{
 await simulateStaleMenu('quantity');
});

test('My Orders discards delayed RPC response after a logout',async()=>{
 let releaseRpc,resolveReached;
 const reached=new Promise(resolve=>resolveReached=resolve);
 const request=new Promise(resolve=>releaseRpc=resolve);
 const nodes={ordersList:{innerHTML:'older'},ordersSubtitle:{textContent:''}};
 const ctx=ctxOf({
  customerOrderViewSequence:0,activeCustomerId:'customer-a',customerOrders:[],
  BITE_SANDBOX_CHECKOUT:false,BITE_DIRECT_MODE:false,BITE_DIRECT_RESTAURANT_ID:null,
  sb:{auth:{getSession:async()=>({data:{session:{user:{id:'customer-a'}}}})},
   rpc:()=>{resolveReached();return request;}},
  $:id=>nodes[id],window:{},document:{querySelectorAll:()=>[]}
 });
 vm.runInContext(orderGuard+orders+'globalThis.loadOrdersTest=loadMyOrders;',ctx);
 const task=ctx.loadOrdersTest();
 await reached;
 ctx.activeCustomerId=null;
 ctx.customerOrderViewSequence++;
 nodes.ordersList.innerHTML='Log in to view your orders.';
 releaseRpc({data:[{id:'previous-account',order_code:'PRIVATE-OLD-ORDER'}],error:null});
 await task;
 assert.equal(ctx.customerOrders.length,0);
 assert.equal(nodes.ordersList.innerHTML,'Log in to view your orders.');
});

test('real session invalidation clears old orders, detail and pending checkout',()=>{
 const nodes={
  ordersList:{innerHTML:'SECRET'},
  ordersSubtitle:{textContent:'Old account'},
  sessionLabel:{textContent:'Owner A'},
  loginBtn:{textContent:'Logout'},
  myOrdersBtn:{classList:{add(){}}},
  ordersView:{classList:{contains:()=>false}}
 };
 let changedView=null;
 const ctx=ctxOf({
  activeCustomerId:'customer-a',customerOrders:[{id:'old'}],
  expandedOrderId:'old',customerOrderViewSequence:3,biteCheckoutOpenSequence:7,
  favouriteRestaurantIds:new Set(['favourite']),orderChannel:null,
  $:id=>nodes[id],window:{BiteCustomerExtras:{clearSensitiveState(){}}},
  sb:{removeChannel(){}},showCustomerView:x=>{changedView=x;}
 });
 vm.runInContext(setSession+'globalThis.endSession=setCustomerSession;',ctx);
 ctx.endSession(null);
 assert.equal(ctx.activeCustomerId,null);
 assert.equal(ctx.customerOrders.length,0);
 assert.equal(ctx.expandedOrderId,null);
 assert.equal(ctx.customerOrderViewSequence,4);
 assert.equal(ctx.biteCheckoutOpenSequence,8);
 assert.match(nodes.ordersList.innerHTML,/Log in/);
 assert.equal(changedView,'home');
});

test('duplicate Continue taps are prevented without modifying Cashfree or backend calls',()=>{
 assert.match(html,/let biteCartCheckoutOpening=false/);
 assert.match(html,/if\(biteCartCheckoutOpening\|\|!cartEntries\(\)\.length\|\|biteCartHoursBusy\)return/);
 assert.match(html,/biteCartCheckoutOpening=true;/);
 assert.match(html,/\}finally\{biteCartCheckoutOpening=false;\}/);
 assert.match(html,/if\(!biteCheckoutOpenMatches\(checkoutSequence,checkoutRestaurantId,checkoutCartSignature\)\)return/);
 assert.match(html,/sb\.rpc\('check_restaurant_delivery_area'/);
 assert.match(html,/sb\.rpc\('list_my_customer_orders'\)/);
 assert.match(html,/sb\.functions\.invoke\('bite-live-create-session'/);
});
