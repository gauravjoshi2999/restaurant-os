'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const accountSource=fs.readFileSync('assets/owner-hotel-accounts.js','utf8');
const homeSource=fs.readFileSync('assets/owner-reference-v3.js','utf8');
const homeCss=fs.readFileSync('assets/owner-pdf-v3-home.css','utf8');
const html=fs.readFileSync('index.html','utf8');
const start=accountSource.indexOf('async function reportOwnerHomeDay(day){');
const stop=accountSource.indexOf('function selectOwnerHomeMonth(day){',start);
assert.ok(start>=0&&stop>start,'H02 reporting function must be readable in isolation');
const code=accountSource.slice(start,stop)+';globalThis.reportOwnerHomeDay=reportOwnerHomeDay;';

function fixture(){
 let property={id:'property-1'},user={id:'owner-1'},handler=async()=>({data:{days:[],journal:[]}});
 const calls=[];
 const ctx={
  getUser:()=>user,
  sb:{rpc:(name,args)=>{calls.push({name,args});return handler(name,args)}}
 };
 const state={ctx,Date,Number,generation:0,
  p:()=>property,
  enabled:()=>true,
  scope:()=>user.id+':'+property.id,
  assertScope:(key,version)=>{
   if(key!==user.id+':'+property.id||version!==state.generation)
    throw Error('Account or property changed. Reopen this action.');
  }
 };
 vm.runInNewContext(code,state);
 return {run:day=>state.reportOwnerHomeDay(day),calls,setHandler:fn=>handler=fn,
  changeProperty:id=>{property={id}},changeUser:id=>{user={id}}};
}
test('H02 totals use one authorized property/date-scoped Daily Book RPC, never create receipts',async()=>{
 const f=fixture();f.setHandler(async()=>({data:{
  days:[{day:'2026-10-01',gross_sales:'850',expenses:'125'}],
  journal:[
   {id:'receipt-pos-1',day:'2026-10-01',source_type:'order_payment',category:'Order payment',direction:'in',method:'Cash',amount:'300'},
   {id:'receipt-folio-1',day:'2026-10-01',source_type:'folio',category:'advance',direction:'in',method:'UPI',amount:'200'},
   {id:'receipt-daybook-1',day:'2026-10-01',source_type:'daybook',category:'income',direction:'in',method:'Cash',amount:'30'},
   {id:'deposit-1',day:'2026-10-01',source_type:'folio',category:'deposit_hold',direction:'in',method:'Cash',amount:'500'},
   {id:'opening-1',day:'2026-10-01',source_type:'daybook',category:'opening',direction:'in',method:'Cash',amount:'700'},
   {id:'transfer-1',day:'2026-10-01',source_type:'daybook',category:'transfer_in',direction:'in',method:'UPI',amount:'150'},
   {id:'other-payment-1',day:'2026-10-01',source_type:'folio',category:'payment',direction:'in',method:'Other',amount:'55'},
   {id:'refund-1',day:'2026-10-01',source_type:'order_payment',category:'Order payment',direction:'out',method:'Cash',amount:'20'},
   {id:'receipt-later-1',day:'2026-11-18',source_type:'order_payment',category:'Order payment',direction:'in',method:'Cash',amount:'900'}
  ]}}));
 const x=await f.run('2026-10-01');
 assert.equal(x.sales,850);
 assert.equal(x.expenses,125);
 assert.equal(x.received,530,'Only collected POS, guest receipts and other recorded income');
 assert.equal(x.receiptCount,3);
 assert.equal(x.propertyId,'property-1');
 assert.deepEqual(f.calls.map(c=>JSON.parse(JSON.stringify(c))),[
  {name:'bite_daily_book',args:{p_property:'property-1',p_from:'2026-10-01',p_to:'2026-10-01'}}
 ]);
 assert.doesNotMatch(code,/\.(?:insert|upsert|update|delete)\(/);
});
test('Missing/sick day or invalid date never pretends a zero sale',async()=>{
 const f=fixture();
 await assert.rejects(f.run('2026-13-01'),/Choose a valid business date/);
 await assert.rejects(f.run('2026-02-30'),/Choose a valid business date/);
 await assert.rejects(f.run('2026-10-01'),/did not return the selected day/);
 f.setHandler(async()=>({data:{days:[{day:'2026-10-01',gross_sales:null,expenses:0}],journal:[]}}));
 await assert.rejects(f.run('2026-10-01'),/incomplete accounting values/);
});
test('Property switch while RPC waits rejects stale financial data',async()=>{
 const f=fixture();let resolve;
 f.setHandler(()=>new Promise(done=>{resolve=done}));
 const pending=f.run('2026-10-01');
 f.changeProperty('another-restaurant');
 resolve({data:{days:[{day:'2026-10-01',gross_sales:100,expenses:0}],journal:[]}});
 await assert.rejects(pending,/Account or property changed/);
});
test('H02/H03 selected day stays separate from live alerts and old dashboard',()=>{
 assert.match(homeSource,/data-bv3-business-day/);
 assert.match(homeSource,/data-bv3-date-today/);
 assert.match(homeSource,/onHomeBusinessDateChange/);
 assert.match(homeSource,/data-bv3-retry-finance/);
 assert.match(homeSource,/Received excludes refundable deposits/);
 assert.match(homeSource,/Rooms.*Live today/);
 assert.match(homeSource,/root\.BiteHotelAccounts\?\.selectOwnerHomeMonth\?\.\(businessDay\(\)\)/);
 assert.match(homeCss,/\.bv3-pdf-date-field input/);
 assert.match(homeCss,/@media\(max-width:760px\)/);
 assert.match(html,/owner-reference-v3\.js\?v=20261118-h02-finance1/);
 assert.match(html,/owner-hotel-accounts\.js\?v=20\d{6}-[a-z0-9-]+/);
 assert.match(html,/owner-pdf-v3-home\.css\?v=20261118-h02-finance1/);
});

test('H02 selected-day receipts reject duplicate source identities and malformed paise amounts',async()=>{
 const receipt={id:'payment-1',day:'2026-10-01',source_type:'order_payment',category:'Order payment',direction:'in',method:'Cash',amount:'10.00'};
 const report=journal=>({data:{days:[{day:'2026-10-01',gross_sales:10,expenses:0}],journal}});
 const duplicate=fixture();duplicate.setHandler(async()=>report([receipt,{...receipt}]));
 await assert.rejects(duplicate.run('2026-10-01'),/duplicate receipt/);
 for(const amount of ['', '  ', null, undefined, true, 'NaN', Infinity, -1, 1.001, Number.MAX_SAFE_INTEGER]){
  const f=fixture();f.setHandler(async()=>report([{...receipt,amount}]));
  await assert.rejects(f.run('2026-10-01'),/invalid receipt|too large/);
 }
 const missingIdentity=fixture();missingIdentity.setHandler(async()=>report([{...receipt,id:''}]));
 await assert.rejects(missingIdentity.run('2026-10-01'),/invalid receipt identity/);
});
