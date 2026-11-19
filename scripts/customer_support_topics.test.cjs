'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const topics=require('../assets/customer-support-topics.js');
const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-support-topics.css','utf8');
test('every shortcut maps only into the existing five constrained categories',()=>{
 const expected=['Order','Payment','Account','Restaurant','Other'];
 assert.deepEqual([...topics.allowedCategories],expected);
 const items=Object.values(topics.options);
 assert.equal(items.length,7);
 for(const topic of items){
  assert.ok(expected.includes(topic.category));
  assert.ok(topic.suggestion.length>=3&&topic.suggestion.length<=120);
  assert.ok(topic.guidance.length>=12);
 }
});
test('deducted-payment and refund questions remain Payment support requests, not payments',()=>{
 const debit=topics.selection('payment-deducted','');
 const refund=topics.selection('refund-status','');
 assert.equal(debit.category,'Payment');
 assert.equal(refund.category,'Payment');
 assert.match(debit.subject,/Payment deducted/);
 assert.match(debit.guidance,/Do not pay again/);
 assert.match(refund.guidance,/does not initiate a refund/);
});
test('choosing a topic preserves a customer custom subject and otherwise fills one suggestion',()=>{
 const first=topics.selection('order-delayed','','');
 assert.equal(first.category,'Order');
 assert.equal(first.subject,'My order is delayed');
 const changed=topics.selection('restaurant-rejected',first.subject,first.suggested);
 assert.equal(changed.subject,'Restaurant rejected my order');
 const manual=topics.selection('refund-status','Please help with my invoice',first.suggested);
 assert.equal(manual.subject,'Please help with my invoice');
 assert.equal(manual.category,'Payment');
});
test('unknown input cannot invent a backend category, payment state or extra support ticket',()=>{
 assert.equal(topics.selection('fraudulent-unknown-topic',''),null);
 const source=fs.readFileSync('assets/customer-support-topics.js','utf8').replace(/^\s*\/\*[\s\S]*?\*\//,'');
 for(const needle of ['sb.rpc','fetch(','payment_intent','customer_support_tickets','.insert(','.update(','Cashfree('])
  assert.ok(!source.toLowerCase().includes(needle.toLowerCase()),'Unexpected side-effect reference: '+needle);
});
test('all seven support topic buttons are accessible and preserve existing form and backend write',()=>{
 const keys=Object.keys(topics.options);
 for(const key of keys){
  assert.ok(html.includes('data-bite-support-topic="'+key+'"'));
 }
 assert.equal((html.match(/data-bite-support-topic="/g)||[]).length,7);
 assert.match(html,/id="biteSupportTopicHelp" role="status" hidden/);
 assert.match(html,/id="customerSupportForm"/);
 assert.match(html,/id="customerSupportCategory"/);
 assert.match(html,/sb\.from\('customer_support_tickets'\)\.insert\(\{customer_id:/);
 assert.match(html,/assets\/customer-support-topics\.js\?v=20261119-help1/);
 assert.match(html,/assets\/customer-support-topics\.css\?v=20261119-help1/);
 assert.match(css,/body\[data-bite-app="customer"\]/);
 assert.match(css,/min-height:44px/);
 assert.match(css,/@media\(max-width:360px\)/);
});
test('topic selection uses textContent and never injects chosen values as HTML',()=>{
 const js=fs.readFileSync('assets/customer-support-topics.js','utf8');
 assert.match(js,/category\.value=chosen\.category/);
 assert.match(js,/subject\.value=chosen\.subject/);
 assert.match(js,/help\.textContent=chosen\.guidance/);
 assert.doesNotMatch(js,/innerHTML|insertAdjacentHTML|eval\(/);
 assert.match(js,/group\.dataset\.biteMounted==='1'/);
 assert.match(js,/group\.addEventListener\('click'/);
});
