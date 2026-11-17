'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/owner-reference-v3.js','utf8');
const styles=fs.readFileSync('assets/owner-image-home.css','utf8');
const nav=fs.readFileSync('assets/owner-mobile-navigation.js','utf8');
const markup=fs.readFileSync('index.html','utf8');
function harness({housekeeping=false,gst=false,paid=true}={}){
 const home={hidden:true,innerHTML:'',querySelectorAll:()=>[]};
 const badge={hidden:true,textContent:''};
 const bell={hidden:true,querySelector:s=>s==='i'?badge:null};
 const doc={body:{dataset:{role:'owner'},classList:{add(){},remove(){}}},
  getElementById:id=>id==='biteV3Home'?home:id==='biteV3HeaderBell'?bell:null,
  visibilityState:'visible'};
 const property={id:'property-a',name:'QA Hotel',business_type:'hybrid',tax_profile:gst?{gstin:'SYNTHETICGST',reviewed:true}:{}};
 const snap={hotel:true,restaurant:true,ready:true,occupied:3,available:7,cleaning:1,arrivals:2};
 const root={console,document:doc,Date,
  BiteOwner:{day:()=> '2026-11-18'},
  BiteHospitality:{prop:()=>property,dashboardSnapshot:()=>snap,housekeepingVisible:()=>housekeeping,
   getWorkspace:()=>({stays:[{id:'stay-1',status:'in_house',arrival:'2026-11-18',registration:{entry_date:'2026-11-18'}},
    {id:'stay-2',status:'reserved',arrival:'2026-11-18'},
    {id:'stay-3',status:'checked_out',arrival:'2026-10-30'}]}),
   routeList:()=>['overview','rooms','pos','hotel-register','daily-book','hr','expenses','guests','orders','reports']},
  BiteOwnerConfirmations:{snapshot:()=>[{intent_id:'pending-1',state:'pending',expires_at:'2099-01-01T00:00:00Z',customer_name:'Test guest'}]},
  BiteOwnerOrderBurst:{paidOrderIds:()=>paid?new Set(['order-1']):new Set()},
  BiteDashboard:{summarize:()=>({active:[{id:'order-1',status:'Received',code:'BITE-TEST'}],
   todayOrders:[],stages:{Received:1},week:[],todaySales:0,todayPosBilled:0,todayExpenses:0})}};
 root.window=root;
 vm.runInNewContext(source,{window:root,console,Date,Intl});
 root.BiteOwnerReferenceV3.refresh({financials:[]},{role:'owner',restaurantId:'r-a'});
 return {home,badge,snap,root};
}
test('Hybrid Home uses actual hotel counts, approved cards and property register, not image dummy values',()=>{
 const {home,badge}=harness();
 for(const label of ['Room Status','New POS Bill','Check-in','Daily Book','Staff Attendance','Expenses','Hotel Register']){
  assert.ok(home.innerHTML.includes(label),label);
 }
 assert.match(home.innerHTML,/Occupied <b>3<\/b>/);
 assert.match(home.innerHTML,/Available <b>7<\/b>/);
 assert.match(home.innerHTML,/Nov · 1 entry/);
 assert.doesNotMatch(home.innerHTML,/Cleaning|All caught up|Business snapshot|₹2,290/);
 assert.equal(badge.textContent,'2'); // pending approval + verified new paid order
});
test('Housekeeping controls cleaning visibility; GST shortcut follows registered tax settings',()=>{
 const off=harness({housekeeping:false,gst:false});
 const on=harness({housekeeping:true,gst:true});
 assert.doesNotMatch(off.home.innerHTML,/Cleaning|GST Collection/);
 assert.match(on.home.innerHTML,/Cleaning <b>1<\/b>/);
 assert.match(on.home.innerHTML,/GST Collection/);
});
test('Unverified Received order is not advertised as paid in notification badge',()=>{
 const {badge}=harness({paid:false});
 assert.equal(badge.textContent,'1'); // only pre-payment approval
});
test('Main actions use existing route/permission gates and notification tray opens real orders',()=>{
 for(const route of ['rooms','hotel-register','pos','daily-book','hr','expenses','guests']){
  assert.match(source,new RegExp("permitted\\(route\\)"),route);
 }
 assert.match(source,/data-bv3-new-pos="true"/);
 assert.match(source,/data-bv3-attendance="true"/);
 assert.match(source,/BiteOwnerHRTabs\.activate/);
 assert.match(source,/data-bv3-notice-index/);
 assert.match(source,/toggleNoticeTray\(false\)/);
 assert.match(source,/route\(item\.route,item\.filter,false,item\)/);
 assert.match(source,/focusNotificationOrder\(notification\)/);
 assert.match(nav,/Bite Orders/);
 assert.match(nav,/Restaurant POS/);
 assert.match(markup,/assets\/owner-image-home\.css\?v=20261118-image-home1/);
 assert.match(markup,/assets\/owner-reference-v3\.js\?v=20261118-image-home1/);
});
test('Illustrated design is CSS/SVG, mobile-only with reduced motion and no insecure remote images',()=>{
 for(const asset of ['owner-home-palace.svg','owner-home-service-bell.svg','owner-home-ledger.svg']){
  assert.match(styles,new RegExp(asset.replaceAll('.','\\.')));
  assert.ok(fs.existsSync('assets/'+asset));
 }
 assert.match(styles,/@media\(max-width:760px\)/);
 assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/);
 assert.doesNotMatch(styles,/https?:\/\/|data:image\/base64/);
});
