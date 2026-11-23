'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const customer=fs.readFileSync('customer.html','utf8');
const owner=fs.readFileSync('assets/owner-v3-settlements.js','utf8');
const admin=fs.readFileSync('assets/admin-cashfree-audit.js','utf8');
const refund=require('../assets/customer-refund-tracker.js');

test('Customer auto refresh checks visible owned Orders and Order Details even after a completed order',()=>{
 assert.match(customer,/function biteRefreshVisibleFinancialStatus\(\)/);
 assert.match(customer,/setInterval\(biteRefreshVisibleFinancialStatus,30000\)/);
 assert.match(customer,/document\.addEventListener\('visibilitychange'/);
 assert.match(customer,/window\.addEventListener\('focus',biteRefreshVisibleFinancialStatus\)/);
 assert.match(customer,/void biteOpenFullOrderDetails\(biteFullOrderId,true\)/);
 assert.match(customer,/void loadMyOrders\(\)/);
 assert.match(customer,/\.eq\('customer_id',requestedCustomerId\)/);
 assert.doesNotMatch(customer.slice(customer.indexOf('function biteRefreshVisibleFinancialStatus()'),customer.indexOf('function setupOrderRealtime')),/Cashfree|service_role|\.insert\(|\.update\(/);
});
test('Owner automatically polls only an active owner scoped to one restaurant; stops on panel clear',()=>{
 assert.match(owner,/function watchRefresh\(\)/);
 assert.match(owner,/host\.isConnected&&validSession\(ctx\)/);
 assert.match(owner,/root\.setInterval\(watchRefresh,30000\)/);
 assert.match(owner,/function stopWatch\(\)/);
 assert.match(owner,/stopWatch\(\);token\+\+/);
 assert.match(owner,/if\(silent&&lastDigest===digest\)return/);
 assert.doesNotMatch(owner,/\.insert\(|\.update\(|\.upsert\(/);
});
test('Super Admin history loads provider statuses and successful refunds without issuing money',()=>{
 assert.match(admin,/provider_status,provider_checked_at/);
 assert.match(admin,/\['pending_approval','approved','processing','submitted','succeeded','failed','rejected'\]/);
 assert.match(admin,/Cashfree reports refund processed; bank credit not independently confirmed/);
 assert.match(admin,/root\.setInterval\(\(\)=>\{/);
 assert.match(admin,/if\(refundReviewSeen&&authorized\(\)&&document\.visibilityState==='visible'&&!refundBusy\)/);
 assert.doesNotMatch(admin.slice(admin.indexOf('function renderRefundReview()'),admin.indexOf('async function loadRefundReview()')),/execute_refund|Send refund/);
});
test('Customer sees provider-confirmed initiated stage while internal approval view is stale',()=>{
 const order={id:'a',status:'Cancelled'};
 const job={amount:174,status:'pending_approval',provider_status:'PENDING',provider_checked_at:'2026-11-23T04:00:00Z',provider_refund_id:'refund_1'};
 const info=refund.classify(order,job);
 assert.equal(info.title,'Refund initiated');
 assert.equal(info.stage,1);
 assert.match(refund.details(order,job),/5–7 working days/);
 assert.doesNotMatch(refund.summary(order,job),/bank credited|received in bank/i);
 const unverified={...job,provider_checked_at:null};
 assert.equal(refund.classify(order,unverified).title,'Refund under review');
});
test('Confirmed SUCCESS remains provider processed and never asserts bank credit',()=>{
 const order={id:'a'};
 const job={amount:174,status:'succeeded',provider_status:'SUCCESS',provider_checked_at:'2026-11-23T04:00:00Z'};
 assert.equal(refund.classify(order,job).title,'Refund processed');
 assert.doesNotMatch(refund.summary(order,job),/credited to bank|bank credited|received in bank/i);
});
