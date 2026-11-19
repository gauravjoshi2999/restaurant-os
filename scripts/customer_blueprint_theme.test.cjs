'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-blueprint-theme.css','utf8');

function luminance(hex){
 const x=hex.match(/^#([\da-fA-F]{6})$/);
 assert.ok(x,'expected six-digit hex');
 const n=[0,2,4].map(i=>parseInt(x[1].slice(i,i+2),16)/255);
 const p=n.map(v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4));
 return 0.2126*p[0]+0.7152*p[1]+0.0722*p[2];
}
function contrast(a,b){
 const [x,y]=[luminance(a),luminance(b)].sort((x,y)=>y-x);
 return (x+0.05)/(y+0.05);
}
test('Blueprint theme applies to customer only, last in the CSS cascade',()=>{
 const file='assets/customer-blueprint-theme.css?v=20261119-design-foundation1';
 assert.match(html,new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.ok(html.indexOf(file)>html.indexOf('assets/customer-home-cart.css'),'override all existing customer-only themes');
 assert.match(html,/<body data-bite-app="customer">/);
 assert.equal((html.match(/customer-blueprint-theme\.css/g)||[]).length,1);
 const blocks=css.match(/(?:^|})\s*[^{}]+\{/g)||[];
 for(const b of blocks){
  const label=b.replace(/^}|\{$/g,'').trim();
  if(label.startsWith('/*')||label.startsWith('@'))continue;
  for(const selector of label.split(',')){
   assert.match(selector,/body\[data-bite-app="customer"\]/,
    'unsafe unscoped selector: '+selector);
  }
 }
});
test('Approved Bite palette uses AA-readable dark-orange text buttons',()=>{
 assert.match(css,/--bite-brand-orange:#F36C22/);
 assert.match(css,/--bite-primary:#B7420B/);
 assert.match(css,/--bite-canvas:#F8F6F2/);
 assert.match(css,/--bite-surface:#FFFEFC/);
 assert.match(css,/--bite-ink:#1F293D/);
 assert.ok(contrast('#B7420B','#FFFFFF')>=4.5);
 assert.ok(contrast('#1F293D','#F8F6F2')>=7);
 assert.match(html,/<meta name="theme-color" content="#B7420B">/);
});
test('Cart, hero, search, restaurant and mobile navigation remain visible and themed',()=>{
 for(const selector of ['.food-hero','.search.home-searchrow','.restaurant',
  '#cartFloating.bite-persistent-cart','#floatingViewCart','.home-bottom-nav']){
  assert.ok(css.includes(selector),'missing theme selector '+selector);
 }
 assert.match(css,/bottom:calc\(84px \+ env\(safe-area-inset-bottom\)\)/);
 assert.match(css,/@media\(max-width:360px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test('Detailed food preference is available inside Filters, not as a prominent default-home selector',()=>{
 const sheet=fs.readFileSync('assets/customer-filter-sheet.js','utf8');
 assert.match(css,/\.discovery-tools \.bite-filter-label,[\s\S]*?#sortFastBtn\{display:none\}/);
 assert.match(sheet,/selection\('Vegetarian options','veg'/);
 assert.match(sheet,/selection\('Non-vegetarian options','nonveg'/);
 assert.match(sheet,/select\('discoveryDiet',next\.diet\)/);
 assert.match(css,/#biteFilterApply/);
});

test('Customer logo is warm-orange and does not alter the shared platform mark',()=>{
 const mark=fs.readFileSync('assets/bite-customer-orange-mark.svg','utf8');
 assert.match(mark,/fill="#B7420B"/);
 assert.doesNotMatch(mark,/#087B4D/i);
 assert.ok(html.includes('assets/bite-customer-orange-mark.svg?v=20261119-orange1'));
 assert.ok(html.split('assets/bite-customer-orange-mark.svg').length-1>=2);
});
test('Theme does not modify transactions, customer orders or other panels',()=>{
 assert.doesNotMatch(css,/fetch\(|sb\.|Cashfree|supabase|payment_session|window\.|localStorage|--green:/i);
 assert.doesNotMatch(css,/(?:^|[\s,{])(?:#owner|#admin|#superAdmin|body\[data-bite-app="owner"\])/i);
 assert.match(html,/sb\.functions\.invoke\('bite-live-create-session'/);
 assert.match(html,/window\.BiteHomeCart\?\.sync\?\.\(\)/);
});
