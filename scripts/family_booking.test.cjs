'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Family=require('../assets/owner-family-checkin.js');
const HTML=fs.readFileSync('index.html','utf8');
const HOME=fs.readFileSync('assets/owner-hospitality.js','utf8');
const BACKEND=fs.readFileSync('supabase/migrations/20261118010000_atomic_family_multi_room_booking.sql','utf8');
test('family step is loaded only in the existing Check-in flow',()=>{
 assert.match(HTML,/assets\/owner-family-checkin\.js\?v=/);
 assert.match(HTML,/assets\/owner-family-checkin\.css\?v=/);
 assert.match(HOME,/BiteFamilyCheckin\?\.decorate\(\$\('bhCheckinForm'\)/);
 assert.match(HOME,/BiteFamilyCheckin\?\.plan\(form,f,data\)/);
 assert.match(HOME,/BiteFamilyCheckin\.commit\(sent,prop\(\)\.id,identity\(\),ctx\.sb\)/);
 assert.match(HOME,/BiteHotelAccounts\?\.saveDocuments\(guestId,form\)/);
 assert.match(HOME,/BiteOwnerOperations\.reservationQuote/);
 assert.match(HOME,/ctx\.navigate\('folios'\)/);
});
test('per-room registration retains protected guest ID references without repeating the room folio',()=>{
 const ids=[
  {subject_key:'a',name:'Mother',id_front:'id-a',id_back:'id-b'},
  {subject_key:'b',name:'Uncle',id_front:'id-c',id_back:'id-d'},
  {subject_key:'c',name:'Aunt',id_front:'id-e',id_back:'id-f'}
 ];
 const original={guest_id:'lead-id',registration:{male:1,female:1,children:0,id_front:'main-id',id_back:'main-back',
   additional_ids:ids,guest_snapshot:{full_name:'Lead'}},
   rooms:[{room_id:'R1',adults:2,children:0},{room_id:'R2',adults:2,children:0,female:1}]};
 const built=Family.withRoomRegistrations(original);
 assert.equal(built.rooms.length,2);
 assert.equal(built.rooms[0].registration.id_front,'main-id');
 assert.equal(built.rooms[0].registration.additional_ids.length,1);
 assert.equal(built.rooms[1].registration.additional_ids.length,1);
 assert.equal(built.rooms[1].registration.male,1);
 assert.equal(built.rooms[1].registration.female,1);
 assert.equal(built.rooms[0].registration.family_guest_ids.length,3);
 assert.equal(original.rooms[0].registration,undefined,'original caller payload not mutated');
 assert.doesNotMatch(JSON.stringify(built),/secret_key|service_role/);
});
test('family booking carries stable request identity across uncertain network responses',async()=>{
 const store=new Map(),calls=[],origLocal=globalThis.localStorage,origCrypto=globalThis.crypto;
 globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 try{
  const payload={guest_id:'lead-a',registration:{male:1,female:0,id_front:'a',id_back:'b'},rooms:[{room_id:'A',adults:1,children:0,nightly_rate:100},{room_id:'B',adults:1,children:0,nightly_rate:100}]};
  const rpc={rpc:async(name,args)=>{calls.push({name,args});return calls.length===1?{error:{message:'Transport unknown'}}:{data:{id:'group-id',stays:[{folio_id:'f-a'},{folio_id:'f-b'}]}};}};
  await assert.rejects(Family.commit(payload,'property-a','user-a:property-a',rpc),/Transport unknown/);
  const response=await Family.commit(payload,'property-a','user-a:property-a',rpc);
  assert.equal(response.booking.stays.length,2);
  assert.equal(calls[0].name,'bite_family_booking');
  assert.equal(calls[0].args.p_request,calls[1].args.p_request,'same request ID on retry');
  await assert.rejects(Family.commit({...payload,name:'Changed booking'},'property-a','user-a:property-a',rpc),/Earlier family booking/);
  Family.clearAttempt(response.requestKey);
  assert.equal(store.size,0);
 }finally{globalThis.localStorage=origLocal;globalThis.crypto=origCrypto;}
});
test('backend only books all rooms in one transaction and uses existing vetted commands',()=>{
 assert.match(BACKEND,/public\.bite_property_command\(p_property,'reserve'/);
 assert.match(BACKEND,/public\.bite_property_command\([\s\S]*?'checkin'/);
 assert.match(BACKEND,/p_request/);
 assert.match(BACKEND,/private\.bite_can\(p_property,'guest_register'\)/);
 assert.match(BACKEND,/p_property and request_id=p_request/);
 assert.match(BACKEND,/insert into public\.bite_booking_groups/);
 assert.match(BACKEND,/revoke all on function public\.bite_family_booking/);
 assert.doesNotMatch(BACKEND,/insert into public\.restaurant_order_payments/);
});
