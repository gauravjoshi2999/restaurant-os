'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const moduleSource=fs.readFileSync('assets/owner-v3-staff-payment-safe-save.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const sql=fs.readFileSync('supabase/migrations/20261119184500_owner_a12_salary_payment_cap.sql','utf8');
const api=require('../assets/owner-v3-staff-payment-safe-save.js');
const restaurant='11111111-1111-4111-8111-111111111111';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const employee='33333333-3333-4333-8333-333333333333';
const payload={restaurant_id:restaurant,employee_id:employee,created_by:owner,
  payment_date:'2026-11-19',period_month:'2026-10-01',payment_type:'Salary',
  payment_method:'UPI',amount:6550,reference:'Bank reference',notes:'Real salary already paid'};
test('A12: validates tenant, payment date, exact salary period, actual method, and money precision',()=>{
 const x=api.normalize(payload);
 assert.equal(x.amount,6550);
 for(const bad of [
 {...payload,amount:0},{...payload,amount:1.001},{...payload,period_month:'2026-10-05'},
 {...payload,payment_date:'2026-02-30'},{...payload,payment_method:''},
 {...payload,payment_type:'Refund'},{...payload,restaurant_id:''}
 ])assert.throws(()=>api.normalize(bad));
});
test('A12: same insert ID is used after ambiguous network failure, so retry never creates another record',async()=>{
 let inserts=0,first=null;
 const client={from(table){assert.equal(table,'restaurant_employee_payments');
  return {insert(record){
    inserts++;if(!first)first={...record};
    assert.equal(record.id,first.id);
    return inserts===1?Promise.reject(Error('network interrupted')):
      Promise.resolve({error:{message:'duplicate key value violates unique constraint'}});
   },select(){return this},eq(){return this},maybeSingle(){return Promise.resolve({data:first,error:null})}};}};
 const a=await api.save({client,data:payload,stillCurrent:()=>true});
 assert.equal(a.ok,false);
 const b=await api.save({client,data:payload,stillCurrent:()=>true});
 assert.equal(b.ok,true);assert.equal(b.verified,true);
 assert.equal(inserts,2);assert.match(b.message,/No duplicate/);
});
test('A12: in-flight double click does not create duplicate inserts',async()=>{
 let unblock,number=0;
 const wait=new Promise(resolve=>{unblock=resolve});
 const client={from(){return{insert(){number++;return wait}}}};
 const a=api.save({client,data:{...payload,reference:'click lock'},stillCurrent:()=>true});
 const b=await api.save({client,data:{...payload,reference:'click lock'},stillCurrent:()=>true});
 assert.equal(b.busy,true);assert.equal(number,1);
 unblock({error:null});const saved=await a;
 assert.equal(saved.ok,true);assert.equal(number,1);
});
test('A12: reset or changed scope does not authorize a write',async()=>{
 api.reset();
 const c={from(){throw Error('must not query')}};
 const x=await api.save({client:c,data:payload,stillCurrent:()=>false});
 assert.equal(x.ok,false);
});
test('A12: original HR Save Payment uses source-verified single-flight module, not direct insert',()=>{
 const a=html.indexOf('async function saveHREmployeePayment(){');
 const b=html.indexOf("document.getElementById('hrRestaurant').addEventListener",a);
 const saving=html.slice(a,b);
 assert.match(html,/owner-v3-staff-payment-safe-save\.js\?v=20261119-a12-1/);
 assert.match(saving,/BiteOwnerSafeStaffPayment\.save/);
 assert.match(saving,/button\.disabled=true/);
 assert.match(saving,/result\.ok/);
 assert.match(saving,/access\.memberships/);
 assert.doesNotMatch(saving,/\.from\('restaurant_employee_payments'\)\.insert/);
 assert.match(sql,/new\.payment_type not in \('Salary','Bonus'\)/);
 assert.match(sql,/for update/);
 assert.match(sql,/new\.amount>v_available/);
 assert.doesNotMatch(sql,/INSERT INTO public\.restaurant_cashbook_entries/i);
 assert.doesNotMatch(moduleSource,/\.upsert\s*\(/);
});
