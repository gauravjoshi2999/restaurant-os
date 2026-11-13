const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/owner-more-mobile.css','utf8');
const hr=require('../assets/owner-hr-mobile-tabs.js');

test('Home duplicates are removed on mobile only and cash safety label remains',()=>{
 assert.match(css,/#overview \.od-accounts/);
 assert.match(css,/#overview \.od-recent/);
 assert.match(css,/#overview \.od-tools-section/);
 assert.match(css,/#overview \.od-sales \.od-text-button/);
 assert.match(css,/#overview \.od-finance-boundary/);
 assert.match(html,/More → Cashbook dekhein\./);
 assert.match(css,/body\[data-role="owner"\]/);
 assert.match(css,/@media \(max-width:760px\)/);
});
test('Reports and all More pages use one-column owner-only mobile layout',()=>{
 for(const route of ['hr','reports','expenses','cashbook','khata','purchases','inventory','tables','settings']){
  assert.ok(css.includes('#'+route),'Expected mobile route '+route);
  assert.match(html,new RegExp('id="'+route+'"'));
 }
 assert.match(css,/grid-template-columns:minmax\(0,1fr\)!important/);
 assert.match(css,/overflow-x:auto!important/);
 assert.match(css,/min-width:600px!important/);
 assert.match(css,/:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
 assert.match(html,/owner-more-mobile\.css\?v=20261114-onecol1/);
});
test('Mobile Staff tabs preserve existing employee, attendance, leave and payment handlers',()=>{
 assert.deepEqual(hr.panels,['employee','attendance','leave','payment']);
 for(const panel of ['hrEmployeePanel','hrAttendancePanel','hrLeavePanel','hrPaymentCard']){
  assert.match(html,new RegExp('id="'+panel+'"'));
 }
 for(const save of ['saveHREmployee()','saveHRAttendance()','saveHRLeave()','saveHREmployeePayment()']){
  assert.ok(html.includes(save),'Existing handler missing: '+save);
 }
 assert.match(html,/owner-hr-mobile-tabs\.js\?v=20261114-onecol1/);
 assert.match(css,/\.bite-hr-editor-grid>\.card\[data-hr-panel\]:not\(\[data-hr-selected="true"\]\)/);
});
test('HR activation only toggles visibility attributes and cannot mutate unsaved fields',()=>{
 const input={value:'Pending input'};
 const tabs=hr.panels.map(name=>({dataset:{hrTab:name},setAttribute(key,v){this[key]=v;}}));
 const panels=hr.panels.map(name=>({dataset:{hrPanel:name}}));
 const page={querySelectorAll(selector){return selector.includes('.bite-hr-tab')?tabs:panels;}};
 const doc={getElementById(id){return id==='hr'?page:null;}};
 assert.equal(hr.activate(doc,'attendance'),true);
 assert.equal(tabs[1]['aria-selected'],'true');
 assert.equal(panels[1].dataset.hrSelected,'true');
 assert.equal(panels[0].dataset.hrSelected,undefined);
 assert.equal(input.value,'Pending input');
 assert.equal(hr.activate(doc,'unknown'),false);
});
