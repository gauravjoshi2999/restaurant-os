'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Family=require('../assets/owner-family-checkin.js');
function plan(ids,advance=0){
 const old=globalThis.FormData;globalThis.FormData=class{getAll(){return['B']}};
 const elements={family_enabled:{checked:true},family_adults_B:{value:'2'},family_children_B:{value:'0'},family_female_B:{value:'0'},family_rate_B:{value:'1300'},family_note_B:{value:'Family'}};
 try{return Family.plan({elements,dataset:{},querySelectorAll:()=>Array(ids)}, {room_id:'A',full_name:'QA Family',male:'2',female:'0',children:'0',mode:'checkin',nightly_rate:'1200',arrival:'2026-11-18',departure:'2026-11-19',advance_amount:advance,advance_method:'Cash'}, {rooms:[{id:'A',active:true,adults:4,children:2},{id:'B',active:true,adults:4,children:2}]});}finally{globalThis.FormData=old}
}
test('four adult family: two IDs suffice; extra IDs remain optional',()=>{
 assert.equal(plan(1).rooms.reduce((n,r)=>n+r.adults,0),4);
 assert.equal(plan(2).rooms.length,2);
 assert.throws(()=>plan(0),/2 guest IDs/);
});
test('a received family advance is carried once to the atomic family request',()=>{
 const payload=plan(1,2000);assert.equal(payload.advance_amount,2000);assert.equal(payload.advance_method,'Cash');assert.ok(payload.rooms.every(r=>!Object.hasOwn(r,'advance_amount')));
});
function home({due=1,allow=true,restaurant=false}={}){
 const el={hidden:true,innerHTML:'',querySelectorAll:()=>[]},badge={};
 const property={id:'P',business_type:restaurant?'hybrid':'hotel',tax_profile:{}};
 const db={stays:[],guests:[{id:'G',full_name:'QA Due Guest'}],rooms:[{id:'R',number:'101'}],folios:[{id:'F',stay_id:'S'}]};
 const root={console,Date,document:{body:{dataset:{role:'owner'},classList:{add(){},remove(){}}},getElementById:id=>id==='biteV3Home'?el:id==='biteV3HeaderBell'?{querySelector:()=>badge}:null,visibilityState:'visible'},BiteOwner:{day:()=> '2026-11-18'},BiteHospitality:{prop:()=>property,getWorkspace:()=>db,checkoutDue:()=>due?[{id:'S',guest_id:'G',room_id:'R',departure:'2026-11-18'}]:[],dashboardSnapshot:()=>({hotel:true,restaurant,ready:true,departures:due,occupied:due,available:2-due}),routeList:()=>['overview','rooms','hotel-register','guests',...(allow?['checkouts','folios']:[])],housekeepingVisible:()=>false}};
 root.window=root;vm.runInNewContext(fs.readFileSync('assets/owner-reference-v3.js','utf8'),{window:root,console,Date,Intl});root.BiteOwnerReferenceV3.refresh({}, {role:'owner',property,restaurantId:null});return{el,badge};
}
test('checkout count and due notifications work for a hotel with no restaurant outlet',()=>{
 const {el,badge}=home();assert.match(el.innerHTML,/data-checkout-count>1</);assert.equal(badge.textContent,'1');
});
test('zero due guests clears the bell badge and shows a zero count',()=>{
 const {el,badge}=home({due:0});assert.match(el.innerHTML,/data-checkout-count>0</);assert.equal(badge.hidden,true);
});
test('checkout shortcut and notifications respect server-granted folio routes',()=>{
 const {el,badge}=home({allow:false});assert.doesNotMatch(el.innerHTML,/data-checkout-count/);assert.equal(badge.hidden,true);
});
