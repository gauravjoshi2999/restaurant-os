'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/bite-pos-reports.js','utf8');
const entry=fs.readFileSync('assets/owner-historical-entries.js','utf8');
const html=fs.readFileSync('index.html','utf8');
function api(){
 const window={document:null,console};window.window=window;
 vm.runInNewContext(source,{window,Intl,Date,Number,console});
 return window.BitePOSReports;
}
const live={
 month:'2026-10',selected_day:'2026-10-01',
 days:[{date:'2026-10-01',bills:0,billed:0,guests:0,dine_in:0,takeaway:0,untracked:0},
       {date:'2026-10-02',bills:1,billed:250,guests:0,dine_in:0,takeaway:1,untracked:0}],
 recent:[]
};
const history=[{id:'synthetic-1',record_date:'2026-10-01',recorded_at:'2026-11-18T06:00:00Z',
 customer_name:'Synthetic guest',amount:400,received_amount:300,visit_type:'dine_in',guest_count:3}];
test('Historical POS records appear on their selected October business date rather than entry timestamp',()=>{
 const merged=api().mergeHistorical(live,history);
 assert.equal(merged.days[0].bills,1);assert.equal(merged.days[0].billed,400);
 assert.equal(merged.days[0].guests,3);assert.equal(merged.days[0].historical_bills,1);
 assert.equal(merged.days[0].historical_received,300);
 assert.equal(merged.days[1].bills,1);assert.equal(merged.days[1].billed,250);
 assert.equal(merged.recent[0].source,'historical');
 assert.equal(merged.recent[0].status,'Historical record');
 assert.equal(live.days[0].bills,0,'Live report response must remain unchanged');
});
test('Monthly reporting includes existing live sales plus explicitly labelled old records',()=>{
 const r=api(),out=r.mergeHistorical(live,history),m=r.summarize(out.days);
 assert.equal(m.bills,2);assert.equal(m.billed,650);assert.equal(m.guests,3);
 assert.equal(m.historical_bills,1);assert.equal(m.historical_billed,400);
 assert.equal(m.historical_received,300);
});
test('Historical month lookup explicitly binds restaurant and entry kind, not creation date',async()=>{
 const calls=[],outRows=[{id:'synthetic-1',record_date:'2026-10-01'}];
 const builder={
  select(...x){calls.push(['select',...x]);return this},
  eq(...x){calls.push(['eq',...x]);return this},
  gte(...x){calls.push(['gte',...x]);return this},
  lt(...x){calls.push(['lt',...x]);return this},
  order(...x){calls.push(['order',...x]);return this},
  range(...x){calls.push(['range',...x]);return Promise.resolve({data:outRows,error:null})}
 };
 const client={from:t=>{calls.push(['from',t]);return builder}};
 const rows=await api().historicalRowsForMonth(client,'restaurant-scope','2026-10');
 assert.equal(rows.length,1);
 assert.ok(calls.some(x=>x[0]==='from'&&x[1]==='bite_owner_historical_entries'));
 assert.ok(calls.some(x=>x[0]==='eq'&&x[1]==='restaurant_id'&&x[2]==='restaurant-scope'));
 assert.ok(calls.some(x=>x[0]==='eq'&&x[1]==='entry_kind'&&x[2]==='pos'));
 assert.ok(calls.some(x=>x[0]==='gte'&&x[2]==='2026-10-01'));
 assert.ok(calls.some(x=>x[0]==='lt'&&x[2]==='2026-11-01'));
 assert.ok(!calls.some(x=>String(x[1]).includes('recorded_at')&&x[0]==='gte'));
});
test('UI always describes old records as separate from live cash and allows date-linked entry',()=>{
 for(const phrase of [
  'data-bpr-add-old','root.openOrder','input.value=date',
  "input.dispatchEvent(new Event('change',{bubbles:true}))",
  'historical_received','not cash collected now','Old POS register',
  'historyError','role="alert"'
 ])assert.ok(source.includes(phrase),phrase);
 assert.match(html,/bite-pos-reports\.js\?v=20\d{6}-[a-z0-9-]+/);
 assert.ok(html.includes('bite-pos-reports.css?v=20261118-historical-report1'));
 assert.ok(entry.includes("root.BitePOSReports?.refresh?.(true)"));
 assert.ok(entry.includes('delete form.dataset.bheSavedSignature'));
 assert.ok(entry.includes('date.value===resetValue'), 'A delayed new-bill reset must not overwrite calendar selection');
});

test('R07 history merge rejects duplicate or out-of-period rows rather than understating or duplicating sales',()=>{
 const a=api(),h=history[0];
 assert.throws(()=>a.mergeHistorical(live,[h,{...h}]),/Duplicate/);
 assert.throws(()=>a.mergeHistorical(live,[{...h,id:''}]),/identity/);
 assert.throws(()=>a.mergeHistorical(live,[{...h,record_date:'2026-11-01'}]),/outside/);
 for(const amount of [null,undefined,'','  ',true,'bad',Infinity,-1,1.001]){
  assert.throws(()=>a.mergeHistorical(live,[{...h,amount}]),/Historical money/);
  assert.throws(()=>a.mergeHistorical(live,[{...h,received_amount:amount}]),/Historical money/);
 }
 assert.throws(()=>a.mergeHistorical(live,[{...h,received_amount:401}]),/exceeds/);
 assert.throws(()=>a.mergeHistorical(live,[{...h,guest_count:null}]),/guest count/);
 assert.throws(()=>a.mergeHistorical(live,[{...h,visit_type:'unknown'}]),/visit type/);
 const zero=a.mergeHistorical(live,[{...h,amount:0,received_amount:0}]);
 assert.equal(zero.days[0].historical_billed,0);
 assert.equal(zero.days[0].historical_bills,1);
 assert.equal(live.days[0].bills,0);
});
test('R07 history failure keeps the existing genuine live report with explicit warning, no partial history',()=>{
 assert.match(source,/order\('id',\{ascending:false\}\)/);
 assert.match(source,/catch\(e\)\{historyError=e\?\.message\|\|'Historical register validation failed';report=mergeHistorical\(res.data,\[\]\);\}/);
 assert.match(source,/Live bills only dikh rahe hain/);
});
