'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const api=require('../assets/owner-v3-historical-reconcile.js');
const html=fs.readFileSync('index.html','utf8');
const accounts=fs.readFileSync('assets/owner-hotel-accounts.js','utf8');
const posV2=fs.readFileSync('assets/bite-pos-v2.js','utf8');
const posReports=fs.readFileSync('assets/bite-pos-reports.js','utf8');
const css=fs.readFileSync('assets/owner-v3-historical-reconcile.css','utf8');
const r='262aaba7-f48b-4fa5-9ff6-b334ededca84';
const row={id:'old-1',restaurant_id:r,record_date:'2026-10-01',recorded_at:'2026-11-18T15:00:00Z',
 customer_name:'Old guest',amount:160,received_amount:160,visit_type:'dine_in',guest_count:2,payment_method:'Cash'};
function clientFor(rows,options={}){
 const calls=[],query={};
 const q={
  select(...args){calls.push(['select',...args]);return this},
  eq(...args){calls.push(['eq',...args]);return this},
  gte(...args){calls.push(['gte',...args]);return this},
  lte(...args){calls.push(['lte',...args]);return this},
  order(...args){calls.push(['order',...args]);return this},
  range(start,end){calls.push(['range',start,end]);if(options.error)return Promise.resolve({data:null,error:Error('RLS denied')});
   return Promise.resolve({data:rows.slice(start,end+1),error:null});}
 };
 return {client:{from(name){calls.push(['from',name]);return q}},calls};
}
test('October 1 historic ₹160/₹160 entry is displayed as an old register snapshot, not a new sale',()=>{
 const result=api.summarize([row],{restaurantId:r,from:'2026-10-01',to:'2026-10-31'});
 assert.equal(result.count,1);assert.equal(result.billedCents,16000);
 assert.equal(result.receivedCents,16000);assert.equal(result.remainingCents,0);
 assert.equal(result.days[0].date,'2026-10-01');
});
test('Historical POS is restaurant-tenant scoped and original business-date scoped, not recorded_at',async()=>{
 const {client,calls}=clientFor([row]);
 const result=await api.load({client,restaurantId:r,from:'2026-10-01',to:'2026-10-31',today:'2026-11-19'});
 assert.equal(result.count,1);
 for(const [column,value] of [['restaurant_id',r],['entry_kind','pos']])
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]===column&&c[2]===value));
 assert.ok(calls.some(c=>c[0]==='gte'&&c[1]==='record_date'&&c[2]==='2026-10-01'));
 assert.ok(calls.some(c=>c[0]==='lte'&&c[1]==='record_date'&&c[2]==='2026-10-31'));
 assert.ok(!calls.some(c=>c[0]==='gte'&&c[1]==='recorded_at'));
 assert.ok(calls.some(c=>c[0]==='range'&&c[1]===0));
});
test('Old written receipts are never added to independent posted Daily Book receipts',()=>{
 const existing=[{source_type:'order_payment',direction:'in',day:'2026-10-01',method:'Cash',amount:100},
 {source_type:'order_payment',direction:'in',day:'2026-10-02',method:'Cashfree',amount:500},
 {source_type:'folio',direction:'in',day:'2026-10-01',method:'Cash',amount:300}];
 const posted=api.postedPosSummary(existing,'2026-10-01','2026-10-31');
 assert.equal(posted.totalCents,10000);assert.equal(posted.count,1);
 assert.equal(api.summarize([row],{restaurantId:r,from:'2026-10-01',to:'2026-10-31'}).receivedCents,16000);
});
test('Mismatched tenant, duplicated row, impossible date and broken money rows fail closed',()=>{
 const args={restaurantId:r,from:'2026-10-01',to:'2026-10-31'};
 for(const invalid of [[row,{...row}], [{...row,restaurant_id:'other'}],
  [{...row,record_date:'2026-10-32'}], [{...row,amount:159}],
  [{...row,amount:'NaN'}], [{...row,received_amount:160.001}]])
  assert.throws(()=>api.summarize(invalid,args));
 assert.equal(api.validPeriod('2026-10-01','2026-10-31','2026-11-19'),true);
 assert.equal(api.validPeriod('2026-10-31','2026-10-01','2026-11-19'),false);
 assert.equal(api.validPeriod('2026-10-01','2026-11-20','2026-11-19'),false);
});
test('Unverified, over-limit and stale historical results never expose invented totals',async()=>{
 await assert.rejects(()=>api.load({client:clientFor([row],{error:true}).client,restaurantId:r,from:'2026-10-01',to:'2026-10-31',today:'2026-11-19'}));
 await assert.rejects(()=>api.load({client:clientFor([row]).client,restaurantId:r,from:'2026-10-01',to:'2026-10-31',today:'2026-11-19',pageSize:1,maxRows:1}));
 await assert.rejects(()=>api.load({client:clientFor([row]).client,restaurantId:r,from:'2026-10-01',to:'2026-10-31',today:'2026-11-19',isCurrent:()=>false}));
});
test('Daily Book view is read-only, mobile responsive and keeps original live KPI journal untouched',()=>{
 for(const marker of ['id="haHistoricalPOS"','BiteV3HistoricalReconcile.mount','renderOldPosReconciliation(body',
  'owner-v3-historical-reconcile.js?v=','owner-v3-historical-reconcile.css?v='])
  assert.ok((html+accounts).includes(marker),marker);
 assert.match(accounts,/function linkedRegisterRestaurant\(/);
 assert.match(accounts,/p\(\)\?\.outlets/);
 assert.match(accounts,/renderOldPosReconciliation\(body,\{from,to,key,version\}\)/);
 assert.match(posV2,/openReportDate/);
 assert.match(posReports,/function focusDate\(day\)/);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.doesNotMatch(fs.readFileSync('assets/owner-v3-historical-reconcile.js','utf8'),
  /\.(?:insert|update|upsert|delete|rpc)\s*\(/);
});
test('Old date in canonical POS report remains historical and is not a normal payment or invoice',()=>{
 assert.match(posReports,/Old POS register/);
 assert.match(posReports,/historyError/);
 assert.match(accounts,/Reference|renderOldPosReconciliation/);
});
