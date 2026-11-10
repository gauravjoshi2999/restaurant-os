const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const html=fs.readFileSync('customer.html','utf8');
const shared=fs.readFileSync('supabase/functions/_shared/bite-payment.ts','utf8');
const source=html.split('// BITE CHECKOUT PAYMENT START')[1].split('// BITE CHECKOUT PAYMENT END')[0];
function setup(options={}){
 const calls=[],nodes={};
 const values={checkoutName:'Test customer',checkoutPhone:'9999999999',savedAddress:'saved-address',addressPostal:'313324',customerNote:'',...options.values};
 const element=id=>nodes[id]??=( {value:values[id]||'',dataset:{},disabled:false,textContent:'',remove(){},setAttribute(){},classList:{add(){},remove(){},toggle(){}}});
 const verify=[...(options.verify||[{status:'activated',order_id:'verified-order'}])];
 let displayedOrders=0,writes=0;
 const db={upsert:async()=>{writes++;return{};},select:()=>db,eq:()=>db,single:async()=>({data:{postal_code:options.savedPostal||'313324'}}),update:()=>{writes++;return db;},then:resolve=>resolve({})};
 const context={
  window:{},customerStateGeneration:1,activeCustomerId:'test-customer',checkoutRequestKey:null,appliedCheckoutCoupon:null,checkoutQuotedTotal:150,crypto:{randomUUID:()=>'request-key-1'},
  $:element,document:{querySelectorAll:()=>[]},BITE_SANDBOX_CHECKOUT:!!options.sandbox,
  sb:{auth:{getSession:async()=>({data:{session:{user:{id:'test-customer'}}}})},from:()=>db,rpc:async(name,args)=>{calls.push({kind:'rpc',name,args});return{data:'checkout-1'};},functions:{invoke:async(name,args)=>{
   calls.push({kind:'function',name,args});
   if(name==='bite-live-create-session'&&args.body.action==='readiness')return options.unavailable?{error:{message:'disabled'}}:{data:{ready:true,provider:'cashfree',environment:'production'}};
   if(name==='bite-live-create-session'||name==='cashfree-sandbox-draft-checkout')return{data:{payment_session_id:'test-session',amount:options.paymentAmount??150,currency:'INR',environment:options.sandbox?'sandbox':'production'}};
   if(name==='bite-live-verify-checkout'){const result=verify.shift()||{status:'awaiting_payment',can_retry:true};if(result.status==='awaiting_payment'&&result.can_retry==null)result.can_retry=true;return result.error?{error:{message:'network'}}:{data:result};}
   if(name==='cashfree-sandbox-verify-draft')return{data:{verified:true}};
   throw Error('Unexpected API '+name);
  }}},
  Cashfree:({mode})=>({checkout:async args=>{calls.push({kind:'sdk',mode,args});if(options.sdkThrows)throw Error('Window closed');return{paymentDetails:{paymentStatus:'SUCCESS'}};}}),
  checkoutMode:()=>options.delivery?'delivery':'pickup',cartEntries:()=>[['dish-1',1]],getCheckoutDeliveryZone:async()=>{if(options.outsideArea)throw Error('Outside delivery area');},
  activeRestaurant:{id:'restaurant-1'},checkoutAddresses:[],addressPin:null,cart:{'dish-1':1},renderCart(){},showCustomerView(){displayedOrders++;},loadMyOrders:async()=>{},
  localStorage:{setItem(){}},biteRefreshSandboxStatus(){},Date,console
 };
 vm.createContext(context);vm.runInContext(source,context);
 return {context,calls,nodes,element,get writes(){return writes;},get displayedOrders(){return displayedOrders;},submit:()=>context.submitCustomerOrder(),refresh:()=>context.refreshCheckoutPaymentReadiness()};
}
test('normal checkout unlocks only after authenticated production readiness',async()=>{
 const t=setup();t.context.syncCheckoutPaymentButton();assert.equal(t.element('placeOrderBtn').disabled,false);
 assert.equal(await t.refresh(),true);assert.equal(t.element('placeOrderBtn').disabled,false);assert.equal(t.element('placeOrderBtn').textContent,'Pay online');
});
test('provider unavailable blocks every profile, address, checkout and SDK write',async()=>{
 const t=setup({unavailable:true});await t.submit();assert.equal(t.writes,0);assert.equal(t.calls.filter(c=>c.kind==='rpc'||c.kind==='sdk').length,0);assert.equal(t.element('placeOrderBtn').disabled,false);
});
test('outside delivery area cannot prepare a payment or write customer data',async()=>{
 const t=setup({delivery:true,outsideArea:true});await t.submit();assert.equal(t.writes,0);assert.equal(t.calls.some(c=>c.kind==='rpc'||c.kind==='sdk'),false);assert.match(t.element('checkoutError').textContent,/Outside delivery area/);
});
test('normal link uses a priced intent and server verification before showing an order',async()=>{
 const t=setup();await t.submit();assert.equal(t.calls.find(c=>c.kind==='rpc').name,'bite_prepare_checkout_v2');assert.equal(t.calls.find(c=>c.kind==='sdk').mode,'production');assert.equal(t.calls.some(c=>c.name==='bite-live-verify-checkout'),true);assert.equal(t.displayedOrders,1);
});
test('SDK success alone cannot create a paid-order success screen',async()=>{
 const t=setup({verify:[{status:'awaiting_payment'}]});await t.submit();assert.equal(t.displayedOrders,0);assert.equal(t.element('placeOrderBtn').textContent,'Retry payment');assert.match(t.element('checkoutError').textContent,/complete nahi hua|Payment confirmation pending/);
});
test('an uncertain verification retry checks the same intent without taking another payment',async()=>{
 const t=setup({verify:[{error:true},{status:'activated',order_id:'verified-order'}]});await t.submit();assert.equal(t.element('placeOrderBtn').textContent,'Check payment status');await t.submit();assert.equal(t.calls.filter(c=>c.kind==='rpc').length,1);assert.equal(t.calls.filter(c=>c.kind==='sdk').length,1);assert.equal(t.displayedOrders,1);
});
test('a cancelled payment resumes the same provider session and priced intent',async()=>{
 const t=setup({sdkThrows:true,verify:[{status:'awaiting_payment'},{status:'awaiting_payment'},{status:'activated',order_id:'verified-order'}]});await t.submit();await t.submit();assert.equal(t.calls.filter(c=>c.kind==='rpc').length,1);assert.equal(t.calls.filter(c=>c.kind==='function'&&c.name==='bite-live-create-session'&&!c.args.body.action).length,2);assert.equal(t.calls.filter(c=>c.kind==='sdk').length,2);assert.equal(t.displayedOrders,1);
});
test('rapid repeated clicks cannot create two checkout intents',async()=>{
 const t=setup();await Promise.all([t.submit(),t.submit()]);assert.equal(t.calls.filter(c=>c.kind==='rpc').length,1);
});
test('explicit sandbox checkout stays isolated from production and restaurant success UI',async()=>{
 const t=setup({sandbox:true});await t.submit();assert.equal(t.writes,0,'Sandbox must not save profile/address data');assert.equal(t.calls.find(c=>c.kind==='rpc').name,'create_bite_sandbox_order_draft');assert.equal(t.calls.find(c=>c.kind==='sdk').mode,'sandbox');assert.equal(t.calls.some(c=>(c.name||'').startsWith('bite-live-')),false);assert.equal(t.displayedOrders,0);
});
async function readinessRequest(options={}){
 let handler,reads=0,providerCalls=0;
 const env={BITE_LIVE_CHECKOUT_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service',CASHFREE_APP_ID:'test-app',CASHFREE_SECRET_KEY:'test-secret',...options.env};
 const raw=(shared+'\n'+fs.readFileSync('supabase/functions/bite-live-create-session/index.ts','utf8')).replace(/^export /gm,'').replace(/^import .*;\n/gm,'');
 const code=stripTypeScriptTypes(raw,{mode:'strip'});
 const context={Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},createClient:()=>({auth:{getUser:async()=>({data:{user:options.invalidUser?null:{id:'test-user'}},error:options.invalidUser?Error('invalid'):null})},from:()=>{reads++;throw Error('Readiness must not access checkout rows');}}),fetch:async()=>{providerCalls++;throw Error('Readiness must not call provider');},Response,Date,JSON,Number,String,Math};
 vm.createContext(context);vm.runInContext(code,context);
 const response=await handler(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test-user-token'},body:JSON.stringify({action:'readiness'})}));
 return {status:response.status,body:await response.json(),reads,providerCalls};
}
test('backend readiness authenticates and returns no credentials or business data',async()=>{
 const result=await readinessRequest();assert.equal(result.status,200);assert.deepEqual(result.body,{ready:true,provider:'cashfree',environment:'production'});assert.equal(result.reads,0);assert.equal(result.providerCalls,0);
});
test('backend readiness retains the enabled flag, valid-user and configured-key gates',async()=>{
 assert.equal((await readinessRequest({env:{BITE_LIVE_CHECKOUT_ENABLED:'false'}})).status,503);
 assert.equal((await readinessRequest({invalidUser:true})).status,401);
 assert.equal((await readinessRequest({env:{CASHFREE_SECRET_KEY:''}})).status,503);
});

test('a server price change requires reviewing the new total before any SDK payment',async()=>{
 const t=setup({paymentAmount:170});await t.submit();assert.equal(t.calls.filter(c=>c.kind==='sdk').length,0);assert.match(t.element('checkoutError').textContent,/Updated total ₹170/);assert.match(t.element('placeOrderBtn').textContent,/Pay updated total/);
 await t.submit();assert.equal(t.calls.filter(c=>c.kind==='sdk').length,1);assert.equal(t.calls.filter(c=>c.kind==='rpc').length,1);
});

test('sandbox refuses a new delivery address before any persistent write or payment request',async()=>{
 const t=setup({sandbox:true,delivery:true,values:{savedAddress:'new'}});await t.submit();assert.equal(t.writes,0);assert.equal(t.calls.length,0);assert.match(t.element('checkoutError').textContent,/saved address/);
});
test('sandbox cannot rewrite the PIN of a saved address',async()=>{
 const t=setup({sandbox:true,delivery:true,savedPostal:'313399'});await t.submit();assert.equal(t.writes,0);assert.equal(t.calls.length,0);assert.match(t.element('checkoutError').textContent,/original PIN/);
});
test('sandbox cannot resume a pre-existing live intent or invoke the production SDK',async()=>{
 const t=setup({sandbox:true});vm.runInContext("pendingLiveCheckout={id:'live-original',session:'production-session',started:true,verifyOnly:true}",t.context);await t.submit();assert.equal(t.calls.length,0);assert.equal(t.writes,0);assert.match(t.element('checkoutError').textContent,/Sandbox mode/);await assert.rejects(t.context.continueLiveCheckout(),/Sandbox mode/);assert.equal(t.calls.length,0);
});
test('HTTP 503 leaves a recoverable saved checkout and working menu route, without a second intent',async()=>{
 const t=setup();const invoke=t.context.sb.functions.invoke;t.context.sb.functions.invoke=async(name,args)=>name==='bite-live-create-session'&&!args.body.action?{error:{context:{json:async()=>({error:'Provider unavailable',code:'provider_timeout'})}}}:invoke(name,args);
 await t.submit();assert.equal(t.calls.filter(c=>c.kind==='sdk').length,0);assert.equal(t.calls.filter(c=>c.kind==='rpc').length,1);t.context.backToCustomerMenu();assert.equal(vm.runInContext('viewingPendingCheckout',t.context),false);assert.equal(vm.runInContext('pendingLiveCheckout.id',t.context),'checkout-1');assert.match(t.element('checkoutError').textContent,/Provider unavailable/);
});
test('verification of a detached old payment cannot clear a newly edited cart',async()=>{
 const t=setup();vm.runInContext("pendingLiveCheckout={id:'old',draftSignature:'old-cart-signature'};cart={'new-dish':3};viewingPendingCheckout=false",t.context);await t.context.finishVerifiedCheckout({status:'activated',order_id:'real-paid-order'});assert.equal(t.context.cart['new-dish'],3);assert.equal(t.displayedOrders,1);
});
test('a new draft cannot bypass an unresolved old payment or silently pay after safe cancellation',async()=>{
 const t=setup({verify:[{status:'awaiting_payment',can_retry:false},{status:'expired',safely_closed:true}]});vm.runInContext("pendingLiveCheckout={id:'old',started:true};viewingPendingCheckout=false",t.context);await t.submit();assert.equal(t.calls.some(c=>c.kind==='rpc'||c.kind==='sdk'),false);await t.submit();assert.equal(t.calls.some(c=>c.kind==='rpc'||c.kind==='sdk'),false);assert.equal(vm.runInContext('pendingLiveCheckout',t.context),null);
});

test('a server-detected earlier unresolved checkout becomes the recovery target without replacing the new cart',async()=>{const t=setup();const original=t.context.sb.functions.invoke;t.context.sb.functions.invoke=async(name,args)=>name==='bite-live-create-session'&&!args.body.action?{error:{context:{json:async()=>({error:'Earlier payment unresolved',code:'earlier_payment_unresolved',blocking_intent_id:'earlier-id'})}}}:original(name,args);await t.submit();assert.equal(vm.runInContext('pendingLiveCheckout.id',t.context),'earlier-id');assert.equal(t.context.cart['dish-1'],1);assert.equal(t.calls.filter(c=>c.kind==='sdk').length,0);});

test('production checkout cannot silently rewrite a saved address PIN',async()=>{const t=setup({delivery:true,savedPostal:'313399'});await t.submit();assert.equal(t.calls.some(c=>c.kind==='rpc'||c.kind==='sdk'),false);assert.equal(t.writes,1,'Only the own contact profile can be saved; the address is not mutated');assert.match(t.element('checkoutError').textContent,/PIN alag/);});

test('account switching while a payment-session response is in flight cannot open the old customer SDK',async()=>{
 const t=setup(),original=t.context.sb.functions.invoke;let release,entered;const waiting=new Promise(resolve=>entered=resolve);t.context.sb.functions.invoke=async(name,args)=>{if(name==='bite-live-create-session'&&!args.body.action){entered();return new Promise(resolve=>release=resolve);}return original(name,args);};const submission=t.submit();await waiting;t.context.activeCustomerId='other-customer';t.context.customerStateGeneration++;vm.runInContext('pendingLiveCheckout=null',t.context);release({data:{payment_session_id:'old-private-session',amount:150,currency:'INR',environment:'production'}});await submission;assert.equal(t.calls.filter(c=>c.kind==='sdk').length,0);assert.equal(t.displayedOrders,0);
});
