const {test}=require('node:test');const assert=require('node:assert/strict');
const R=require('../assets/owner-guest-register.js');
test('register preserves per-entry identity and travel snapshots when the profile changes',()=>{
 const [row]=R.records({guests:[{id:'g',full_name:'New name',phone:'new phone',address:'New address'}],rooms:[{id:'r',number:'104'}],stays:[{id:'s',guest_id:'g',room_id:'r',register_number:7,arrival:'2026-11-17',arrival_time:'07:17:00',departure:'2026-11-18',status:'checked_out',nightly_rate:1400,registration:{entry_date:'2026-11-17',guest_snapshot:{full_name:'Original guest',phone:'9999999999',address:'Original address'},male:1,female:1,children:1,arrived_from:'Udaipur',next_destination:'Jaipur',transport:'Car',vehicle_number:'RJ00QA0000'}}]});
 assert.equal(row.name,'Original guest');assert.equal(row.phone,'9999999999');assert.equal(row.address,'Original address');assert.equal(row.arrival_time,'07:17');assert.equal(row.room,'104');assert.equal(row.serial,7);assert.equal(row.male+row.female+row.children,3);
});
test('older register entries use issued guest identity before the current profile',()=>{
 const [row]=R.records({guests:[{id:'g',full_name:'Current guest',address:'Current address'}],stays:[{id:'s',guest_id:'g',arrival:'2026-01-01'}],folios:[{stay_id:'s',invoice_snapshot:{guest:{name:'Issued name',address:'Issued address'}}}]});assert.equal(row.name,'Issued name');assert.equal(row.address,'Issued address');assert.equal(row.snapshot,false);
});
test('register export includes all rows and excludes private photo identifiers or URLs',()=>{
 const rows=R.records({guests:[{id:'g',full_name:'Synthetic guest',phone:'9999999999'}],stays:[{id:'s',guest_id:'g',register_number:1,arrival:'2026-11-17',registration:{id_front:'PRIVATE-FRONT',id_back:'PRIVATE-BACK',additional_ids:[{name:'Companion',id_front:'PRIVATE-COMPANION'}]}}]});const sheet=R.exportRows(rows);assert.equal(sheet.length,2);assert(sheet[0].includes('Permanent address'));assert(sheet[1].includes('Companion'));assert(!JSON.stringify(sheet).includes('PRIVATE-'));assert(sheet[1].includes('Yes'));
});
