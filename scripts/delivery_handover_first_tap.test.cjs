'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const a=source.indexOf('const deliveryShareInFlight=new Set();');
const b=source.indexOf('async function advanceOrder(id,next)',a);
assert(a>=0&&b>a,'Production delivery share function must exist');
const js=source.slice(a,b);
function setup(status='Handed Over',defer=false){
 const navigations=[],alerts=[],updates=[];
 let finish=()=>{};
 const pending=new Promise(resolve=>{finish=resolve;});
 const rpcCalls=[];
 const ctx={
  access:{role:'owner'},
  state:{orders:[{id:'order-1',status,deliveryType:'delivery'}]},
  sb:{
   rpc:async(name,args)=>{
    rpcCalls.push({name,args});
    if(defer)await pending;
    return {data:{token:'one-time-test-token',restaurant_name:'QA Restaurant',order_code:'QA-100',
     customer_name:'Sample',customer_phone:'0000000000',items:[{item_name:'QA Veg Thali',quantity:1}],
     delivery_address:{address_line:'QA Lane',city:'Rajsamand',state:'Rajasthan',postal_code:'313324'}}};
   },
   from:()=>({update:values=>({eq(){return this},select(){return this},async maybeSingle(){updates.push(values);return{data:{id:'order-1',status:'Handed Over'}}}})})
  },
  window:{location:{assign:url=>navigations.push(url)},open:()=>{throw Error('about:blank popup must never be opened')}},
  console, alert:s=>alerts.push(s),
  confirm:()=>true,loadCloudData:async()=>{},Number,Date,Promise,Set,
  encodeURIComponent
 };
 vm.createContext(ctx);vm.runInContext(js,ctx);
 return {ctx,navigations,alerts,rpcCalls,updates,finish};
}
test('First delivery share click opens WhatsApp directly without about:blank or popup',async()=>{
 const t=setup();
 assert.equal(await t.ctx.shareDeliveryHandoff('order-1',false),true);
 assert.equal(t.navigations.length,1);
 assert(t.navigations[0].startsWith('https://wa.me/?text='));
 assert(t.navigations[0].includes('delivery.html%3Ftoken%3Done-time-test-token'));
 assert.deepEqual(t.alerts,[]);
 assert.deepEqual(t.updates,[]);
});
test('Share and hand over saves status once and opens WhatsApp on first action',async()=>{
 const t=setup('Ready');
 assert.equal(await t.ctx.shareDeliveryHandoff('order-1',true),true);
 assert.equal(t.updates.length,1);
 assert.equal(t.updates[0].status,'Handed Over');
 assert.equal(t.navigations.length,1);
});
test('Rapid repeat clicks cannot create two delivery links',async()=>{
 const t=setup('Handed Over',true);
 const first=t.ctx.shareDeliveryHandoff('order-1',false);
 assert.equal(await t.ctx.shareDeliveryHandoff('order-1',false),false);
 t.finish();assert.equal(await first,true);
 assert.equal(t.rpcCalls.length,1);
 assert.equal(t.navigations.length,1);
});
test('Owner handover never pre-opens an empty browser tab',()=>{
 assert.doesNotMatch(js,/window\.open\(['"]about:blank/);
 assert.match(js,/window\.location\.assign\(waUrl\)/);
 assert.doesNotMatch(js,/prompt\('WhatsApp share/);
});