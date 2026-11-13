const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const payments=require('../assets/bite-pos-payment-safety.js');

const identity={uid:'owner-a',restaurantId:'restaurant-a',orderId:'order-a'};
const details={amount:145.50,method:'UPI',date:'2026-11-13',reference:'UPI-123',notes:'Counter'};
const uuid='01234567-89ab-4def-8abc-0123456789ab';
function storage(){
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),
  removeItem:key=>values.delete(key),values};
}
function fakeDb(onInsert){
 const rows=new Map(),calls=[];
 return {
  rows,calls,
  from(table){
   assert.equal(table,'restaurant_order_payments');
   return {
    insert:async payload=>{
     calls.push({...payload});
     return onInsert?onInsert(payload,rows,calls.length):(
      rows.set(payload.id,{...payload}),{error:null});
    },
    select:()=>{
     const filters={};
     const query={eq:(key,value)=>{filters[key]=value;return query},
      maybeSingle:async()=>{
       const row=rows.get(filters.id);
       if(!row||Object.entries(filters).some(([key,value])=>row[key]!==value))
        return {data:null,error:null};
       return {data:row,error:null};
      }};
     return query;
    }
   };
  }
 };
}
const options=(db,store,extra={})=>({sb:db,storage:store,identity,details,
 uuid:()=>uuid,...extra});

test('payment script parses, and owner workspace loads payment safety with Check status',()=>{
 const page=fs.readFileSync('index.html','utf8');
 for(const name of ['assets/bite-pos-payment-safety.js','assets/bite-pos-payment-ui.js']){
  assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(name,'utf8')));
  assert.ok(page.includes(name));
 }
 assert.match(page,/id="paymentCheckBtn"/);
 assert.match(page,/function checkPosPaymentAttempt\(/);
 assert.match(page,/BitePOSPaymentUI\.save/);
 assert.doesNotMatch(fs.readFileSync('customer.html','utf8'),/bite-pos-payment-safety/);
});

test('successful payment records one row, with stable client UUID and no leftover marker',async()=>{
 const db=fakeDb(),store=storage();
 const result=await payments.save(options(db,store));
 assert.equal(result.status,'confirmed');
 assert.equal(db.calls.length,1);
 assert.equal(db.calls[0].id,uuid);
 assert.equal(db.calls[0].restaurant_id,identity.restaurantId);
 assert.equal(db.calls[0].created_by,identity.uid);
 assert.equal(db.calls[0].amount,145.5);
 assert.equal(payments.getPending(store,identity),null);
});

test('timeout AFTER server commit is reconciled as success, not retried',async()=>{
 const db=fakeDb((payload,rows)=>{
  rows.set(payload.id,{...payload});
  return {error:{message:'Gateway timeout'}};
 }),store=storage();
 const result=await payments.save(options(db,store));
 assert.equal(result.status,'confirmed');
 assert.equal(result.recovered,true);
 assert.equal(db.calls.length,1);
 assert.equal(db.rows.size,1);
 assert.equal(payments.getPending(store,identity),null);
});

test('offline before commit preserves same UUID and details on retry',async()=>{
 const db=fakeDb((payload,rows,count)=>{
  if(count===1)return {error:{message:'Network unavailable'}};
  rows.set(payload.id,{...payload});return {error:null};
 }),store=storage();
 const first=await payments.save(options(db,store));
 assert.equal(first.status,'pending');
 assert.equal(payments.getPending(store,identity).id,uuid);
 const second=await payments.save(options(db,store,{uuid:()=>{throw Error('New ID must not be created')}}));
 assert.equal(second.status,'confirmed');
 assert.equal(db.calls.length,2);
 assert.equal(db.calls[0].id,db.calls[1].id);
 assert.equal(db.rows.size,1);
});

test('late commit and duplicate UUID on retry reconcile to one receipt',async()=>{
 const db=fakeDb((payload,rows,count)=>{
  if(count===1)return {error:{message:'Timeout'}};
  rows.set(payload.id,{...payload});
  return {error:{code:'23505',message:'duplicate key'}};
 }),store=storage();
 assert.equal((await payments.save(options(db,store))).status,'pending');
 assert.equal((await payments.save(options(db,store))).status,'confirmed');
 assert.equal(db.rows.size,1);
 assert.equal(db.calls[0].id,db.calls[1].id);
});

test('definite database rejection clears marker for corrected payment',async()=>{
 const db=fakeDb(()=>({error:{code:'P0001',message:'Day already closed'}})),store=storage();
 const result=await payments.save(options(db,store));
 assert.equal(result.status,'rejected');
 assert.equal(payments.getPending(store,identity),null);
});

test('pending payment details cannot be changed to create another receipt',async()=>{
 const db=fakeDb(()=>({error:{message:'Timeout'}})),store=storage();
 assert.equal((await payments.save(options(db,store))).status,'pending');
 await assert.rejects(payments.save(options(db,store,{details:{...details,amount:155}})),/Pichhla payment/);
 assert.equal(db.calls.length,1);
});

test('failed device storage blocks the insert instead of risking duplicate',async()=>{
 const db=fakeDb(),store={getItem:()=>null,setItem:()=>{throw Error('Storage denied')}};
 await assert.rejects(payments.save(options(db,store)),/Device storage unavailable/);
 assert.equal(db.calls.length,0);
});

test('payment cannot exceed two decimal places or use unsupported method',()=>{
 assert.throws(()=>payments.normalize({...details,amount:10.123}),/two decimal/);
 assert.throws(()=>payments.normalize({...details,method:'Bitcoin'}),/method/);
 assert.throws(()=>payments.normalize({...details,amount:0}),/Valid amount/);
});

test('payment attempt storage keys isolate owner, restaurant and order',()=>{
 const a=payments.key(identity);
 for(const field of ['uid','restaurantId','orderId'])
  assert.notEqual(a,payments.key({...identity,[field]:identity[field]+'-other'}));
});

test('reconciliation refuses a mismatched database payment row',async()=>{
 const db=fakeDb(),store=storage();
 const attempt=payments.begin(store,identity,details,()=>uuid).attempt;
 db.rows.set(attempt.id,{id:uuid,order_id:identity.orderId,restaurant_id:identity.restaurantId,
  amount:1,payment_method:'Cash',payment_date:details.date,reference:details.reference});
 const result=await payments.reconcile({sb:db,storage:store,identity});
 assert.equal(result.status,'conflict');
 assert.equal(payments.getPending(store,identity).id,uuid);
});
