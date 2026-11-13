const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const dashboard=require('../assets/owner-dashboard.js');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/owner-home-finance.css','utf8');
const at=new Date('2026-11-14T08:00:00+05:30');
const make=(id,restaurant,channel,amount,status='Completed',date='2026-11-14T07:00:00+05:30',isDemo=false)=>({id,restaurant,channel,amount,status,createdAt:date,isDemo});
test('separates POS billed face value from website paid net and filters tenant, void, demo and dates',()=>{
 const orders=[
  make('pos1','r1','POS - Counter',320),
  make('pos2','r1','POS - Dine-in',80),
  make('void','r1','POS - Counter',700,'Cancelled'),
  make('demo','r1','POS - Counter',999,'Completed',undefined,true),
  make('other','r2','POS - Counter',888),
  make('old','r1','POS - Counter',200,'Completed','2026-11-13T06:00:00+05:30'),
  make('web','r1','Own Platform Website',174),
  make('unpaid','r1','Website',500),
 ];
 const financials=[{order_id:'web',payment_status:'paid',customer_payable_amount:174,refund_amount_actual:24},{order_id:'unpaid',payment_status:'pending',customer_payable_amount:500}];
 const data=dashboard.summarize({orders,financials,expenses:[{restaurant_id:'r1',expense_date:'2026-11-14',amount:40},{restaurant_id:'r2',expense_date:'2026-11-14',amount:777}]},'r1',at);
 assert.equal(data.todayPosBilled,400);
 assert.equal(data.todayPosBills,2);
 assert.equal(data.todaySales,150);
 assert.equal(data.todayExpenses,40);
 assert.equal(data.todayOrders.length,2);
});
test('POS face-value cannot be mislabelled cash received, settled or combined profit',()=>{
 assert.match(html,/id="ownerTodayPosBilled"/);
 assert.match(html,/id="ownerTodayPosBills"/);
 assert.match(html,/BITE ONLINE · PAID \(NET\)/);
 assert.match(html,/billed value, not payment received/);
 assert.match(html,/Daily Cashbook/);
 assert.match(html,/href="assets\/owner-home-finance.css"/);
 assert.match(css,/body\[data-role="owner"\]/);
});
