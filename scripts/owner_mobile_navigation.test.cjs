const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const nav=require('../assets/owner-mobile-navigation.js');

test('Owner mobile quick navigation keeps daily tasks one tap away',()=>{
  assert.deepEqual(nav.tabs.map(t=>t.page),['overview','orders','pos','menu','more']);
  for(const page of ['overview','orders','pos','menu']){
    const state=nav.navigationState('owner',page);
    assert.equal(state.visible,true);
    assert.equal(state.active,page);
    assert.equal(state.showBack,page!=='overview');
  }
  for(const page of ['cashbook','expenses','purchases','hr','inventory','reports','settings','tables','khata']){
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

test('Canonical Owner mobile tabs preserve the POS workspace and More section',()=>{
  const source=fs.readFileSync('assets/owner-mobile-navigation.js','utf8');
  const css=fs.readFileSync('assets/owner-mobile-navigation.css','utf8');
  const owner=fs.readFileSync('index.html','utf8');
  assert.deepEqual(nav.tabs.map(t=>t.label),['Home','Orders','POS','Menu','More']);
  assert.doesNotMatch(source,/root\.openPosFromOverview\(/);
  assert.match(source,/root\.showPage\(tab\.page\)/);
  assert.match(owner,/function openPosFromOverview\(/,'Existing one-tap new-bill shortcut remains available');
  for(const page of ['overview','orders','pos','menu']){
    assert.ok(css.includes('data-page="'+page+'"'),'Mobile drawer should de-duplicate '+page);
  }
  assert.match(css,/#35166e/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.equal(nav.navigationState('owner','overview',true).active,'more');
  assert.equal(nav.navigationState('owner','overview',true).showBack,true);
});

test('More is an owner-only full content screen, not a sidebar drawer',()=>{
  const source=fs.readFileSync('assets/owner-mobile-navigation.js','utf8');
  const styles=fs.readFileSync('assets/owner-mobile-polish.css','utf8');
  const owner=fs.readFileSync('index.html','utf8');
  assert.equal(nav.sections.flatMap(group=>group.items.map(item=>item[0])).join(','),
    'expenses,cashbook,khata,purchases,tables,inventory,hr,reports,settings');
  assert.doesNotMatch(source,/root\.toggleSidebar\(true\)/);
  assert.match(source,/content\.append\(moreScreen\)/);
  assert.match(source,/currentSection\(\)\?\.setAttribute\('aria-hidden','true'\)/);
  assert.match(styles,/#mainApp\[data-bite-more-open="true"\]/);
  assert.match(styles,/\.bite-language-row\{display:none!important\}/);
  assert.match(owner,/assets\/owner-mobile-polish\.css\?v=/);
  assert.doesNotMatch(owner,/priority\.after\(live\)/);
});
