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
test('Screenshot Home is implemented as a real owner-only UI, never a static image or fake sales',()=>{
 const api=compile();
 assert.equal(api.timeLabel(new Date(Date.now()+90*1000)), '01:30');
 assert.match(source,/BiteDashboard/);
 assert.match(source,/BiteHospitality\?\.dashboardSnapshot/);
 assert.match(source,/BiteOwnerConfirmations\?\.snapshot/);
 assert.match(source,/todaySales/);
 assert.match(source,/todayPosBilled/);
 assert.match(source,/\.week/);
 assert.match(source,/Payment not collected/);
 assert.doesNotMatch(source,/Rahul Verma|BITE-7842|5,480|456\b/,'mock screenshot figures must not ship to production');
 assert.match(css,/\.bv3-attention/);
 assert.match(css,/\.bv3-kpis/);
 assert.match(css,/\.bv3-insights/);
 assert.match(css,/\.bv3-shortcuts/);
 assert.match(css,/\.bv3-flow-grid/);
});
test('Owner Home does not repeat existing premium, tools, current paid queue or finance ledger',()=>{
 assert.match(css,/#overview>\*:not\(#biteV3Home\)\{display:none!important\}/);
 assert.match(css,/@media \(max-width:760px\)/);
 assert.match(css,/body\[data-role="owner"\]/);
 assert.match(source,/Online paid \(net\)/);
 assert.match(source,/POS billed/);
 assert.match(source,/Not cash collected/);
 assert.match(source,/Verified · refunds minus/);
 assert.match(source,/Daily Cashbook|Cashbook for collections/);
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

test('Hybrid Home prioritizes real front-desk work and preserves operational shortcuts',()=>{
 assert.match(source,/function hotelAttentionCard\(snap\)/);
 assert.match(source,/snap\.ready===false/);
 assert.match(source,/snap\.departures/);
 assert.match(source,/snap\.arrivals/);
 assert.match(source,/data-bv3-route="reservations"/);
 assert.match(source,/hotelAttentionCard\(snap\)/);
 assert.match(source,/actionLink\('Check-in','hotel-register'/);
 assert.match(source,/actionLink\('New POS bill','pos'/);
 assert.match(source,/actionLink\('Guest Bills','folios'/);
 assert.match(source,/actionLink\('Live Orders','orders'/);
 assert.match(css,/\.bv3-hotel-attention-items/);
 assert.doesNotMatch(source,/from\(['"]bite_stays['"]\)\.update/);
});
