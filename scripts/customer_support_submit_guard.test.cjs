'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const html=fs.readFileSync('customer.html','utf8');
const start=html.indexOf('let biteSupportSubmitPending=false;');
const end=html.indexOf("\n$('accountAddresses').addEventListener",start);
assert.ok(start>=0&&end>start,'Support submit handler must exist on the Customer page');
const source=html.slice(start,end);
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function harness({authResponse,insertResponse}={}){
 const values={
  customerSupportCategory:'Payment',
  customerSupportOrder:'',
  customerSupportSubject:'Money deducted but no order',
  customerSupportMessage:'I was charged and need payment status checked.'
 };
 const fields={},calls={session:0,insert:0,reload:0,reset:0,login:0,rows:[]};
 let callback;
 for(const [name,value] of Object.entries(values))fields[name]={value};
 fields.customerSupportError={textContent:''};
 fields.customerSupportSubmit={disabled:false,textContent:'Send support request'};
 fields.customerSupportForm={
  addEventListener(kind,fn){if(kind==='submit')callback=fn;},
  reset(){calls.reset++;}
 };
 const ctx=vm.createContext({
  activeCustomerId:'customer-A',
  $:id=>fields[id],
  sb:{
   auth:{getSession(){calls.session++;return authResponse?authResponse():Promise.resolve({data:{session:{user:{id:'customer-A'}}},error:null});}},
   from(table){assert.equal(table,'customer_support_tickets');return{
    insert(row){calls.insert++;calls.rows.push(row);return insertResponse?insertResponse():Promise.resolve({error:null});}
   };}
  },
  async loadCustomerSupportTickets(){calls.reload++;},
  showAuth(){calls.login++;}
 });
 vm.runInContext(source,ctx);
 return {ctx,fields,calls,submit:()=>callback({preventDefault(){}})};
}
test('a fast second tap cannot create two tickets while the auth request is pending',async()=>{
 const auth=deferred(),x=harness({authResponse:()=>auth.promise});
 const first=x.submit(),second=x.submit();
 assert.equal(x.calls.session,1);
 assert.equal(x.fields.customerSupportSubmit.disabled,true,'must disable synchronously before the first await');
 auth.resolve({data:{session:{user:{id:'customer-A'}}},error:null});
 await Promise.all([first,second]);
 assert.equal(x.calls.insert,1);
 assert.equal(x.calls.reset,1);
 assert.equal(x.calls.reload,1);
 assert.equal(x.fields.customerSupportSubmit.disabled,false);
 assert.equal(x.calls.rows[0].customer_id,'customer-A');
});
test('invalid draft does not lock Submit or contact the backend',async()=>{
 const x=harness();
 x.fields.customerSupportSubject.value='a';
 await x.submit();
 assert.equal(x.calls.session,0);
 assert.equal(x.calls.insert,0);
 assert.equal(x.fields.customerSupportSubmit.disabled,false);
 x.fields.customerSupportSubject.value='Valid request subject';
 await x.submit();
 assert.equal(x.calls.insert,1);
});
test('account switch during auth check cannot send old customer support details',async()=>{
 const auth=deferred(),x=harness({authResponse:()=>auth.promise});
 const pending=x.submit();
 x.ctx.activeCustomerId='customer-B';
 auth.resolve({data:{session:{user:{id:'customer-A'}}},error:null});
 await pending;
 assert.equal(x.calls.insert,0);
 assert.equal(x.calls.reset,0);
 assert.equal(x.fields.customerSupportError.textContent,'');
 assert.equal(x.fields.customerSupportSubmit.disabled,false);
});
test('network uncertainty never claims ticket success and asks to check history before retry',async()=>{
 const x=harness({insertResponse:async()=>{throw Error('Network timeout after insert');}});
 await x.submit();
 assert.equal(x.calls.insert,1);
 assert.equal(x.calls.reset,0);
 assert.match(x.fields.customerSupportError.textContent,/My support requests check karein/);
 assert.doesNotMatch(x.fields.customerSupportError.textContent,/bhej di gayi/);
});
test('support guard does not change orders, Cashfree, refunds or Supabase permissions',()=>{
 assert.match(source,/biteSupportSubmitPending=true;button.disabled=true/);
 assert.match(source,/const \{data:sessionData,error:authError\}=await sb\.auth\.getSession\(\)/);
 assert.match(source,/\.from\('customer_support_tickets'\)\.insert/);
 assert.doesNotMatch(source,/Cashfree|payment_session|refund_jobs|service_role|update\(/);
});
