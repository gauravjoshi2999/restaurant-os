'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const start=source.indexOf('let cashbookEntries=[],cashbookClosing=null,cashbookLastLoadedKey=null;');
const end=source.indexOf('let hrEmployees=[]',start);
assert(start>0&&end>start,'cashbook source must exist');
const part=source.slice(start,end);
function deferred(){let resolve;const promise=new Promise(ok=>{resolve=ok});return {promise,resolve};}
function harness(){
 const elements=new Map(),calls=[],inserts=[];
 const el=id=>{
  if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',style:{},disabled:false,
   addEventListener(){},setAttribute(){},className:''});
  return elements.get(id);
 };
 el('cashbookRestaurant').value='r1';
 el('cashbookDate').value='2026-11-14';
 el('cashbookOpeningCash').value='100';
 el('cashbookCountedCash').value='';
 el('cashbookCategory').value='Misc';
 el('cashbookAmount').value='10';
 el('cashbookDirection').value='in';
 el('cashbookPayment').value='Cash';
 const rows=[{entry_id:'a1',source_type:'order_payment',source_id:'a1',entry_date:'2026-11-14',
  direction:'in',payment_method:'Cash',amount:'50.00',restaurant_id:'r1',created_at:'2026-11-14T10:00:00Z'}];
 let nextFetch=null,nextInsert=null;
 const db={
  from(table){
   const q={
    select(){return q},eq(){return q},
    order(){
     const gate=nextFetch;nextFetch=null;
     return gate?gate.promise.then(()=>({data:rows,count:rows.length,error:null})):Promise.resolve({data:rows,count:rows.length,error:null});
    },
    maybeSingle(){return Promise.resolve({data:null,error:null})},
    insert(payload){
     inserts.push(payload);const gate=nextInsert;nextInsert=null;
     return gate?gate.promise.then(()=>({error:null})):Promise.resolve({error:null});
    }
   };return q;
  },
  rpc(name,args){calls.push({name,args});return Promise.resolve({data:'closing-id',error:null})}
 };
 const closing=require('../assets/owner-cash-closing.js');
 const ctx={sb:db,document:{getElementById:el},access:{role:'owner',restaurantId:'r1',memberships:[{role:'owner',restaurant_id:'r1'}]},
  state:{restaurants:[{id:'r1',name:'Hotel'}]},currentUser:{id:'owner-one'},
  BiteCashClosing:closing,localDateInput:()=> '2026-11-14',money:n=>'₹'+Number(n).toFixed(2),
  esc:v=>String(v),Promise,console:{log(){},error(){},warn(){}}};
 vm.createContext(ctx);vm.runInContext(part,ctx);
 return {ctx,el,rows,calls,inserts,
   delayFetch(){nextFetch=deferred();return nextFetch},
   delayInsert(){nextInsert=deferred();return nextInsert},
   switchOwner(){ctx.currentUser={id:'owner-two'}},
   read(expr){return vm.runInContext(expr,ctx)}
 };
}
test('cashbook source retains per-session identity guard without DB migration',()=>{
 assert.match(part,/function cashbookSameSession\(/);
 assert.match(part,/review\.ownerId!==session\.userId/);
 assert.match(part,/cashbookEntryBusy=true/);
 assert.match(part,/cashbookEntryBusy\|\|cashbookClosing/);
 assert.doesNotMatch(part,/service_role|Cashfree|vendor_payout/i);
});
test('late cashbook load from prior owner cannot populate fresh session',async()=>{
 const h=harness(),gate=h.delayFetch();
 const loading=h.ctx.loadCashbook();
 h.switchOwner();
 gate.resolve();await loading;
 assert.equal(h.read('cashbookDataReadyKey'),null);
 assert.equal(h.read('cashbookReview'),null);
});
test('late Review closing cannot authorize another account to close a day',async()=>{
 const h=harness();await h.ctx.loadCashbook();
 h.el('cashbookOpeningCash').value='100';h.el('cashbookCountedCash').value='150';
 const gate=h.delayFetch(),work=h.ctx.reviewCashbookDay();
 h.switchOwner();gate.resolve();await work;
 assert.equal(h.read('cashbookReview'),null);
 await h.ctx.closeCashbookDay();
 assert.equal(h.calls.length,0);
});
test('switch after closing review but before confirming blocks RPC',async()=>{
 const h=harness();await h.ctx.loadCashbook();
 h.el('cashbookOpeningCash').value='100';h.el('cashbookCountedCash').value='150';
 await h.ctx.reviewCashbookDay();
 assert.ok(h.read('cashbookReview'));
 h.switchOwner();
 await h.ctx.closeCashbookDay();
 assert.equal(h.calls.length,0,'other owner must not confirm original review');
});
test('switch while confirmation refresh is pending prevents closing RPC',async()=>{
 const h=harness();await h.ctx.loadCashbook();
 h.el('cashbookOpeningCash').value='100';h.el('cashbookCountedCash').value='150';
 await h.ctx.reviewCashbookDay();
 const gate=h.delayFetch(),work=h.ctx.closeCashbookDay();
 h.switchOwner();gate.resolve();await work;
 assert.equal(h.calls.length,0);
});
test('rapid double tap on manual cash entry results in one insert',async()=>{
 const h=harness();await h.ctx.loadCashbook();
 const gate=h.delayInsert();
 const first=h.ctx.saveCashbookEntry();
 const second=h.ctx.saveCashbookEntry();
 assert.equal(h.inserts.length,1);
 assert.equal(h.el('cashbookSaveBtn').disabled,true);
 await second;gate.resolve();await first;
 assert.equal(h.inserts.length,1);
});
test('stale manual entry response cannot clear another owner fields',async()=>{
 const h=harness();await h.ctx.loadCashbook();
 const gate=h.delayInsert(),work=h.ctx.saveCashbookEntry();
 h.switchOwner();h.el('cashbookCategory').value='Second owner category';
 gate.resolve();await work;
 assert.equal(h.el('cashbookCategory').value,'Second owner category');
});
