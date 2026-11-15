'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const migration=fs.readFileSync('supabase/migrations/20261115123000_bite_owner_cancellation_push.sql','utf8');
const dispatch=fs.readFileSync('supabase/functions/bite-owner-push-dispatch/index.ts','utf8');
const helper=fs.readFileSync('supabase/functions/bite-owner-push-dispatch/cancellation-push.mjs','utf8');
const reqId='11111111-1111-4111-8111-111111111111';
const orderId='22222222-2222-4222-8222-222222222222';
const restaurantId='33333333-3333-4333-8333-333333333333';
function fixture(overrides={}){
 const events=[{request_id:reqId,order_id:orderId,restaurant_id:restaurantId,delivery_status:'queued',attempts:0,created_at:'2026-11-15T12:00:00Z',...overrides.event}];
 const request={id:reqId,order_id:orderId,restaurant_id:restaurantId,customer_id:'customer-a',request_type:'cancel_request',status:'Pending',...overrides.request};
 const order={id:orderId,restaurant_id:restaurantId,customer_id:'customer-a',status:'Accepted',channel:'Own Platform',is_demo:false,...overrides.order};
 const rows={
  bite_owner_cancellation_push_events:events,
  restaurant_customer_order_requests:[request],
  orders:[order],
  order_financials:[{order_id:orderId,restaurant_id:restaurantId,payment_status:overrides.paymentStatus||'paid'}],
  restaurant_members:[{user_id:'owner-a',restaurant_id:restaurantId,role:'owner'}],
  bite_owner_push_devices:overrides.noDevices?[]:
   [{restaurant_id:restaurantId,user_id:'owner-a',fcm_token:'device-token',enabled:true,supports_order_actions:true}]
 };
 const updates=[],calls=[];
 const db={from(table){
  assert.ok(Object.prototype.hasOwnProperty.call(rows,table),'Unexpected database table: '+table);
  const constraints=[];let update=null;
  const matching=()=>rows[table].filter(row=>constraints.every(([k,v])=>
   Array.isArray(v)?v.includes(row[k]):row[k]===v));
  const q={
   select(){return q},
   eq(k,v){constraints.push([k,v]);return q},
   in(k,v){constraints.push([k,v]);return q},
   order(){return q},
   limit(n){return Promise.resolve({data:matching().slice(0,n),error:null})},
   update(value){update=value;return q},
   async maybeSingle(){
    const row=matching()[0]||null;
    if(update&&row){Object.assign(row,update);updates.push({table,value:update})}
    return {data:row,error:null};
   },
   then(resolve,reject){
    const data=matching();
    if(update){for(const row of data){Object.assign(row,update);updates.push({table,value:update})}}
    return Promise.resolve({data,error:null}).then(resolve,reject);
   }
  };
  return q;
 }};
 const fetcher=async(url,options)=>{
  calls.push({url,options,payload:JSON.parse(options.body)});
  return {ok:true,status:200};
 };
 return {db,rows,calls,updates,fetcher};
}
test('cancellation push migration creates a private one-shot outbox for legitimate pending paid orders only',()=>{
 for(const token of [
  'create table if not exists public.bite_owner_cancellation_push_events',
  'request_id uuid primary key',
  'alter table public.bite_owner_cancellation_push_events enable row level security',
  'revoke all on public.bite_owner_cancellation_push_events from public,anon,authenticated',
  "new.request_type<>'cancel_request' or new.status<>'Pending'",
  "o.status in ('Accepted','Preparing','Ready')",
  "f.payment_status='paid'",
  'on conflict(request_id) do nothing',
  'after insert on public.restaurant_customer_order_requests',
  'cron.alter_job',
  "bite_private.kick_owner_push_dispatch('pending_orders')"
 ])assert.ok(migration.includes(token),'Missing guard: '+token);
 assert.doesNotMatch(migration,/update public\.bite_refund_jobs|execute_refund|POST \/refunds/i);
});
test('existing signed push dispatcher imports the restricted request sender',()=>{
 assert.match(dispatch,/import \{dispatchCancellationPush\} from "\.\/cancellation-push\.mjs";/);
 assert.match(dispatch,/dispatchCancellationPush\(\{/);
 assert.match(dispatch,/projectId:account\.project_id/);
 assert.match(helper,/event_type:"bite_cancel_request"/);
 assert.doesNotMatch(helper,/body:"Customer.*customer_phone|order\.customer_name/);
});
test('valid pending customer cancellation sends one high-priority Android notification without order acceptance actions',async()=>{
 const {dispatchCancellationPush}=await import(pathToFileURL(path.resolve('supabase/functions/bite-owner-push-dispatch/cancellation-push.mjs')));
 const f=fixture();
 const result=await dispatchCancellationPush({db:f.db,fetcher:f.fetcher,bearer:'secret-test-token',projectId:'fcm-test'});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{processed:1,sent:1,failed:0,skipped:0});
 assert.equal(f.calls.length,1);
 const message=f.calls[0].payload.message;
 assert.equal(message.data.event_type,'bite_cancel_request');
 assert.equal(message.data.order_id,orderId);
 assert.equal(message.android.priority,'HIGH');
 assert.equal(message.notification,undefined,'native service must own data-only display');
 assert.equal(JSON.stringify(message).includes('customer-a'),false,'do not leak customer details');
 assert.equal(JSON.stringify(message).includes('Accept'),false);
 assert.equal(f.rows.bite_owner_cancellation_push_events[0].delivery_status,'sent');
});
test('resolved request is not pushed and is marked skipped',async()=>{
 const {dispatchCancellationPush}=await import(pathToFileURL(path.resolve('supabase/functions/bite-owner-push-dispatch/cancellation-push.mjs')));
 const f=fixture({request:{status:'Approved'}});
 const result=await dispatchCancellationPush({db:f.db,fetcher:f.fetcher,bearer:'secret',projectId:'fcm-test'});
 assert.equal(result.skipped,1);assert.equal(f.calls.length,0);
 assert.equal(f.rows.bite_owner_cancellation_push_events[0].delivery_status,'skipped');
});
test('foreign restaurant/customer order is rejected without any FCM send',async()=>{
 const {dispatchCancellationPush}=await import(pathToFileURL(path.resolve('supabase/functions/bite-owner-push-dispatch/cancellation-push.mjs')));
 const f=fixture({order:{customer_id:'foreign-customer'}});
 const result=await dispatchCancellationPush({db:f.db,fetcher:f.fetcher,bearer:'secret',projectId:'fcm-test'});
 assert.equal(result.skipped,1);assert.equal(f.calls.length,0);
});
test('new cancellation waits briefly for missing Owner device, then sends only while request remains Pending',async()=>{
 const {dispatchCancellationPush}=await import(pathToFileURL(path.resolve('supabase/functions/bite-owner-push-dispatch/cancellation-push.mjs')));
 const f=fixture({noDevices:true});
 const args={db:f.db,fetcher:f.fetcher,bearer:'secret',projectId:'fcm-test',clock:()=>new Date('2026-11-15T12:01:00Z')};
 const first=await dispatchCancellationPush(args);
 assert.equal(first.skipped,1);assert.equal(first.sent,0);
 assert.equal(f.calls.length,0);
 assert.equal(f.rows.bite_owner_cancellation_push_events[0].delivery_status,'retry');
 assert.match(f.rows.bite_owner_cancellation_push_events[0].last_error,/Awaiting Owner Partner device/);
 f.rows.bite_owner_push_devices.push({restaurant_id:restaurantId,user_id:'owner-a',fcm_token:'late-device-token',enabled:true,supports_order_actions:true});
 const second=await dispatchCancellationPush(args);
 assert.equal(second.sent,1);
 assert.equal(f.calls.length,1);
 assert.equal(f.rows.bite_owner_cancellation_push_events[0].delivery_status,'sent');
});
test('expired missing-device retry fails closed; resolved cancellation is never pushed',async()=>{
 const {dispatchCancellationPush}=await import(pathToFileURL(path.resolve('supabase/functions/bite-owner-push-dispatch/cancellation-push.mjs')));
 const expired=fixture({noDevices:true});
 await dispatchCancellationPush({db:expired.db,fetcher:expired.fetcher,bearer:'secret',projectId:'fcm-test',
  clock:()=>new Date('2026-11-15T12:26:00Z')});
 assert.equal(expired.rows.bite_owner_cancellation_push_events[0].delivery_status,'failed');
 assert.equal(expired.calls.length,0);
 const resolved=fixture({noDevices:true});
 const args={db:resolved.db,fetcher:resolved.fetcher,bearer:'secret',projectId:'fcm-test',
  clock:()=>new Date('2026-11-15T12:01:00Z')};
 await dispatchCancellationPush(args);
 resolved.rows.restaurant_customer_order_requests[0].status='Approved';
 resolved.rows.bite_owner_push_devices.push({restaurant_id:restaurantId,user_id:'owner-a',fcm_token:'late-token',enabled:true,supports_order_actions:true});
 await dispatchCancellationPush(args);
 assert.equal(resolved.calls.length,0);
 assert.equal(resolved.rows.bite_owner_cancellation_push_events[0].delivery_status,'skipped');
});
