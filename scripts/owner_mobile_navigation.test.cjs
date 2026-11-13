const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const nav=require('../assets/owner-mobile-navigation.js');

test('Owner mobile quick navigation keeps daily tasks one tap away',()=>{
  assert.deepEqual(nav.tabs.map(t=>t.page),['overview','orders','pos','expenses','more']);
  for(const page of ['overview','orders','pos','expenses']){
    const state=nav.navigationState('owner',page);
    assert.equal(state.visible,true);
    assert.equal(state.active,page);
    assert.equal(state.showBack,page!=='overview');
  }
  for(const page of ['cashbook','purchases','hr','inventory','reports','settings']){
    const state=nav.navigationState('owner',page);
    assert.equal(state.active,'more');
    assert.equal(state.showBack,true);
  }
});

test('Admin and unauthenticated sessions never receive Owner quick navigation',()=>{
  for(const role of ['super_admin','no_membership',undefined]){
    const state=nav.navigationState(role,'pos');
    assert.deepEqual(state,{visible:false,showBack:false,active:null});
  }
});

test('Owner navigation is loaded in workspace and not injected into customer page',()=>{
  const owner=fs.readFileSync('index.html','utf8');
  const customer=fs.readFileSync('customer.html','utf8');
  const css=fs.readFileSync('assets/owner-mobile-navigation.css','utf8');
  assert.match(owner,/assets\/owner-mobile-navigation\.css\?v=/);
  assert.match(owner,/assets\/owner-mobile-navigation\.js\?v=/);
  assert.doesNotMatch(customer,/owner-mobile-navigation/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/\[hidden\]\{display:none!important\}/);
  assert.match(css,/body\[data-role="owner"\]/);
});
