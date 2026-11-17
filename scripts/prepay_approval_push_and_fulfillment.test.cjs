'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const migration=fs.readFileSync('supabase/migrations/20261117140000_prepaid_owner_confirmation_push.sql','utf8');
const finish=fs.readFileSync('supabase/migrations/20261117135500_auto_accept_verified_approved_checkout.sql','utf8');
const dispatch=fs.readFileSync('supabase/functions/bite-owner-push-dispatch/index.ts','utf8');
const native=fs.readFileSync('android-app/patch_bite_fcm.py','utf8');
const owner=fs.readFileSync('index.html','utf8');
const intent='11111111-1111-4111-8111-111111111111';
const restaurant='22222222-2222-4222-8222-222222222222';
const customer='33333333-3333-4333-8333-333333333333';
const before='2026-11-17T08:00:00Z',until='2026-11-17T08:03:00Z';
function mock(overrides={}){
 const rows={
  bite_owner_approval_push_events:[{intent_id:intent,restaurant_id:restaurant,delivery_status:'queued',attempts:0,created_at:before}],
  bite_order_confirmations:[{intent_id:intent,restaurant_id:restaurant,customer_id:customer,state:'pending',expires_at:until,...overrides.confirmation}],
  bite_live_checkout_intents:[{id:intent,restaurant_id:restaurant,customer_id:customer,confirmation_required:true,status:'awaiting_payment',provider_order_id:null,provider_attempted_at:null,...overrides.checkout}],
  restaurant_members:[{user_id:'owner-1',restaurant_id:restaurant,role:'owner'}],
  bite_owner_push_devices:overrides.noDevices?[]:[{fcm_token:'token-1',user_id:'owner-1',restaurant_id:restaurant,enabled:true,supports_order_actions:overrides.oldApk!==true}]
 };
 const calls=[];
 const db={from(table){
  assert.ok(table in rows,'Unexpected table '+table);
  const filters=[];let change=null;
  const found=()=>rows[table].filter(row=>filters.every(([k,v])=>Array.isArray(v)?v.includes(row[k]):row[k]===v));
  const q={
   eq(k,v){filters.push([k,v]);return q},
   in(k,v){filters.push([k,v]);return q},
   select(){return q},order(){return q},
   limit(n){return Promise.resolve({data:found().slice(0,n),error:null})},
   update(v){change=v;return q},
   async maybeSingle(){
    const row=found()[0]||null;if(change&&row)Object.assign(row,change);
    return{data:row,error:null};
   },
   then(resolve,reject){return Promise.resolve({data:found(),error:null}).then(resolve,reject)}
  };
  return q;
 }};
 const fetcher=async(url,opts)=>{calls.push({url,payload:JSON.parse(opts.body)});return{ok:true,status:200}};
 const clock=()=>new Date('2026-11-17T08:01:00Z');
 return{rows,db,fetcher,calls,clock};
}
const dispatchApprovalPush=async args=>{
 const module=await import(pathToFileURL(path.resolve('supabase/functions/bite-owner-push-dispatch/approval-push.mjs')));
 return module.dispatchApprovalPush(args);
};
test('verified paid checkout finalizer auto-accepts ONLY owner-preapproved order',()=>{
 assert.match(finish,/BITE_PREPAY_APPROVAL_AUTO_ACCEPT_V1/);
 assert.match(finish,/state='approved'/);
 assert.match(finish,/reviewed_by is not null/);
 assert.match(finish,/status='Received'/);
 assert.match(finish,/set status='Accepted'/);
 assert.match(finish,/and o\.restaurant_id=v\.restaurant_id and o\.customer_id=v\.customer_id/);
 assert.match(finish,/Finalizer changed; do not patch without review/);
 assert.doesNotMatch(finish,/UPDATE public\.order_financials/i);
 assert.match(dispatch,/prepaidApproved/);
 assert.match(dispatch,/event_type:prepaidApproved\?"bite_payment_confirmed":"bite_order"/);
 assert.match(dispatch,/const nativeActions=device\.supports_order_actions===true&&!prepaidApproved/);
});
test('approval event outbox requires authenticated intent and private RLS',()=>{
 for(const snippet of [
 'bite_owner_approval_push_events(intent_id','ENABLE ROW LEVEL SECURITY',
 'REVOKE ALL ON TABLE public.bite_owner_approval_push_events FROM PUBLIC,anon,authenticated',
 'NEW.state <> \'pending\'','i.confirmation_required',
 'i.provider_order_id IS NULL','i.provider_attempted_at IS NULL',
 'bite_private.kick_owner_push_dispatch','bite-owner-approval-push-retry'
 ])assert.ok(migration.includes(snippet),snippet);
 assert.match(dispatch,/import \{dispatchApprovalPush\} from "\.\/approval-push\.mjs"/);
 assert.match(native,/boolean isApproval="bite_approval_request"/);
 assert.match(native,/isApproval\?"Approval":null/);
 assert.match(owner,/handlePendingNativeApprovalOpen/);
});
test('unpaid, still pending request notifies exact owner without PII or Accept action',async()=>{
 const f=mock();
 const res=await dispatchApprovalPush({db:f.db,fetcher:f.fetcher,bearer:'server-token',projectId:'project-qa',clock:f.clock});
 assert.deepEqual(JSON.parse(JSON.stringify(res)),{processed:1,sent:1,failed:0,skipped:0});
 assert.equal(f.calls.length,1);
 const m=f.calls[0].payload.message;
 assert.equal(m.data.event_type,'bite_approval_request');
 assert.equal(m.data.intent_id,intent);
 assert.equal(m.data.restaurant_id,restaurant);
 assert.equal(m.android.priority,'HIGH');
 assert.equal(m.notification,undefined,'native FCM renders data-only message');
 assert.ok(!JSON.stringify(m).includes(customer));
 assert.ok(!JSON.stringify(m).includes('customer_name'));
 assert.ok(!JSON.stringify(m).includes('Accept'));
 assert.equal(f.rows.bite_owner_approval_push_events[0].delivery_status,'sent');
});
test('expired, already approved, and foreign restaurant requests never notify',async()=>{
 for(const config of [
  {confirmation:{expires_at:'2026-11-17T07:59:00Z'}},
  {confirmation:{state:'approved'}},
  {checkout:{restaurant_id:'foreign-restaurant'}},
  {checkout:{confirmation_required:false}},
  {checkout:{provider_attempted_at:'2026-11-17T08:00:00Z'}}
 ]){
  const f=mock(config);
  const res=await dispatchApprovalPush({db:f.db,fetcher:f.fetcher,bearer:'server-token',projectId:'project-qa',clock:f.clock});
  assert.equal(res.sent,0);assert.equal(res.skipped,1);assert.equal(f.calls.length,0);
  assert.equal(f.rows.bite_owner_approval_push_events[0].delivery_status,'skipped');
 }
});
test('older installed Partner APK gets notification payload without lock-screen actions',async()=>{
 const f=mock({oldApk:true});
 const res=await dispatchApprovalPush({db:f.db,fetcher:f.fetcher,bearer:'server-token',projectId:'project-qa',clock:f.clock});
 assert.equal(res.sent,1);
 const m=f.calls[0].payload.message;
 assert.equal(m.notification.title,'Bite: New confirmation request');
 assert.equal(m.android.notification.channel_id,'bite_owner_new_orders_v1');
 assert.ok(!JSON.stringify(m).includes('customer-a'));
 assert.ok(!JSON.stringify(m).includes('Accept'));
});
