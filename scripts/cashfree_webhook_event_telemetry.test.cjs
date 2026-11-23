'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/cashfree-webhook/index.ts'),'utf8');

test('event-type telemetry runs only after signed raw payload and JSON validation',()=>{
 const signature=source.indexOf('if(!safeEqual(expected,signature))');
 const parsed=source.indexOf('event=JSON.parse(raw)');
 const logged=source.indexOf('BITE_CASHFREE_SIGNED_WEBHOOK_RECEIVED');
 assert.ok(signature>0&&parsed>signature&&logged>parsed,'unsigned webhooks must never create verified event evidence');
 assert.match(source,/const observedKind=REFUND_EVENTS\.has\(event\?\.type\)\?event\.type:/);
 assert.match(source,/event\?\.type==="PAYMENT_SUCCESS_WEBHOOK"/);
 assert.match(source,/"OTHER_SIGNED_EVENT"/);
 assert.match(source,/console\.info\("BITE_CASHFREE_SIGNED_WEBHOOK_RECEIVED",observedKind\)/);
});
test('event telemetry does not expose transaction identifiers, signatures, or raw bodies',()=>{
 const start=source.indexOf('const observedKind='),end=source.indexOf('if(REFUND_EVENTS.has(event?.type))',start);
 const audit=source.slice(start,end);
 assert.ok(audit.length>0);
 assert.doesNotMatch(audit,/console\.(?:log|info|warn|error)\([^\n]*(?:raw|signature|secret|order_id|refund_id|customer|body)/i);
});
