const {test}=require('node:test');
const assert=require('node:assert/strict');
const flow=require('../assets/owner-checkin-flow.js');
const guests=[{id:'a',full_name:'Gaurav Joshi',phone:'9999912345',address:'Rajsamand'},{id:'b',full_name:'Ravi Gaurav',phone:'8888812345'},{id:'c',full_name:'Gaurav Joshi',phone:'7777700000'}];
test('guest suggestions match names or formatted mobile and preserve distinct same-name people',()=>{
 assert.deepEqual(flow.guestMatches(guests,'gaurav').map(g=>g.id),['a','c','b']);
 assert.deepEqual(flow.guestMatches(guests,'99999 12345').map(g=>g.id),['a']);
 assert.equal(flow.guestMatches(guests,'').length,0);
 assert.equal(flow.guestMatches(guests,'Gaurav 1').length,0);
});
test('saved guest fills the latest personal and travel details while current stay terms stay editable',()=>{
 const out=flow.savedProfile(guests[0],[{guest_id:'a',created_at:'2026-11-01',registration:{arrived_from:'Old place'}},{guest_id:'a',created_at:'2026-11-16',nightly_rate:1200,arrival:'2026-11-16',registration:{arrived_from:'Udaipur',next_destination:'Jaipur',transport:'Car',vehicle_number:'RJ01AB1234',male:2}},{guest_id:'b',created_at:'2026-11-17',registration:{arrived_from:'Wrong guest'}}]);
 assert.equal(out.full_name,'Gaurav Joshi');assert.equal(out.address,'Rajsamand');assert.equal(out.arrived_from,'Udaipur');assert.equal(out.vehicle_number,'RJ01AB1234');
 for(const key of ['arrival','nightly_rate','room_id','advance_amount','male'])assert.ok(!Object.hasOwn(out,key),key);
});
