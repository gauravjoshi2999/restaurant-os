'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const owner=require('../assets/owner-orders-workspace.js');
const page=fs.readFileSync('index.html','utf8');
const styles=fs.readFileSync('assets/owner-orders-workspace.css','utf8');

const created='2026-11-15T12:00:00.000Z';
const after=minutes=>Date.parse(created)+minutes*60000;
test('New order aging is compact and deterministic at 0, 2, 3, 5 and 60 minutes',()=>{
 assert.deepEqual(owner.waitingInfo(created,after(0)),{minutes:0,level:'normal',label:'Just received'});
 assert.equal(owner.waitingInfo(created,after(2)).level,'normal');
 assert.equal(owner.waitingInfo(created,after(2)).label,'2m waiting');
 assert.equal(owner.waitingInfo(created,after(3)).level,'attention');
 assert.equal(owner.waitingInfo(created,after(3)).label,'Attention · 3m waiting');
 assert.equal(owner.waitingInfo(created,after(5)).level,'urgent');
 assert.equal(owner.waitingInfo(created,after(5)).label,'Urgent · 5m waiting');
 assert.equal(owner.waitingInfo(created,after(60)).label,'Urgent · 1h waiting');
});
test('Unknown and invalid timestamps never invent an order deadline',()=>{
 for(const invalid of ['',null,'bad timestamp']){
  assert.deepEqual(owner.waitingInfo(invalid,after(5)),{
   minutes:null,level:'unknown',label:'Waiting for response'
  });
 }
 assert.equal(owner.waitingInfo(created,Date.parse(created)-2*60000).level,'unknown');
 assert.equal(owner.waitingInfo(created,after(100)).level,'urgent');
});
test('Only active Owner Received non-demo orders show aging UI, no duplicate action queues',()=>{
 assert.match(page,/const waitInfo=canManage&&!o\.isDemo&&o\.status==='Received'\?BiteOwnerOrders\.waitingInfo\(o\.createdAt\):null/);
 assert.match(page,/class="bite-order-wait"/);
 assert.match(page,/function updateOwnerWaitingIndicators\(\)/);
 assert.match(page,/o\.restaurant===access\.restaurantId&&!o\.isDemo/);
 assert.match(page,/o\.status==='Received'/);
 assert.match(page,/document\.querySelectorAll\('#orderBoard \.bite-order-wait'\)/);
 assert.match(page,/if\(currentUser&&access\.role==='owner'&&document\.visibilityState!=='hidden'\)updateOwnerWaitingIndicators\(\)/);
 assert.match(page,/id="ownerQueueNote"/);
});
test('Urgency is only a UI indicator, not another cancellation, payment or refresh workflow',()=>{
 const fn=page.slice(page.indexOf('function updateOwnerWaitingIndicators(){'),
  page.indexOf("document.addEventListener('bite-owner-order-date-change'",page.indexOf('function updateOwnerWaitingIndicators(){')));
 assert.doesNotMatch(fn,/\.from\('orders'\)\.(delete|update)/);
 assert.doesNotMatch(fn,/\.from\('order_financials'\)/);
 assert.doesNotMatch(fn,/\bfetch\(|\bsb\.rpc\(|cancelUnanswered/);
 assert.doesNotMatch(fn,/playOrderAlertSound\(/);
 assert.match(styles,/data-wait-level="attention"/);
 assert.match(styles,/data-wait-level="urgent"/);
});
