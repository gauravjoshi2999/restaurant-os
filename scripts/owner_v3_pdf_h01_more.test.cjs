'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('assets/owner-mobile-navigation.js','utf8');
const nav=require('../assets/owner-mobile-navigation.js');
test('H01 navigation is one adaptive Home Hotel Orders POS More workspace',()=>{
 const hybrid=nav.approvedHomeTabs({business_type:'hybrid'},['overview','rooms','orders','pos','menu','reports','hr','settings']).map(x=>x.label);
 assert.deepEqual(hybrid,['Home','Hotel','Orders','POS','More']);
 const hotel=nav.approvedHomeTabs({business_type:'hotel'},['overview','rooms','hotel-register','folios','settings']).map(x=>x.label);
 assert.deepEqual(hotel,['Home','Hotel','More']);
});
test('H01 More contains PDF Accounts and Business tools once, never cloned ledgers',()=>{
 const groups=nav.sections;
 assert.deepEqual(groups.map(x=>x.heading),['Accounts','Business tools']);
 const routes=groups.flatMap(g=>g.items.map(item=>item[0]));
 assert.equal(new Set(routes).size,routes.length,'No duplicate feature route across groups');
 for(const id of ['daily-book','expenses','khata','cashbook','menu','inventory','hr','reports','reviews','settings']){
  assert.equal(routes.filter(x=>x===id).length,1,id);
 }
 assert.ok(!routes.includes('pos')&&!routes.includes('orders'),'Core workspace stays in its own tabs');
});
test('H01 More respects scoped routes and hides disabled modules',()=>{
 assert.match(source,/if\(Array\.isArray\(allowed\)&&!allowed\.includes\(page\)\)return/);
 assert.match(source,/b\.hidden=!!allowed&&!allowed\.includes\(b\.dataset\.ownerRoute\)/);
 assert.match(source,/group\.hidden=!\[\.\.\.group\.querySelectorAll\('\[data-owner-route\]'\)\]/);
 assert.match(source,/moreChildPage===currentPage\(\)/);
});
