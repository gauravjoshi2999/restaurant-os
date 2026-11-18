'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/owner-reference-v3.js','utf8')
  .replace('root.BiteOwnerReferenceV3={refresh,',
    'root.__roomTest={recoverRoomSnapshot,roomStatusCard};root.BiteOwnerReferenceV3={refresh,');
const css=fs.readFileSync('assets/owner-image-home.css','utf8');
const index=fs.readFileSync('index.html','utf8');

function makeFixture(){
 let property={id:'hotel-1'},ready=false,loads=0,throws=false;
 const timers=[];
 const hospitality={
  prop:()=>property,
  dashboardSnapshot:()=>({hotel:true,ready,occupied:0,available:7,departures:0}),
  routeList:()=>['overview','rooms','hotel-register','checkouts'],
  housekeepingVisible:()=>false,
  reload:async()=>{loads++;if(throws)throw Error('simulated offline');ready=true;}
 };
 const doc={readyState:'loading',body:{dataset:{role:'owner'}},
  getElementById:()=>null,addEventListener(){}};
 const root={document:doc,console:{warn(){}},BiteHospitality:hospitality,
  setTimeout:(callback,ms)=>{timers.push({callback,ms});return timers.length}};
 root.window=root;
 vm.runInNewContext(source,{window:root,console,Date});
 root.BiteOwnerReferenceV3.refresh({orders:[],financials:[],expenses:[]},
  {role:'owner',restaurantId:'restaurant-1'});
 return {api:root.__roomTest,timers,hospitality,
  get loads(){return loads},
  setReady(value){ready=value},
  setProperty(value){property=value},
  setThrows(value){throws=value}};
}
test('Room counts are fetched once per property, never substituted with invented numbers',async()=>{
 const f=makeFixture(),snapshot=f.hospitality.dashboardSnapshot();
 f.api.recoverRoomSnapshot(snapshot);
 f.api.recoverRoomSnapshot(snapshot);
 assert.equal(f.timers.length,1,'multiple render events should not create multiple refreshes');
 assert.equal(f.timers[0].ms,3500,'retry leaves time for initial cloud load');
 await f.timers[0].callback();
 assert.equal(f.loads,1,'one read-only hospitality refresh');
 const home=f.api.roomStatusCard(f.hospitality.dashboardSnapshot());
 assert.match(home,/Occupied <b>0<\/b>/);
 assert.match(home,/Available <b>7<\/b>/);
 assert.doesNotMatch(home,/Syncing room data/);
 assert.match(index,/BiteHospitality\.reload/);
});
test('Unknown counts never display as zero when the hotel data is not ready',()=>{
 const f=makeFixture();
 const markup=f.api.roomStatusCard(f.hospitality.dashboardSnapshot());
 assert.match(markup,/Occupied <b>—<\/b>/);
 assert.match(markup,/Available <b>—<\/b>/);
 assert.match(markup,/Syncing room data · Tap to retry/);
 assert.match(css,/\.boh-room-sync/);
});
test('Failed snapshot retry shows a readable retry state without changing backend records',async()=>{
 const f=makeFixture();f.setThrows(true);
 f.api.recoverRoomSnapshot(f.hospitality.dashboardSnapshot());
 await f.timers[0].callback();
 assert.equal(f.loads,1);
 const markup=f.api.roomStatusCard(f.hospitality.dashboardSnapshot());
 assert.match(markup,/Room data sync failed · Tap to retry/);
 const section=source.slice(source.indexOf('function recoverRoomSnapshot('),source.indexOf('function actionLink('));
 assert.doesNotMatch(section,/\.(?:insert|upsert|update|delete)\(/);
});
test('Stale retry must not affect a newly selected hotel',async()=>{
 const f=makeFixture();
 f.api.recoverRoomSnapshot(f.hospitality.dashboardSnapshot());
 f.setProperty({id:'different-hotel'});
 await f.timers[0].callback();
 assert.equal(f.loads,0);
});
