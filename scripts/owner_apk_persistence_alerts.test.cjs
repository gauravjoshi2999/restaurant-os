'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const workflow=fs.readFileSync('.github/workflows/bite-android-signed-manual.yml','utf8');
test('Owner overview remains clean; sound controls live only in collapsed settings',()=>{
 assert.equal((html.match(/id="orderSoundToggle"/g)||[]).length,1);
 assert.equal((html.match(/id="ownerPriorityOrders"/g)||[]).length,1);
 const overview=html.split('<section class="page active" id="overview">')[1].split('<section class="page" id="orders">')[0];
 const settings=html.split('<section class="page" id="settings">')[1].split('</details>')[0];
 assert.doesNotMatch(overview,/id="orderSoundToggle"|Test alert|Test lock-screen push/);
 assert.match(settings,/<details class="card" id="ownerAlertPreferences"/);
 assert.match(settings,/id="orderSoundToggle"/);
 assert.match(settings,/id="ownerNotificationSoundSettings"/);
 const orders=html.slice(html.indexOf('id="orderLiveState"'),html.indexOf('id="orderStatusTabs"'));
 assert.doesNotMatch(orders,/id="orderSoundToggle"/);
});
test('Owner login persists in localStorage, returns to cached session and does not sign out on connection errors',()=>{
 assert.match(html,/persistSession:true,autoRefreshToken:true/);
 assert.match(html,/async function retrySavedOwnerSession/);
 assert.match(html,/id="authSessionRetry"/);
 const auth=html.slice(html.indexOf('async function activateSession(user)'),html.indexOf('async function loadAccessContext()'));
 assert.doesNotMatch(auth,/sb\.auth\.signOut\(/);
 assert.doesNotMatch(auth,/currentUser=null/);
 assert.match(auth,/Login saved hai/);
 const boot=html.slice(html.indexOf('(async()=>{\n let session=null,restoreError=null'),html.indexOf('</script>',html.indexOf('(async()=>{\n let session=null,restoreError=null')));
 assert.match(boot,/for\(let attempt=0;attempt<3;attempt\+\+\)/);
});
test('New live owner order sends native notification only for the current mapped restaurant',()=>{
 assert.match(html,/function sendOwnerOrderNotification\(order,restaurant\)/);
 assert.match(html,/order\.restaurant!==access\.restaurantId/);
 assert.match(html,/access\.role!=='owner'/);
 assert.match(html,/notifyOrder\(\{orderId:String\(order\.id\),title,body\}\)/);
 assert.match(html,/showOrderLiveToast\('🛎️ Naya order mila! '.+?sendOwnerOrderNotification\(order,rest\)/s);
});
test('Android APK build does not wipe session cookies and installs native notification bridge',()=>{
 assert.match(workflow,/python3 patch_bite_native\.py/);
 assert.doesNotMatch(workflow,/webView\.clearCache\(true\)/);
 assert.match(workflow,/BITE_VERSION_CODE:.*\|\| '15'/);
 assert.match(workflow,/Sign release APK with stable private key/);
});
