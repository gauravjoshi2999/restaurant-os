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
function harness({authResponse,insertResponse,lookupResponse}={}){
 const values={
  customerSupportCategory:'Payment',
  customerSupportOrder:'',
  customerSupportSubject:'Money deducted but no order',
  customerSupportMessage:'I was charged and need payment status checked.'
 };
 const fields={},calls={session:0,insert:0,lookup:0,reload:0,reset:0,login:0,rows:[]};
 let randomSerial=0;
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
  crypto:{randomUUID:()=>`00000000-0000-4000-8000-${(++randomSerial).toString(16).padStart(12,'0')}`},
  $:id=>fields[id],
  sb:{
   auth:{getSession(){calls.session++;return authResponse?authResponse():Promise.resolve({data:{session:{user:{id:'customer-A'}}},error:null});}},
   from(table){assert.equal(table,'customer_support_tickets');return{
    insert(row){calls.insert++;calls.rows.push(row);return insertResponse?insertResponse(row,calls):Promise.resolve({error:null});},
    select(columns){assert.equal(columns,'id');const query={
     eq(){return query;},
     maybeSingle(){calls.lookup++;return lookupResponse?lookupResponse(calls.rows.at(-1),calls):Promise.resolve({data:null,error:null});}
    };return query;}
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
 assert.match(x.calls.rows[0].id,/^[0-9a-f-]{36}$/);
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
 assert.match(source,/biteSupportFindExisting/);
 assert.match(source,/crypto\.randomUUID/);
 assert.doesNotMatch(source,/Cashfree|payment_session|refund_jobs|service_role|update\(/);
});

test('lost response after successful server commit resolves only through owned ticket readback',async()=>{
 const x=harness({
  insertResponse:async()=>{throw new Error('Network disconnected after insert');},
  lookupResponse:async row=>({data:{id:row.id},error:null})
 });
 await x.submit();
 assert.equal(x.calls.insert,1);
 assert.equal(x.calls.lookup,1);
 assert.equal(x.calls.reset,1);
 assert.equal(x.calls.reload,1);
 assert.match(x.fields.customerSupportError.textContent,/bhej di gayi/);
});

test('retry after unknown response reuses the exact ticket primary key and reconciles duplicate',async()=>{
 let attempt=0;
 const x=harness({
  insertResponse:async()=>++attempt===1?Promise.reject(new Error('Timeout')):{error:{code:'23505'}},
  lookupResponse:async(row,calls)=>({data:calls.lookup>1?{id:row.id}:null,error:null})
 });
 await x.submit();
 assert.match(x.fields.customerSupportError.textContent,/status confirm nahi/);
 assert.equal(x.calls.reset,0);
 await x.submit();
 assert.equal(x.calls.insert,2);
 assert.equal(x.calls.rows[0].id,x.calls.rows[1].id,'never generate a new ticket id for retry of same draft');
 assert.equal(x.calls.reset,1);
 assert.equal(x.calls.reload,1);
 assert.match(x.fields.customerSupportError.textContent,/bhej di gayi/);
});

test('editing the draft after an uncertain insert generates a new UUID',async()=>{
 let attempt=0;
 const x=harness({insertResponse:async()=>++attempt===1?Promise.reject(new Error('Timeout')):{error:null}});
 await x.submit();
 const oldId=x.calls.rows[0].id;
 x.fields.customerSupportMessage.value+=' An updated detail.';
 await x.submit();
 assert.equal(x.calls.reset,1);
 assert.notEqual(x.calls.rows[1].id,oldId);
});

test('duplicate conflict without an owned matching row must never claim ticket success',async()=>{
 const x=harness({
  insertResponse:async()=>({error:{code:'23505'}}),
  lookupResponse:async()=>({data:{id:'other-customer-ticket'},error:null})
 });
 await x.submit();
 assert.equal(x.calls.reset,0);
 assert.equal(x.calls.reload,0);
 assert.match(x.fields.customerSupportError.textContent,/status confirm nahi/);
});
