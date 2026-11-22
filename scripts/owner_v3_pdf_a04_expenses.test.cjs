'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
globalThis.BiteV3Period=require('../assets/owner-v3-period.js');
const exp=require('../assets/owner-v3-expenses.js');
const html=fs.readFileSync('index.html','utf8');
const hotel=fs.readFileSync('assets/owner-hospitality.js','utf8');
const css=fs.readFileSync('assets/owner-v3-expenses.css','utf8');
const source=fs.readFileSync('assets/owner-v3-expenses.js','utf8');
const today='2026-11-19';
const rows=[
 {id:'oct',expense_date:'2026-10-01',category:'Gas',title:'Cylinder',amount:100,payment_method:'Cash'},
 {id:'nov',expense_date:'2026-11-11',category:'Electricity',title:'Electricity',amount:400,payment_method:'UPI'},
 {id:'sep',expense_date:'2026-09-19',category:'Vegetables',title:'Vegetables',amount:50,payment_method:'Cash'}
];
test('A04 same tenant keeps selected period while switching tenant clears it',()=>{
 exp.reset();
 assert.deepEqual(exp.filter(rows,'owner-1:restaurant-1',today).map(x=>x.id),['nov']);
 const selected=exp.period('owner-1:restaurant-1',today);
 assert.equal(selected.mode,'month');
 assert.equal(selected.from,'2026-11-01');
 assert.deepEqual(exp.filter(rows,'owner-2:restaurant-2',today).map(x=>x.id),['nov']);
 assert.equal(exp.total(rows),550);
});
test('A04 historical expense date is not confused with receipt/payment date',()=>{
 const q=exp.filter([
  {expense_date:'2026-11-01',amount:80,method:'UPI'},
  {expense_date:'2026-12-01',amount:300,method:'Other'}
 ],'hotel:u1:p1',today);
 assert.equal(q.length,1);
 assert.equal(exp.total(q),80);
 assert.equal(exp.total([{amount:null},{amount:'NaN'},{amount:-20},{amount:35.51}]),null);
});
test('A04 existing restaurant table remains canonical write source',()=>{
 assert.match(html,/id="expenseV3Period"/);
 assert.match(html,/id="expenseV3Cards"/);
 assert.match(html,/id="expenseV3Status"/);
 assert.match(html,/BiteV3ExpenseView\?\.filter\(expenseRecords/);
 assert.match(html,/BiteV3ExpenseView\?\.renderRestaurant/);
 assert.match(html,/from\('restaurant_expenses'\)/);
 assert.match(html,/saveExpense\(\)/);
 assert.match(html,/BiteV3Period\?\.validDay\(date\)/);
 assert.match(html,/expenseDate'\)\.max=localDateInput\(\)/);
 assert.match(html,/owner-v3-expenses\.css\?v=20261119-a04-paid1/);
 assert.match(html,/owner-v3-expenses\.js\?v=20261122-a04-verified1/);
});
test('A04 Hotel reuses real property expense command without copying cashbook receipts',()=>{
 assert.match(hotel,/root\.BiteV3ExpenseView\?\.renderHotel/);
 assert.match(hotel,/if\(rendered\)return/);
 assert.match(hotel,/if\(type==='expense'\)\{action='expense';payload=/);
 assert.match(source,/data-hotel-form="expense"/);
 assert.match(source,/name="expense_date"/);
 assert.match(source,/recorded paid expense/i);
 assert.doesNotMatch(source,/\.(?:insert|upsert|update|delete|rpc)\(/);
});
test('A04 does not fake credit/pay-later or invent settlement movement',()=>{
 assert.match(source,/create an unpaid purchase in Purchases/);
 assert.match(source,/Do not save the same expense twice/);
 assert.match(source,/Later-payment date reconciliation is not yet available/);
 assert.match(source,/Supplier credit \/ Pay later cannot be posted here/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/@media\(max-width:430px\)/);
});

test('Expense totals validate exact paise and source identity before displaying or saving',()=>{
 assert.equal(exp.total([{amount:'0.10'},{amount:'0.20'}]),0.3);
 assert.equal(exp.total([]),0);
 for(const amount of [null,true,false,[],{},'',' ',Infinity,-10,1.001,'0x10'])assert.equal(exp.total([{amount}]),null);
 const scoped=rows.map(row=>({...row,restaurant_id:'r'}));
 assert.equal(exp.verifiedRecords(scoped,'r','restaurant_id'),true);
 for(const bad of [[...scoped,scoped[0]],[{...scoped[0],restaurant_id:'other'}],[{...scoped[0],expense_date:'2026-02-30'}],[{...scoped[0],amount:null}]])assert.equal(exp.verifiedRecords(bad,'r','restaurant_id'),false);
 assert.match(html,/count!==data.length\|\|!window.BiteV3ExpenseView\?\.verifiedRecords/);
});
