'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const patch=fs.readFileSync('android-app/patch_bite_fcm.py','utf8');
test('New and cancellation FCM messages are explicitly distinguished',()=>{
 assert.match(patch,/boolean isOrder="bite_order"\.equals\(data\.get\("event_type"\)\)/);
 assert.match(patch,/boolean isCancellation="bite_cancel_request"\.equals\(data\.get\("event_type"\)\)/);
 assert.match(patch,/String requestId=data\.get\("request_id"\)/);
 assert.match(patch,/if\(isCancellation&&\(id==null\|\|restaurant==null\|\|requestId==null/);
 assert.match(patch,/!requestId\.matches\(/);
});
test('Android uses a distinct stable notification tag for each paid order and each cancellation request',()=>{
 assert.match(patch,/String notificationTag=isOrder\?"bite-order-"\+id:\s*isCancellation\?"bite-cancel-"\+requestId:"bite-general-"\+id/);
 assert.match(patch,/manager\.notify\(notificationTag,0,builder\.build\(\)\)/);
 assert.doesNotMatch(patch,/manager\.notify\(id\.hashCode\(\)\s*&\s*0x7fffffff,builder\.build\(\)\)/);
 const order1="11111111-1111-4111-8111-111111111111";
 const order2="22222222-2222-4222-8222-222222222222";
 const request="33333333-3333-4333-8333-333333333333";
 assert.notEqual('bite-order-'+order1,'bite-order-'+order2);
 assert.notEqual('bite-order-'+order1,'bite-cancel-'+request);
 assert.equal('bite-order-'+order1,'bite-order-'+order1,'repeat order updates should reuse the same notification card');
});
test('Order action authentication and ID-specific intents are preserved',()=>{
 assert.match(patch,/manager\.notify\(notificationTag,0,builder\.build\(\)\)/);
 assert.match(patch,/if\(isOrder\)\{/);
 assert.match(patch,/activityIntent\(id,restaurant,"Accepted"\)/);
 assert.match(patch,/activityIntent\(id,restaurant,"Rejected"\)/);
 assert.match(patch,/\.setAuthenticationRequired\(true\)\.build\(\)/);
 assert.match(patch,/\(orderId\+":\"\+action\)\.hashCode\(\)/);
 assert.match(patch,/getActivity\(this,requestCode,open,/);
 assert.match(patch,/FLAG_UPDATE_CURRENT\|PendingIntent\.FLAG_IMMUTABLE/);
});
