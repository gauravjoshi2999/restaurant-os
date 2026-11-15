'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cutlery=require('../assets/customer-cutlery-preference.js');
const notes=require('../assets/customer-item-notes.js');
const customer=fs.readFileSync('customer.html','utf8');
const owner=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/customer-cutlery-preference.css','utf8');
test('cutlery is opt-in, with no cost or guaranteed fulfillment claim',()=>{
 assert.equal(cutlery.composeGeneralNote('Less spicy',false),'Less spicy');
 assert.equal(cutlery.composeGeneralNote('',true),cutlery.REQUEST);
 assert.match(cutlery.REQUEST,/if available/);
 assert.doesNotMatch(cutlery.REQUEST,/guaranteed|free|fee/i);
 const composite=notes.compose({
  generalNote:cutlery.composeGeneralNote('Deliver carefully',true),
  itemNotes:{'dish-1':'Less spicy'},entries:[['dish-1',1]],
  menuItems:[{id:'dish-1',name:'Veg Thali'}]
 });
 assert.match(composite.note,/Deliver carefully/);
 assert.match(composite.note,/Please include disposable spoon\/fork if available/);
 assert.match(composite.note,/Dish requests.*Veg Thali/s);
 assert.equal(composite.tooLong,false);
});
test('turning off cutlery removes extra instruction without modifying customer note',()=>{
 assert.equal(cutlery.composeGeneralNote('No onions',false),'No onions');
 assert.equal(cutlery.composeGeneralNote('Please include disposable spoon/fork if available.',true),
  cutlery.REQUEST);
});
test('existing combined 500-character note guard rejects overlimit cutlery plus dish notes',()=>{
 const composite=notes.compose({
  generalNote:cutlery.composeGeneralNote('A'.repeat(470),true),
  itemNotes:{x:'Less spicy'},entries:[['x',1]],
  menuItems:[{id:'x',name:'Paneer'}]
 });
 assert.equal(composite.tooLong,true);
});
test('checkout persists cutlery with the restaurant cart and sends to existing owner order notes',()=>{
 assert.match(customer,/id="checkoutCutlery" type="checkbox"/);
 assert.match(customer,/cutleryRequested:!!\$\('checkoutCutlery'\)\?\.checked/);
 assert.match(customer,/savedCart\.cutleryRequested===true/);
 assert.match(customer,/BiteCutleryPreference\.composeGeneralNote/);
 assert.match(customer,/p_customer_note:instructions\.note\|\|null/);
 assert.match(owner,/customerNote:x\.customer_note\|\|''/);
 assert.match(owner,/if\(d\.customer_note\)/);
});
test('cutlery preference is cleared after cart reset or successful order and does not alter fee calculation',()=>{
 assert.match(customer,/function clearCustomerCart\(\).*?\$\('checkoutCutlery'\)\.checked=false/s);
 assert.match(customer,/showSandboxSuccess\(\).*?\$\('checkoutCutlery'\)\.checked=false/s);
 assert.match(customer,/pendingCartSignature===biteCheckoutCartSignature.*?\$\('checkoutCutlery'\)\.checked=false/s);
 assert.match(customer,/checkoutCutlery'\)\.addEventListener\('change',onCustomerInstructionsEdited\)/);
 assert.match(customer,/customer-cutlery-preference\.js\?v=20261116-cutlery1/);
 assert.match(css,/\.bite-cutlery-choice:focus-within/);
 assert.match(customer,/checkoutQuotedTotal=subtotal\+fee-Number\(appliedCheckoutCoupon/);
});
