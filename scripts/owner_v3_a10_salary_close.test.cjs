'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const api=require('../assets/owner-v3-salary-closing.js');
const html=fs.readFileSync('index.html','utf8');
const engine=fs.readFileSync('assets/owner-v3-salary-closing.js','utf8');
const ui=fs.readFileSync('assets/owner-v3-salary-closing-ui.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261119173000_owner_a10_salary_closing.sql','utf8');
const css=fs.readFileSync('assets/owner-v3-salary-closing.css','utf8');
const r='11111111-1111-4111-8111-111111111111';
const e='22222222-2222-4222-8222-222222222222';
const person={id:e,restaurant_id:r,full_name:'Synthetic cook',salary_amount:10000,salary_period:'Monthly'};
const payments=[
 {id:'a',restaurant_id:r,employee_id:e,payment_date:'2026-09-02',period_month:'2026-09-01',payment_type:'Advance',amount:500},
 {id:'b',restaurant_id:r,employee_id:e,payment_date:'2026-10-20',period_month:'2026-10-01',payment_type:'Advance',amount:400},
 {id:'c',restaurant_id:r,employee_id:e,payment_date:'2026-11-02',period_month:'2026-10-01',payment_type:'Salary',amount:3000},
 {id:'d',restaurant_id:r,employee_id:e,payment_date:'2026-10-28',period_month:'2026-10-01',payment_type:'Bonus',amount:250},
 {id:'e',restaurant_id:r,employee_id:e,payment_date:'2026-10-21',period_month:'2026-10-01',payment_type:'Deduction',amount:100}
];
const old=[{id:'closing-sep',restaurant_id:r,employee_id:e,period_month:'2026-09-01',advance_applied:200}];
const scope={restaurantId:r,employeeId:e,month:'2026-10',today:'2026-11-19',payments,closings:old,employee:person};
test('A10: October sources stay separate from actual payment dates and deduction records',()=>{
 const report=api.summarize(scope);
 assert.equal(report.advances,90000);assert.equal(report.used,20000);
 assert.equal(report.available,70000);assert.equal(report.taggedPaid,325000);
 assert.equal(report.unassigned,0);
 assert.equal(api.lastMonth('2026-01-09'),'2025-12');
 assert.equal(api.validCompleted('2026-11','2026-11-19'),false);
});
test('A10: owner-reviewed calculation and exact advance cap',()=>{
 const report=api.summarize(scope);
 const x=api.proposal(report,{gross:10000,bonus:500,deduction:100,advance:600,note:'Agreed salary and deduction reviewed'});
 assert.equal(x.grossCents,1000000);assert.equal(x.advanceCents,60000);
 assert.equal(x.taggedPaidCents,325000);assert.equal(x.dueCents,655000);
 assert.throws(()=>api.proposal(report,{gross:10000,bonus:0,deduction:0,advance:701,note:'x'}),/advance/i);
 assert.throws(()=>api.proposal(report,{gross:10000,bonus:0,deduction:100,advance:0,note:''}),/deduction/i);
 assert.throws(()=>api.proposal(report,{gross:20,bonus:0,deduction:0,advance:0,note:'x'}),/lower/i);
});
test('A10: no cross-tenant records, invalid salary month or duplicated source accepted',()=>{
 assert.throws(()=>api.summarize({...scope,employee:{...person,restaurant_id:'other'}}),/mismatch/);
 assert.throws(()=>api.summarize({...scope,payments:[...payments,{...payments[0],id:'other',restaurant_id:'other'}]}),/mismatch/);
 assert.throws(()=>api.summarize({...scope,payments:[...payments,payments[0]]}),/duplicate/);
 assert.throws(()=>api.summarize({...scope,month:'2026-12'}),/mismatch/);
 assert.throws(()=>api.summarize({...scope,payments:[{...payments[0],amount:1.001}]}),/amount/);
});
test('A10: salary month without assignment blocks closing, but does not guess',()=>{
 const x=api.summarize({...scope,payments:[...payments,{...payments[2],id:'z',period_month:null,payment_date:'2026-10-10'}]});
 assert.equal(x.unassigned,1);
 assert.throws(()=>api.proposal(x,{gross:10000,bonus:0,deduction:0,advance:0,note:''}),/Unassigned/);
});
test('A10: approved closing immutable but due recomputes from newly recorded payments',()=>{
 const row={id:'oct',restaurant_id:r,employee_id:e,period_month:'2026-10-01',approved_gross:10000,approved_bonus:500,
  approved_deduction:100,advance_applied:600,approved_at:'2026-11-19'};
 const x=api.summarize({...scope,closings:[...old,row]});
 assert.equal(x.due,655000);assert.equal(x.available,10000);
 assert.throws(()=>api.proposal(x,{gross:10000,bonus:0,deduction:0,advance:0}),/already/);
 const y=api.summarize({...scope,closings:[...old,row],payments:[...payments,{...payments[2],id:'late',amount:1000}]});
 assert.equal(y.due,555000);
 const markup=api.summaryHtml(y);
 assert.match(markup,/Currently recorded amount due/);
 assert.match(markup,/approval/i);
});
test('A10: complete source pagination, owner-only scoped load and missing pages fail closed',async()=>{
 const calls=[];
 function fake(){
  return {from(name){calls.push(['from',name]);const data=name==='restaurant_employee_payments'?payments:old;
   return {select(){return this},eq(key,val){calls.push(['eq',key,val]);return this},order(){return this},
    range(a,b){return Promise.resolve({data:data.slice(a,b+1),error:null,count:data.length})}}}};
 }
 const x=await api.load({client:fake(),...Object.fromEntries(['restaurantId','employeeId','month','today','employee'].map(k=>[k,scope[k]]))});
 assert.equal(x.taggedPaid,325000);
 assert.ok(calls.some(c=>c[1]==='employee_id'&&c[2]===e));
 await assert.rejects(()=>api.fullTable(fake(),'restaurant_employee_payments',r,e,'payment_date',()=>false),/changed/);
 await assert.rejects(()=>api.fullTable(fake(),'restaurant_employee_payments',r,e,'payment_date',()=>true,1,2),/Too many/);
});
test('A10: zero direct payroll payments, tenant guard, confirmation, responsive UI and no Cashbook mutation',()=>{
 for(const k of ['hrA10Section','hrA10Month','hrA10Advance','hrA10Approval','hrA10Save',
   'BiteV3SalaryClosingUI','owner-v3-salary-closing.js?v=','owner-v3-salary-closing-ui.js?v='])
  assert.ok(html.includes(k),k);
 assert.match(ui,/getMemberships/);
 assert.match(ui,/crypto\?\.randomUUID/);
 assert.match(ui,/p_expected_available:report.available\/100/);
 assert.match(ui,/owner_close_employee_salary_month/);
 assert.match(ui,/confirmFn/);
 assert.doesNotMatch(engine,/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
 assert.doesNotMatch(sql,/insert into public\.restaurant_cashbook_entries/i);
 assert.match(sql,/salary_closings_owner_read/);
 assert.match(sql,/revoke all on public\.restaurant_employee_salary_closings/);
 assert.match(css,/@media\(max-width:430px\)/);
});

test('A10 exact salary source rejects missing count and invalid amounts',async()=>{
 for(const value of [true,false,[],{},' ','0x10',null,0.001])assert.equal(api.cents(value),null);
 const fake={from(){return{select(){return this},eq(){return this},order(){return this},range(){return Promise.resolve({data:[payments[0]],count:2})}}}};
 await assert.rejects(()=>api.fullTable(fake,'restaurant_employee_payments',r,e,'payment_date',()=>true),/Incomplete/);
});
