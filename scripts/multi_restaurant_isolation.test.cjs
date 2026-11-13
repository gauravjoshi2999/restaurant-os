'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');

// All data below is synthetic. It never reaches Supabase, Cashfree or Firebase.
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const ownerA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const orderA='33333333-3333-4333-8333-333333333333';
const secret='synthetic-push-secret';
const env={
 SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'anon-fixture',
 SUPABASE_SERVICE_ROLE_KEY:'service-fixture',BITE_PUSH_DISPATCH_SECRET:secret,
 FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'fake-project',
  client_email:'fake@example.invalid',private_key:'-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----'})
};
function compile(path,createClient,fetchFn){
 let handler;
 const source=fs.readFileSync(path,'utf8').replace(/^import .*;\s*$/gm,'');
 const code=stripTypeScriptTypes(source,{mode:'strip'});
 const fakeCrypto={subtle:{importKey:async()=>({}),sign:async()=>new Uint8Array([1,2,3])}};
 const ctx={Deno:{env:{get:key=>env[key]},serve:f=>handler=f},
  createClient,fetch:fetchFn||(()=>{throw Error('Never contact an external endpoint');}),
  crypto:fakeCrypto,Response,Request,URLSearchParams,TextEncoder,Uint8Array,
  AbortSignal,btoa,atob,Date,Math,JSON,Number,String,Array,console};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 assert.equal(typeof handler,'function');
 return handler;
}
function call(handler,body,headers={}){
 return handler(new Request('https://functions.synthetic.invalid/verify',{
  method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)
 }));
}
function queryStore(store,table){
 let filters=[],operation='read',change=null;
 const matches=row=>filters.every(([k,v,mode])=>mode==='in'?v.includes(row[k]):row[k]===v);
 const go=()=>{
  const rows=(store[table]||[]).filter(matches);
  if(operation==='update')for(const row of rows)Object.assign(row,change);
  if(operation==='delete')store[table]=(store[table]||[]).filter(row=>!rows.includes(row));
  if(operation==='upsert'){const arr=Array.isArray(change)?change:[change];for(const row of arr){
   const i=store[table].findIndex(r=>r.fcm_token===row.fcm_token);
   if(i<0)store[table].push({...row});else Object.assign(store[table][i],row);
  }}
  return rows;
 };
 const query={
  select:()=>query,eq:(k,v)=>{filters.push([k,v,'eq']);return query;},
  in:(k,v)=>{filters.push([k,v,'in']);return query;},
  order:()=>query,limit:()=>query,
  update:v=>{operation='update';change=v;return query;},
  delete:()=>{operation='delete';return query;},
  upsert:v=>{operation='upsert';change=v;return query;},
  maybeSingle:async()=>({data:go()[0]||null,error:null}),
  then:(resolve,reject)=>Promise.resolve({data:go(),error:null}).then(resolve,reject)
 };
 return query;
}
function registerFixture(loginOwner=ownerA){
 const store={restaurant_members:[{restaurant_id:A,user_id:ownerA,role:'owner'},
  {restaurant_id:B,user_id:ownerB,role:'owner'}],bite_owner_push_devices:[]};
 const createClient=(_,key)=>key===env.SUPABASE_ANON_KEY
  ?{auth:{getUser:async()=>({data:{user:{id:loginOwner}},error:null})}}
  :{from:table=>queryStore(store,table)};
 const handler=compile('supabase/functions/bite-owner-push-register/index.ts',createClient);
 const register=(restaurant_id,action='register')=>call(handler,{
  restaurant_id,fcm_token:'synthetic-token-'.padEnd(75,'x'),
  supports_order_actions:true,action
 },{authorization:'Bearer synthetic-jwt'});
 return {store,register};
}

test('Owner A can register a device only for Restaurant A',async()=>{
 const f=registerFixture();
 const yes=await f.register(A); assert.equal(yes.status,200);
 assert.equal((await yes.json()).registered,true);
 assert.equal(f.store.bite_owner_push_devices[0].restaurant_id,A);
 const no=await f.register(B);assert.equal(no.status,403);
 assert.equal(f.store.bite_owner_push_devices.length,1);
});
test('Owner B cannot register or unregister Restaurant A push devices',async()=>{
 const f=registerFixture(ownerB);
 assert.equal((await f.register(A)).status,403);
 assert.equal((await f.register(A,'unregister')).status,403);
 assert.equal(f.store.bite_owner_push_devices.length,0);
 assert.equal((await f.register(B)).status,200);
 assert.equal(f.store.bite_owner_push_devices[0].restaurant_id,B);
});
function dispatchFixture(opts={}){
 const store={
  bite_owner_push_events:[{order_id:orderA,restaurant_id:A,delivery_status:'queued',attempts:0}],
  orders:[{id:orderA,restaurant_id:opts.orderRestaurant||A,status:'Received',
   channel:'Own Platform',is_demo:false,order_code:'SYNTHETIC-001'}],
  order_financials:[{order_id:orderA,restaurant_id:A,payment_status:opts.paid===false?'unpaid':'paid'}],
  restaurant_members:[{restaurant_id:A,user_id:ownerA,role:'owner'},
   {restaurant_id:B,user_id:ownerB,role:'owner'}],
  bite_owner_push_devices:[
   {restaurant_id:A,user_id:ownerA,enabled:true,fcm_token:'token-A',supports_order_actions:true},
   {restaurant_id:B,user_id:ownerB,enabled:true,fcm_token:'token-B',supports_order_actions:true}
  ]
 };
 if(opts.duplicateOwner)store.restaurant_members.push({restaurant_id:A,user_id:ownerB,role:'owner'});
 const notifications=[],external=[];
 const fetchFn=async(url,config)=>{
  external.push(url);
  if(String(url).includes('oauth2.googleapis.com'))return new Response(
   JSON.stringify({access_token:'synthetic-access'}),{status:200});
  if(String(url).includes('fcm.googleapis.com')){
   const payload=JSON.parse(config.body);
   notifications.push(payload.message);
   return new Response('{}',{status:200});
  }
  throw Error('Unexpected endpoint');
 };
 const handler=compile('supabase/functions/bite-owner-push-dispatch/index.ts',
  ()=>({from:table=>queryStore(store,table),rpc:async()=>({data:false,error:null})}),fetchFn);
 const dispatch=()=>call(handler,{}, {'x-bite-push-secret':secret});
 return {store,notifications,external,dispatch};
}
test('One paid Restaurant A event targets ONLY its own verified owner device',async()=>{
 const f=dispatchFixture();
 const result=await f.dispatch();assert.equal(result.status,200);
 const body=await result.json();assert.equal(body.sent,1);
 assert.equal(f.notifications.length,1);
 assert.equal(f.notifications[0].token,'token-A');
 assert.equal(f.notifications[0].data.restaurant_id,A);
 assert.equal(f.notifications[0].data.order_id,orderA);
 assert.equal(f.store.bite_owner_push_events[0].delivery_status,'sent');
});
test('A spoofed outbox event cannot dispatch a foreign Restaurant B order',async()=>{
 const f=dispatchFixture({orderRestaurant:B});
 const result=await f.dispatch();assert.equal(result.status,200);
 assert.equal(f.notifications.length,0);
 assert.equal(f.store.bite_owner_push_events[0].delivery_status,'retry');
});
test('Unpaid orders cannot send a real-order push to either restaurant',async()=>{
 const f=dispatchFixture({paid:false});
 const result=await f.dispatch();assert.equal(result.status,200);
 assert.equal(f.notifications.length,0);
 assert.equal(f.store.bite_owner_push_events[0].delivery_status,'retry');
});
test('Duplicate owner mappings stop the push rather than mixing tenants',async()=>{
 const f=dispatchFixture({duplicateOwner:true});
 const result=await f.dispatch();assert.equal(result.status,200);
 assert.equal(f.notifications.length,0);
 assert.equal(f.store.bite_owner_push_events[0].delivery_status,'retry');
});
test('An unauthenticated dispatcher never reads the outbox or sends push',async()=>{
 const f=dispatchFixture();
 const response=await call(
  compile('supabase/functions/bite-owner-push-dispatch/index.ts',
   ()=>({from:table=>{throw Error('Unauthorized code read '+table)}}),
   ()=>{throw Error('Unauthorized network request')}),
  {},{'x-bite-push-secret':'invalid'});
 assert.equal(response.status,403);
 assert.equal(f.notifications.length,0);
});
test('Customer session creation cannot pay against another customer checkout intent',()=>{
 const code=fs.readFileSync('supabase/functions/bite-live-create-session/index.ts','utf8');
 assert.match(code,/intent\.customer_id!==user\.id/);
 assert.match(code,/restaurant_id/);
 assert.match(code,/priced_items/);
});
test('Owner order actions remain server authenticated and restaurant bound',()=>{
 const owner=fs.readFileSync('index.html','utf8');
 const block=owner.slice(owner.indexOf('async function handlePendingNativeOwnerAction()'),
  owner.indexOf("window.addEventListener('focus'",owner.indexOf('async function handlePendingNativeOwnerAction()')));
 assert.match(block,/pending\.restaurant_id!==access\.restaurantId/);
 assert.match(block,/bite_owner_notification_order_action/);
 assert.match(block,/p_restaurant_id:access\.restaurantId/);
 assert.match(block,/order\.restaurant===access\.restaurantId/);
});
