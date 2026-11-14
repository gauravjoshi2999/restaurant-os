'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const begin=html.indexOf('async function bitePromoteDefaultAddress(');
const end=html.indexOf("$('addrSave').addEventListener",begin);
assert.ok(begin>=0&&end>begin);
const snippet=html.slice(begin,end);

function runPromotion(rows,failStep=0,missing=false){
 const calls=[];
 const db={from(table){
  const op={table,filters:[],data:null};
  const chain={
   update(data){op.data=data;return chain;},
   eq(field,value){op.filters.push({where:'eq',field,value});return chain;},
   neq(field,value){op.filters.push({where:'neq',field,value});return chain;},
   select(){return chain;},
   maybeSingle(){
    calls.push(op);
    return Promise.resolve(failStep===calls.length?{data:null,error:new Error('write unavailable')}:
      {data:missing?null:{id:'new'},error:null});
   },
   then(resolve,reject){
    calls.push(op);
    const result=failStep===calls.length?{error:new Error('database unavailable')}:{error:null};
    return Promise.resolve(result).then(resolve,reject);
   }
  };
  return chain;
 }};
 const ctx=vm.createContext({accountAddressRows:rows,sb:db,console,Date});
 vm.runInContext(snippet+';globalThis.promote=bitePromoteDefaultAddress;',ctx);
 return {promote:(id='new',owner='customer-a')=>ctx.promote(id,owner),calls};
}

test('changing default updates selected row first, then clears only other addresses of the same owner',async()=>{
 const {promote,calls}=runPromotion([{id:'old',is_default:true},{id:'new',is_default:false}]);
 await promote();
 assert.equal(calls.length,2);
 assert.equal(calls[0].table,'customer_addresses');
 assert.equal(calls[0].data.is_default,true);
 assert.ok(calls[0].filters.some(f=>f.field==='customer_id'&&f.value==='customer-a'));
 assert.ok(calls[0].filters.some(f=>f.field==='id'&&f.value==='new'));
 assert.equal(calls[1].data.is_default,false);
 assert.ok(calls[1].filters.some(f=>f.where==='neq'&&f.field==='id'&&f.value==='new'));
 assert.ok(calls[1].filters.some(f=>f.field==='customer_id'&&f.value==='customer-a'));
});

test('failed selected address update leaves previous default untouched',async()=>{
 const {promote,calls}=runPromotion([{id:'old',is_default:true},{id:'new',is_default:false}],1);
 await assert.rejects(promote(),/write unavailable/);
 assert.equal(calls.length,1,'Must not clear existing defaults after a failed target update');
});

test('failed clear step compensates by restoring the new address to non-default',async()=>{
 const {promote,calls}=runPromotion([{id:'old',is_default:true},{id:'new',is_default:false}],2);
 await assert.rejects(promote(),/refresh and retry/);
 assert.equal(calls.length,3);
 assert.equal(calls[0].data.is_default,true);
 assert.equal(calls[1].data.is_default,false);
 assert.equal(calls[2].data.is_default,false,'Rollback must restore new target to non-default');
 assert.ok(calls[2].filters.some(f=>f.field==='id'&&f.value==='new'));
 assert.ok(calls[2].filters.some(f=>f.field==='customer_id'&&f.value==='customer-a'));
});

test('missing target does not clear the other saved addresses',async()=>{
 const {promote,calls}=runPromotion([{id:'old',is_default:true}],0,true);
 await assert.rejects(promote(),/no longer available/);
 assert.equal(calls.length,1);
});

test('address list, save and delete are explicitly owner-scoped and do not clear default before saving',()=>{
 assert.match(html,/function loadAccountAddresses\([^)]*\)\{[^}]*\.eq\('customer_id',userId\)\.order\('is_default'/);
 assert.match(html,/\.update\(payload\)\.eq\('customer_id',customerId\)\.eq\('id',id\)/);
 assert.match(html,/\.delete\(\)\.eq\('customer_id',customerId\)\.eq\('id',addressId\)/);
 assert.match(html,/const payload=\{[\s\S]*is_default:existing\?\.is_default===true/);
 assert.match(html,/\.insert\(\{\.\.\.payload,is_default:false\}\)/);
 assert.match(html,/if\(wantsDefault&&!existing\?\.is_default\)\{[\s\S]*await bitePromoteDefaultAddress\(savedId,customerId\)/);
 assert.match(html,/Address saved, but default could not be updated/);
 assert.match(html,/await loadAccountAddresses\(accountSequence,customerId\);\s*resetAddrForm\(\)/);
 assert.match(html,/let biteAddressMutationBusy=false/);
 assert.match(html,/if\(biteAddressMutationBusy\)return/);
 assert.match(html,/finally\{biteAddressMutationBusy=false;/);
});

test('mobile edit action scrolls to real address form; account logout returns home',()=>{
 assert.match(html,/\$\('customerAddressForm'\)\.scrollIntoView\(/);
 assert.match(html,/\$\('addrName'\)\.focus\(\{preventScroll:true\}\)/);
 assert.match(html,/if\(!\$\('ordersView'\)\.classList\.contains\('hidden'\)\|\|!\$\('accountView'\)\.classList\.contains\('hidden'\)\)showCustomerView\('home'\)/);
 assert.match(html,/sb\.rpc\('list_my_customer_orders'\)/);
 assert.match(html,/sb\.rpc\('check_restaurant_delivery_area'/);
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
 for(const script of scripts)assert.doesNotThrow(()=>new vm.Script(script));
});
