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
test('PDF H01–H03 Home uses real tenant status, not old illustrated-card dashboard or sample rupees',()=>{
 const {home,badge}=harness();
 for(const label of ['Sales','Received','Due','Expenses','Live orders','Arrivals &amp; checkouts','Rooms','Recent activity','New POS bill','New check-in','Daily Book','Reports']){
  assert.ok(home.innerHTML.includes(label),label);
 }
 assert.match(home.innerHTML,/data-pdf-screen="H02-H03"/);
 assert.match(home.innerHTML,/Occupied<\/span><b>3<\/b>/);
 assert.match(home.innerHTML,/Ready<\/span><b>7<\/b>/);
 assert.doesNotMatch(home.innerHTML,/boh-feature-grid|boh-card-illustration|Room Status|New POS Bill|₹10,500|₹8,000|₹2,500/);
 assert.match(home.innerHTML,/Collection source verification pending/);
 assert.equal(badge.textContent,'2'); // one pending approval + one verified new paid order
});
test('PDF H02 respects optional housekeeping and does not fabricate GST or accounting totals',()=>{
 const off=harness({housekeeping:false,gst:false});
 const on=harness({housekeeping:true,gst:true});
 assert.doesNotMatch(off.home.innerHTML,/Cleaning<\/span>/);
 assert.match(on.home.innerHTML,/Cleaning<\/span><b>1<\/b>/);
 assert.doesNotMatch(off.home.innerHTML,/GST Collection|₹10,500/);
 assert.doesNotMatch(on.home.innerHTML,/GST Collection|₹10,500/);
 assert.match(on.home.innerHTML,/Cross-source totals show —/);
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
 assert.match(source,/const quickRoutes=/); // canonical PDF links preserve the guarded route function
 assert.match(source,/BiteOwnerHRTabs\.activate/);
 assert.match(source,/data-bv3-notice-index/);
 assert.match(source,/toggleNoticeTray\(false\)/);
 assert.match(source,/route\(item\.route,item\.filter,false,item\)/);
 assert.match(source,/focusNotificationOrder\(notification\)/);
 assert.match(nav,/label:'Orders'/);
 assert.match(nav,/label:'POS'/);
 assert.match(markup,/assets\/owner-image-home\.css\?v=20261118-room-hydration1/);
 assert.match(markup,/assets\/owner-reference-v3\.js\?v=20261118-pdf-stage1a/);
 assert.match(markup,/assets\/owner-pdf-v3-home\.css\?v=20261118-stage1-h03a/);
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

test('Final Home tabs match actual server-permitted hotel, restaurant and hybrid routes',()=>{
 const Mobile=require('../assets/owner-mobile-navigation.js');
 const pages=(type,allowed)=>Mobile.approvedHomeTabs({business_type:type},allowed).map(t=>t.page);
 assert.deepEqual(pages('hotel',['overview','rooms','hotel-register','folios','hr','expenses']),['overview','rooms','more']);
 assert.deepEqual(pages('restaurant',['overview','pos','orders','menu','hr']),['overview','orders','pos','more']);
 assert.deepEqual(pages('hybrid',['overview','rooms','orders','pos','menu','hr']),['overview','rooms','orders','pos','more']);
 assert.deepEqual(pages('restaurant',['overview','pos','menu']),['overview','pos','more'],'no restaurant Orders tab without permission');
 assert.deepEqual(pages('hybrid',['overview','rooms','hotel-register']),['overview','rooms','more'],'no restaurant tabs without outlet rights');
});
test('Approved Home hides old KPIs on mobile without deleting payments or reports',()=>{
 assert.match(styles,/#overview > :not\(#biteV3Home\)/);
 for(const old of ['od-metrics','od-pos-breakdown','od-finance-boundary','od-dashboard-grid','od-footer']){
  assert.ok(styles.includes('#overview .'+old),old);
  assert.ok(markup.includes('class="'+old)||markup.includes(' '+old),'original underlying bindings remain intact '+old);
 }
 assert.match(source,/overview\.dataset\.biteHomeCompact='true'/);
 const pdf=fs.readFileSync('assets/owner-pdf-v3-home.css','utf8');
 assert.match(pdf,/#overview>:not\(#biteV3Home\)/);
 assert.match(pdf,/@media\(min-width:761px\)/);
 assert.match(styles,/mask-image:linear-gradient/);
 assert.match(styles,/\.boh-feature>strong/);
});

test('Hotel-only Owner boots V3 Home without an online restaurant outlet or stale notifications',()=>{
 const home={hidden:true,innerHTML:'',querySelectorAll:()=>[]};
 const badge={hidden:true,textContent:''};
 const bell={hidden:true,querySelector:key=>key==='i'?badge:null};
 const doc={body:{dataset:{role:'owner'},classList:{add(){},remove(){}}},visibilityState:'visible',
  getElementById:id=>id==='biteV3Home'?home:id==='biteV3HeaderBell'?bell:id==='overview'?{dataset:{}}:null};
 const root={console,document:doc,Date,BiteOwner:{day:()=> '2026-11-18'},
  BiteHospitality:{prop:()=>({id:'hotel-only',business_type:'hotel',name:'Standalone Hotel',tax_profile:{}}),
   dashboardSnapshot:()=>({hotel:true,restaurant:false,ready:true,occupied:2,available:5,cleaning:1}),
   housekeepingVisible:()=>false,getWorkspace:()=>({stays:[]}),
   routeList:()=>['overview','rooms','hotel-register','daily-book','guests','hr','expenses']},
  BiteOwnerConfirmations:{snapshot:()=>[{state:'pending',intent_id:'other-outlet-order',expires_at:'2099-01-01'}]},
  BiteDashboard:{summarize:()=>{throw Error('Hotel-only must not read an outlet summary')} }};
 root.window=root;
 vm.runInNewContext(source,{window:root,console,Date,Intl});
 assert.match(home.innerHTML,/Rooms/);
 assert.match(home.innerHTML,/New check-in/);
 assert.match(home.innerHTML,/Daily Book/);
 assert.match(home.innerHTML,/Arrivals &amp; checkouts/);
 assert.doesNotMatch(home.innerHTML,/New POS bill|Cleaning<\/span>/);
 assert.equal(badge.hidden,true);
});
