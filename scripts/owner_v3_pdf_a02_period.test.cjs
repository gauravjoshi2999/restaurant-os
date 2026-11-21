/* Regression: A02 one period picker across canonical Owner financial reports. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const period=require('../assets/owner-v3-period.js');
const account=fs.readFileSync('assets/owner-hotel-accounts.js','utf8');
const hotel=fs.readFileSync('assets/owner-hospitality.js','utf8');
const collections=fs.readFileSync('assets/owner-v3-collections.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/owner-v3-period.css','utf8');
const today='2026-11-19';

test('A02 Gregorian date validation, leap day, month-to-date, prior months',()=>{
 assert.equal(period.validDay('2026-02-29'),false);
 assert.equal(period.validDay('2024-02-29'),true);
 assert.equal(period.validDay('2026-11-19'),true);
 assert.equal(period.endOfMonth('2026-02'),'2026-02-28');
 assert.equal(period.endOfMonth('2024-02'),'2024-02-29');
 assert.deepEqual(period.normalize({mode:'month',month:'2026-11'},today),
  {mode:'month',from:'2026-11-01',to:'2026-11-19',day:'',month:'2026-11'});
 assert.deepEqual(period.normalize({mode:'month',month:'2026-10'},today),
  {mode:'month',from:'2026-10-01',to:'2026-10-31',day:'',month:'2026-10'});
 assert.equal(period.normalize({mode:'day',day:'2026-10-01'},today).from,'2026-10-01');
 assert.equal(period.normalize({mode:'range',from:'2026-10-01',to:'2026-11-19'},today).to,today);
});
test('A02 rejects forged, reversed, future and excessively long record periods',()=>{
 for(const p of [
  {mode:'day',day:'2026-02-30'},
  {mode:'day',day:'2026-11-20'},
  {mode:'range',from:'2026-11-19',to:'2026-10-01'},
  {mode:'range',from:'2025-01-01',to:'2026-11-19'},
  {mode:'month',month:'2026-13'},
  {mode:'month',month:'2027-01'}
 ])assert.throws(()=>period.normalize(p,today));
});
test('A02 Cancel and Today are draft-only; Apply is the only callback',async()=>{
 const listeners={};
 const host={innerHTML:'',isConnected:true,
  addEventListener:(name,fn)=>listeners[name]=fn,
  contains:()=>true,querySelector:()=>null};
 const applied=[];
 const x=period.mount(host,{today:()=>today,value:{mode:'month',month:'2026-10'},onApply:p=>applied.push(p)});
 assert.ok(x);assert.equal(x.getSelected().from,'2026-10-01');
 const click=key=>listeners.click({target:{dataset:{},closest:()=>({
  dataset:{},matches:selector=>selector==='[data-bv3-period-'+key+']'
 })}});
 click('toggle');assert.match(host.innerHTML,/data-bv3-period-form/);
 click('today');assert.match(host.innerHTML,/value="2026-11-19"/);
 assert.equal(x.getSelected().from,'2026-10-01','Today does not silently change the report');
 click('cancel');assert.equal(x.getSelected().from,'2026-10-01');
 assert.equal(applied.length,0);
 const old=global.FormData;
 try{
  global.FormData=class{get(key){return {day:'2026-11-05'}[key]||null}};
  click('toggle');click('today');
  const form={matches:selector=>selector==='[data-bv3-period-form]',querySelector:()=>({disabled:false})};
  await listeners.submit({target:form,preventDefault(){},stopPropagation(){}});
  assert.deepEqual(applied.map(x=>[x.mode,x.from,x.to]),[['day','2026-11-05','2026-11-05']]);
  assert.equal(x.getSelected().from,'2026-11-05');
 }finally{global.FormData=old}
 x.dispose();
});
test('A02 financial views share picker, preserve property scope and source date',()=>{
 assert.match(account,/picker\.mount\(target\.querySelector\('#haPeriod'\)/);
 assert.match(account,/p_from:from,p_to:to/);
 assert.match(account,/version===reportVersion/);
 assert.match(account,/viewPeriod=\{mode:'day',day\}/);
 assert.match(account,/Entry date/);
 assert.match(account,/field\('entry_date','Date','date',today\(\)/);
 assert.match(hotel,/picker\.mount\(target\.querySelector\('#bhReportPeriod'\)/);
 assert.match(hotel,/hotelReportPeriod=null/);
 assert.match(hotel,/reportFrom=next\.from;reportTo=next\.to/);
 assert.doesNotMatch(collections,/data-v3-money-day/,'Collections must not introduce another date picker');
 assert.match(html,/owner-v3-period\.js\?v=20261119-a02-shared1/);
 assert.match(html,/owner-v3-period\.css\?v=20261119-a02-shared1/);
 assert.match(html,/owner-hotel-accounts\.js\?v=20\d{6}-[a-z0-9-]+/);
 assert.match(html,/owner-hospitality\.js\?v=20261119-[a-z0-9-]+/);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.match(css,/@media\(max-width:340px\)/);
 assert.doesNotMatch(fs.readFileSync('assets/owner-v3-period.js','utf8'),/\.(?:insert|upsert|update|delete|rpc)\(/);
});

test('A02 remount disables old picker and validates leap-century boundaries',()=>{
 const handlers={};const removed=[];
 const target={innerHTML:'',isConnected:true,addEventListener:(k,f)=>handlers[k]=f,removeEventListener:(k,f)=>removed.push(k),contains:()=>true,querySelector:()=>null};
 const options={today:()=>today,value:{mode:'month',month:'2026-10'},onApply:()=>{}};
 period.mount(target,options);const oldClick=handlers.click;
 period.mount(target,{...options,value:{mode:'day',day:today}});
 const previous=target.innerHTML;
 oldClick({target:{closest:()=>({dataset:{},matches:()=>true})}});
 assert.equal(target.innerHTML,previous);
 assert.deepEqual(removed,['click','submit']);
 assert.equal(period.endOfMonth('1900-02'),'1900-02-28');
 assert.equal(period.endOfMonth('2000-02'),'2000-02-29');
 assert.equal(period.endOfMonth('0004-02'),'0004-02-29');
});
