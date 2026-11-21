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


test('H06 original entry date supports Day, Month and Range without changing saved stays',()=>{
 const rows=R.records({stays:[
  {id:'oct',arrival:'2026-10-01',registration:{entry_date:'2026-10-01'}},
  {id:'nov10',arrival:'2026-11-10',registration:{entry_date:'2026-11-10'}},
  {id:'nov12',arrival:'2026-11-12',registration:{entry_date:'2026-11-12'}},
  {id:'bad',arrival:'2026-10-11',registration:{entry_date:'invalid-date'}}
 ]});
 const select=period=>rows.filter(r=>R.inPeriod(r,period)).map(r=>r.id);
 assert.deepEqual(select(null),['nov12','nov10','bad','oct']);
 assert.deepEqual(select({mode:'day',from:'2026-10-01',to:'2026-10-01'}),['oct']);
 assert.deepEqual(select({mode:'month',from:'2026-11-01',to:'2026-11-19'}),['nov12','nov10']);
 assert.deepEqual(select({mode:'range',from:'2026-10-01',to:'2026-11-10'}),['nov10','oct']);
 assert.deepEqual(select({mode:'day',from:'2026-09-10',to:'2026-09-10'}),[]);
 assert.equal(rows.length,4,'Only the read-only filtered presentation changes');
});

test('H07 close guard protects changed fields beyond guest name, including date, room and ID files',()=>{
 const input=(name,value,initial='',type='text')=>({name,value,defaultValue:initial,type,disabled:false});
 const unchanged=[input('full_name',''),input('arrival','2026-11-19','2026-11-19','date'),input('male','1','1','number')];
 assert.equal(R.hasUnsavedCheckinChanges({elements:unchanged}),false);
 assert.equal(R.hasUnsavedCheckinChanges({elements:[...unchanged,input('female','2','0','number')]}),true);
 assert.equal(R.hasUnsavedCheckinChanges({elements:[...unchanged,input('departure','2026-11-22','2026-11-20','date')]}),true);
 assert.equal(R.hasUnsavedCheckinChanges({elements:[...unchanged,{name:'room_id',type:'select-one',tagName:'SELECT',selectedIndex:1,options:[{defaultSelected:false},{defaultSelected:false}]}]}),true);
 assert.equal(R.hasUnsavedCheckinChanges({elements:[...unchanged,{name:'id_front',type:'file',files:[{name:'private.jpg'}]}]}),true);
 assert.equal(R.hasUnsavedCheckinChanges({elements:[...unchanged,{name:'id_checked',type:'checkbox',checked:true,defaultChecked:false}]}),true);
 assert.equal(R.hasUnsavedCheckinChanges({elements:[...unchanged,input('id_front_id','sensitive-hidden','','hidden')]}),false);
 assert.equal(R.hasUnsavedCheckinChanges({elements:[...unchanged,{name:'guest_id',type:'select-one',tagName:'SELECT',selectedIndex:0,options:[{defaultSelected:false},{defaultSelected:false}]}]}),false);
});

test('H06 period filter rejects impossible dates while All dates keeps old records accessible',()=>{
 const period={mode:'month',from:'2026-02-01',to:'2026-03-01'};
 for(const entry_date of ['2026-02-29','2026-02-30','2026-02-00','2026-01-32','invalid-date','']){
  assert.equal(R.inPeriod({entry_date},period),false,entry_date);
  assert.equal(R.inPeriod({entry_date},null),true,entry_date);
 }
 assert.equal(R.inPeriod({entry_date:'2028-02-29'},{from:'2028-02-01',to:'2028-02-29'}),true);
 assert.equal(R.inPeriod({entry_date:'2026-02-28'},{from:'2026-02-30',to:'2026-03-01'}),false);
 assert.equal(R.inPeriod({entry_date:'2026-02-28'},period),true);
});
test('H06 unknown rent is blank in Excel rather than a false zero; confirmed zero remains zero',()=>{
 const values=[null,undefined,'','  ',false,true,[],{},'not recorded',-1,1.001,Infinity,'0x10',Number.MAX_SAFE_INTEGER];
 const rows=R.records({stays:values.map((nightly_rate,i)=>({id:'synthetic-'+i,nightly_rate,register_number:i}))});
 const sheet=R.exportRows(rows),col=sheet[0].indexOf('Agreed rent / night');
 assert.ok(col>=0);assert.ok(sheet.slice(1).every(row=>row[col]===''));
 for(const [value,expected] of [[0,0],['0',0],[1200.25,1200.25],['1200.25',1200.25]]){
  assert.equal(R.verifiedRent(value),expected);
  assert.equal(R.exportRows(R.records({stays:[{id:'valid',nightly_rate:value}]}))[1][col],expected);
 }
});
