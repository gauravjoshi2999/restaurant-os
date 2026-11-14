'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-order-cards.css','utf8');
const start=html.indexOf('function orderActionsMarkup(o)');
const end=html.indexOf('async function loadMyOrders(){',start);
assert.ok(start!==-1&&end>start,'Order action renderer must be defined before loadMyOrders');
const snippet=html.slice(start,end);
const orderActionsMarkup=vm.runInNewContext(snippet+';orderActionsMarkup',{
 safe:value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
 expandedOrderId:null
});
const sample={id:'00000000-0000-4000-8000-000000000006',order_code:'BITE-QA-006',status:'Completed',review_id:null};
const render=patch=>orderActionsMarkup({...sample,...patch});
const mainButtons=markup=>{
 const first=markup.slice(0,markup.indexOf('<details class="order-more">'));
 return [...first.matchAll(/<button\b/g)].length;
};
const extras=markup=>markup.slice(markup.indexOf('<div class="order-more-items">'));

test('only two instantly scannable actions and one accessible native disclosure',()=>{
 const markup=render({});
 assert.equal(mainButtons(markup),2);
 assert.match(markup,/class="orderactions" role="group" aria-label="Actions for order BITE-QA-006"/);
 assert.match(markup,/<details class="order-more"><summary>More options<\/summary>/);
 assert.match(markup,/<button[^>]+data-reorder=/);
 assert.match(markup,/<button[^>]+data-order-detail=/);
 assert.match(extras(markup),/data-invoice=/);
 assert.match(extras(markup),/data-customer-order-action="review"/);
 assert.match(extras(markup),/data-customer-order-action="complaint"/);
 assert.doesNotMatch(extras(markup),/data-customer-order-action="cancel"/);
});

test('cancel remains immediately accessible for a newly received order',()=>{
 const markup=render({status:'Received'});
 const top=markup.slice(0,markup.indexOf('<details class="order-more">'));
 assert.equal(mainButtons(markup),2);
 assert.match(top,/data-order-detail=/);
 assert.match(top,/data-customer-order-action="cancel"/);
 assert.doesNotMatch(top,/data-reorder=/);
 assert.match(extras(markup),/data-invoice=/);
 assert.match(extras(markup),/data-reorder=/);
});

test('cancellation request remains immediately visible during preparation',()=>{
 for(const status of ['Accepted','Preparing','Ready']){
  const markup=render({status});
  const top=markup.slice(0,markup.indexOf('<details class="order-more">'));
  assert.equal(mainButtons(markup),2,status);
  assert.match(top,/data-customer-order-action="cancel_request"/,status);
  assert.doesNotMatch(markup,/data-customer-order-action="cancel"/,status);
  assert.match(extras(markup),/data-invoice=/);
 }
});

test('reviews remain truthful and past orders remain usable',()=>{
 const reviewed=render({status:'Completed',review_id:'actual-review-id'});
 assert.doesNotMatch(reviewed,/data-customer-order-action="review"/);
 assert.match(reviewed,/data-customer-order-action="complaint"/);
 for(const status of ['Cancelled','Rejected','Handed Over']){
  const markup=render({status});
  assert.equal(mainButtons(markup),2,status);
  assert.match(markup,/data-order-detail=/,status);
  assert.match(markup,/data-reorder=/,status);
  assert.match(extras(markup),/data-invoice=/,status);
  assert.doesNotMatch(markup,/data-customer-order-action=/,status);
 }
});

test('existing handlers, status badges and customer-only style scope remain intact',()=>{
 assert.match(html,/\+orderActionsMarkup\(o\)\+\(expandedOrderId===o\.id\?/);
 assert.match(html,/document\.querySelectorAll\('\[data-order-detail\]'\)/);
 assert.match(html,/document\.querySelectorAll\('\[data-customer-order-action\]'\)/);
 assert.match(html,/data-reorder/);
 assert.match(html,/data-invoice/);
 assert.match(html,/class="order-badges"/);
 assert.match(html,/assets\/customer-order-cards\.css\?v=20261114-ordercards1/);
 assert.match(css,/body\[data-bite-app="customer"\] #ordersView/);
 assert.match(css,/\.order-more>summary:focus-visible/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/min-height:44px/);
 assert.doesNotMatch(snippet,/sb\.|fetch\(|payment|localStorage|sessionStorage|Cashfree/i);
});
