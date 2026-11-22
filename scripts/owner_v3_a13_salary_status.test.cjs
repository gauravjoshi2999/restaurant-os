'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const api=require('../assets/owner-v3-salary-status.js');
const index=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/owner-v3-salary-status.css','utf8');
const src=fs.readFileSync('assets/owner-v3-salary-status.js','utf8');
const rid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const makeEmp=(id,name,date='2026-09-01')=>({id,restaurant_id:rid,joining_date:date,full_name:name,employee_code:'B-'+id,status:'Active'});
const employees=[makeEmp('a','A Paid'),makeEmp('b','B Partial'),makeEmp('c','C Unpaid'),makeEmp('d','D Adjusted'),
 makeEmp('e','E No Closing'),makeEmp('f','F Review'),makeEmp('g','G Joined Later','2026-11-01')];
const closing=(id,emp,gross,advance=0)=>({id,restaurant_id:rid,employee_id:emp,period_month:'2026-10-01',
 approved_gross:gross,approved_bonus:0,approved_deduction:0,advance_applied:advance,approved_at:'2026-11-04T10:00:00Z'});
const closings=[closing('c-a','a',10000),closing('c-b','b',10000),closing('c-c','c',10000),
 closing('c-d','d',500,500),closing('c-f','f',1000)];
const paid=(id,emp,amount,date='2026-11-08')=>({id,restaurant_id:rid,employee_id:emp,period_month:'2026-10-01',
 payment_date:date,payment_type:'Salary',amount});
const payments=[paid('p-a','a',10000),paid('p-b','b',3000),paid('p-e','e',2000),paid('p-f','f',2000)];
const args={restaurantId:rid,month:'2026-10',today:'2026-11-19',employees,closings,payments};
test('A13: verified salary board derives paid / partly paid / unpaid / adjusted / not closed / review without invented dues',()=>{
 const report=api.summarize(args);
 assert.equal(report.staffCount,6); // joined-after-month excluded
 assert.deepEqual(report.stats,{paid:1,partial:1,unpaid:1,adjusted:1,open:1,review:1});
 const byName=new Map(report.entries.map(e=>[e.employee.id,e]));
 assert.equal(byName.get('b').remaining,700000);
 assert.equal(byName.get('a').remaining,0);
 assert.equal(byName.get('e').remaining,null); // even though an unclosed salary entry exists
 assert.equal(byName.get('d').status,'adjusted');
 assert.equal(byName.get('f').status,'review');
 assert.equal(report.remainingCents,1700000); // partial 7000 plus unpaid 10000
 assert.equal(report.uncertainCount,1);
 const rendered=api.render(report);
 assert.match(rendered,/Partially paid/);
 assert.match(rendered,/Not closed/);
 assert.match(rendered,/Settled by adjustments/);
 assert.match(rendered,/₹17,000/);
 assert.match(rendered,/No approved closing/);
 assert.match(rendered,/Records needing review are excluded/);
});
test('A13: no closing never implies due, even when no payments exist',()=>{
 const x=api.summarize({...args,closings:[],payments:[]});
 assert.equal(x.approvedCount,0);
 assert.equal(x.remainingCents,0);
 assert.equal(x.stats.open,6);
 assert.equal(x.entries.every(e=>e.remaining===null),true);
});
test('A13: errors and unassigned salary payments do not produce false Paid status',()=>{
 const uncertain={id:'unassigned-a',restaurant_id:rid,employee_id:'a',payment_type:'Salary',amount:100,
  payment_date:'2026-10-10',period_month:null};
 const x=api.summarize({...args,unassigned:[uncertain]});
 assert.equal(x.stats.paid,0);
 assert.equal(x.stats.review,2);
 assert.ok(x.entries.find(e=>e.employee.id==='a').status==='review');
 assert.equal(x.remainingCents,1700000);
 assert.match(api.render(x),/no salary month assigned/);
 const future=api.summarize({...args,payments:[...payments.filter(x=>x.employee_id!=='a'),paid('future','a',10000,'2026-11-25')]});
 assert.equal(future.entries.find(e=>e.employee.id==='a').status,'review');
});
test('A13: tenant mixing, duplicates, impossible source data and mismatched periods fail closed',()=>{
 for(const input of [
  {...args,employees:[{...employees[0],restaurant_id:other}]},
  {...args,closings:[closings[0],closings[0]]},
  {...args,payments:[...payments,{...payments[0],restaurant_id:other,id:'otherpay'}]},
  {...args,payments:[...payments,{...payments[0],id:'odd',period_month:'2026-09-01'}]},
  {...args,payments:[...payments,{...payments[0],id:'odd',amount:0.001}]},
  {...args,closings:[{...closings[0],approved_deduction:10001}]},
  {...args,month:'2026-12'}
 ])assert.throws(()=>api.summarize(input));
 assert.equal(api.nextMonth('2026-12'),'2027-01-01');
});
test('A13: server-side restaurant and month filters and full source pagination are required',async()=>{
 const datasets={restaurant_employees:employees,restaurant_employee_salary_closings:closings,
  restaurant_employee_payments:payments};
 const calls=[];
 const client={from(table){calls.push(['from',table]);const active=[];
  return {select(){return this},eq(k,v){active.push(['eq',k,v]);calls.push(['eq',k,v]);return this},
   in(k,v){active.push(['in',k,v]);return this},
   is(k,v){active.push(['is',k,v]);return this},
   gte(k,v){active.push(['gte',k,v]);return this},
   lt(k,v){active.push(['lt',k,v]);return this},
   order(){return this},range(from,to){let rows=datasets[table];
    for(const [op,k,v] of active){
     if(op==='eq')rows=rows.filter(x=>x[k]===v);
     if(op==='in')rows=rows.filter(x=>v.includes(x[k]));
     if(op==='is')rows=rows.filter(x=>x[k]===v);
     if(op==='gte')rows=rows.filter(x=>x[k]>=v);
     if(op==='lt')rows=rows.filter(x=>x[k]<v);
    }
    return Promise.resolve({data:rows.slice(from,to+1),error:null,count:rows.length});
   }};
 }};
 const report=await api.load({client,restaurantId:rid,month:'2026-10',today:'2026-11-19'});
 assert.equal(report.stats.partial,1);
 assert.ok(calls.filter(c=>c[0]==='eq'&&c[1]==='restaurant_id'&&c[2]===rid).length===4);
 assert.ok(calls.filter(c=>c[0]==='eq'&&c[1]==='period_month'&&c[2]==='2026-10-01').length===2);
 await assert.rejects(()=>api.load({client,restaurantId:rid,month:'2026-10',today:'2026-11-19',isCurrent:()=>false}),/changed/);
});
test('A13: oversized/incomplete source and stale requests expose no fabricated money',async()=>{
 const row={...paid('z','a',1000)};
 const fake={from(){return{select(){return this},eq(){return this},order(){return this},
    range(){return Promise.resolve({data:[row],error:null,count:3})}}}};
 await assert.rejects(()=>api.pageAll({client:fake,table:'x',fields:'*',restaurantId:rid,
  isCurrent:()=>true,pageSize:1,maxRows:2}),/limit reached/);
});
test('A13: Owner UI, selected month, post-approval refresh and 320px layout wired; no money writes',()=>{
 for(const marker of ['id="hrV3SalaryStatusSection"','id="hrV3SalaryStatusMonth"','id="hrV3SalaryStatusResult"',
  'function loadHRSalaryStatus()','BiteV3SalaryStatus.load','refreshSalaryStatus:',
  'hrSalaryStatusVersion++','owner-v3-salary-status.js?v=','owner-v3-salary-status.css?v='])
  assert.ok(index.includes(marker),marker);
 assert.match(index,/access\.memberships\?\.some/);
 assert.match(fs.readFileSync('assets/owner-v3-salary-closing-ui.js','utf8'),/refreshSalaryStatus\?\.\(/);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.doesNotMatch(src,/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
});

test('A13 rejects incomplete source pages, missing counts and invalid salary amounts',async()=>{
 for(const value of [true,false,[],{},' ','0x10',null,0.001])assert.equal(api.cents(value),null);
 const fake=count=>({from(){return{select(){return this},eq(){return this},order(){return this},range(){return Promise.resolve({data:[payments[0]],count})}}}});
 for(const count of [null,2])await assert.rejects(()=>api.pageAll({client:fake(count),table:'x',fields:'*',restaurantId:rid}));
});
