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

test('Hotel mode does not hide the premium Home while retaining operational front desk',()=>{
  const hotelCss=fs.readFileSync(path.join(__dirname,'../assets/owner-hospitality.css'),'utf8');
  assert.match(hotelCss,/body\[data-business-type=hotel\] #overview>:not\(#biteHotelHome\):not\(#bitePremiumHome\)\{display:none!important\}/);
  assert.doesNotMatch(hotelCss,/body\[data-business-type=hotel\] #overview>:not\(#biteHotelHome\)\{display:none!important\}/);
});

test('V2 metrics use provided operational numbers, never synthetic revenue',()=>{
  const c=require('../assets/owner-premium-shell.js');
  const routes=capabilities.routes(owner('hybrid'),true);
  const blank=c.viewModel('hybrid',routes,null);
  assert.ok(blank.metrics.every(m=>m.value==='—'));
  assert.equal(blank.rows.length,0);
  const model=c.viewModel('hybrid',routes,{occupied:8,arrivals:2,cleaning:1,newOrders:3,ready:true});
  assert.deepEqual(model.metrics.map(m=>m.value),['8','2','3','1']);
  assert.deepEqual(model.rows.map(r=>r.page),['housekeeping','reservations','orders']);
  assert.equal(model.rows.every(r=>routes.includes(r.page)),true);
  assert.equal(c.viewModel('restaurant',capabilities.routes(owner('restaurant'),true),{newOrders:0}).rows.length,0);
});
test('Hybrid mobile has five focused tabs; Hotel remains a group, not duplicate destinations',()=>{
 const tabs=capabilities.tabs(owner('hybrid'),true);
 assert.deepEqual(tabs.map(t=>t.label),['Home','Hotel','Orders','POS','More']);
 assert.deepEqual(tabs.map(t=>t.page),['overview','rooms','orders','pos','more']);
});
