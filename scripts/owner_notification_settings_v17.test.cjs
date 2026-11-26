'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const page=fs.readFileSync('index.html','utf8');
const android=fs.readFileSync('android-app/patch_bite_fcm.py','utf8');
const workflow=fs.readFileSync('.github/workflows/bite-android-signed-manual.yml','utf8');
const settings=page.slice(page.indexOf('<section class="page" id="settings">'),page.indexOf('<div class="card owner-profile-settings">'));
const notificationFn=page.slice(page.indexOf('function openOwnerNotificationSoundSettings(){'),page.indexOf('async function prepareOwnerOrderNotifications(){'));
test('Owner Settings removes unintended list marker and keeps expandable notification options',()=>{
 assert.match(settings,/<details class="card" id="ownerAlertPreferences"/);
 assert.match(settings,/<summary style="font-weight:750;font-size:15px">🔔 Order notification preferences<\/summary>/);
 assert.doesNotMatch(settings,/list-style:auto/);
 assert.match(page,/#ownerAlertPreferences>summary::-webkit-details-marker\{display:none\}/);
 assert.match(page,/#ownerAlertPreferences>summary::marker\{content:""\}/);
});
test('Push health and actual server-only lock-screen test are accessible from settings',()=>{
 assert.equal((page.match(/id="ownerLockScreenPushTest"/g)||[]).length,1);
 assert.match(settings,/id="ownerPushHealthButton"/);
 assert.match(settings,/onclick="testOwnerLockScreenPush\(\)"/);
 assert.match(page,/async function testOwnerLockScreenPush\(\)/);
 assert.match(page,/sb\.functions\.invoke\('bite-owner-push-test'/);
 assert.match(page,/if\(data\?\.scheduled!==true\)/);
});
test('Settings button opens OS via native bridge, or gives short in-card instructions without false APK claims',()=>{
 assert.match(settings,/id="ownerNotificationSettingsHint"/);
 assert.match(notificationFn,/native\?\.openNotificationSettings/);
 assert.match(notificationFn,/native\.openNotificationSettings\(\)\.catch/);
 assert.match(notificationFn,/hint\.textContent='Android Settings/);
 assert.match(notificationFn,/hint\.hidden=false/);
 assert.doesNotMatch(notificationFn,/Partner APK update karein|showOrderLiveToast/);
});
test('Native plugin takes the owner directly to order notification channel, with device-settings fallback',()=>{
 assert.match(android,/@CapacitorPlugin\(name="BiteOwnerPush"\)/);
 assert.match(android,/public void openNotificationSettings\(PluginCall call\)/);
 assert.match(android,/Settings\.ACTION_CHANNEL_NOTIFICATION_SETTINGS/);
 assert.match(android,/Settings\.EXTRA_APP_PACKAGE/);
 assert.match(android,/Settings\.EXTRA_CHANNEL_ID,"bite_owner_new_orders_v1"/);
 assert.match(android,/Settings\.ACTION_APPLICATION_DETAILS_SETTINGS/);
 assert.match(android,/call\.resolve\(\);/);
 assert.match(workflow,/default: '19'/);
 assert.match(workflow,/matrix\.app == 'customer' && '19' \|\| '18'/);
 assert.match(workflow,/Partner v18 notification settings plugin method not compiled/);
});
