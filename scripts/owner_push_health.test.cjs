'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const summary=import(pathToFileURL(resolve('supabase/functions/bite-owner-push-health/summary.mjs')).href);

test('Owner push health counts events, never asserts FCM means phone delivery or exposes tokens',async()=>{
 const {summarizePushHealth}=await summary;
 const now=Date.parse('2026-11-15T00:00:00Z');
 const devices=[
  {enabled:true,supports_order_actions:true,last_seen_at:'2026-11-14T23:00:00Z',fcm_token:'sensitive'},
  {enabled:false,supports_order_actions:true,last_seen_at:'2026-11-13T10:00:00Z',fcm_token:'private'}];
 const events=['sent','sent','failed','retry','processing'].map(s=>({delivery_status:s,order_id:'private-order'}));
 const result=summarizePushHealth(devices,events,now);
 assert.equal(result.status,'FCM_DEVICE_REGISTERED');
 assert.deepEqual(result.devices,{registered:2,enabled:1,supports_order_actions:1,seen_within_48h:1});
 assert.equal(result.outbox.submitted_to_fcm,2);
 assert.equal(result.outbox.failed,1);
 assert.equal(result.outbox.retry,1);
 assert.equal(result.delivered_to_phone,'NOT_VERIFIED');
 const output=JSON.stringify(result);
 assert.doesNotMatch(output,/sensitive|private-order|fcm_token|account_number/);
});
test('disabled or stale device is never counted as an active recently seen device',async()=>{
 const {summarizePushHealth}=await summary;
 const result=summarizePushHealth([
  {enabled:false,supports_order_actions:true,last_seen_at:'2026-11-14T00:00:00Z'},
  {enabled:true,supports_order_actions:false,last_seen_at:'2026-11-01T00:00:00Z'}
 ],[],Date.parse('2026-11-15T00:00:00Z'));
 assert.equal(result.devices.enabled,1);
 assert.equal(result.devices.seen_within_48h,0);
 assert.equal(result.devices.supports_order_actions,0);
 assert.equal(summarizePushHealth([{enabled:false}],[]).status,'NO_ACTIVE_PARTNER_DEVICE');
 assert.throws(()=>summarizePushHealth(new Array(31).fill({}),[]),/Unexpected/);
});

const html=fs.readFileSync('index.html','utf8');
const begin=html.indexOf('let ownerPushHealthBusy=false;');
const end=html.indexOf('let ownerPushToken=null',begin);
assert(begin>0&&end>begin,'Cannot find isolated Owner push health UI function');
const code=html.slice(begin,end);

function setup(opts={}){
 const out={textContent:''};
 const button={disabled:false};
 const nodes={ownerPushHealthResult:out,ownerPushHealthButton:button};
 let role=opts.role??'owner',user=opts.user??'owner-a',restaurant=opts.restaurant??'restaurant-a';
 const calls=[];
 let response={data:{
  status:'FCM_DEVICE_REGISTERED',
  devices:{registered:2,enabled:1,supports_order_actions:1,seen_within_48h:1},
  outbox:{sampled_events:4,submitted_to_fcm:2,failed:1,queued:1,retry:0,processing:0,no_devices:0},
  delivered_to_phone:'NOT_VERIFIED'},error:null};
 const sb={functions:{async invoke(name,args){calls.push({name,args});return typeof response==='function'?response():response;}}};
 const ctx={document:{getElementById:id=>nodes[id]||null},sb,
  window:{Capacitor:{Plugins:opts.native?{BiteOwnerPush:opts.native}:{}}},
  get access(){return {role,restaurantId:restaurant};},
  get currentUser(){return user?{id:user}:null;}
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {ctx,button,out,calls,setRole:x=>role=x,setUser:x=>user=x,
  setRestaurant:x=>restaurant=x,setResponse:x=>response=x,
  check:()=>ctx.checkOwnerPushHealth()};
}
test('Owner can manually check own devices without mistaking submission for delivery',async()=>{
 const f=setup();
 await f.check();
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].name,'bite-owner-push-health');
 assert.equal(f.calls[0].args.body.restaurant_id,'restaurant-a');
 assert.match(f.out.textContent,/2 submitted/);
 assert.match(f.out.textContent,/This device: native push not detected/);
 assert.match(f.out.textContent,/Server: 1 active device/);
 assert.match(f.out.textContent,/Phone delivery NOT verified/);
 assert.equal(f.button.disabled,false);
});
test('Owner push health clearly distinguishes installed native bridge and settings shortcut from server registrations',async()=>{
 const ready=setup({native:{enable(){},openNotificationSettings(){}}});
 await ready.check();
 assert.match(ready.out.textContent,/This device: native push and notification settings available/);
 assert.match(ready.out.textContent,/Server: 1 active device/);
 assert.match(ready.out.textContent,/Phone delivery NOT verified/);
 assert.equal(ready.calls.length,1);
 const older=setup({native:{enable(){}}});
 await older.check();
 assert.match(older.out.textContent,/This device: native push available; notification settings shortcut requires newer APK/);
 assert.equal(older.calls.length,1);
});
test('Non-owner and logged-out sessions cannot request Owner diagnostics',async()=>{
 const f=setup({role:'super_admin'});
 await f.check();
 assert.equal(f.calls.length,0);
 f.setRole('owner');f.setUser(null);
 await f.check();
 assert.equal(f.calls.length,0);
});
test('invalid diagnostic payload fails closed without showing untrusted fields',async()=>{
 const f=setup();
 f.setResponse({data:{status:'FCM_DEVICE_REGISTERED',devices:{enabled:1},outbox:{}},error:null});
 await f.check();
 assert.match(f.out.textContent,/health check unavailable/);
 assert.equal(f.button.disabled,false);
});
test('Owner identity switch discards asynchronous prior-restaurant report',async()=>{
 let resolve;
 const pending=new Promise(r=>{resolve=r;});
 const f=setup();
 f.setResponse(()=>pending);
 const inFlight=f.check();
 assert.equal(f.button.disabled,true);
 f.setRestaurant('restaurant-b');
 resolve({data:{status:'NO_ACTIVE_PARTNER_DEVICE',devices:{registered:0,enabled:0,supports_order_actions:0,seen_within_48h:0},
  outbox:{sampled_events:0,submitted_to_fcm:0,failed:0,queued:0,retry:0,processing:0,no_devices:0},
  delivered_to_phone:'NOT_VERIFIED'},error:null});
 await inFlight;
 assert.doesNotMatch(f.out.textContent,/No active Partner device/);
});
test('backend requires valid logged-in Owner and returns ONLY aggregated rows',()=>{
 const ts=fs.readFileSync('supabase/functions/bite-owner-push-health/index.ts','utf8');
 assert.match(ts,/auth\.getUser/);
 assert.match(ts,/\.eq\("user_id",user\.id\)/);
 assert.match(ts,/\.eq\("restaurant_id",restaurantId\)/);
 assert.match(ts,/\.eq\("role","owner"\)/);
 assert.match(ts,/summarizePushHealth/);
 assert.doesNotMatch(ts,/\.insert\(|\.update\(|\.delete\(|method:"POST"/);
 assert.doesNotMatch(ts,/select\(".*fcm_token|select\(".*order_id/);
 assert.match(html,/id="ownerPushHealthButton"/);
 assert.match(html,/ownerPushHealthRequest\+\+;ownerPushHealthBusy=false/);
});
