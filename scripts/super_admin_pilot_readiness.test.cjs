'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const api=require('../assets/super-admin-pilot-readiness.js');
const html=fs.readFileSync('index.html','utf8');
const owner=fs.readFileSync('assets/super-admin-workspace.js','utf8');
const css=fs.readFileSync('assets/super-admin-pilot-readiness.css','utf8');
const source=fs.readFileSync('assets/super-admin-pilot-readiness.js','utf8');

function client(data,fail=null){
 const calls=[];
 return {calls,from(table){
  calls.push(table);
  return {select(fields,options){
   assert.equal(fields,'id');assert.deepEqual(options,{count:'exact',head:true});
   const q={in(column,values){
     assert.equal(table,'bite_refund_jobs');assert.equal(column,'status');
     assert.deepEqual(values,['pending_approval','approved','processing','submitted']);
     return this;
   },then(ok){return Promise.resolve(fail===table?
    {count:null,error:{message:'permission denied'}}:{count:data[table],error:null}).then(ok)}};
   return q;
  }};
 }};
}
test('pilot source counts are head-only and only from established RLS tables',async()=>{
 const c=client({bite_provider_checks:0,restaurant_settlements:0,bite_refund_jobs:3});
 const d=await api.load(c,()=>true);
 assert.deepEqual(c.calls.sort(),['bite_provider_checks','bite_refund_jobs','restaurant_settlements']);
 assert.deepEqual([d.providerChecks,d.settlements,d.refundsAwaiting],[0,0,3]);
 assert.equal(d.bankSettlementVerified,false);
 assert.equal(d.restaurantPayoutVerified,false);
 assert.equal(d.authenticatedOwnerAccepted,false);
 assert.equal(d.androidDeviceAccepted,false);
 const content=api.render(d);
 assert.match(content,/Pilot Launch Readiness/);
 assert.match(content,/merchant bank credit not proven/);
 assert.match(content,/vendor bank payout not proven/);
 assert.match(content,/real Cashfree dashboard/);
 assert.match(content,/issues\/124/);
 assert.doesNotMatch(content,/Go Live|Ready to launch|Payment successful/);
});
test('zero source count is not interpreted as verified, and missing count rejects',async()=>{
 for(const invalid of [null,undefined,-1,1.4,'0']){
   const c=client({bite_provider_checks:invalid,restaurant_settlements:0,bite_refund_jobs:0});
   await assert.rejects(()=>api.load(c,()=>true),/Incomplete/);
 }
 assert.match(api.render({providerChecks:null,settlements:null,refundsAwaiting:null}),/Unverified/);
});
test('permission failure or stale Admin session fails closed',async()=>{
 const c=client({bite_provider_checks:0,restaurant_settlements:0,bite_refund_jobs:0},'bite_provider_checks');
 await assert.rejects(()=>api.load(c,()=>true),/Could not verify/);
 const d=client({bite_provider_checks:0,restaurant_settlements:0,bite_refund_jobs:0});
 await assert.rejects(()=>api.load(d,()=>false),/Admin session unavailable/);
 assert.deepEqual(d.calls,[]);
 let n=0;
 await assert.rejects(()=>api.load(d,()=>++n===1),/session changed/);
});
test('actual Super Admin Home wires the existing authenticated role guard',()=>{
 for(const text of ['super-admin-pilot-readiness.js?v=','super-admin-pilot-readiness.css?v='])
  assert.ok(html.includes(text));
 assert.match(owner,/BitePilotReadiness\?\.mount\?\./);
 assert.match(owner,/isCurrent:\(\)=>valid\(token\)&&current==='overview'/);
 assert.match(owner,/ctx\.sb/);
 assert.match(css,/@media\(max-width:390px\)/);
 assert.doesNotMatch(source,/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(/);
 assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|Cashfree.*POST/);
});
