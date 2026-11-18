'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const apply=html.slice(html.indexOf('function applyRoleUI()'),html.indexOf('function applyRoleUI()')+6300);
const show=html.slice(html.indexOf('function showPage(id)'),html.indexOf('function showPage(id)')+4800);
function list(block,key){
  const m=block.match(new RegExp('const '+key+'=\\[([^\\]]+)\\]'));
  assert.ok(m,key+' list missing');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
}
const owner=['overview','orders','pos','menu','tables','khata','cashbook','expenses','purchases','inventory','hr','reports','settings'];
const platform=['overview','restaurants','orders','reconciliation','financials','audit','support','moderation','customers','storefront','platform-commission','platform-reports'];

test('Owner canonical navigation has precisely 13 non-admin destinations',()=>{
  assert.deepEqual(list(apply,'ownerPages'),owner);
  assert.deepEqual(list(show,'ownerPages'),owner);
  assert.ok(owner.every(p=>!['restaurants','reconciliation','financials','audit','support','moderation','customers','storefront'].includes(p)));
});
test('Super Admin has exactly 12 platform routes, no POS/menu/staff/stock routes',()=>{
  assert.deepEqual(list(apply,'platformPages'),platform);
  assert.deepEqual(list(show,'platformPages'),platform);
  assert.ok(platform.every(p=>!['pos','menu','hr','inventory','purchases','cashbook'].includes(p)));
});
test('direct Partner and Admin app shells require correct roles',()=>{
  assert.match(apply,/appScope==='admin'&&role!=='super_admin'/);
  assert.match(apply,/appScope==='partner'&&role!=='owner'/);
  assert.match(show,/if\(!allowed\.includes\(id\)\)id='overview'/);
});
test('navigation and admin controls are hidden based on role rather than text labels',()=>{
  assert.match(apply,/b\.hidden=!ok/);
  assert.match(apply,/e\.style\.display=role==='super_admin'/);
  assert.match(apply,/role==='owner'\?ownerPages\.includes\(p\):false/);
});
