'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const capabilities=require('../assets/owner-capabilities.js');
const design=require('../assets/owner-premium-shell.js');

function owner(type){
  return {id:'fixture-'+type,business_type:type,role:'owner',can_configure:true,capabilities:capabilities.defaults[type]};
}
test('Hotel shortcuts never expose restaurant actions',()=>{
  const property=owner('hotel');
  const routes=capabilities.routes(property,false);
  const cards=design.actionsFor('hotel',routes);
  assert.ok(cards.some(x=>x.page==='hotel-register'));
  assert.ok(cards.some(x=>x.page==='rooms'));
  assert.equal(cards.some(x=>['orders','pos','menu'].includes(x.page)),false);
  assert.ok(cards.every(x=>routes.includes(x.page)));
});
test('Restaurant shortcuts do not expose guest or folio pages',()=>{
  const property=owner('restaurant');
  const routes=capabilities.routes(property,true);
  const cards=design.actionsFor('restaurant',routes);
  assert.ok(cards.some(x=>x.page==='orders'));
  assert.ok(cards.some(x=>x.page==='pos'));
  assert.equal(cards.some(x=>['hotel-register','rooms','folios'].includes(x.page)),false);
  assert.ok(cards.every(x=>routes.includes(x.page)));
});
test('Hybrid shortcuts include hotel and restaurant without duplicate routes',()=>{
  const property=owner('hybrid');
  const routes=capabilities.routes(property,true);
  const cards=design.actionsFor('hybrid',routes);
  assert.ok(cards.some(x=>x.page==='hotel-register'));
  assert.ok(cards.some(x=>x.page==='orders'));
  assert.ok(cards.some(x=>x.page==='pos'));
  assert.equal(new Set(cards.map(x=>x.page)).size,cards.length);
  assert.ok(cards.every(x=>routes.includes(x.page)));
});
test('Restricted cashier shortcuts only show allowed routes',()=>{
  const cards=design.actionsFor('hybrid',['overview','pos']);
  assert.deepEqual(cards.map(x=>x.page),['pos']);
});
test('Owner layer is isolated from payments, customer and admin workspaces',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../assets/owner-premium-shell.js'),'utf8');
  const style=fs.readFileSync(path.join(__dirname,'../assets/owner-premium-shell.css'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.match(style,/data-role="owner"/);
  assert.match(style,/prefers-reduced-motion:reduce/);
  assert.match(source,/BiteHospitality\.routeList/);
  assert.match(source,/root\.showPage/);
  assert.doesNotMatch(source,/supabase\.|cashfree|fetch\(|\.insert\(|\.update\(|service_role/i);
  assert.match(html,/owner-premium-shell\.css/);
  assert.match(html,/owner-premium-shell\.js/);
  assert.equal((html.match(/assets\/owner-premium-shell\.js/g)||[]).length,1);
});
