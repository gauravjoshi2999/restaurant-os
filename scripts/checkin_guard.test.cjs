const {test}=require('node:test'),assert=require('node:assert/strict');
global.BiteOwner=require('../assets/owner-core.js');
const G=require('../assets/owner-checkin-guard.js');
const day='2026-11-17',room={id:'r',active:true,housekeeping:'ready'},stay={id:'s',room_id:'r',arrival:'2026-11-16',departure:'2026-11-17',status:'in_house'};
test('an overdue physical occupant blocks Check in now even outside the old booking dates',()=>assert.equal(G.roomAvailability(room,[stay],day,'2026-11-18','checkin','',day),'Occupied'));
test('a future reservation can use a room occupied today after the earlier stay ends',()=>assert.equal(G.roomAvailability(room,[stay],'2026-11-20','2026-11-21','reserve','',day),''));
test('overlapping reservations and maintenance are unavailable, while the current edited stay is excluded',()=>{
 const booking={...stay,status:'reserved',arrival:day,departure:'2026-11-19'};
 assert.match(G.roomAvailability(room,[booking],day,'2026-11-18','reserve','',day),/Reserved/);
 assert.equal(G.roomAvailability(room,[booking],day,'2026-11-18','reserve','s',day),'');
 assert.equal(G.roomAvailability({...room,housekeeping:'blocked'},[],day,'2026-11-18','checkin','',day),'Unavailable');
});
test('late departure/turnover conflicts and unreleased vacant rooms are explained',()=>{
 assert.match(G.roomAvailability(room,[{...stay,status:'reserved',expected_checkout_at:'2026-11-17T13:00:00+05:30'}],day,'2026-11-18','reserve','',day),/timing/);
 assert.match(G.roomAvailability({...room,housekeeping:'dirty'},[],day,'2026-11-18','checkin','',day),/released/);
});
test('drafts distinguish unsaved, saved reservation, completed, expired and corrupted entries',()=>{
 const raw={savedAt:100,fields:{full_name:'Saved guest'}};
 assert.equal(G.draftState(raw,[],200).kind,'draft');
 assert.equal(G.draftState({...raw,fields:{stay_id:'s'}},[{id:'s',status:'reserved'}],200).kind,'reserved');
 for(const status of ['in_house','checked_out','cancelled','no_show'])assert.equal(G.draftState({...raw,fields:{stay_id:'s'}},[{id:'s',status}],200).kind,'stale');
 assert.equal(G.draftState(raw,[],86400200).kind,'none');assert.equal(G.draftState({fields:{}},[],200).kind,'none');
});
const foreign={nationality:'France',date_of_birth:'1990-01-01',document_type:'passport',document_last4:'A123',document_expiry:'2030-01-01',visa_status:'visa',permission_last4:'V123',visa_expiry:'2027-01-01',india_arrival:'2026-11-01',entry_port:'Delhi',purpose:'Tourism'};
test('foreign dates, travel references and nationality point to the field needing correction',()=>{
 G.validateForeign(foreign,day);
 for(const [key,value,field]of [['nationality','India','country'],['document_last4','FULL-NUMBER','foreign_document_last4'],['document_expiry','2020-01-01','foreign_document_expiry'],['visa_expiry','2020-01-01','foreign_visa_expiry'],['india_arrival','2026-12-01','foreign_india_arrival']])assert.throws(()=>G.validateForeign({...foreign,[key]:value},day),e=>e.field===field);
});
test('OCI skips visa expiry, and exempt non-passport documents can explicitly have no expiry',()=>{
 G.validateForeign({...foreign,visa_status:'oci',visa_expiry:''},day);
 G.validateForeign({...foreign,nationality:'Nepal',visa_status:'exempt',permission_last4:'',visa_expiry:'',document_type:'travel_document',document_no_expiry:true,document_expiry:''},day);
 assert.throws(()=>G.validateForeign({...foreign,document_no_expiry:true,document_expiry:''},day));
});
