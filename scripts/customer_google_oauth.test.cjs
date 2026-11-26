'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const section=html.slice(
 html.indexOf("let customerGoogleProviderState='unknown'"),
 html.indexOf("function showAuth(mode='login')")
);
assert.ok(section.startsWith("let customerGoogleProviderState='unknown'"),'Google auth helper missing');
assert.match(html, /id="googleAuthBtn"[^>]+aria-label="Continue with Google"/);
assert.match(html, /id="googleAuthWrap" class="bite-google-auth hidden"/);
assert.match(html, /assets\/customer-google-auth\.css/);
assert.match(html, /\$\('googleAuthBtn'\)\.addEventListener\('click',signInCustomerWithGoogle\)/);
assert.match(html, /handleCustomerGoogleRedirectError\(\);let checkoutAddresses=/);
assert.match(html, /signInWithPassword\(/);
assert.match(html, /sb\.auth\.signUp\(/);
assert.doesNotMatch(html, /client_secret|service_role/i);
function setup({webview=false,direct=false,provider=true,nativeReady=null,cancelNative=false,noNativeSession=false}={}){
 const nodes=new Map();
 function $(id){
  if(!nodes.has(id))nodes.set(id,{
   disabled:false,textContent:'',value:'',style:{color:''},
   classList:{hidden:true,show:true,contains(name){return name==='show'&&this.show;},toggle(name,value){if(name==='hidden')this.hidden=Boolean(value);},remove(name){if(name==='show')this.show=false;}}
  });
  return nodes.get(id);
 }
 const calls=[],fetches=[];
 const window={
  location:{
   origin:'https://gauravjoshi2999.github.io',
   pathname:'/restaurant-os/customer.html',
   search:direct?'?direct=1&restaurant=262aaba7-f48b-4fa5-9ff6-b334ededca84':'',
   hash:''
  },
  history:{replaceState(_,__,url){calls.push({history:url});}}
 };
 if(nativeReady!==null)window.Capacitor={
  getPlatform:()=> 'android',isPluginAvailable:name=>name==='BiteCustomerGoogle',
  Plugins:{BiteCustomerGoogle:{
   availability:async()=>({ready:nativeReady}),
   signIn:async()=>{calls.push({native:true});if(cancelNative)throw Object.assign(new Error('Cancelled'),{code:'CANCELLED'});return {idToken:'mock-google-token',nonce:'mock-raw-nonce'};}
  }}
 };
 const ctx=vm.createContext({
  $,window,navigator:{userAgent:webview?'Mozilla/5.0 (Linux; Android 13; wv)':'Mozilla/5.0 Chrome/156'},
  authMode:'login',SUPABASE_URL:'https://project.supabase.co',SUPABASE_KEY:'sb_publishable_test',
  BITE_DIRECT_MODE:direct,
  URLSearchParams,
  fetch:async(url,opts)=>{fetches.push({url,opts});return {ok:true,json:async()=>({external:{google:provider}})};},
  sb:{auth:{signInWithOAuth:async(args)=>{calls.push({oauth:args});return{error:null};},signInWithIdToken:async(args)=>{calls.push({idToken:args});return {data:{session:noNativeSession?null:{user:{id:'test'}}},error:null};}}},
  isCustomerAuthNetworkError:()=>false,
  setCustomerSession:(session)=>{calls.push({session});ctx.completeUi(session);},
  hideAuth:()=>{$('authModal').classList.remove('show');calls.push({closed:true});},
  showAuth:(mode)=>{calls.push({showAuth:mode});}
 });
 const ui=html.slice(html.indexOf('function completeCustomerLoginUi(session)'),html.indexOf('function setCustomerSession(session)'));
 assert.ok(ui.startsWith('function completeCustomerLoginUi'));
 vm.runInContext(section+ui+';globalThis.completeUi=completeCustomerLoginUi;globalThis.load=checkCustomerGoogleProvider;globalThis.click=signInCustomerWithGoogle;globalThis.draw=renderCustomerGoogleAuth;globalThis.err=handleCustomerGoogleRedirectError;',ctx);
 vm.runInContext('biteRestoreCustomerAuthReturn=async()=>{globalThis.recordRestore();return true;}',ctx);
 ctx.recordRestore=()=>calls.push({restore:true});
 return{ctx,$,calls,fetches,window};
}
test('Google is hidden until verified enabled by Supabase, then shows in login and signup only',async()=>{
 const t=setup();
 assert.equal(t.$('googleAuthWrap').classList.hidden,true);
 await t.ctx.load();
 assert.equal(t.fetches.length,1);
 assert.equal(t.fetches[0].url,'https://project.supabase.co/auth/v1/settings');
 assert.equal(t.$('googleAuthWrap').classList.hidden,false);
 t.ctx.authMode='signup';t.ctx.draw();
 assert.equal(t.$('googleAuthWrap').classList.hidden,false);
 t.ctx.authMode='reset-request';t.ctx.draw();
 assert.equal(t.$('googleAuthWrap').classList.hidden,true);
 t.ctx.authMode='recovery';t.ctx.draw();
 assert.equal(t.$('googleAuthWrap').classList.hidden,true);
});
test('Google is not offered when disabled, and click never starts OAuth',async()=>{
 const t=setup({provider:false});
 await t.ctx.load();
 assert.equal(t.$('googleAuthWrap').classList.hidden,true);
 await t.ctx.click();
 assert.equal(t.calls.filter(x=>x.oauth).length,0);
});
test('Enabled Google click uses Supabase OAuth and a same-origin customer callback',async()=>{
 const t=setup();
 await t.ctx.load();
 await t.ctx.click();
 assert.equal(t.calls.filter(x=>x.oauth).length,1);
 const args=t.calls.find(x=>x.oauth).oauth;
 assert.equal(args.provider,'google');
 assert.equal(args.options.redirectTo,'https://gauravjoshi2999.github.io/restaurant-os/customer.html');
 assert.equal(t.$('googleAuthBtn').disabled,false);
});
test('Direct restaurant QR/login context is preserved through OAuth callback',async()=>{
 const t=setup({direct:true});
 await t.ctx.load();await t.ctx.click();
 const args=t.calls.find(x=>x.oauth).oauth;
 assert.equal(args.options.redirectTo,'https://gauravjoshi2999.github.io/restaurant-os/customer.html?direct=1&restaurant=262aaba7-f48b-4fa5-9ff6-b334ededca84');
});
test('Android embedded WebView does not expose a Google flow that Google blocks',async()=>{
 const t=setup({webview:true});
 await t.ctx.load();await t.ctx.click();
 assert.equal(t.fetches.length,0);
 assert.equal(t.calls.filter(x=>x.oauth).length,0);
 assert.equal(t.$('googleAuthWrap').classList.hidden,true);
});
test('OAuth error returns to email login; successful auth tokens remain untouched',()=>{
 const t=setup();
 t.window.location.hash='#access_token=opaque-secret';
 t.ctx.err();
 assert.equal(t.calls.length,0);
 t.window.location.hash='#error=access_denied&error_description=denied';
 t.ctx.err();
 assert.equal(t.calls.filter(x=>x.showAuth).length,1);
 assert.match(t.$('authError').textContent,/cancel/);
 assert.equal(t.calls.filter(x=>x.history).length,1);
});

test('Configured Customer native bridge uses ID token and nonce, never WebView OAuth',async()=>{
 const t=setup({webview:true,nativeReady:true});
 await t.ctx.load();
 assert.equal(t.$('googleAuthWrap').classList.hidden,false);
 await t.ctx.click();
 assert.equal(t.calls.filter(x=>x.native).length,1);
 assert.equal(t.calls.filter(x=>x.oauth).length,0);
 const payload=t.calls.find(x=>x.idToken).idToken;
 assert.equal(payload.provider,'google');
 assert.equal(payload.token,'mock-google-token');
 assert.equal(payload.nonce,'mock-raw-nonce');
 assert.equal(t.calls.filter(x=>x.session).length,1);
 assert.equal(t.$('authModal').classList.contains('show'),false);
 assert.equal(t.calls.filter(x=>x.restore).length,1);
 assert.equal(t.$('authSubmit').disabled,false);
});
test('Unconfigured APK bridge keeps Google hidden and email available',async()=>{
 const t=setup({webview:true,nativeReady:false});
 await t.ctx.load();await t.ctx.click();
 assert.equal(t.$('googleAuthWrap').classList.hidden,true);
 assert.equal(t.calls.length,0);
 assert.equal(t.$('authSubmit').disabled,false);
});
test('Native account selection cancellation never exchanges a token or starts OAuth',async()=>{
 const t=setup({webview:true,nativeReady:true,cancelNative:true});
 await t.ctx.load();await t.ctx.click();
 assert.equal(t.calls.filter(x=>x.idToken||x.oauth).length,0);
 assert.match(t.$('authError').textContent,/cancel/);
 assert.equal(t.$('authSubmit').disabled,false);
});

test('Authenticated session closes login or signup and clears credentials; repeat event is harmless',()=>{
 for(const mode of ['login','signup']){
  const t=setup();t.ctx.authMode=mode;
  t.$('customerPassword').value='old-password';t.$('customerPasswordConfirm').value='old-confirm';
  assert.equal(t.ctx.completeUi({user:{id:'test'}}),true);
  assert.equal(t.$('authModal').classList.contains('show'),false);
  assert.equal(t.$('customerPassword').value,'');
  assert.equal(t.$('customerPasswordConfirm').value,'');
  assert.equal(t.ctx.completeUi({user:{id:'test'}}),false);
  assert.equal(t.calls.filter(x=>x.closed).length,1);
 }
});
test('No valid session or password recovery must not dismiss the auth form',()=>{
 const t=setup();
 assert.equal(t.ctx.completeUi(null),false);
 assert.equal(t.ctx.completeUi({user:{}}),false);
 for(const mode of ['recovery','reset-request']){
  t.ctx.authMode=mode;
  assert.equal(t.ctx.completeUi({user:{id:'test'}}),false);
  assert.equal(t.$('authModal').classList.contains('show'),true);
 }
});
test('Native Google token without authenticated session keeps login open',async()=>{
 const t=setup({webview:true,nativeReady:true,noNativeSession:true});
 await t.ctx.load();await t.ctx.click();
 assert.equal(t.calls.filter(x=>x.session||x.restore).length,0);
 assert.equal(t.$('authModal').classList.contains('show'),true);
 assert.notEqual(t.$('authError').textContent,'');
});
test('Session change handler uses shared authenticated modal completion',()=>{
 assert.match(html,/function setCustomerSession\(session\)\{[^\n]+\n completeCustomerLoginUi\(session\);/);
});
