'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const yml=fs.readFileSync('.github/workflows/bite-android-signed-manual.yml','utf8');
const native=fs.readFileSync('android-app/patch_bite_fcm.py','utf8');

test('Signed Android workflow pulls latest reviewed Firebase patch from main, not stale scaffold',()=>{
 assert.match(yml,/ref: feature\/bite-android-apk/);
 assert.match(yml,/ref: main[\s\S]*?sparse-checkout: \|[\s\S]*?android-app\/patch_bite_fcm\.py/);
 assert.match(yml,/test -s \.\.\/bite-approved-brand\/android-app\/patch_bite_fcm\.py/);
 assert.match(yml,/cp \.\.\/bite-approved-brand\/android-app\/patch_bite_fcm\.py patch_bite_fcm\.py/);
 const copyIndex=yml.indexOf('cp ../bite-approved-brand/android-app/patch_bite_fcm.py patch_bite_fcm.py');
 const applyIndex=yml.indexOf('python3 patch_bite_fcm.py');
 assert.ok(copyIndex>=0&&applyIndex>copyIndex,'approved main patch must be copied before Firebase service generation');
 assert.match(native,/manager\.notify\(notificationTag,0,builder\.build\(\)\)/);
 assert.match(native,/public void openNotificationSettings\(PluginCall call\)/);
});
test('Signed APK build provides a fresh upgrade versionCode and runs on workflow file update',()=>{
 assert.match(yml,/default: '17'/);
 assert.equal((yml.match(/inputs\.version_code \|\| '17'/g)||[]).length,2);
 assert.match(yml,/push:[\s\S]*?branches: \[main\][\s\S]*?\.github\/workflows\/bite-android-signed-manual\.yml/);
 assert.match(yml,/Sign release APK with stable private key/);
 assert.match(yml,/matrix:[\s\S]*?app: \[customer, partner, admin\]/);
});

test('Partner release fails closed without Firebase secrets or generated native order receiver',()=>{
 assert.match(yml,/\[ "\$\{\{ matrix\.app \}\}" = "partner" \] && \[ -z "\$BITE_FIREBASE_GOOGLE_SERVICES_JSON_BASE64" \] && \[ -z "\$BITE_FIREBASE_GOOGLE_SERVICES_JSON" \]/);
 assert.match(yml,/Partner signed release blocked: Firebase Android config secret is missing/);
 assert.match(yml,/test -s android\/app\/google-services\.json/);
 assert.match(yml,/find android\/app\/src\/main\/java -name BiteFirebaseMessagingService\.java/);
 assert.match(yml,/grep -Fq 'manager\.notify\(notificationTag,0,builder\.build\(\)\);' "\$SERVICE_FILE"/);
 assert.match(yml,/grep -Fq 'isCancellation\?"bite-cancel-"\+requestId' "\$SERVICE_FILE"/);
 assert.match(yml,/grep -Fq 'activityIntent\(id,restaurant,"Accepted"\)' "\$SERVICE_FILE"/);
 assert.match(yml,/grep -Fq 'activityIntent\(id,restaurant,"Rejected"\)' "\$SERVICE_FILE"/);
 assert.match(yml,/grep -Fq '\.BiteFirebaseMessagingService' android\/app\/src\/main\/AndroidManifest\.xml/);
 assert.match(yml,/Partner v17 notification settings plugin method not compiled/);
 const checkIndex=yml.indexOf('Verified Partner v17 native FCM');
 const signingIndex=yml.indexOf('- name: Sign release APK with stable private key');
 assert.ok(checkIndex>=0 && signingIndex>checkIndex,'Partner native verification must happen before signing');
});
