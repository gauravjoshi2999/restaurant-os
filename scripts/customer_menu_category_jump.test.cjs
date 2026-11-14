'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-menu-navigation.css','utf8');

function getScroller({hidden=false,reducedMotion=false}={}){
 const start=html.indexOf('function biteRevealMenuResults(){');
 const end=html.indexOf('function renderMenu(cats){',start);
 assert.ok(start!==-1&&end>start);
 const scrolls=[];
 const nodes={
  menuView:{classList:{contains:()=>hidden}},
  menuItems:{getBoundingClientRect:()=>({top:450})},
  categoryBar:{getBoundingClientRect:()=>({height:52})}
 };
 const env={
  $:id=>nodes[id],
  document:{querySelector:()=>({getBoundingClientRect:()=>({bottom:64})})},
  window:{
   scrollY:250,
   getComputedStyle:()=>({top:'72px'}),
   matchMedia:()=>({matches:reducedMotion}),
   scrollTo:args=>scrolls.push(args)
  }
 };
 const fn=vm.runInNewContext(html.slice(start,end)+';biteRevealMenuResults',env);
 return {fn,scrolls};
}

test('category tap scrolls real dish results beneath sticky header and category rail',()=>{
 const {fn,scrolls}=getScroller();
 fn();
 assert.equal(scrolls.length,1);
 assert.equal(scrolls[0].top,562); // 250 + 450 - max(64,72) - 52 - 14
 assert.equal(scrolls[0].behavior,'smooth');
});

test('hidden restaurant view never scrolls, reduced motion uses auto',()=>{
 const hidden=getScroller({hidden:true});hidden.fn();assert.equal(hidden.scrolls.length,0);
 const reduced=getScroller({reducedMotion:true});reduced.fn();assert.equal(reduced.scrolls[0].behavior,'auto');
});

test('real category chips and selected headings use loaded menu, no fake content',()=>{
 assert.match(html,/id="categoryBar" role="group" aria-label="Menu categories"/);
 assert.match(html,/id="menuCategoryHeading" class="bite-menu-category-heading"/);
 assert.match(html,/data-cat="all" aria-controls="menuItems"/);
 assert.match(html,/data-cat="'\+safe\(c\.id\)\+'" aria-controls="menuItems"/);
 assert.match(html,/requestAnimationFrame\(biteRevealMenuResults\)/);
 assert.match(html,/activeChip\?\.textContent\?\.trim\(\)/);
 assert.match(html,/BiteDiscovery\.selectMenu\(menuItems/);
 assert.match(html,/id="menuResultCount"[^>]*role="status" aria-live="polite"/);
 assert.match(html,/assets\/customer-menu-navigation\.css\?v=20261114-menujump1/);
 assert.doesNotMatch(css,/display:none!important/);
});

test('category control preserves menu/cart backend and touch accessibility',()=>{
 assert.match(css,/\.categorybar \.chip:focus-visible/);
 assert.match(css,/min-height:44px/);
 assert.match(css,/scroll-margin-top/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/body\[data-bite-app="customer"\] #menuView/);
 assert.match(html,/sb\.from\('menu_items'\)/);
 assert.match(html,/sb\.rpc\('check_restaurant_delivery_area'/);
 assert.match(html,/function menuQuantityMarkup\(item\)/);
 assert.match(html,/function renderCart\(\)/);
 const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match=>match[1]).filter(Boolean);
 for(const js of inline)assert.doesNotThrow(()=>new vm.Script(js));
});
