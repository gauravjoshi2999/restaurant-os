const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const closing=require('../assets/owner-cash-closing.js');

const entry=(id,amount,method='Cash',direction='in')=>({
 entry_id:id,source_type:'order_payment',source_id:id,restaurant_id:'r1',
 entry_date:'2026-11-13',direction,amount,payment_method:method,
 category:'Order payment',description:'POS payment',created_at:'2026-11-13T10:00:00Z'
});
test('cash amounts are explicit, bounded and precise in paise',()=>{
 assert.throws(()=>closing.paise('','Counted cash'),/Counted cash/);
 assert.throws(()=>closing.paise(' ','Counted cash'),/Counted cash/);
 assert.equal(closing.paise('0','Counted cash'),0);
 assert.equal(closing.paise('0.01'),1);
 assert.equal(closing.paise('100.50'),10050);
 for(const bad of ['-1','1.234','1e3','Infinity','NaN','01','1,000','1000000000000'])
  assert.throws(()=>closing.paise(bad),undefined,bad);
});
test('closing totals use Cash only, do not double-count UPI, and require discrepancy reason',()=>{
 const rows=[entry('p1','125.25'),entry('p2','100.00','UPI'),entry('p3','20.05','Cash','out')];
 const p=closing.preview(rows,'100','205.20','');
 assert.deepEqual({in:p.cash_in,out:p.cash_out,expected:p.expected_cash,difference:p.difference,cash:p.cash_entry_count},
  {in:125.25,out:20.05,expected:205.20,difference:0,cash:2});
 assert.throws(()=>closing.preview(rows,'100','200',''),/reason/);
 const mismatch=closing.preview(rows,'100','200','Cash drawer short');
 assert.equal(mismatch.difference,-5.2);
 assert.throws(()=>closing.preview([entry('out','20.05','Cash','out')],'0','0','Cash drawer short'),/negative/);
});
test('invalid and future dates are blocked; ledger signature is order independent',()=>{
 closing.validateDate('2026-11-13','2026-11-13');
 assert.throws(()=>closing.validateDate('2026-11-14','2026-11-13'),/Future/);
 assert.throws(()=>closing.validateDate('2026-02-30','2026-11-13'),/Valid/);
 assert.equal(closing.fingerprint([entry('a','1'),entry('b','2')]),closing.fingerprint([entry('b','2'),entry('a','1')]));
 assert.notEqual(closing.fingerprint([entry('a','1')]),closing.fingerprint([entry('a','2')]));
});
function workspace({rows=[entry('p1','50.00')],rpcMode='success'}={}){
 const elements=new Map(),calls=[];
 const el=id=>{
  if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',style:{},className:'',disabled:false,
   addEventListener(){},setAttribute(){}});
  return elements.get(id);
 };
 el('cashbookRestaurant').value='r1';
 el('cashbookDate').value='2026-11-13';
 el('cashbookOpeningCash').value='100';
 el('cashbookCountedCash').value='';
 el('cashbookClosingNote').value='';
 let serverRows=rows,serverClosing=null;
 const from=name=>{
  const q={select(){return q},eq(){return q},order(){return Promise.resolve({data:name==='restaurant_cashbook_entries'?serverRows:[],error:null})},
   maybeSingle(){return Promise.resolve({data:name==='restaurant_cashbook_closings'?serverClosing:null,error:null})},
   insert(){return Promise.resolve({error:null})}};
  return q;
 };
 const sb={from,rpc:async(name,payload)=>{
  calls.push({name,payload});
  if(rpcMode==='timeout-no-commit')return {error:{message:'Network timeout'}};
  serverClosing={opening_cash:payload.p_opening_cash,counted_cash:payload.p_counted_cash,
   cash_in:50,cash_out:0,expected_cash:payload.p_opening_cash+50,
   difference:payload.p_counted_cash-(payload.p_opening_cash+50),notes:payload.p_notes};
  if(rpcMode==='timeout-after-commit')return {error:{message:'Network timeout'}};
  return {data:'closing-id',error:null};
 }};
 const context={document:{getElementById:el},sb,BiteCashClosing:closing,
  access:{role:'owner',restaurantId:'r1',memberships:[{role:'owner',restaurant_id:'r1'}]},
  state:{restaurants:[{id:'r1',name:'Demo Hotel'}]},currentUser:{id:'owner-1'},
  localDateInput:()=> '2026-11-13',money:n=>'₹'+Number(n).toFixed(2),
  esc:x=>String(x),console:{...console,error(){}},Promise};
 const source=fs.readFileSync('index.html','utf8');
 const start=source.indexOf('let cashbookEntries=[],cashbookClosing=null,cashbookLastLoadedKey=null;');
 const end=source.indexOf('let hrEmployees=[]',start);
 assert(start>=0&&end>start,'cashbook integration must remain present');
 vm.createContext(context);
 vm.runInContext(source.slice(start,end),context);
 return {context,el,calls,setRows:x=>serverRows=x,setClosing:x=>serverClosing=x};
}
test('blank counted cash cannot close; review then confirm commits once',async()=>{
 const w=workspace();
 await w.context.loadCashbook();
 assert.equal(w.el('cashbookCountedCash').value,'');
 await w.context.reviewCashbookDay();
 assert.match(w.el('cashbookCloseMessage').textContent,/Counted cash/);
 assert.equal(w.calls.length,0);
 w.el('cashbookCountedCash').value='150';
 await w.context.reviewCashbookDay();
 assert.match(w.el('cashbookClosingReview').textContent,/Expected ₹150.00/);
 assert.equal(w.el('cashbookCloseBtn').disabled,false);
 await w.context.closeCashbookDay();
 assert.equal(w.calls.length,1);
 assert.equal(w.calls[0].name,'close_restaurant_cashbook_day');
 assert.equal(w.calls[0].payload.p_counted_cash,150);
 assert.equal(w.el('cashbookStatus').textContent,'Closed');
 await w.context.closeCashbookDay();
 assert.equal(w.calls.length,1,'double confirmation must not create a second RPC');
});
test('cash difference requires a reason; edits invalidate confirmation',async()=>{
 const w=workspace();
 await w.context.loadCashbook();
 w.el('cashbookCountedCash').value='145';
 await w.context.reviewCashbookDay();
 assert.match(w.el('cashbookCloseMessage').textContent,/reason/);
 w.el('cashbookClosingNote').value='Five rupees short';
 await w.context.reviewCashbookDay();
 assert.match(w.el('cashbookClosingReview').textContent,/Difference ₹-5.00/);
 w.el('cashbookCountedCash').value='150';
 w.context.invalidateCashbookReview();
 assert.equal(w.el('cashbookCloseBtn').disabled,true);
 await w.context.closeCashbookDay();
 assert.equal(w.calls.length,0);
});
test('new ledger transaction invalidates old review before RPC',async()=>{
 const w=workspace();
 await w.context.loadCashbook();
 w.el('cashbookCountedCash').value='150';
 await w.context.reviewCashbookDay();
 w.setRows([entry('p1','50.00'),entry('p2','10.00')]);
 await w.context.closeCashbookDay();
 assert.equal(w.calls.length,0);
 assert.match(w.el('cashbookCloseMessage').textContent,/Nayi transaction/);
 assert.equal(w.el('cashbookCloseBtn').disabled,true);
});
test('lost RPC response is verified against the closed row without retrying',async()=>{
 const w=workspace({rpcMode:'timeout-after-commit'});
 await w.context.loadCashbook();
 w.el('cashbookCountedCash').value='150';
 await w.context.reviewCashbookDay();
 await w.context.closeCashbookDay();
 assert.equal(w.calls.length,1);
 assert.equal(w.el('cashbookStatus').textContent,'Closed');
 assert.match(w.el('cashbookCloseMessage').textContent,/already closed/);
});
test('failed RPC with no closing row never retries silently',async()=>{
 const w=workspace({rpcMode:'timeout-no-commit'});
 await w.context.loadCashbook();
 w.el('cashbookCountedCash').value='150';
 await w.context.reviewCashbookDay();
 await w.context.closeCashbookDay();
 assert.equal(w.calls.length,1);
 assert.match(w.el('cashbookCloseMessage').textContent,/Day close nahi hua/);
});
test('closing review is scoped to Owner and does not change customer or POS flows',()=>{
 const index=fs.readFileSync('index.html','utf8');
 assert(index.includes('assets/owner-cash-closing.js'));
 assert(index.includes('id="cashbookReviewBtn"'));
 assert(index.includes('id="cashbookClosingReview"'));
 assert(index.includes("if(access.role!=='owner'||cashbookClosingBusy||!cashbookReview)return;"));
 assert(index.includes("sb.rpc('close_restaurant_cashbook_day'"));
});
