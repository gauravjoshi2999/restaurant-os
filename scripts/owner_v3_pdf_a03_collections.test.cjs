'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const collections=require('../assets/owner-v3-collections.js');
const accounts=fs.readFileSync('assets/owner-hotel-accounts.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/owner-v3-collections.css','utf8');
const id='123e4567-e89b-12d3-a456-426614174000';
const journal=[
 {id,day:'2026-10-01',source_type:'order_payment',category:'Order payment',direction:'in',method:'Cash',amount:500,description:'POS-001'},
 {id:'123e4567-e89b-12d3-a456-426614174001',day:'2026-10-01',source_type:'customer_ledger_payment',category:'Customer collection',direction:'in',method:'UPI',amount:90},
 {id:'123e4567-e89b-12d3-a456-426614174002',day:'2026-10-01',source_type:'folio',category:'advance',direction:'in',method:'Bank Transfer',amount:350},
 {id:'123e4567-e89b-12d3-a456-426614174003',day:'2026-10-01',source_type:'folio',category:'deposit_hold',direction:'in',method:'Cash',amount:400},
 {id:'123e4567-e89b-12d3-a456-426614174004',day:'2026-10-01',source_type:'daybook',category:'opening',direction:'in',method:'UPI',amount:700},
 {id:'123e4567-e89b-12d3-a456-426614174005',day:'2026-10-01',source_type:'daybook',category:'transfer_in',direction:'in',method:'Cash',amount:800},
 {id:'123e4567-e89b-12d3-a456-426614174006',day:'2026-10-01',source_type:'daybook',category:'income',direction:'in',method:'Cash',amount:60},
 {id:'123e4567-e89b-12d3-a456-426614174007',day:'2026-10-01',source_type:'property_expense',category:'Expense',direction:'out',method:'Cash',amount:120},
 {id:'123e4567-e89b-12d3-a456-426614174008',day:'2026-10-01',source_type:'folio',category:'refund',direction:'out',method:'UPI',amount:50},
 {id:'123e4567-e89b-12d3-a456-426614174009',day:'2026-10-01',source_type:'daybook',category:'salary_expense',direction:'noncash',method:'Non-cash',amount:999},
 {id:'123e4567-e89b-12d3-a456-426614174010',day:'2026-10-02',source_type:'order_payment',category:'Order payment',direction:'in',method:'Cash',amount:180},
 {id:'123e4567-e89b-12d3-a456-426614174011',day:'2026-10-01',source_type:'order_payment',category:'Order payment',direction:'in',method:'Cashfree',amount:245}
];
test('A03: received is posted receipt, not deposits, transfers, opening or salary expense',()=>{
 const all=collections.summarize(journal);
 assert.equal(all.received,1180);
 assert.equal(all.paid,170);
 assert.equal(all.receiptCount,5);
 assert.equal(all.paymentCount,2);
 assert.equal(all.excludedCount,4);
 assert.equal(collections.type(journal[3]),'other');
 assert.equal(collections.type(journal[9]),'noncash');
});
test('A03: method, date and source filters preserve actual transaction date',()=>{
 const cash=collections.summarize(journal,'cash','2026-10-01');
 assert.equal(cash.received,560);
 assert.equal(cash.paid,120);
 const bank=collections.summarize(journal,'bank','2026-10-01');
 assert.equal(bank.received,440);
 assert.equal(bank.paid,50);
 const khata=collections.summarize(journal,'all','2026-10-01','customer_ledger_payment');
 assert.equal(khata.received,90);
 assert.equal(khata.entries.length,1);
 const gateway=collections.summarize(journal,'gateway','2026-10-01');
 assert.equal(gateway.received,0);
 assert.equal(gateway.entries.length,1);
 assert.equal(gateway.excludedCount,1,'Cashfree pending settlement is not money received');
});
test('A03: row contains source link, accessible method tabs and honest financial disclaimer',()=>{
 const listeners={};
 const target={innerHTML:'',addEventListener(k,cb){listeners[k]=cb}};
 const opened=[];
 const api=collections.render(target,{from:'2026-10-01',to:'2026-10-31',journal},
  {scope:'owner|hotel',day:'2026-10-01',onOpen:x=>opened.push(x)});
 assert.ok(api);
 assert.doesNotMatch(target.innerHTML,/data-v3-money-day/);
 assert.match(target.innerHTML,/role="group" aria-label="Collection payment method"/);
 assert.match(target.innerHTML,/Opening balances, transfers and refundable deposits are not sales/);
 assert.match(target.innerHTML,/data-v3-money-source="order_payment"/);
 assert.match(target.innerHTML,/Received<\/span><strong>₹1,180/);
 listeners.click({target:{closest:q=>q==='[data-v3-money-source]'?{dataset:{v3MoneySource:'order_payment',v3MoneyId:id}}:null}});
 assert.equal(opened.length,1);
 assert.equal(opened[0].id,id);
 api.dispose();
 listeners.click({target:{closest:q=>q==='[data-v3-money-source]'?{dataset:{v3MoneySource:'order_payment',v3MoneyId:id}}:null}});
 assert.equal(opened.length,1,'detached/old tenant target cannot open another source');
});
test('A03 integrates existing Daily Book instead of creating any payments',()=>{
 assert.match(accounts,/id="haCollections"/);
 assert.match(accounts,/root\.BiteV3Collections\?\.render/);
 assert.match(accounts,/openCollectionSource\(entry\)/);
 assert.match(accounts,/state\.orderPayments/);
 assert.match(accounts,/root\.printOwnerInvoice/);
 assert.match(accounts,/customer_ledger_payment/);
 assert.match(accounts,/Original ledger and account notes/);
 assert.match(html,/owner-v3-collections\.js\?v=20261122-a03-daily-coverage1/);
 assert.match(html,/owner-v3-collections\.css\?v=20261118-a03-collections1/);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.doesNotMatch(fs.readFileSync('assets/owner-v3-collections.js','utf8'),/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
});

test('A03 collections reject duplicate source identities, malformed amounts and missing journal before filters',()=>{
 const a=journal[0];
 assert.ok(collections.summarize(undefined).error);
 assert.ok(collections.summarize([a,{...a}],'bank').error);
 for(const amount of [null,undefined,'','  ',true,false,[],{},'bad',Infinity,-1,1.001,Number.MAX_SAFE_INTEGER]){
  assert.ok(collections.summarize([{...a,amount}]).error,String(amount));
 }
 assert.ok(collections.summarize([{...a,id:''}]).error);
 assert.ok(collections.summarize([{...a,source_type:''}]).error);
 assert.ok(collections.summarize([null]).error);
 assert.ok(collections.summarize([{...a,amount:90071992547409},{...a,id:'p2',amount:1}]).error);
 assert.equal(collections.summarize([]).received,0);
 assert.equal(collections.summarize([{...a,amount:0.1},{...a,id:'p2',amount:0.2}]).received,0.3);
 assert.equal(collections.summarize([a,{...a,source_type:'folio',category:'payment'}]).received,1000);
});

test('A03 out-of-period or invalid receipt dates fail closed and stale scope cannot open records',()=>{
 const valid={from:'2026-10-01',to:'2026-10-31',journal};
 assert.equal(collections.validPeriod(valid),true);
 for(const day of ['2026-09-30','2026-11-01','2026-10-32','2026-02-30',null]){
  assert.equal(collections.validPeriod({...valid,journal:[{...journal[0],day}]}),false);
 }
 let current=true;const handlers={},opened=[];
 const target={isConnected:true,innerHTML:'',addEventListener:(k,f)=>handlers[k]=f};
 collections.render(target,valid,{scope:'owner|hotel',isCurrent:()=>current,onOpen:x=>opened.push(x)});
 current=false;
 handlers.click({target:{closest:q=>q==='[data-v3-money-source]'?{dataset:{v3MoneySource:'order_payment',v3MoneyId:id}}:null}});
 assert.equal(opened.length,0);
 assert.match(accounts,/report=null;reportScope='';/);
 assert.match(accounts,/r.data\?\.from!==from\|\|r.data\?\.to!==to/);
});

test('Daily Book rejects incomplete, out-of-order or duplicate days and malformed money before totals',()=>{
 const row={day:'2026-10-01',gross_sales:100,expenses:20,staff_advance:0,cash_balance:-20,online_balance:0,profit:80};
 const next={...row,day:'2026-10-02',gross_sales:'12.34',profit:-5};
 const report={from:'2026-10-01',to:'2026-10-02',days:[row,next],journal:[]};
 assert.equal(collections.validDailyTotals(report),true);
 for(const days of [[],[row],[row,row],[next,row],[row,{...next,day:'2026-10-03'}]])assert.equal(collections.validDailyTotals({...report,days}),false);
 for(const value of [null,undefined,'','  ',true,'NaN',Infinity,0.001,Number.MAX_SAFE_INTEGER])assert.equal(collections.validDailyTotals({...report,days:[{...row,gross_sales:value},next]}),false);
 assert.equal(collections.validDailyTotals({...report,days:[{...row,gross_sales:90071992547409},{...next,gross_sales:1}]}),false);
 assert.match(accounts,/BiteV3Collections\?\.validDailyTotals\(r.data\)/);
});
