'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const start=html.indexOf('function isCustomerAuthNetworkError(error){');
const end=html.indexOf('async function submitCustomerAuth(){',start);
assert.ok(start>=0&&end>start,'Expected auth diagnostic helpers');
const source=html.slice(start,end);
function fakeDOM(){
 const nodes=new Map();
 function $(id){
  if(!nodes.has(id))nodes.set(id,{
   textContent:'',style:{color:''},disabled:false,
   classList:{hidden:true,toggle(name,hidden){if(name==='hidden')this.hidden=Boolean(hidden);}}
  });
  return nodes.get(id);
 }
 return $;
}
test('network fetch errors are actionable; credentials are not exposed',()=>{
 const $=fakeDOM();
 const ctx=vm.createContext({$});
 vm.runInContext(source+';globalThis.describe=showCustomerAuthFailure;',ctx);
 ctx.describe(new TypeError('Failed to fetch'));
 assert.match($('authError').textContent,/server se connection/i);
 assert.equal($('authNetworkHelp').classList.hidden,false);
 assert.match($('authNetworkStatus').textContent,/Wi-Fi\/mobile data/);
 assert.doesNotMatch($('authError').textContent,/password|apikey/i);
 ctx.describe(new Error('Email rate limit exceeded'));
 assert.match($('authError').textContent,/Bahut requests/i);
 assert.equal($('authNetworkHelp').classList.hidden,true);
});
test('health check uses public health endpoint and never submits or retries signup',async()=>{
 const $=fakeDOM(),requests=[];
 const ctx=vm.createContext({
  $,SUPABASE_URL:'https://example.supabase.co',SUPABASE_KEY:'sb_publishable_test',
  AbortController:class{constructor(){this.signal={};}abort(){}},
  setTimeout:()=>1,clearTimeout:()=>{},
  fetch:async(url,options)=>{requests.push({url,options});return{ok:true,status:200};}
 });
 vm.runInContext(source+';globalThis.check=checkCustomerAuthConnection;',ctx);
 await ctx.check();
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,'https://example.supabase.co/auth/v1/health');
 assert.equal(requests[0].options.method,'GET');
 assert.equal(requests[0].options.headers.apikey,'sb_publishable_test');
 assert.match($('authNetworkStatus').textContent,/reachable/);
 assert.equal($('authNetworkCheck').disabled,false);
 const auth=html.slice(end,html.indexOf("setCustomerSession(result.data.session)",end));
 assert.equal((auth.match(/sb\.auth\.signUp\(/g)||[]).length,1);
 assert.doesNotMatch(source,/signUp\(/);
});
test('failed health probe gives device-level next steps without account mutation',async()=>{
 const $=fakeDOM();
 const ctx=vm.createContext({
  $,SUPABASE_URL:'https://example.supabase.co',SUPABASE_KEY:'sb_publishable_test',
  AbortController:class{constructor(){this.signal={};}abort(){}},
  setTimeout:()=>1,clearTimeout:()=>{},
  fetch:async()=>{throw new TypeError('Failed to fetch');}
 });
 vm.runInContext(source+';globalThis.check=checkCustomerAuthConnection;',ctx);
 await ctx.check();
 assert.match($('authNetworkStatus').textContent,/VPN ya Private DNS/);
 assert.equal($('authNetworkCheck').disabled,false);
});
