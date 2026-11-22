'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const api=require('../assets/owner-support-tickets.js');
const request={id:'ticket1',restaurant_id:'r1',category:'POS',subject:'Bill problem',message:'Bill not visible'};
const saved={...request,owner_id:'u1',status:'Open',admin_response:null,updated_at:'v1'};
test('owner and platform scopes are separate; staff and owners without restaurant blocked',()=>{
 assert.equal(api.identity({role:'owner',restaurantId:'r1'},{id:'u1'}),'owner:u1:r1');
 assert.equal(api.identity({role:'super_admin',restaurantId:'r1'},{id:'a1'}),'admin:a1');
 assert.equal(api.identity({role:'staff',restaurantId:'r1'},{id:'u1'}),'');
 assert.equal(api.identity({role:'owner'},{id:'u1'}),'');
});
test('ticket content validation rejects empty or oversized data',()=>{
 assert.deepEqual(api.normalize('POS',' Bill problem ',' Bill not visible '),{category:'POS',subject:'Bill problem',message:'Bill not visible'});
 assert.throws(()=>api.normalize('Other','x','valid message'));
 assert.throws(()=>api.normalize('Other','valid','x'.repeat(2001)));
 assert.throws(()=>api.normalize('Unknown','valid','valid message'));
});
function client({insertResult,lookupResult,updateResult}={}){
 const calls=[];
 return {calls,from(table){assert.equal(table,'owner_support_tickets');let mode;const q={
 insert(x){mode='insert';calls.push(['insert',x]);return q;},
 select(){if(!mode)mode='lookup';return q;},
 eq(k,v){calls.push(['eq',k,v]);return q;},
 update(x){mode='update';calls.push(['update',x]);return q;},
 async single(){return insertResult;},
 async maybeSingle(){return mode==='update'?updateResult:lookupResult;}
 };return q;}};
}
test('verified insert succeeds once without secondary lookup',async()=>{
 const db=client({insertResult:{data:saved}});
 assert.equal(await api.createOrRecover(db,request,'u1'),saved);
 assert.deepEqual(db.calls,[['insert',request]]);
});
test('lost response recovers exact source identity without another ticket id',async()=>{
 const db=client({insertResult:{error:{code:'23505'}},lookupResult:{data:saved}});
 assert.equal(await api.createOrRecover(db,request,'u1'),saved);
 assert.deepEqual(db.calls,[['insert',request],['eq','id','ticket1'],['eq','restaurant_id','r1'],['eq','owner_id','u1']]);
});
test('unconfirmed insert or mismatching ticket never displays success',async()=>{
 for(const row of [null,{...saved,restaurant_id:'r2'},{...saved,owner_id:'u2'},{...saved,message:'different'}]){
  const db=client({insertResult:{error:{}},lookupResult:{data:row}});
  await assert.rejects(api.createOrRecover(db,request,'u1'),/not confirmed/);
 }
});
test('admin response guards optimistic revision and checks saved result',async()=>{
 const updated={...saved,status:'Resolved',admin_response:'Fixed',updated_at:'v2'};
 const db=client({updateResult:{data:updated}});
 assert.equal(await api.updateTicket(db,saved,'Resolved',' Fixed '),updated);
 assert.deepEqual(db.calls,[['update',{status:'Resolved',admin_response:'Fixed'}],['eq','id','ticket1'],['eq','updated_at','v1']]);
 await assert.rejects(api.updateTicket(client({updateResult:{data:null}}),saved,'Resolved','Fixed'),/not confirmed/);
 await assert.rejects(api.updateTicket(db,{...saved,updated_at:null},'Resolved','Fixed'),/revision/);
});
test('integration reuses Settings and Support, clears session, avoids HTML injection',()=>{
 const html=fs.readFileSync('index.html','utf8'),js=fs.readFileSync('assets/owner-support-tickets.js','utf8');
 assert.match(html,/owner-support-tickets\.js/);
 assert.match(html,/BiteOwnerSupport\?\.init\(/);
 assert.match(html,/BiteOwnerSupport\?\.clear\(/);
 assert.match(html,/BiteOwnerSupport\?\.mount\(id\)/);
 assert.doesNotMatch(js,/\.innerHTML\s*=/);
 assert.match(js,/\.eq\('restaurant_id',rid\)\.eq\('owner_id',userId\)/);
});
