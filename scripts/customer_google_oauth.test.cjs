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
assert.match(html, /handleCustomerGoogleRedirectError\(\);biteInstallNativeGoogleCallback\(\);let checkoutAddresses=/);
assert.match(html, /signInWithPassword\(/);
assert.match(html, /sb\.auth\.signUp\(/);
assert.doesNotMatch(html, /client_secret|service_role/i);
function setup({webview=false,direct=false,provider=true,native=false}={}){
 const nodes=new Map();
 function $(id){
  if(!nodes.has(id))nodes.set(id,{
   disabled:false,textContent:'',style:{color:''},
   classList:{hidden:true,toggle(name,value){if(name==='hidden')this.hidden=Boolean(value);}}
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
 if(native)window.Capacitor={Plugins:{BiteGoogleOAuth:{open:async({url})=>{calls.push({nativeUrl:url})},consumeRedirect:async()=>({})}}};
 const ctx=vm.createContext({
  $,window,navigator:{userAgent:webview?'Mozilla/5.0 (Linux; Android 13; wv)':'Mozilla/5.0 Chrome/156'},
  authMode:'login',SUPABASE_URL:'https://project.supabase.co',SUPABASE_KEY:'sb_publishable_test',
  BITE_DIRECT_MODE:direct,BITE_CUSTOMER_WEBVIEW:webview,
  URLSearchParams,
  fetch:async(url,opts)=>{fetches.push({url,opts});return {ok:true,json:async()=>({external:{google:provider}})};},
  sb:{auth:{signInWithOAuth:async(args)=>{calls.push({oauth:args});return{data:{url:'https://project.supabase.co/auth/v1/authorize?provider=google'},error:null};}}},
  isCustomerAuthNetworkError:()=>false,
  showAuth:(mode)=>{calls.push({showAuth:mode});}
 });
 vm.runInContext(section+';globalThis.load=checkCustomerGoogleProvider;globalThis.click=signInCustomerWithGoogle;globalThis.draw=renderCustomerGoogleAuth;globalThis.err=handleCustomerGoogleRedirectError;',ctx);
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
test('Android APK bridge opens Google in external browser and receives PKCE return URL',async()=>{
 const t=setup({webview:true,native:true});
 await t.ctx.load();
 assert.equal(t.fetches.length,1);
 assert.equal(t.$('googleAuthWrap').classList.hidden,false);
 await t.ctx.click();
 const args=t.calls.find(x=>x.oauth).oauth;
 assert.equal(args.options.redirectTo,'bitecustomer://oauth/callback');
 assert.equal(args.options.skipBrowserRedirect,true);
 assert.equal(t.calls.filter(x=>x.nativeUrl).length,1);
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
