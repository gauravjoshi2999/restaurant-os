'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/super-admin-workspace.js','utf8');
const start=source.indexOf('async function sourceCount(');
const end=source.indexOf('async function home(',start);
assert.ok(start>=0&&end>start,'Home count loader exists');

function scope(allowed=true,replies={}){
 const calls=[];
 const ctx={sb:{from(table){
  calls.push({table});
  const q={select(fields,options){
   assert.equal(fields,'id');
   assert.equal(options.count,'exact');assert.equal(options.head,true);
   return this;
  },eq(column,value){
   calls[calls.length-1].filters??=[];
   calls[calls.length-1].filters.push([column,value]);
   return this;
  },then(resolve){
   const key=table==='restaurants'&&calls[calls.length-1].filters?.length?'active':'all';
   const reply=replies[key]??{count:key==='active'?4:table==='orders'?27:11,error:null};
   return Promise.resolve(reply).then(resolve);
  }};
  return q;
 }}};
 const sandbox={ctx,authorized:()=>allowed,Number,Error};
 vm.runInNewContext(source.slice(start,end)+'\nthis.loadCount=sourceCount;',sandbox);
 return {...sandbox,calls};
}

test('Super Admin headline counts read only exact RLS-scoped server aggregates',async()=>{
 const s=scope();
 assert.equal(await s.loadCount('restaurants'),11);
 assert.equal(await s.loadCount('restaurants',[['is_published',true],['status','Active'],['onboarding_status','approved']]),4);
 assert.equal(await s.loadCount('orders',[['channel','Own Platform'],['is_demo',false]]),27);
 assert.equal(s.calls.length,3);
 assert.deepEqual(s.calls.map(x=>x.table),['restaurants','restaurants','orders']);
 assert.deepEqual(s.calls[1].filters,[['is_published',true],['status','Active'],['onboarding_status','approved']]);
 assert.deepEqual(s.calls[2].filters,[['channel','Own Platform'],['is_demo',false]]);
 assert.match(source,/data-sa-all-restaurants/);
 assert.match(source,/data-sa-active-restaurants/);
 assert.match(source,/data-sa-platform-orders/);
 assert.match(source,/Promise\.allSettled/);
 assert.match(source,/Unverified/);
});
test('missing or invalid counts fail closed instead of displaying zero or guessed totals',async()=>{
 for(const count of [null,undefined,'4',-1,1.25]){
  const s=scope(true,{all:{count,error:null}});
  await assert.rejects(()=>s.loadCount('restaurants'),/Source count unavailable/);
 }
 const s=scope(true,{all:{count:null,error:{message:'RLS denied'}}});
 await assert.rejects(()=>s.loadCount('restaurants'),/Source count unavailable/);
});
test('non-Super Admin cannot use the Home aggregate loader',async()=>{
 const s=scope(false);
 await assert.rejects(()=>s.loadCount('restaurants'),/Super Admin session unavailable/);
 assert.equal(s.calls.length,0);
 assert.match(source,/ctx\.getAccess\(\)\?\.role==='super_admin'/);
});
