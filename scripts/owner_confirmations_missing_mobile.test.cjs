'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const begin=html.indexOf('let ownerConfirmationsLoading=false,ownerConfirmationsLastRetry=0;');
const end=html.indexOf('function renderOrderBoard(){',begin);
assert.ok(begin>0&&end>begin,'Owner recovery module must remain next to Order renderer');
const recovery=html.slice(begin,end);

test('Missing approval script does not break Owner/Hotel render or permit fake approval',()=>{
 const call=html.slice(html.indexOf('function renderOrderBoard(){'),html.indexOf('const datedOrders=',html.indexOf('function renderOrderBoard(){')));
 assert.match(call,/typeof BiteOwnerConfirmations==='undefined'\?null:BiteOwnerConfirmations/);
 assert.match(call,/renderOwnerConfirmationUnavailable\(!ready\)/);
 assert.match(call,/if\(ready\)confirmations\.mount\(/);
 assert.match(call,/else retryOwnerConfirmations\(false\)/);
 assert.match(call,/else if\(typeof BiteOwnerConfirmations!=='undefined'\)/);
 assert.doesNotMatch(call,/(?:\{|;)BiteOwnerConfirmations\.mount\(/);
 assert.match(html,/owner-order-confirmations\.js\?v=20261118-confirm-mobile-recovery1/);
 assert.match(recovery,/same-origin asset URL/);
 assert.doesNotMatch(recovery,/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
});

test('Broken mobile script shows retry and recovers when the module loads; no payment actions',()=>{
 let notice=null,script=null,renderCalls=0;
 const board={before(item){notice=item}};
 const document={
  getElementById(id){if(id==='orderBoard')return board;if(id==='biteOwnerConfirmationsUnavailable')return notice;return null},
  createElement(tag){
   if(tag==='script')return {src:'',async:false,remove(){this.removed=true}};
   return {id:'',className:'',hidden:false,innerHTML:'',attributes:{},setAttribute(k,v){this.attributes[k]=v},querySelector(){return {addEventListener(event,fn){this.onClick=fn}}}};
  },
  head:{appendChild(item){script=item}}
 };
 const window={};
 const ctx=vm.createContext({document,window,access:{role:'owner',restaurantId:'r1'},currentUser:{id:'person'},Date,renderOrderBoard(){renderCalls++}});
 vm.runInContext(recovery,ctx);
 vm.runInContext('renderOwnerConfirmationUnavailable(true)',ctx);
 assert.equal(notice.hidden,false);
 assert.match(notice.innerHTML,/temporarily unavailable/);
 assert.match(notice.innerHTML,/pre-payment approvals cannot be reviewed/);
 vm.runInContext('retryOwnerConfirmations(false)',ctx);
 assert.match(script.src,/owner-order-confirmations\.js\?v=20261118-confirm-mobile-recovery2/);
 assert.equal(script.async,true);
 script.onerror();
 assert.equal(renderCalls,0,'a failed retry must never pretend the approvals are connected');
 assert.equal(notice.hidden,false);
 window.BiteOwnerConfirmations={mount(){}};
 vm.runInContext('retryOwnerConfirmations(true)',ctx);
 assert.equal(script,script);
 script.onload();
 assert.equal(notice.hidden,true);
 assert.equal(renderCalls,1);
 assert.equal(script.removed,true);
});

test('Switching owner during delayed script load cannot mutate the new account view',()=>{
 let script=null,called=0;
 const board={before(){}},notice={hidden:false};
 const document={
  getElementById(id){if(id==='orderBoard')return board;if(id==='biteOwnerConfirmationsUnavailable')return notice;return null},
  head:{appendChild(value){script=value}},
  createElement(){return {remove(){}}}
 };
 const window={};
 const ctx=vm.createContext({document,window,access:{role:'owner',restaurantId:'r1'},currentUser:{id:'old'},Date,renderOrderBoard(){called++}});
 vm.runInContext(recovery,ctx);
 vm.runInContext('retryOwnerConfirmations(false)',ctx);
 ctx.currentUser={id:'new'};ctx.access.restaurantId='r2';
 window.BiteOwnerConfirmations={mount(){}};
 script.onload();
 assert.equal(called,0);
 assert.equal(notice.hidden,false);
});
