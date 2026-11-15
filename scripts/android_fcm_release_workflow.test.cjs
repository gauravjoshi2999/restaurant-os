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
});
test('Signed APK build provides a fresh upgrade versionCode and runs on workflow file update',()=>{
 assert.match(yml,/default: '16'/);
 assert.equal((yml.match(/inputs\.version_code \|\| '16'/g)||[]).length,2);
 assert.match(yml,/push:[\s\S]*?branches: \[main\][\s\S]*?\.github\/workflows\/bite-android-signed-manual\.yml/);
 assert.match(yml,/Sign release APK with stable private key/);
 assert.match(yml,/matrix:[\s\S]*?app: \[customer, partner, admin\]/);
});
