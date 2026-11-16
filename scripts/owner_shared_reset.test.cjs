'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{webcrypto}=require('node:crypto');
const source=fs.readFileSync('supabase/functions/reset-restaurant-owner-password/index.ts','utf8');
const rid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',uid='33333333-3333-4333-8333-333333333333';
function setup(o={}){
 const members=[{restaurant_id:rid,user_id:uid,role:'owner'},...(o.shared?[{restaurant_id:other,user_id:uid,role:o.mixed?'staff':'owner'}]:[])];
 const tables={restaurants:[{id:rid,name:'Synthetic hotel'}],restaurant_members:o.duplicate?[...members,{restaurant_id:rid,user_id:other,role:'owner'}]:members,platform_admins:o.ownerAdmin?[{user_id:uid}]:[]};
 let updates=[],handler;
 const from=name=>{const filters=[],q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q},maybeSingle:async()=>({data:tables[name].find(r=>filters.every(([k,v])=>r[k]===v))||null,error:null}),then:(resolve,reject)=>Promise.resolve({data:tables[name].filter(r=>filters.every(([k,v])=>r[k]===v)),error:null}).then(resolve,reject)};return q};
 const caller={auth:{getUser:async()=>({data:{user:{id:'synthetic-admin'}},error:null})},rpc:async name=>name==='is_platform_admin'?{data:o.admin!==false,error:null}:{data:o.unverified?[]:members.map(m=>({user_id:uid,restaurant_id:m.restaurant_id,verified:true})),error:o.scopeError?{message:'Unavailable'}:null}};
 const admin={from,auth:{admin:{getUserById:async()=>({data:{user:o.phoneOnly?{id:uid,phone:'+919876543210'}:{id:uid,email:'owner@example.test',email_confirmed_at:o.unconfirmed?null:'2026-01-01',app_metadata:{keep:true}}},error:null}),updateUserById:async(id,update)=>{updates.push({id,update});return{error:null}}}}};
 const context={Deno:{serve:fn=>handler=fn,env:{get:k=>({SUPABASE_URL:'https://qa.invalid',SUPABASE_ANON_KEY:'anon-fixture',SUPABASE_SERVICE_ROLE_KEY:'service-fixture'})[k]}},createClient:(url,key)=>key==='anon-fixture'?caller:admin,Request,Response,Uint8Array,crypto:webcrypto,console};
 vm.createContext(context);vm.runInContext(stripTypeScriptTypes(source,{mode:'strip'}).replace(/^import .*?;\s*$/gm,''),context);
 return {updates,send:async(body={})=>{const r=await handler(new Request('https://qa.invalid/reset',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({restaurantId:rid,...body})}));return{status:r.status,body:await r.json()}}};
}
test('single mapped owner reset preserves identity and mandatory password rotation',async()=>{const t=setup(),r=await t.send();assert.equal(r.status,200);assert.equal(t.updates[0].id,uid);assert.equal(t.updates[0].update.app_metadata.keep,true);assert.equal(t.updates[0].update.app_metadata.must_change_password,true);assert.equal(r.body.affectedOutletCount,1)});
test('shared owner reset requires explicit all-outlet acknowledgment',async()=>{const t=setup({shared:true}),r=await t.send();assert.equal(r.status,409);assert.equal(r.body.code,'SHARED_LOGIN_ACK_REQUIRED');assert.equal(t.updates.length,0)});
test('verified shared portfolio can reset the same account after scope acknowledgment',async()=>{const t=setup({shared:true}),r=await t.send({acknowledge_shared_login:true});assert.equal(r.status,200);assert.equal(r.body.affectedOutletCount,2);assert.equal(t.updates.length,1);assert.equal(t.updates[0].id,uid)});
for(const o of [{shared:true,unverified:true},{shared:true,scopeError:true},{shared:true,mixed:true},{duplicate:true},{ownerAdmin:true},{admin:false},{unconfirmed:true}])test('reset refuses unsafe or unverifiable identity '+JSON.stringify(o),async()=>{const t=setup(o),r=await t.send({acknowledge_shared_login:true});assert.ok(r.status>=400);assert.equal(t.updates.length,0)});
test('legacy phone-only reset upgrades the same user without changing memberships',async()=>{const t=setup({phoneOnly:true}),r=await t.send();assert.equal(r.status,200);assert.equal(t.updates[0].id,uid);assert.equal(t.updates[0].update.email,'owner-919876543210@restaurantos.test');assert.equal(r.body.migrated,true)});
