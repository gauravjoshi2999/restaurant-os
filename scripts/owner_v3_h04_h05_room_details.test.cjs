'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

 assert.match(index,/owner-hospitality\.js\?v=20261119-[a-z0-9-]+/);
const css=fs.readFileSync('assets/owner-hotel-polish.css','utf8');
const index=fs.readFileSync('index.html','utf8');
const marker=' root.BiteHospitality={header,';
assert.equal(source.split(marker).length-1,1,'Owner Hospitality export insertion point must stay unique');
const script=source.replace(marker,
 " root.__roomDetailTest={roomDetailMarkup,roomState,setData:next=>{data=next;workspaceReady=true},setCtx:next=>{ctx=next}};\n"+marker);

function fixture({role='owner',capabilities=['hotel_rooms','guest_register','folios','charge_to_room'],restaurantId='rest-1'}={}){
 const property={id:'property-1',role,capabilities,business_type:'hybrid'};
 const root={BiteCapabilities:{has:(p,c)=>!!p?.capabilities?.includes(c)},BiteOwner:{day:()=> '2026-11-19'}};
 root.window=root;
 vm.runInNewContext(script,{window:root,console});
 const api=root.__roomDetailTest;
 api.setCtx({getAccess:()=>({property,restaurantId})});
 const setData=value=>api.setData({rooms:[],stays:[],guests:[],groups:[],folios:[],...value});
 return {api,property,setData};
}

test('H04 clean vacant room opens its own details and safe check-in shortcut',()=>{
 const f=fixture(),room={id:'101',number:'101',room_type:'Deluxe',active:true,housekeeping:'ready'};
 f.setData({rooms:[room]});
 const html=f.api.roomDetailMarkup(room);
 assert.match(html,/Room 101/);
 assert.match(html,/Available today/);
 assert.match(html,/data-hotel-action="room-detail-checkin"/);
 assert.doesNotMatch(html,/data-hotel-action="room-detail-food"/);
 assert.doesNotMatch(html,/data-hotel-action="room-detail-extra"/);
 assert.doesNotMatch(html,/No balance due/);
});

test('H05 occupied family room links existing stay, group, folio, food and hotel extra',()=>{
 const f=fixture(),room={id:'101',number:'101',room_type:'Deluxe',active:true,housekeeping:'ready'};
 const second={id:'102',number:'102',room_type:'Deluxe',active:true,housekeeping:'ready'};
 const stay={id:'stay-1',room_id:'101',guest_id:'guest-1',group_id:'group-1',status:'in_house',arrival:'2026-11-18',departure:'2026-11-20'};
 f.setData({rooms:[room,second],stays:[stay,{...stay,id:'stay-2',room_id:'102'}],
  guests:[{id:'guest-1',full_name:'Sharma family'}],
  groups:[{id:'group-1',name:'Sharma group'}],
  folios:[{id:'folio-1',stay_id:'stay-1',status:'open',totals:{balance:2500}}]});
 const html=f.api.roomDetailMarkup(room);
 assert.match(html,/Sharma family/);
 assert.match(html,/Sharma group/);
 assert.match(html,/Linked rooms: 101, 102/);
 assert.match(html,/₹2,500/);
 assert.match(html,/data-hotel-action="folio"/);
 assert.match(html,/data-hotel-action="room-detail-food"/);
 assert.match(html,/data-hotel-action="room-detail-extra"/);
 assert.match(html,/data-hotel-action="stay-options"/);
 assert.doesNotMatch(html,/data-hotel-action="room-detail-checkin"/);
});

test('H04 blocked room is not offered for check-in; housekeeping hidden when module is off',()=>{
 const f=fixture(),room={id:'301',number:'301',room_type:'Suite',active:true,housekeeping:'blocked',status_note:'AC maintenance'};
 f.setData({rooms:[room]});
 const html=f.api.roomDetailMarkup(room);
 assert.match(html,/Blocked/);
 assert.match(html,/AC maintenance/);
 assert.doesNotMatch(html,/data-hotel-action="room-detail-checkin"/);
 assert.doesNotMatch(html,/data-hotel-action="room-status"/);
 assert.doesNotMatch(html,/data-hotel-action="room-privacy"/);
});

test('H05 no invented payable balance when verified folio totals are absent',()=>{
 const f=fixture(),room={id:'101',number:'101',room_type:'Deluxe',active:true,housekeeping:'ready'};
 f.setData({rooms:[room],stays:[{id:'stay-1',room_id:'101',guest_id:'guest-1',status:'in_house',arrival:'2026-11-19',departure:'2026-11-20'}],
  folios:[{id:'folio-1',stay_id:'stay-1',status:'open'}]});
 const html=f.api.roomDetailMarkup(room);
 assert.match(html,/Balance unavailable/);
 assert.doesNotMatch(html,/No balance due/);
});

test('H05 receptionist never receives owner-only food or room edit shortcuts',()=>{
 const f=fixture({role:'receptionist'}),room={id:'101',number:'101',room_type:'Deluxe',active:true,housekeeping:'ready'};
 f.setData({rooms:[room],stays:[{id:'stay-1',room_id:'101',status:'in_house',arrival:'2026-11-19',departure:'2026-11-20'}],
  folios:[{id:'folio-1',stay_id:'stay-1',status:'open',totals:{balance:0}}]});
 const html=f.api.roomDetailMarkup(room);
 assert.match(html,/data-hotel-action="room-detail-extra"/);
 assert.doesNotMatch(html,/data-hotel-action="room-detail-food"/);
 assert.doesNotMatch(html,/data-hotel-action="edit-room"/);
});

test('H05 escapes property/guest-supplied text and rejects stale tenant room references',()=>{
 const f=fixture(),room={id:'101',number:'<script>x</script>',room_type:'Deluxe',active:true,housekeeping:'ready'};
 f.setData({rooms:[room],stays:[{id:'stay-1',room_id:'101',guest_id:'guest-1',status:'in_house',arrival:'2026-11-19',departure:'2026-11-20'}],
  guests:[{id:'guest-1',full_name:'<img src=x onerror=alert(1)>'}]});
 const html=f.api.roomDetailMarkup(room);
 assert.doesNotMatch(html,/<script>|<img src=x/);
 assert.match(html,/&lt;img/);
 f.setData({rooms:[{id:'201',number:'201',room_type:'Suite',active:true,housekeeping:'ready'}]});
 assert.throws(()=>f.api.roomDetailMarkup(room),/Room information is unavailable/);
});

test('H04/H05 links, assets and responsive CSS are wired into the existing Owner dashboard',()=>{
 assert.match(source,/btn\('room-details','View details',r\.id\)/);
 assert.match(source,/else if\(action==='room-details'\)/);
 assert.match(source,/else if\(action==='room-detail-food'\|\|action==='room-detail-extra'\)/);
 assert.match(source,/else if\(action==='room-detail-checkin'\)/);
 assert.match(source,/Reserved today/);
 assert.match(source,/Other \/ unavailable/);
 assert.match(index,/owner-hospitality\.js\?v=20261119-h04filter1/);
 assert.match(index,/owner-hotel-polish\.css\?v=20261119-h04filter1/);
 assert.match(css,/Owner V3 H04–H05/);
 assert.match(css,/@media\(max-width:480px\)/);
 assert.match(css,/@media\(max-width:350px\)/);
 const body=source.slice(source.indexOf('function roomDetailMarkup('),source.indexOf('function renderHome()'));
 assert.doesNotMatch(body,/\.(?:insert|upsert|update|delete)\(/,'room detail must be read-only');
});


test('H04 floor and room-type filtering remains read-only, reversible and correctly scoped',()=>{
 assert.match(source,/data-room-filter="floor"/);
 assert.match(source,/data-room-filter="type"/);
 assert.match(source,/data-room-floor/);
 assert.match(source,/data-room-type/);
 assert.match(source,/function applyRoomFilters\(target\)/);
 assert.match(source,/roomFilters=\{floor:'',type:''\}/);
 assert.match(source,/data-room-filter-empty/);
 assert.match(source,/card\.style\.setProperty\('display','none','important'\)/);
 assert.match(source,/Clear filters/);
 assert.match(css,/\.bh-room-card\[hidden\]/);
 const body=source.slice(source.indexOf('function applyRoomFilters(target)'),source.indexOf('function pendingRegistration()'));
 assert.doesNotMatch(body,/\.(?:insert|update|upsert|delete|rpc)\(/);
});
