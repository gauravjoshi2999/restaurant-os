'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const workflow=fs.readFileSync('.github/workflows/bite-android-signed-manual.yml','utf8');
const register=fs.readFileSync('supabase/functions/bite-owner-push-register/index.ts','utf8');
const dispatch=fs.readFileSync('supabase/functions/bite-owner-push-dispatch/index.ts','utf8');
test('FCM token registration requires authenticated owner membership matching restaurant',()=>{
 assert.match(register,/auth\.getUser\(/);
 assert.match(register,/eq\("user_id",user\.id\)/);
 assert.match(register,/eq\("restaurant_id",restaurantId\)/);
 assert.match(register,/eq\("role","owner"\)/);
 assert.match(register,/if\(!membership\)return respond\(\{error:/);
 assert.match(register,/onConflict:"fcm_token"/);
 assert.match(register,/action==="unregister"/);
});
test('Push dispatcher requires private secret and checks live paid-platform order before send',()=>{
 assert.match(dispatch,/BITE_PUSH_DISPATCH_SECRET/);
 assert.match(dispatch,/safeEqual\(configured,supplied\)/);
 assert.match(dispatch,/bite_verify_owner_push_dispatch/);
 assert.match(dispatch,/bite_verify_owner_push_dispatch_secret/);
 assert.match(dispatch,/db\.rpc\(verifier,\{candidate:supplied\}\)/);
 assert.match(dispatch,/FIREBASE_SERVICE_ACCOUNT_JSON/);
 assert.match(dispatch,/orders"\)/);
 assert.match(dispatch,/order\.status!=="Received"/);
 assert.match(dispatch,/order\.is_demo===true/);
 assert.match(dispatch,/finance\?\.payment_status!=="paid"/);
 assert.match(dispatch,/eq\("role","owner"\)/);
 assert.match(dispatch,/ids\.length!==1/);
 assert.match(dispatch,/service_role|SUPABASE_SERVICE_ROLE_KEY/);
 assert.doesNotMatch(dispatch,/customer_phone|customer_address|delivery_address/);
});
test('Partner token registration is voluntary, refreshes only for owner and revokes on logout',()=>{
 assert.match(html,/async function syncOwnerPushToken\(force=false\)/);
 assert.match(html,/access\.role!=='owner'/);
 assert.match(html,/auth\.session\.user\.id!==currentUser\.id/);
 assert.match(html,/bite-owner-push-register/);
 const logout=html.slice(html.indexOf('async function logout(){'),html.indexOf('async function loadCloudData()',html.indexOf('async function logout(){')));
 assert.match(logout,/action:'unregister'/);
 assert.match(logout,/push\.disable\(\)/);
 assert.match(logout,/sb\.auth\.signOut\(\)/);
});
test('Signed APK build never includes FCM without explicit Firebase config secret',()=>{
 assert.match(workflow,/patch_bite_fcm\.py/);
 assert.match(workflow,/BITE_FIREBASE_GOOGLE_SERVICES_JSON_BASE64:.*secrets\./);
 assert.doesNotMatch(workflow,/FIREBASE_SERVICE_ACCOUNT_JSON/);
});

const pushTest=fs.readFileSync('supabase/functions/bite-owner-push-test/index.ts','utf8');
test('Lock-screen push test is owner authenticated, rate-limited and contains no fake order',()=>{
 assert.match(pushTest,/auth\.getUser\(token\)/);
 assert.match(pushTest,/owners\.length!==1/);
 assert.match(pushTest,/owners\[0\]\.user_id!==user\.id/);
 assert.match(pushTest,/last_test_at/);
 assert.match(pushTest,/EdgeRuntime\.waitUntil/);
 assert.match(pushTest,/setTimeout\(resolve,8000\)/);
 assert.match(pushTest,/test notification/);
 assert.doesNotMatch(pushTest,/orders"\)/);
});
test('Overview exposes separate native sound test and real lock-screen FCM push test',()=>{
 const overview=html.split('<section class="page active" id="overview">')[1].split('<section class="page" id="orders">')[0];
 assert.match(overview,/id="ownerLockScreenPushTest"/);
 assert.match(overview,/onclick="testOwnerOrderAlert\(\)"/);
 assert.match(overview,/onclick="testOwnerLockScreenPush\(\)"/);
 assert.match(html,/sb\.functions\.invoke\('bite-owner-push-test'/);
});
