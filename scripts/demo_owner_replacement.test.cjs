'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('supabase/functions/create-restaurant-owner-login/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20261113105000_admin_replace_owner_identity_atomic.sql','utf8');
const restaurant='11111111-1111-4111-8111-111111111111';
const oldOwner='22222222-2222-4222-8222-222222222222';
const newOwner='33333333-3333-4333-8333-333333333333';
const restaurantName='Synthetic Old Restaurant';
function setup(options={}){
 const state={
  restaurants:[{id:restaurant,name:restaurantName}],
  restaurant_members:options.empty?[]:[{restaurant_id:restaurant,user_id:oldOwner,role:'owner'}],
  orders:[{id:'order-1',restaurant_id:restaurant,is_demo:false}],
  platform_admins:[],bite_owner_push_devices:[{restaurant_id:restaurant,user_id:oldOwner,enabled:true}],
  users:[{id:oldOwner,email:'owner-919876543210@restaurantos.test',phone:null}]
 };
 const calls={create:0,delete:0,rpc:[],disable:0};
 const filter=(rows,filters)=>rows.filter(row=>filters.every(([k,v])=>row[k]===v));
 const from=table=>{
  let filters=[],doUpdate=null,selectOpts={};
  const q={
   select:(fields,opts)=>{selectOpts=opts||{};return q;},
   eq:(key,val)=>{filters.push([key,val]);return q;},
   neq:(key,val)=>{filters.push([key,val]);return q;},
   limit:()=>q,
   update:v=>{doUpdate=v;return q;},
   maybeSingle:async()=>({data:filter(state[table]||[],filters)[0]||null,error:null}),
   insert:async(row)=>{state[table].push({...row});return{error:null};},
   then:(resolve,reject)=>{
    let rows=filter(state[table]||[],filters);
    if(doUpdate){for(const r of rows)Object.assign(r,doUpdate);calls.disable+=rows.length;}
    return Promise.resolve({data:selectOpts.head?null:rows,count:selectOpts.count==='exact'?rows.length:null,error:null}).then(resolve,reject);
   }
  };
  return q;
 };
 const authClient={
  auth:{getUser:async()=>({data:{user:{id:'synthetic-admin'}},error:null})},
  rpc:async(name,params)=>{
   calls.rpc.push({name,params});
   if(name==='is_platform_admin')return{data:options.admin===false?false:true,error:null};
   if(name==='admin_replace_owner_mapping'){
    if(options.rejectSwitch)return{data:null,error:{message:'Simulated atomic RPC failure'}};
    const prev=state.restaurant_members.find(r=>r.restaurant_id===restaurant&&r.role==='owner');
    if(prev?.user_id!==params.p_expected_owner_id)return{data:null,error:{message:'Mapping changed'}};
    state.restaurant_members=state.restaurant_members.filter(r=>r!==prev);
    state.restaurant_members.push({restaurant_id:restaurant,user_id:params.p_new_owner_id,role:'owner'});
    return{data:true,error:null};
   }
   throw Error('Unexpected RPC '+name);
  }
 };
 const service={
  from,
  auth:{admin:{
   listUsers:async()=>({data:{users:state.users},error:null}),
   createUser:async({email,password})=>{
    calls.create++;
    const u={id:newOwner,email,password};state.users.push(u);
    return{data:{user:u},error:null};
   },
   deleteUser:async id=>{calls.delete++;state.users=state.users.filter(u=>u.id!==id);return{error:null};}
  }}
 };
 let handler;
 const context={Deno:{serve:fn=>handler=fn,env:{get:key=>({
  SUPABASE_URL:'https://qa.invalid',SUPABASE_ANON_KEY:'anon-fixture',SUPABASE_SERVICE_ROLE_KEY:'service-fixture'
 })[key]}},createClient:(url,key)=>key==='anon-fixture'?authClient:service,
  Response,Request,Uint8Array,crypto:webcrypto,console,Date};
 vm.createContext(context);
 vm.runInContext(stripTypeScriptTypes(source,{mode:'strip'}).replace(/^import .*?;\s*$/gm,''),context);
 const send=async payload=>{
  const r=await handler(new Request('https://qa.invalid/functions/v1/create-restaurant-owner-login',{
   method:'POST',headers:{authorization:'Bearer synthetic-jwt','content-type':'application/json','origin':'https://gauravjoshi2999.github.io'},
   body:JSON.stringify({restaurantId:restaurant,phone:'9123456789',fullName:'Real Owner',
    replaceExistingOwner:true,expectedOwnerUserId:oldOwner,confirmRestaurantName:restaurantName,
    acknowledgeExistingHistory:true,...payload})
  }));
  return{status:r.status,body:await r.json()};
 };
 return {state,calls,send};
}

test('Owner login replacement requires a logged-in Platform Admin',async()=>{
 const t=setup({admin:false});
 const r=await t.send({});
 assert.equal(r.status,403);
 assert.equal(t.calls.create,0);
 assert.equal(t.state.restaurant_members[0].user_id,oldOwner);
});
test('Old mapping mismatch must fail closed before creating an account',async()=>{
 const t=setup();
 const r=await t.send({expectedOwnerUserId:newOwner});
 assert.equal(r.status,409);
 assert.equal(r.body.code,'OWNER_MAPPING_CHANGED');
 assert.equal(t.calls.create,0);
});
test('A changed restaurant name must not replace the Owner',async()=>{
 const t=setup();
 const r=await t.send({confirmRestaurantName:'Not the current restaurant'});
 assert.equal(r.status,400);
 assert.equal(t.calls.create,0);
});
test('Historical live order access requires explicit acknowledgement',async()=>{
 const t=setup();
 const r=await t.send({acknowledgeExistingHistory:false});
 assert.equal(r.status,409);
 assert.equal(r.body.code,'HISTORY_ACK_REQUIRED');
 assert.equal(t.calls.create,0);
});
test('Real Owner replacement commits only after atomic and audited mapping RPC',async()=>{
 const t=setup();
 const r=await t.send({});
 assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.success,true);
 assert.equal(r.body.replaced,true);
 assert.equal(r.body.created,true);
 assert.equal(r.body.phone,'+919123456789');
 assert.equal(typeof r.body.temporaryPassword,'string');
 assert.equal(t.state.restaurant_members.length,1);
 assert.equal(t.state.restaurant_members[0].user_id,newOwner);
 assert.equal(t.state.bite_owner_push_devices[0].enabled,false);
 assert.equal(t.calls.create,1);
 assert.equal(t.calls.delete,0);
 const rpc=t.calls.rpc.find(x=>x.name==='admin_replace_owner_mapping');
 assert.equal(rpc.params.p_expected_owner_id,oldOwner);
 assert.equal(rpc.params.p_new_owner_id,newOwner);
});
test('Failed replacement never removes the previous owner and cleans new Auth account',async()=>{
 const t=setup({rejectSwitch:true});
 const r=await t.send({});
 assert.equal(r.status,409);
 assert.equal(r.body.code,'MAPPING_FAILED');
 assert.equal(t.calls.delete,1);
 assert.equal(t.state.restaurant_members[0].user_id,oldOwner);
});
test('Server SQL requires authenticated administrator, exact original owner and audits transfer',()=>{
 assert.match(migration,/auth\.uid\(\)/);
 assert.match(migration,/is_platform_admin\(\)/);
 assert.match(migration,/v_existing\[1\]<>p_expected_owner_id/);
 assert.match(migration,/platform_audit_logs/);
 assert.match(migration,/revoke all on function/i);
 assert.match(migration,/grant execute.*authenticated/i);
 assert.doesNotMatch(source,/admin\.auth\.admin\.updateUserById/);
});
test('Super Admin UI exposes the mapped phone login, reset and explicit replacement',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/data-reset-mapped-owner/);
 assert.match(html,/data-replace-owner/);
 assert.match(html,/expected_owner_user_id/);
 assert.match(html,/acknowledgeExistingHistory/);
 assert.match(html,/const loginId=match\?match\[1\]/);
});
