'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('index.html','utf8');
const start=source.indexOf('function redactPlatformAuditDetails(');
const end=source.indexOf('async function loadAuditLogWorkspace(){',start);
assert.ok(start>=0&&end>start,'Audited Super Admin redaction helper exists');
const ctx={Object,Array,RegExp,String};
vm.runInNewContext(source.slice(start,end)+'\nthis.redact=redactPlatformAuditDetails;',ctx);
test('audit view hides banking, customer contact and credential values while retaining status metadata',()=>{
 const out=ctx.redact({
  old_status:'Open',new_status:'Resolved',response_changed:true,
  account_number:'1234567890123456',ifsc_code:'SBIN0001234',pan:'ABCDE1234F',
  customer_phone:'9999999999',order_status:'Completed',
  nested:{vendor_bank:{bank_account:'secret-value'},secret_key:'opaque',note:'Private reply',timestamp:'2026-11-19T10:00:00Z'}
 });
 const text=JSON.stringify(out);
 for(const secret of ['1234567890123456','SBIN0001234','ABCDE1234F','9999999999','secret-value','Private reply','opaque'])assert.ok(!text.includes(secret));
 assert.match(text,/Open/);
 assert.match(text,/Resolved/);
 assert.match(text,/Completed/);
 assert.match(text,/REDACTED/);
 assert.equal(out.response_changed,true);
});
test('deep and oversized entries cannot flood audit rendering',()=>{
 let deep={value:'leaf'};for(let i=0;i<12;i++)deep={child:deep};
 const out=ctx.redact({deep,values:Array.from({length:120},(_,i)=>({index:i}))});
 assert.match(JSON.stringify(out),/Nested details hidden/);
 assert.equal(out.values.length,30);
 assert.ok(ctx.redact({comment:'a'.repeat(500)}).comment.length<=180);
});
test('existing audit viewer uses redacted details and keeps Super Admin role restriction',()=>{
 const audit=source.slice(source.indexOf('async function loadAuditLogWorkspace(){'),source.indexOf('async function loadOwnerChangeRequestsWorkspace(){'));
 assert.match(audit,/access\.role!=='super_admin'/);
 assert.match(audit,/esc\(JSON\.stringify\(redactPlatformAuditDetails\(r\.details\|\|\{\}\)\)\)/);
 assert.doesNotMatch(audit,/esc\(JSON\.stringify\(r\.details\|\|\{\}\)\)/);
});
