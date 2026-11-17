'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const nav=fs.readFileSync('assets/owner-mobile-navigation.js','utf8');
const css=fs.readFileSync('assets/owner-reference-v3.css','utf8');
const old=fs.readFileSync('assets/owner-hospitality.js','utf8');
test('Approved Home header uses selected Bite logo and current property name, retaining existing bell',()=>{
 assert.match(nav,/homeLogo\.src='assets\/bite-selected-icon\.png'/);
 assert.match(nav,/homeProperty\.textContent=property\.name\|\|'Your business'/);
 assert.match(nav,/root\.BiteHospitality\?\.prop\?\.\(\)/);
 assert.match(css,/#biteOwnerHomeLogo/);
 assert.match(css,/#biteOwnerHomeProperty/);
 assert.match(css,/#pageTitle\{\s*display:none!important/);
 assert.match(css,/#biteV3Home \.bv3-intro\{\s*display:none!important/);
 assert.match(fs.readFileSync('assets/owner-reference-v3.js','utf8'),/bell\.addEventListener\('click',\(\)=>toggleNoticeTray\(\)\)/);
});
test('Property selector remains functional in More for businesses with multiple properties',()=>{
 assert.match(nav,/propertySlot\.id='biteOwnerPropertySwitchSection'/);
 assert.match(nav,/const count=holder\.querySelectorAll\('select option'\)\.length/);
 assert.match(nav,/propertySlot\.append\(holder\)/);
 assert.match(nav,/propertyAnchor\.after\(holder\)/);
 assert.match(nav,/propertySlot\.hidden=count<2/);
 assert.match(nav,/holder\.hidden=count===0/);
 assert.match(old,/\$\('bitePropertySelect'\)\.addEventListener\('change'/);
 assert.doesNotMatch(nav,/propertyHolder\.remove\(\)/);
});
