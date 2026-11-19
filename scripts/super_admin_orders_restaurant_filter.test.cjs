'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/super-admin-workspace.js','utf8');
const start=source.indexOf('async function listing(token){');
const end=source.indexOf('\n function record(',start);
assert.ok(start>=0&&end>start,'Existing Super Admin list controller must be preserved');
const rid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='11111111-1111-4111-8111-000000000001';

function harness({selected=rid,status='all',queryText=''}={}){
 const calls=[], page={innerHTML:''};
 const data=[{id:'order-1',restaurant_id:rid,order_code:'BITE-123'}];
 function query(table){
  const filters=[];calls.push({table,filters});
  const q={
   select(){return this;},eq(key,value){filters.push(['eq',key,value]);return this;},
   in(key,values){filters.push(['in',key,values]);return this;},
   ilike(key,value){filters.push(['ilike',key,value]);return this;},
   order(){return this;},
   range(){return Promise.resolve({data:data.filter(row=>filters.every(([op,key,v])=>op!=='eq'||row[key]===v)),count:filters.some(x=>x[1]==='restaurant_id'&&x[2]===other)?0:1,error:null});}
  };
  return q;
 }
 const sb={from:query,rpc(name){calls.push({rpc:name});return Promise.resolve({data:{rows:data,total_count:1},error:null});}};
 const ctx={sb,getState:()=>({restaurants:[{id:rid,name:'Rajsamand Kitchen'},{id:other,name:'Another Hotel'}]})};
 const sandbox={ctx,current:'orders',tab:'payments',filter:status,search:queryText,restaurantFilter:selected,offset:0,total:0,rows:[],
  loading(){},valid:()=>true,host:()=>page,heading:()=>'',status:()=>'',esc:v=>String(v),record:()=>'<article class="sa-record"></article>',pageButtons(){},button:()=>'',Number,Promise};
 vm.runInNewContext(source.slice(start,end)+'\nthis.runListing=listing;',sandbox);
 return {sandbox,calls,page};
}

test('restaurant choice filters on server before paginating and changes empty state',async()=>{
 const testCase=harness({selected:other});
 await testCase.sandbox.runListing(1);
 const order=testCase.calls.find(x=>x.table==='orders');
 assert.ok(order,'Orders query called');
 assert.ok(order.filters.some(([op,key,value])=>op==='eq'&&key==='restaurant_id'&&value===other));
 assert.equal(testCase.sandbox.rows.length,0);
 assert.match(testCase.page.innerHTML,/No matching records/);
 assert.match(testCase.page.innerHTML,/Restaurant<select name="restaurant"/);
 assert.match(testCase.page.innerHTML,/value="11111111-1111-4111-8111-000000000001" selected/);
});
test('order-code and status stay composed with restaurant scoping',async()=>{
 const run=harness({selected:rid,status:'completed',queryText:'BITE'});
 await run.sandbox.runListing(1);
 const filters=run.calls.find(x=>x.table==='orders').filters;
 assert.ok(filters.some(([op,key,value])=>op==='eq'&&key==='restaurant_id'&&value===rid));
 assert.ok(filters.some(([op,key])=>op==='eq'&&key==='channel'));
 assert.ok(filters.some(([op,key])=>op==='eq'&&key==='is_demo'));
 assert.ok(filters.some(([op,key])=>op==='eq'&&key==='status'));
 assert.ok(filters.some(([op,key])=>op==='ilike'&&key==='order_code'));
});
test('global delayed alert never silently applies a restaurant filter',async()=>{
 const run=harness({selected:other,status:'delayed',queryText:'BITE'});
 await run.sandbox.runListing(1);
 assert.ok(run.calls.some(x=>x.rpc==='bite_super_admin_attention_v1'));
 assert.ok(!run.calls.some(x=>x.table==='orders'&&x.filters.some(f=>f[1]==='restaurant_id')));
 assert.doesNotMatch(run.page.innerHTML,/select name="restaurant"/);
 assert.match(run.page.innerHTML,/platform-wide server alert rule/);
 assert.match(source,/restaurantFilter=current==='orders'&&filter!=='delayed'/);
 assert.match(source,/restaurantFilter='';detail=null/);
});
