'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const enhancement=fs.readFileSync('assets/customer-premium.js','utf8');

const begin=html.indexOf('let biteStorefrontLoadToken=0;');
const end=html.indexOf('function customerDistanceKm(',begin);
assert.ok(begin>=0&&end>begin,'Race-safe storefront loader exists');
const loader=html.slice(begin,end);

function deferred(){
 let resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}
function fixture({manualMenu=false}={}){
 const resultNode={innerHTML:'old restaurant card'};
 const countNode={textContent:'1 restaurant'};
 const rpcCalls=[],menuCalls=[],commits=[];
 const ctx={
  BITE_DIRECT_MODE:false,
  BITE_DIRECT_RESTAURANT_ID:null,
  currentDiscoveryPin:'313324',
  restaurants:[{id:'stale',name:'Stale'}],
  storefrontCategories:[],
  publicMenuSearch:[],
  coverRefreshLastAt:0,
  window:{BiteCustomerExtras:{renderCategories(){}}},
  $:id=>id==='restaurantGrid'?resultNode:countNode,
  renderRestaurants(){commits.push(ctx.restaurants.map(r=>r.id));},
  sb:{
   rpc(name,params){
    if(name!=='bite_storefront')throw Error('Unexpected RPC '+name);
    const task=deferred();
    rpcCalls.push({...task,pin:params.p_postal_code});
    return task.promise;
   },
   from(table){
    assert.equal(table,'menu_items');
    return {
     select(){return this;},
     eq(){return this;},
     limit(){
      const task=deferred();menuCalls.push(task);
      return manualMenu?task.promise:Promise.resolve({data:[],error:null});
     }
    };
   }
  },
  console:{error(){}}
 };
 vm.runInNewContext(loader+';this.runStorefront=loadRestaurants;',ctx);
 const result=(id,serviceable=true)=>({data:{restaurants:[{
  id,name:id,cuisine_tags:['Indian'],price_from:null,
  accepts_delivery:true,accepts_pickup:true,
  delivery_paused:false,serviceable
 }],categories:[]},error:null});
 return {ctx,resultNode,countNode,rpcCalls,menuCalls,commits,result};
}

test('PIN change immediately hides old restaurant cards until delivery is checked',async()=>{
 const f=fixture();
 const pending=f.ctx.runStorefront();
 assert.match(f.resultNode.innerHTML,/Checking restaurants/);
 assert.equal(f.countNode.textContent,'Checking delivery area…');
 assert.equal(f.ctx.window.biteStorefrontLoading,true);
 f.rpcCalls[0].resolve(f.result('Rajsamand'));
 await pending;
 assert.equal(f.ctx.restaurants[0].name,'Rajsamand');
 assert.equal(f.ctx.window.biteStorefrontLoading,false);
 assert.equal(f.commits.length,1);
});

test('out-of-order slower old PIN response never replaces newer restaurant listing',async()=>{
 const f=fixture();
 const older=f.ctx.runStorefront();
 f.ctx.currentDiscoveryPin='313399';
 const latest=f.ctx.runStorefront();
 assert.deepEqual(f.rpcCalls.map(x=>x.pin),['313324','313399']);
 f.rpcCalls[1].resolve(f.result('new PIN restaurant'));
 await latest;
 f.rpcCalls[0].resolve(f.result('OLD wrong restaurant'));
 await older;
 assert.equal(f.ctx.restaurants[0].name,'new PIN restaurant');
 assert.equal(f.commits.length,1);
 assert.deepEqual(Array.from(f.commits[0]),['new PIN restaurant']);
});

test('previous PIN response cannot overwrite newer selection even after its menu query starts',async()=>{
 const f=fixture({manualMenu:true});
 const old=f.ctx.runStorefront();
 f.rpcCalls[0].resolve(f.result('old menu'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.menuCalls.length,1);
 f.ctx.currentDiscoveryPin='313399';
 const latest=f.ctx.runStorefront();
 f.rpcCalls[1].resolve(f.result('new menu'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.menuCalls.length,2);
 f.menuCalls[1].resolve({data:[],error:null});
 await latest;
 f.menuCalls[0].resolve({data:[],error:null});
 await old;
 assert.equal(f.ctx.restaurants[0].name,'new menu');
 assert.equal(f.commits.length,1);
});

test('old failed request cannot replace successful new-PIN results with an error',async()=>{
 const f=fixture();
 const old=f.ctx.runStorefront();
 f.ctx.currentDiscoveryPin='313399';
 const latest=f.ctx.runStorefront();
 f.rpcCalls[1].resolve(f.result('correct'));
 await latest;
 f.rpcCalls[0].reject(new Error('slow network'));
 await old;
 assert.equal(f.ctx.restaurants[0].name,'correct');
 assert.doesNotMatch(f.resultNode.innerHTML,/Restaurants load nahi ho paaye/);
});

test('Change PIN uses visible premium location sheet; no hidden legacy form focus',()=>{
 const location=html.slice(html.indexOf("$('restaurantGrid').addEventListener('click'"),html.indexOf("$('homeSearchInput').addEventListener('keydown'"));
 assert.match(location,/if\(e\.target\.closest\('\[data-discovery-pin\]'\)\)/);
 assert.match(location,/\$\('biteLocationOpen'\)\.click\(\)/);
 assert.doesNotMatch(location,/discoveryPinInput'\)\.focus/);
 assert.match(html,/id="discoveryLocationForm"[^>]*\bhidden\b/);
 assert.match(html,/id="biteSheetPinForm"/);
});

test('no unverified delivery badge or fee while PIN is pending or pickup-only',()=>{
 const renderer=html.slice(html.indexOf('function renderRestaurants(){'),html.indexOf('function resetDiscovery(',html.indexOf('function renderRestaurants(){')));
 assert.match(renderer,/window\.biteStorefrontLoading/);
 assert.match(renderer,/delivery=!!currentDiscoveryPin&&r\.serviceable===true/);
 assert.match(renderer,/delivery\?money\(r\.zone_delivery_fee\?\?r\.default_delivery_fee\)/);
 assert.match(renderer,/r\.accepts_delivery\?'Check PIN'/);
 assert.match(enhancement,/window\.biteStorefrontLoading\|\|query\.length<2/);
 assert.doesNotMatch(loader,/Cashfree|service_role|payment_session_id|localStorage/);
});
