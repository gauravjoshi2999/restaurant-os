'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/owner-reference-v3.js','utf8');
const css=fs.readFileSync('assets/owner-reference-v3.css','utf8');
const approvals=fs.readFileSync('assets/owner-order-confirmations.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const core=fs.readFileSync('assets/owner-dashboard.js','utf8');
function compile(){
 const root={console,document:null,Date,CustomEvent:function(){},setInterval(){return 1}};
 root.window=root;vm.runInNewContext(source,{window:root,console,Date});
 return root.BiteOwnerReferenceV3;
}
test('Screenshot Home is implemented as owner-only interactive content from tenant data',()=>{
 const api=compile();
 assert.equal(api.timeLabel(new Date(Date.now()+90*1000)),'01:30');
 assert.match(source,/BiteDashboard/);
 assert.match(source,/BiteHospitality\?\.dashboardSnapshot/);
 assert.match(source,/BiteOwnerConfirmations\?\.snapshot/);
 assert.match(source,/monthRegisterSummary/);
 assert.match(source,/Room Status/);
 assert.match(source,/New POS Bill/);
 assert.match(source,/Daily Book/);
 assert.match(source,/Staff Attendance/);
 assert.match(source,/Hotel Register/);
 assert.match(source,/housekeepingVisible/);
 assert.match(source,/biteOwnerNoticeTray/);
 assert.doesNotMatch(source,/Rahul Verma|BITE-7842|5,480|456\b|₹2,290/,'mock screenshot figures must not ship');
 assert.match(index,/owner-image-home\.css\?v=/);
});
test('Owner Home replaces the old Sales snapshot without removing existing backend',()=>{
 const imageCss=fs.readFileSync('assets/owner-image-home.css','utf8');
 assert.match(css,/#overview>\*:not\(#biteV3Home\)\{display:none!important\}/);
 assert.match(imageCss,/\.boh-feature-grid/);
 assert.match(imageCss,/\.boh-register/);
 assert.match(imageCss,/\.boh-notice-tray/);
 assert.match(imageCss,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(source,/return date\.startsWith\(month\)&&\['in_house','checked_out'\]/);
 assert.match(source,/BiteOwnerOrderBurst\?\.paidOrderIds/);
 assert.match(core,/core\.financialSummary/);
});
test('No new order mutation: only existing owner review RPC; no unverified Paid claim',()=>{
 assert.match(source,/BiteOwnerConfirmations\?\.review\?\./);
 assert.match(source,/decision==='rejected'&&!root\.confirm/);
 assert.match(source,/secondsLeft\(r\.expires_at\)>0/);
 assert.match(source,/data-bv3-review="approved"/);
 assert.doesNotMatch(source,/from\(['"]orders['"]\)\.update|provider_order_id.*set|insert into|cashfree-sdk/);
 assert.match(approvals,/id===restaurant\?rows\.filter/);
 assert.match(approvals,/bite:owner-confirmations-updated/);
 assert.match(approvals,/root\.BiteOwnerConfirmations=\{mount,refresh,stop,review,snapshot\}/);
});
test('Orders match New/Preparing/Ready/Delivery/Delivered and keep all/cancelled via filter',()=>{
 assert.match(source,/renderOrdersHeader/);
 assert.match(source,/Search Order ID, customer or item/);
 for(const status of ['new','preparing','ready','delivery','completed','cancelled','all'])assert.ok(source.includes('value="'+status+'"'),status);
 assert.match(source,/classList\.toggle\('bv3-search-hidden'/);
 assert.match(css,/\.bv3-search-hidden\{display:none!important\}/);
 assert.match(css,/#orders \.bite-approval-card/);
 assert.match(css,/#orders \.order-card\.bite-compact-order/);
 assert.match(index,/window\.BiteOwnerReferenceV3\?\.afterOrdersRender\(\)/);
});
test('Native approval notification navigates to Orders, never Check-in; legacy business modules stay',()=>{
 const start=index.indexOf('async function handlePendingNativeApprovalOpen(){');
 const end=index.indexOf('window.addEventListener(',start);
 const handler=index.slice(start,end);
 assert.ok(start>0);
 assert.match(handler,/await showPage\('orders'\)/);
 assert.match(handler,/setOrderStatus\('new'\)/);
 assert.doesNotMatch(handler,/showPage\('hotel-register'\)|showPage\('rooms'\)/);
 assert.match(index,/function advanceOrder\(id,next/);
 assert.match(index,/function renderOrderBoard\(\)/);
 assert.match(index,/BiteDashboard\.render\(document,state,access\)/);
 assert.match(index,/owner-reference-v3\.css\?v=/);
 assert.match(index,/owner-reference-v3\.js\?v=/);
});
