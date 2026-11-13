const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const stages=require('../assets/owner-orders-workspace.js');

test('Owner order stages group real current lifecycle without inventing statuses',()=>{
  assert.deepEqual(stages.stages.map(s=>s.key),[
    'new','preparing','ready','delivery','completed','cancelled','all'
  ]);
  const inputs=[
    ['Received','new'],['Accepted','preparing'],['Preparing','preparing'],
    ['Ready','ready'],['Handed Over','delivery'],['Out for Delivery','delivery'],
    ['Completed','completed'],['Delivered','completed'],
    ['Rejected','cancelled'],['Cancelled','cancelled']
  ];
  for(const [status,group] of inputs){
    assert.equal(stages.groupForStatus(status),group);
    assert.equal(stages.matches(group,status),true);
    assert.equal(stages.matches('all',status),true);
    for(const other of stages.stages.map(s=>s.key).filter(s=>s!==group&&s!=='all')){
      assert.equal(stages.matches(other,status),false,'wrong group for '+status);
    }
  }
});
test('Owner stages count real orders once per stage and allow all records',()=>{
  const list=['Received','Accepted','Preparing','Ready','Handed Over','Completed','Rejected','Cancelled'].map(
    (status,i)=>({id:String(i),status})
  );
  assert.deepEqual(stages.counts(list),{
    new:1,preparing:2,ready:1,delivery:1,completed:1,cancelled:2,all:8
  });
  assert.equal(Object.entries(stages.counts(list)).filter(([k])=>k!=='all').reduce((sum,[,n])=>sum+n,0),list.length);
  assert.equal(stages.groupForStatus('Unknown'),'all');
  assert.equal(stages.isFilter('new'),true);
  assert.equal(stages.isFilter('Received'),false);
});
test('Orders screen has a single owner action queue and admin role is untouched',()=>{
  const page=fs.readFileSync('index.html','utf8');
  const css=fs.readFileSync('assets/owner-orders-workspace.css','utf8');
  assert.match(page,/BiteOwnerOrders\.prepare\(document,access\.role,setOrderStatus\)/);
  assert.match(page,/BiteOwnerOrders\.update\(document,channelOrders,activeOrderStatus\)/);
  assert.match(page,/BiteOwnerOrders\.matches\(activeOrderStatus,o\.status\)/);
  assert.match(page,/access\.role==='owner'\)\{list\.replaceChildren\(\);return;/);
  assert.match(css,/body\[data-role="owner"\] #orders \.order-inbox/);
  assert.match(css,/body\[data-role="owner"\] #orders #orderStatusTabs/);
  assert.match(page,/async function advanceOrder\(id,next\)/,'Old order mutation handler must remain');
  assert.match(page,/function renderOrderBoard\(\)/,'Existing order source of truth remains');
  assert.match(page,/loadCustomerOrderRequestsWorkspace\(\)/);
  assert.match(page,/loadRestaurantReviewsWorkspace\(\)/);
  assert.match(page,/loadVerifiedLiveInbox\(\)/);
});
