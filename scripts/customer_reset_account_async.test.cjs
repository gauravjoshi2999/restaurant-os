'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
function segment(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Code section missing: '+start);
 return html.slice(a,b);
}
const authRender=segment('function renderAuthMode(){','function setCustomerSession(session){');
const resetHandler=segment('async function sendCustomerPasswordResetLink(){','async function submitCustomerAuth(){');
const accountLoad=segment('let accountAddressRows=[];','function resetAddrForm(){');
const accountSupport=segment('async function loadCustomerSupportTickets(', "$('customerSupportForm')?.addEventListener");
const accountOpen=segment('async function openAccountView(){', "$('customerAddressForm').addEventListener");
const extractScript=()=>[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());

function dom(){
 const nodes=new Map();
 const get=id=>{
  if(!nodes.has(id))nodes.set(id,{
   id,value:'',textContent:'',innerHTML:'',placeholder:'',autocomplete:'',
   style:{color:''},
   classList:{
    hidden:false,
    toggle(cls,off){if(cls==='hidden')this.hidden=Boolean(off);},
    contains(cls){return cls==='hidden'?this.hidden:false;}
   }
  });
  return nodes.get(id);
 };
 return {nodes,$:get};
}

test('reset request is email only and has a distinct back-to-login action',()=>{
 const { $ }=dom();
 const ctx=vm.createContext({authMode:'login',$});
 vm.runInContext(authRender+';globalThis.render=renderAuthMode;',ctx);
 ctx.authMode='reset-request';ctx.render();
 assert.equal($('customerEmail').classList.hidden,false);
 assert.equal($('customerPassword').classList.hidden,true);
 assert.equal($('passwordLabel').classList.hidden,true);
 assert.equal($('customerPasswordConfirm').classList.hidden,true);
 assert.equal($('nameLabel').classList.hidden,true);
 assert.equal($('authBackWrap').classList.hidden,false);
 assert.equal($('authSubmit').textContent,'Send reset link');
 assert.equal($('authTitle').textContent,'Reset your password');
 ctx.authMode='login';ctx.render();
 assert.equal($('customerPassword').classList.hidden,false);
 assert.equal($('forgotPasswordWrap').classList.hidden,false);
 assert.equal($('authBackWrap').classList.hidden,true);
 ctx.authMode='recovery';ctx.render();
 assert.equal($('customerEmail').classList.hidden,true);
 assert.equal($('customerPassword').classList.hidden,false);
 assert.equal($('customerPasswordConfirm').classList.hidden,false);
 assert.equal($('authSubmit').textContent,'Password update karein');
});

test('invalid email never invokes provider and valid email only calls reset-link endpoint',async()=>{
 const { $ }=dom();
 const calls=[];
 const ctx=vm.createContext({
  $,window:{location:{origin:'https://bite.example',pathname:'/customer.html',search:'?restaurant=qa'}},
  BITE_DIRECT_MODE:false,
  sb:{auth:{resetPasswordForEmail:async(email,opts)=>{calls.push({email,opts});return{error:null};}}}
 });
 vm.runInContext(resetHandler+';globalThis.request=sendCustomerPasswordResetLink;',ctx);
 $('customerEmail').value='bad';
 await ctx.request();
 assert.equal(calls.length,0);
 assert.match($('authError').textContent,/sahi email/);
 $('customerEmail').value='  QA@example.com ';
 await ctx.request();
 assert.equal(calls.length,1);
 assert.equal(calls[0].email,'qa@example.com');
 assert.equal(calls[0].opts.redirectTo,'https://bite.example/customer.html');
 assert.match($('authError').textContent,/password reset link/i);
 assert.equal($('authSubmit').disabled,false);
 assert.equal($('authSubmit').textContent,'Send reset link');
});

test('provider email rate-limit remains a user-facing failure without claiming email was sent',async()=>{
 const { $ }=dom();
 const ctx=vm.createContext({
  $,window:{location:{origin:'https://bite.example',pathname:'/customer.html',search:''}},
  BITE_DIRECT_MODE:false,
  sb:{auth:{resetPasswordForEmail:async()=>({error:new Error('Email rate limit exceeded')})}}
 });
 vm.runInContext(resetHandler+';globalThis.request=sendCustomerPasswordResetLink;',ctx);
 $('customerEmail').value='qa@example.com';
 await ctx.request();
 assert.match($('authError').textContent,/too many reset requests/i);
 assert.doesNotMatch($('authError').textContent,/inbox mein bhej diya/i);
 assert.equal($('authSubmit').disabled,false);
});

test('stale saved addresses response never shows previous customer addresses after logout',async()=>{
 let release,started;
 const arrived=new Promise(r=>started=r);
 const waiting=new Promise(r=>release=r);
 const { $ }=dom();
 const ctx=vm.createContext({
  $,activeCustomerId:'customer-a',checkoutAddresses:[],
  sb:{from:()=>{const chain={select:()=>chain,order:()=>{started();return waiting;}};return chain;}}
 });
 vm.runInContext(accountLoad+';globalThis.load=loadAccountAddresses;',ctx);
 const running=ctx.load();
 await arrived;
 ctx.activeCustomerId=null;
 vm.runInContext('customerAccountViewSequence++',ctx);
 $('accountAddresses').innerHTML='Sign in to view saved addresses.';
 release({data:[{id:'old-secret',address_line:'Old customer address'}],error:null});
 await running;
 assert.equal($('accountAddresses').innerHTML,'Sign in to view saved addresses.');
 assert.equal(vm.runInContext('accountAddressRows.length',ctx),0);
});

test('stale support response does not inject old tickets or customer orders after logout',async()=>{
 let release,started;
 const pending=new Promise(r=>started=r);
 const waiting=new Promise(r=>release=r);
 const { $ }=dom();
 const ctx=vm.createContext({
  $,activeCustomerId:'customer-a',customerAccountViewSequence:5,
  sb:{from:()=>{const chain={select:()=>chain,order:()=>chain,limit:()=>{started();return waiting;}};return chain;},
   rpc:async()=>({data:[{id:'old-order',order_code:'OLD-ORDER'}],error:null})},
  safe:String,statusClass:String,formatOrderDate:String
 });
 ctx.biteAccountRequestActive=(sequence,userId)=>sequence===ctx.customerAccountViewSequence&&ctx.activeCustomerId===userId;
 vm.runInContext(accountSupport+';globalThis.load=loadCustomerSupportTickets;',ctx);
 const running=ctx.load();
 await pending;
 ctx.activeCustomerId=null;
 ctx.customerAccountViewSequence++;
 $('customerSupportList').innerHTML='Signed out';
 $('customerSupportOrder').innerHTML='No customer orders';
 release({data:[{id:'secret-ticket',subject:'Previous account message',category:'Complaint',message:'Private',status:'Open'}],error:null});
 await running;
 assert.equal($('customerSupportList').innerHTML,'Signed out');
 assert.equal($('customerSupportOrder').innerHTML,'No customer orders');
});

test('account profile fetch and address fetch are guarded before rendering',()=>{
 assert.match(accountOpen,/accountRequestId=\+\+customerAccountViewSequence/);
 assert.match(accountOpen,/if\(!biteAccountRequestActive\(accountRequestId,accountUserId\)\)return/);
 assert.match(accountOpen,/loadAccountAddresses\(accountRequestId,accountUserId\)/);
 assert.match(accountOpen,/loadCustomerSupportTickets\(accountRequestId,accountUserId\)/);
 assert.match(accountSupport,/if\(!biteAccountRequestActive\(sequence,userId\)\)return/);
 assert.match(html,/if\(activeCustomerId!==nextUserId\)\{\s*\+\+customerAccountViewSequence/);
 assert.match(html,/accountAddressRows=\[\];checkoutAddresses=\[\]/);
 assert.match(html,/event==='PASSWORD_RECOVERY'/);
 assert.match(html,/signInWithPassword/);
 assert.match(html,/sb\.auth\.updateUser\(\{password\}\)/);
 assert.equal((html.match(/resetPasswordForEmail/g)||[]).length,1);
 for(const js of extractScript()) assert.doesNotThrow(()=>new vm.Script(js));
});
