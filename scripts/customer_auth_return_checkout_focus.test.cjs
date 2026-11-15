'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const authSource=html.slice(html.indexOf("const BITE_AUTH_RETURN_KEY="),html.indexOf("function showAuth(mode='login')"));
const fieldSource=html.slice(html.indexOf('function biteCheckoutFieldError('),html.indexOf('let checkoutPaymentReady='));
assert.ok(authSource.startsWith('const BITE_AUTH_RETURN_KEY='));
assert.ok(fieldSource.startsWith('function biteCheckoutFieldError('));

function authSetup(){
 const saved=new Map(),calls=[],fields={
  cartModal:{classList:{contains:()=>false}},
  menuSearchInput:{value:'paneer'},menuVegToggle:{checked:true}
 };
 let cartCount=2;
 const context={
  activeCustomerId:null,activeRestaurant:{id:'r-1'},restaurants:[{id:'r-1'}],menuItems:[{id:'dish'}],
  resumeCheckoutAfterLogin:true,activeMenuCategory:'c-1',
  document:{body:{dataset:{view:'menu'}}},
  window:{scrollY:482,biteStorefrontLoading:false,scrollTo:value=>calls.push({scroll:value})},
  BITE_DIRECT_MODE:false,BITE_DIRECT_RESTAURANT_ID:null,
  sessionStorage:{setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k)||null,removeItem:k=>saved.delete(k)},
  $:id=>fields[id]||(fields[id]={value:'',checked:false}),
  cartEntries:()=>Array.from({length:cartCount},(_,i)=>['dish',1]),
  renderMenuItems:category=>calls.push({render:category}),
  showCustomerView:view=>calls.push({view}),
  openRestaurant:async id=>{calls.push({restaurant:id});context.activeRestaurant={id};context.menuItems=[{id:'dish'}]},
  openCheckout:async()=>{calls.push({checkout:true})},
  openCartModal:()=>calls.push({cart:true}),
  Date,Number,JSON,Math,console
 };
 vm.createContext(context);
 vm.runInContext(authSource+';globalThis.remember=biteRememberCustomerAuthReturn;globalThis.restore=biteRestoreCustomerAuthReturn;',context);
 return{context,calls,saved,fields,setCartCount:n=>cartCount=n};
}

test('guest checkout saves restaurant, cart return target and scroll without credentials',()=>{
 const t=authSetup();t.context.remember();
 const context=JSON.parse(t.saved.get('bite_customer_auth_return_v1'));
 assert.deepEqual(Object.keys(context).sort(),['at','category','flow','restaurantId','scrollY','search','vegOnly']);
 assert.equal(context.restaurantId,'r-1');
 assert.equal(context.flow,'checkout');
 assert.equal(context.scrollY,482);
 assert.equal(context.search,'paneer');
 assert.equal(context.vegOnly,true);
});

test('OAuth page reload restores the restaurant and returns to checkout without paying',async()=>{
 const t=authSetup();
 t.context.remember();
 t.context.activeCustomerId='signed-in-user';
 t.context.activeRestaurant=null;t.context.menuItems=[];t.context.resumeCheckoutAfterLogin=false;
 await Promise.all([t.context.restore(),t.context.restore()]);
 assert.equal(t.calls.filter(c=>c.restaurant).length,1);
 assert.equal(t.calls.filter(c=>c.checkout).length,1);
 assert.equal(t.calls.filter(c=>c.cart).length,0);
 assert.equal(t.saved.size,0,'return is one-shot to prevent duplicate checkout opens');
 assert.equal(t.context.resumeCheckoutAfterLogin,false);
});

test('login from menu preserves scroll and filters without forced checkout',async()=>{
 const t=authSetup();t.context.resumeCheckoutAfterLogin=false;t.context.remember();
 t.context.activeCustomerId='signed-in-user';
 await t.context.restore();
 assert.equal(t.calls.some(c=>c.checkout),false);
 assert.equal(t.calls.find(c=>c.scroll).scroll.top,482);
 assert.equal(t.calls.find(c=>c.scroll).scroll.behavior,'instant');
 assert.equal(t.calls.find(c=>c.render).render,'c-1');
});

test('expired login position is ignored and never starts an old checkout',async()=>{
 const t=authSetup();t.context.remember();
 const key='bite_customer_auth_return_v1',saved=JSON.parse(t.saved.get(key));saved.at=Date.now()-31*60*1000;
 t.saved.set(key,JSON.stringify(saved));
 t.context.activeCustomerId='signed-in-user';
 assert.equal(await t.context.restore(),false);
 assert.equal(t.calls.some(c=>c.checkout),false);
 assert.equal(t.saved.has(key),false);
});

test('auth restoration waits for restaurant discovery to finish',async()=>{
 const t=authSetup();t.context.remember();t.context.activeCustomerId='signed-in-user';
 t.context.window.biteStorefrontLoading=true;
 assert.equal(await t.context.restore(),false);
 assert.equal(t.saved.size,1);
 t.context.window.biteStorefrontLoading=false;
 assert.equal(await t.context.restore(),true);
 assert.equal(t.calls.filter(c=>c.checkout).length,1);
});

test('checkout validation maps required values to exact customer fields',()=>{
 for(const id of ['checkoutName','checkoutPhone','addressLine','addressCity','addressState','addressPostal','savedAddress'])
  assert.match(html,new RegExp("biteCheckoutFieldError\\('"+id+"'"));
 assert.match(html,/if\(error\.checkoutField\)biteHighlightCheckoutField\(error\.checkoutField,error\.message\)/);
 assert.match(html,/placeOrderBtn'\)\.addEventListener\('click'/);
});

test('invalid checkout field is highlighted, scrolled into view and focused',()=>{
 const operations=[],nodes=new Map(),document={
  querySelectorAll:()=>Array.from(nodes.values()).filter(el=>el.attributes['aria-invalid']==='true'),
  createElement:()=>({setAttribute(){},textContent:'',id:'',className:''})
 };
 const $=id=>{
  if(!nodes.has(id))nodes.set(id,{
   attributes:{},setAttribute(k,v){this.attributes[k]=v;},
   removeAttribute(k){delete this.attributes[k];},
   getAttribute(k){return this.attributes[k]??null;},
   insertAdjacentElement(where,child){operations.push({hint:where,text:child.textContent});},
   scrollIntoView:opts=>operations.push({scroll:opts}),
   focus:opts=>operations.push({focus:opts})
  });
  return nodes.get(id);
 };
 const ctx=vm.createContext({document,$,Error});
 vm.runInContext(fieldSource+';globalThis.mark=biteHighlightCheckoutField;globalThis.fail=biteCheckoutFieldError;',ctx);
 const error=ctx.fail('checkoutPhone','Phone number required');
 assert.equal(error.checkoutField,'checkoutPhone');
 ctx.mark(error.checkoutField,error.message);
 assert.equal($('checkoutPhone').getAttribute('aria-invalid'),'true');
 assert.equal($('checkoutPhone').getAttribute('aria-describedby'),'biteCheckoutFieldIssue');
 assert.ok(operations.find(op=>op.scroll?.behavior==='smooth'&&op.scroll.block==='center'));
 assert.ok(operations.some(op=>op.focus?.preventScroll===true));
 assert.ok(operations.some(op=>op.text==='Phone number required'));
});
