'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const customer=fs.readFileSync('customer.html','utf8');
const workflow=fs.readFileSync('.github/workflows/bite-android-signed-manual.yml','utf8');
const patch=path.resolve('android-app/patch_bite_google_oauth.py');

test('Android Customer Google OAuth requires native bridge and enabled provider',()=>{
 assert.match(customer,/BITE_CUSTOMER_WEBVIEW\?\{auth:\{flowType:'pkce'/);
 assert.match(customer,/window\.Capacitor\?\.Plugins\?\.BiteGoogleOAuth/);
 assert.match(customer,/customerGoogleProviderState==='enabled'&&\(!isEmbeddedCustomerWebView\(\)\|\|nativeReady\)/);
 assert.match(customer,/if\(isEmbeddedCustomerWebView\(\)&&!biteNativeGoogleOAuth\(\)\)return renderCustomerGoogleAuth\(\)/);
 assert.match(customer,/id="biteGoogleAppStatus"/);
});
test('Android uses outside browser with one-time PKCE code callback',()=>{
 assert.match(customer,/native\?'bitecustomer:\/\/oauth\/callback'/);
 assert.match(customer,/skipBrowserRedirect:true/);
 assert.match(customer,/await native\.open\(\{url:data\.url\}\)/);
 assert.match(customer,/await sb\.auth\.exchangeCodeForSession\(code\)/);
 assert.match(customer,/url\.protocol!=='bitecustomer:'\|\|url\.hostname!=='oauth'\|\|url\.pathname!=='\/callback'/);
});
test('normal web login remains same-origin; Customer signed build includes patch',()=>{
 assert.match(customer,/window\.location\.origin\+window\.location\.pathname/);
 assert.match(workflow,/BITE_VERSION_CODE: \$\{\{ inputs\.version_code \|\| '19' \}\}/);
 assert.match(workflow,/android-app\/patch_bite_google_oauth\.py/);
 assert.match(workflow,/Confirm Google provider is actually enabled for Customer signed APK/);
 assert.match(workflow,/settings\?\.external\?\.google!==true/);
 assert.match(workflow,/matrix\.app \}\}" = "customer"/);
});
function fixture(pkg){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bite-google-patch-'));
 const dir=path.join(tmp,'android/app/src/main/java',...pkg.split('.'));
 fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'MainActivity.java'),
  'package '+pkg+';\npublic class MainActivity extends BridgeActivity {\n @Override public void onCreate(android.os.Bundle savedInstanceState) {\n  registerPlugin(BiteOrderAlertsPlugin.class);\n  super.onCreate(savedInstanceState);\n }\n}\n');
 const manif=path.join(tmp,'android/app/src/main/AndroidManifest.xml');
 fs.mkdirSync(path.dirname(manif),{recursive:true});
 fs.writeFileSync(manif,'<manifest><application><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter></activity></application></manifest>');
 fs.writeFileSync(path.join(tmp,'android/app/build.gradle'),"dependencies {\n implementation 'androidx.appcompat:appcompat:1.6.1'\n}\n");
 return {tmp,dir,manif};
}
test('native patch installs Customer-only OAuth bridge, callback and package restrictions',()=>{
 const f=fixture('in.bite.restaurant');
 try{
  const run=cp.spawnSync('python3',[patch],{cwd:f.tmp,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const plugin=fs.readFileSync(path.join(f.dir,'BiteGoogleOAuthPlugin.java'),'utf8');
  const main=fs.readFileSync(path.join(f.dir,'MainActivity.java'),'utf8');
  const manifest=fs.readFileSync(f.manif,'utf8');
  const gradle=fs.readFileSync(path.join(f.tmp,'android/app/build.gradle'),'utf8');
  assert.match(plugin,/new CustomTabsIntent\.Builder\(\)\.build\(\)\.launchUrl\(getActivity\(\),u\)/);
  assert.match(plugin,/wedbgpybbgsszcmffoha\.supabase\.co/);
  assert.match(plugin,/code_challenge/);
  assert.match(plugin,/consumeRedirect/);
  assert.match(plugin,/pendingRedirect=null/);
  assert.match(main,/registerPlugin\(BiteGoogleOAuthPlugin\.class\)/);
  assert.match(main,/onNewIntent\(android\.content\.Intent intent\)/);
  assert.match(manifest,/android:scheme="bitecustomer"/);
  assert.match(manifest,/android:host="oauth"/);
  assert.match(manifest,/android:path="\/callback"/);
  assert.match(gradle,/androidx\.browser:browser:1\.8\.0/);
  const duplicate=cp.spawnSync('python3',[patch],{cwd:f.tmp,encoding:'utf8'});
  assert.notEqual(duplicate.status,0);
 }finally{fs.rmSync(f.tmp,{recursive:true,force:true});}
});
test('Android patch cannot alter Partner and Admin app',()=>{
 for(const pkg of ['in.bite.partner','in.bite.admin']){
  const f=fixture(pkg);
  try{
   const before=fs.readFileSync(path.join(f.dir,'MainActivity.java'),'utf8');
   const result=cp.spawnSync('python3',[patch],{cwd:f.tmp,encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
   assert.equal(fs.readFileSync(path.join(f.dir,'MainActivity.java'),'utf8'),before);
   assert.equal(fs.existsSync(path.join(f.dir,'BiteGoogleOAuthPlugin.java')),false);
  }finally{fs.rmSync(f.tmp,{recursive:true,force:true});}
 }
});
