'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const backend=fs.readFileSync('supabase/functions/bite-cashfree-operations/index.ts','utf8');
const start=backend.indexOf('if(body.action==="inspect_refund"){');
const end=backend.indexOf('if(body.action==="inspect_split"){',start);
assert.ok(start>0&&end>start,'Expected distinct, narrowly-scoped preview action');
const preview=backend.slice(start,end);

test('pending refund inspection is independent of the approve-or-execute guard',()=>{
 assert.match(backend,/\["reconcile","inspect_split","inspect_vendor","inspect_vendor_recon","inspect_refund","execute_refund","check_refund"\]/);
 assert.match(backend,/if\(body\.action!=="inspect_refund"&&/);
 assert.match(backend,/!job\.approved_by\|\|!job\.approved_at/);
 assert.match(backend,/Deno\.env\.get\("BITE_PROVIDER_REFUNDS_ENABLED"\)!=="true"/);
 assert.match(backend,/body\.confirm!=="EXECUTE APPROVED REFUND"/);
});

test('refund preview never posts a refund, writes a ledger or changes an approval',()=>{
 assert.match(preview,/provider\("\/orders\/"\+cfId\)/);
 assert.match(preview,/provider\("\/orders\/"\+cfId\+"\/refunds\/"\+/);
 assert.match(preview,/record\.r\.status===404/);
 assert.match(preview,/no_action_taken:true/);
 for(const disallowed of ['method:"POST"','.insert(','.update(','.upsert(','.delete(',
  '.rpc("bite_record_provider_refund"','execute_refund','refund_speed'])
  assert.equal(preview.includes(disallowed),false,'Disallowed operation in refund preview: '+disallowed);
});

test('provider result is only accepted for exact paid order and refund amount',()=>{
 for(const required of [
  'job.restaurant_id!==order.restaurant_id',
  'job.customer_id!==order.customer_id',
  'job.provider_refund_id',
  'Number(job.amount)>Number(intent.amount)',
  'financial?.payment_status!=="paid"',
  'exactMoney(financial.customer_payable_amount,intent.amount)',
  'collection.data?.order_status!=="PAID"',
  'collection.data?.order_id!==intent.provider_order_id',
  'cf.order_id!==intent.provider_order_id',
  'cf.refund_id!==job.provider_refund_id',
  'cf.refund_currency!=="INR"',
  '!exactMoney(cf.refund_amount,job.amount)'
 ])assert.ok(preview.includes(required),'Missing strict evidence guard: '+required);
});

test('404 and matching refund record never mean a refund was created or verified bank credit',()=>{
 assert.match(preview,/status:"NO_PROVIDER_REFUND_RECORD"/);
 assert.match(preview,/status:"PROVIDER_REFUND_RECORD_FOUND"/);
 assert.match(preview,/No refund record was found. Do not infer approval/);
 assert.match(preview,/No refund is approved, created, retried or bank-confirmed/);
 assert.ok(!preview.includes('bank_credit:"VERIFIED"'));
 assert.ok(!preview.includes('refund_approved:true'));
});

test('only authenticated platform admins may read any refund provider status',()=>{
 const auth=backend.slice(0,backend.indexOf('  let body:any'));
 assert.match(auth,/client\.auth\.getUser\(\)/);
 assert.match(auth,/client\.rpc\("is_platform_admin"\)/);
 assert.match(auth,/admin!==true/);
 assert.match(backend,/if\(!uuid\(body\.refund_id\)\)/);
});
