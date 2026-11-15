'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const guard=require('../assets/customer-search-autofill-guard.js');
const html=fs.readFileSync('customer.html','utf8');
function mock(){
 const elements={};
 const handles={};
 const doc={
  visibilityState:'visible',
  getElementById(id){return elements[id]??null},
  addEventListener(type,callback){handles[type]=callback;},
  removeEventListener(type){delete handles[type];}
 };
 for(const id of ['homeSearchInput','searchInput']){
  const listeners={};
  elements[id]={
   value:'',listeners,attrs:{},setAttribute(k,v){this.attrs[k]=v},
   addEventListener(type,callback){listeners[type]=callback},
   removeEventListener(type){delete listeners[type]},
   dispatchEvent(event){listeners[event.type]?.(event);return true}
  };
 }
 return {doc,elements,handles};
}
test('both food search inputs are semantic search fields with no browser credential autofill',()=>{
 for(const id of ['searchInput','homeSearchInput']){
  const open=html.match(new RegExp('<input\\b[^>]*id="'+id+'"[^>]*>'))?.[0];
  assert.ok(open,'missing '+id);
  assert.match(open,/type="search"/);
  assert.match(open,/autocomplete="off"/);
  assert.match(open,/name="bite_food_/);
  assert.match(open,/spellcheck="false"/);
 }
 assert.match(html,/customer-search-autofill-guard\.js\?v=20261115-search-autofill1/);
});
test('email from browser autofill is cleared on initialization, both inputs',()=>{
 const {doc,elements}=mock();
 elements.homeSearchInput.value='someone@example.com';
 elements.searchInput.value='someone@example.com';
 const controller=guard.install(doc);
 assert.equal(elements.homeSearchInput.value,'');
 assert.equal(elements.searchInput.value,'');
 assert.equal(elements.homeSearchInput.attrs.autocomplete,'off');
 controller.stop();
});
test('normal restaurant or dish search is not cleared and can still be typed',()=>{
 const {doc,elements}=mock();
 elements.homeSearchInput.value='paneer tikka';
 const controller=guard.install(doc);
 assert.equal(elements.homeSearchInput.value,'paneer tikka');
 elements.homeSearchInput.value='Hotel Maharani Palace';
 elements.homeSearchInput.dispatchEvent({type:'input'});
 assert.equal(elements.homeSearchInput.value,'Hotel Maharani Palace');
 controller.stop();
});
test('browser email restoration is cleared on input, focus and page visibility',()=>{
 const {doc,elements,handles}=mock();
 const controller=guard.install(doc);
 elements.homeSearchInput.value='someone@example.com';
 elements.homeSearchInput.dispatchEvent({type:'input'});
 assert.equal(elements.homeSearchInput.value,'');
 elements.searchInput.value='someone@example.com';
 elements.searchInput.dispatchEvent({type:'focus'});
 assert.equal(elements.searchInput.value,'');
 elements.homeSearchInput.value='someone@example.com';
 handles.visibilitychange();
 assert.equal(elements.homeSearchInput.value,'');
 controller.stop();
});
test('only email-shaped values are removed, never saved customer account credentials',()=>{
 assert.equal(guard.isEmailAutofill('someone@example.com'),true);
 assert.equal(guard.isEmailAutofill('someone@example'),false);
 assert.equal(guard.isEmailAutofill('paneer pizza'),false);
 assert.equal(guard.isEmailAutofill('Shreeji@ Thali'),false);
 assert.equal(guard.isEmailAutofill('food@example.com offers'),false);
 assert.match(html,/id="loginEmail"/);
});
