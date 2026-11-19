'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const s=require('../assets/owner-v3-staff-payments.js');
const html=fs.readFileSync('index.html','utf8');
const source=fs.readFileSync('assets/owner-v3-staff-payments.js','utf8');
const css=fs.readFileSync('assets/owner-v3-staff-payments.css','utf8');
const restaurant='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const employee='33333333-3333-4333-8333-333333333333';
const rows=[
 {id:'a',restaurant_id:restaurant,employee_id:employee,payment_date:'2026-11-04',period_month:'2026-10-01',payment_type:'Salary',amount:10000,payment_method:'UPI'},
 {id:'b',restaurant_id:restaurant,employee_id:employee,payment_date:'2026-11-05',period_month:'2026-10-01',payment_type:'Advance',amount:1500,payment_method:'Cash'},
 {id:'c',restaurant_id:restaurant,employee_id:employee,payment_date:'2026-11-07',period_month:'2026-11-01',payment_type:'Bonus',amount:700,payment_method:'Cash'},
 {id:'d',restaurant_id:restaurant,employee_id:employee,payment_date:'2026-11-08',period_month:null,payment_type:'Deduction',amount:100,payment_method:'Cash'}
];
function fakeClient(input){
 const calls=[],q={
  select(...args){calls.push(['select',...args]);return this;},
  eq(...args){calls.push(['eq',...args]);return this;},
  gte(...args){calls.push(['gte',...args]);return this;},
  lt(...args){calls.push(['lt',...args]);return this;},
  order(...args){calls.push(['order',...args]);return this;},
  range(start,end){calls.push(['range',start,end]);const period=calls.find(x=>x[1]==='period_month'),dateFrom=calls.find(x=>x[1]==='payment_date'&&x[0]==='gte');
   const matched=input.filter(x=>x.restaurant_id===restaurant&&
     (period?x.period_month===period[2]:x.payment_date>=dateFrom[2]&&x.payment_date<calls.find(c=>c[0]==='lt')[2]));
   return Promise.resolve({data:matched.slice(start,end+1),error:null});}
 };
 return {client:{from(table){calls.push(['from',table]);return q}},calls};
}
test('A09: salary month and actual payment month are distinct original-source queries',async()=>{
 const one=fakeClient(rows);
 const salary=await s.load({client:one.client,restaurantId:restaurant,month:'2026-10',mode:'salary'});
 assert.equal(salary.count,2);
 assert.equal(salary.totals.Salary,1000000);
 assert.equal(salary.totals.Advance,150000);
 assert.ok(one.calls.some(x=>x[0]==='eq'&&x[1]==='period_month'&&x[2]==='2026-10-01'));
 const two=fakeClient(rows);
 const paid=await s.load({client:two.client,restaurantId:restaurant,month:'2026-11',mode:'paid'});
 assert.equal(paid.count,4);
 assert.equal(paid.totals.Bonus,70000);
 assert.equal(paid.totals.Deduction,10000);
 assert.ok(two.calls.some(x=>x[0]==='gte'&&x[1]==='payment_date'&&x[2]==='2026-11-01'));
 assert.ok(two.calls.some(x=>x[0]==='lt'&&x[1]==='payment_date'&&x[2]==='2026-12-01'));
});
test('A09: records keep exact amounts and no inferred salary due or duplicate cashbook write',()=>{
 const r=s.summarize(rows,{restaurantId:restaurant,month:'2026-11',mode:'paid'});
 const display=s.html(r,[{id:employee,full_name:'Test employee'}]);
 assert.match(display,/Test employee/);
 assert.match(display,/Salary month and actual payment date may differ/);
 assert.match(display,/Deduction is a recorded adjustment/);
 assert.match(display,/100/);
 assert.doesNotMatch(source,/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
});
test('A09: date rollover, invalid dates, cross-tenant and duplicates fail closed',()=>{
 assert.equal(s.nextMonth('2026-12'),'2027-01-01');
 assert.throws(()=>s.nextMonth('2026-13'));
 assert.throws(()=>s.summarize([{...rows[0],restaurant_id:other}],{restaurantId:restaurant,month:'2026-11',mode:'paid'}));
 assert.throws(()=>s.summarize([rows[0],rows[0]],{restaurantId:restaurant,month:'2026-11',mode:'paid'}));
 assert.throws(()=>s.summarize([{...rows[0],amount:0}],{restaurantId:restaurant,month:'2026-11',mode:'paid'}));
 assert.throws(()=>s.summarize([{...rows[0],payment_date:'2026-02-30'}],{restaurantId:restaurant,month:'2026-02',mode:'paid'}));
});
test('A09: missing complete report does not fabricate totals',async()=>{
 const {client}=fakeClient(rows);
 await assert.rejects(()=>s.load({client,restaurantId:restaurant,month:'2026-11',mode:'paid',isCurrent:()=>false}));
 const {client:short}=fakeClient(rows);
 await assert.rejects(()=>s.load({client:short,restaurantId:restaurant,month:'2026-11',mode:'paid',pageSize:1,maxRows:2}));
});
test('A09: HR dashboard is wired only for Owner, resets scope and is responsive',()=>{
 for(const x of ['id="hrV3PaymentStatement"','id="hrV3PaymentMonth"','id="hrV3PaymentMode"','function loadHRPaymentStatement()',
  "access.role==='owner'?'block':'none'",'BiteV3StaffPayments.load','hrPaymentStatementVersion++',
  'owner-v3-staff-payments.js?v=','owner-v3-staff-payments.css?v='])assert.ok(html.includes(x),x);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.match(html,/Never calculate the payment KPI from the latest-300 truncated history/);
});
