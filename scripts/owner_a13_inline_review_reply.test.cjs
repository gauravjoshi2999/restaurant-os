'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('var ownerReviewVersion=0');
const end=html.indexOf('async function loadCustomerOrderRequestsWorkspace()',start);
const source=html.slice(start,end);
function fixture(rpc){
 const status={textContent:''},field={value:'Thank you for visiting!',disabled:false},button={disabled:false};
 const form={dataset:{ownerReviewId:'review1'},isConnected:true,elements:{response:field},querySelector(s){return s==='button[type="submit"]'?button:status;}};
 const calls=[],alerts=[];
 const context=vm.createContext({access:{role:'owner',restaurantId:'r1'},currentUser:{id:'u1'},document:{querySelectorAll:()=>[form],getElementById:()=>({replaceChildren(){}})},sb:{rpc:async(...args)=>{calls.push(args);return rpc(...args)}},alert:m=>alerts.push(m),form});
 vm.runInContext(source,context);
 vm.runInContext("ownerReviewScope=currentOwnerReviewScope();ownerReviewRows=[{id:'review1',status:'Published'}];loadRestaurantReviewsWorkspace=async()=>{}",context);
 return {context,calls,alerts,status,field,button,submit:()=>vm.runInContext("replyRestaurantReview({preventDefault(){},currentTarget:form})",context),draft:()=>vm.runInContext("ownerReviewDrafts.get('u1:r1:review1')",context)};
}
test('inline review reply requires explicit submit and contains public privacy guidance',()=>{
 assert.match(source,/onsubmit="replyRestaurantReview\(event\)"/);
 assert.match(source,/oninput="saveOwnerReviewDraft\(event\)"/);
 assert.match(source,/minlength="3" maxlength="500"/);
 assert.match(source,/Do not include guest IDs/);
 assert.doesNotMatch(source,/prompt\(/);
});
test('a failed or unconfirmed reply preserves the text and allows explicit retry',async()=>{
 let ok=false;
 const f=fixture(async()=>({data:ok,error:null}));
 await f.submit();
 assert.match(f.status.textContent,/Draft kept/);assert.equal(f.draft(),f.field.value);assert.equal(f.button.disabled,false);assert.equal(f.alerts.length,0);
 ok=true;await f.submit();assert.equal(f.draft(),undefined);assert.equal(f.alerts.length,1);
 assert.equal(f.calls[0][1].p_publish,true);
});
test('invalid whitespace reply and non-owner cannot write',async()=>{
 const f=fixture(async()=>({data:true,error:null}));f.field.value='  x ';
 await f.submit();assert.equal(f.calls.length,0);assert.match(f.status.textContent,/3–500/);
 f.context.access.role='super_admin';f.field.value='Valid reply';await f.submit();assert.equal(f.calls.length,0);
});
test('duplicate clicks and changed session cannot display stale reply confirmation',async()=>{
 let finish;
 const f=fixture(()=>new Promise(resolve=>{finish=resolve}));
 const pending=f.submit();await f.submit();assert.equal(f.calls.length,1);assert.equal(f.button.disabled,true);
 vm.runInContext("clearOwnerReviews();currentUser.id='u2';ownerReviewScope=currentOwnerReviewScope()",f.context);
 finish({data:true,error:null});await pending;assert.equal(f.alerts.length,0);
});
test('same-visit input is recorded and cleared on account switch',()=>{
 const f=fixture(async()=>({data:true,error:null}));
 vm.runInContext("saveOwnerReviewDraft({currentTarget:{form,value:'Draft response'}})",f.context);
 assert.equal(f.draft(),'Draft response');vm.runInContext("clearOwnerReviews()",f.context);assert.equal(f.draft(),undefined);
});
