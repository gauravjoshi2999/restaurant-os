'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('assets/admin-cashfree-audit.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const makeNode=()=>({
 textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},style:{},children:[],handlers:{},
 setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;},
 append(...nodes){this.children.push(...nodes);},
 replaceChildren(){this.children=[];},
 closest(){return null;}
});
function setup(options={}){
 const elements=new Map();
 const find=id=>{
  if(!elements.has(id))elements.set(id,makeNode());
  return elements.get(id);
 };
 const document={getElementById:find,createElement:makeNode};
 const window={};
 vm.runInNewContext(code,{window,document,console});
 const calls=[],read=[];
 let user=options.userId??'admin-a',role=options.role??'super_admin',isAdmin=options.isAdmin??true;
 let checks=options.checks||[],error=null;
 const orders=[
  {id:'order-paid',order_code:'BITE-123',is_demo:false,channel:'Own Platform'},
  {id:'order-demo',order_code:'DEMO',is_demo:true,channel:'Own Platform'},
  {id:'order-pos',order_code:'POS',is_demo:false,channel:'POS - Counter'}];
 const fin=[
  {order_id:'order-paid',restaurant_id:'restaurant-a',channel:'Own Platform',is_demo:false,payment_status:'paid',customer_payable_amount:174,created_at:'2026-11-14T09:00:00Z'},
  {order_id:'order-demo',restaurant_id:'restaurant-a',channel:'Own Platform',is_demo:true,payment_status:'paid',customer_payable_amount:150},
  {order_id:'order-pos',restaurant_id:'restaurant-a',channel:'POS - Counter',is_demo:false,payment_status:'paid',customer_payable_amount:100}
 ];
 const state={orders,financials:fin,restaurants:[{id:'restaurant-a',name:'Test Restaurant'}]};
 const query={select(...args){read.push({type:'select',args});return this;},order(){return this;},async limit(){return {data:checks,error};}};
 const sb={from(name){read.push({type:'table',name});return query;},functions:{async invoke(name,payload){
    calls.push({name,payload});
    if(payload.body?.action==='inspect_split'){
      return {data:{split:{status:'PROVIDER_VENDOR_SPLIT_RECORDS',vendor_count:1,
       vendors:[{vendor_id:'vendor_1',amount:145,settlement_reference:'78123'}],
       vendor_mapping:'NOT_VERIFIED',bank_payout:'NOT_VERIFIED'}},error:null};
    }
    checks=[{order_id:'order-paid',collection_status:'PAID',collection_amount:174,settlement_evidence:{settlement:{status:'SUCCESS',settlement_utr:'some-utr'}},checked_at:'2026-11-14T10:00:00Z'}];return {data:{collection:{status:'PAID',amount:174,currency:'INR'},restaurant_payout:'NOT_VERIFIED_BY_PG_COLLECTION'},error:null};}}};
 window.BiteCashfreeAudit.init({sb,getState:()=>state,getAccess:()=>({role,isPlatformAdmin:isAdmin}),getUser:()=>user?{id:user}:null,formatMoney:n=>'₹'+Number(n).toFixed(2)});
 return {audit:window.BiteCashfreeAudit,find,calls,read,state,setUser(x){user=x;},setRole(x){role=x;},setChecks(x){checks=x;},setError(x){error=x;}};
}
test('classification never confuses provider collection or merchant evidence with vendor payout',()=>{
 const a=setup();
 const fin={customer_payable_amount:174};
 let v=a.audit.classify(fin,null);
 assert.equal(v.verifiedCollection,false);
 assert.match(v.restaurantPayout,/NOT verified/);
 v=a.audit.classify(fin,{collection_status:'PAID',collection_amount:173,settlement_evidence:{settlement:{status:'SUCCESS'}}});
 assert.equal(v.verifiedCollection,false,'Wrong amount is not verified');
 v=a.audit.classify(fin,{collection_status:'PAID',collection_amount:174,settlement_evidence:{settlement:{status:'SUCCESS'}}});
 assert.equal(v.verifiedCollection,true);
 assert.match(v.merchantSettlement,/bank not confirmed/);
 assert.match(v.restaurantPayout,/NOT verified/);
});
test('loading verified-payment queue reads RLS protected table and NEVER invokes Cashfree',async()=>{
 const a=setup();
 await a.audit.load();
 assert.equal(a.calls.length,0,'No provider call on page load');
 assert.ok(a.read.some(x=>x.name==='bite_provider_checks'));
 assert.equal(a.find('biteProviderNeedCount').textContent,'1');
 assert.equal(a.find('biteProviderCheckedCount').textContent,'0');
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
 assert.equal(a.find('biteProviderAuditRows').children.length,1,'No DEMO or POS orders in live reconciliation');
 assert.match(a.find('biteProviderAuditStatus').textContent,/not bank payout confirmations/);
});
test('manual verification invokes only the existing admin-only reconcile endpoint, not transfer/refund',async()=>{
 const a=setup();
 await a.audit.load();
 await a.audit.reconcile('order-paid');
 assert.equal(a.calls.length,1);
 assert.equal(a.calls[0].name,'bite-cashfree-operations');
 assert.equal(a.calls[0].payload.body.action,'reconcile');
 assert.equal(a.calls[0].payload.body.order_id,'order-paid');
 assert.equal(a.find('biteProviderCheckedCount').textContent,'1');
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});
test('owner and signed-out sessions cannot read provider checks or invoke payment operations',async()=>{
 const a=setup({role:'owner',isAdmin:false});
 await a.audit.load();await a.audit.reconcile('order-paid');
 assert.equal(a.calls.length,0);
 assert.equal(a.read.length,0);
 assert.equal(a.find('biteProviderAuditRows').children.length,0);
 a.setRole('super_admin');a.setUser(null);
 await a.audit.load();await a.audit.reconcile('order-paid');
 assert.equal(a.calls.length,0);
 assert.equal(a.read.length,0);
});
test('a failed RLS query shows a safe error without implying payment failed or transferred',async()=>{
 const a=setup();a.setError(new Error('RLS denied'));
 await a.audit.load();
 assert.match(a.find('biteProviderAuditStatus').textContent,/Unable to read provider-check records/);
 assert.equal(a.calls.length,0);
});
test('GitHub UI wires Super Admin financials only and never exposes provider secret',()=>{
 assert.match(html,/id="biteProviderAuditRows"/);
 assert.match(html,/assets\/admin-cashfree-audit\.js/);
 assert.match(html,/financials:async\(\)=>\{/);
 assert.match(html,/window\.BiteCashfreeAudit\?\.clear\?\.\(\)/);
 assert.match(html,/role==='super_admin'\?platformPages/);
 assert.match(code,/role==='super_admin'/);
 assert.match(code,/action:'reconcile'/);
 assert.doesNotMatch(code,/CASHFREE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|execute_refund|create_refund|create_transfer/);
 for(const part of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]){
  if(part[1].trim()) assert.doesNotThrow(()=>new vm.Script(part[1]));
 }
});

test('manual vendor inspection only invokes read-only inspect_split and does not mark bank payout',async()=>{
 const a=setup();
 await a.audit.load();
 assert.equal(a.calls.length,0);
 await a.audit.inspectSplit('order-paid');
 assert.equal(a.calls.length,1);
 assert.equal(a.calls[0].payload.body.action,'inspect_split');
 assert.equal(a.calls[0].payload.body.order_id,'order-paid');
 const tr=a.find('biteProviderAuditRows').children[0];
 assert.match(tr.children[4].textContent,/vendor_1/);
 assert.match(tr.children[4].textContent,/NOT verified/);
 assert.match(a.find('biteProviderAuditStatus').textContent,/mapping and bank payout remain NOT verified/);
 assert.equal(a.find('biteProviderPayoutCount').textContent,'Not independently verified');
});

test('split inspection is restricted to Super Admin and never starts automatically',async()=>{
 const a=setup({role:'owner',isAdmin:false});
 await a.audit.load();await a.audit.inspectSplit('order-paid');
 assert.equal(a.calls.length,0);
 a.setRole('super_admin');a.setUser('super-admin-b');
 await a.audit.load();
 assert.equal(a.calls.length,0);
 assert.equal(a.find('biteProviderAuditRows').children[0].children[5].children.length,2,
  'both manual actions are explicit buttons');
});

test('changing login clears split details instead of showing prior Owner or Admin data',async()=>{
 const a=setup();
 await a.audit.load();await a.audit.inspectSplit('order-paid');
 a.audit.clear();
 assert.equal(a.find('biteProviderAuditRows').children.length,0);
 a.setUser('another-admin');
 await a.audit.load();
 const tr=a.find('biteProviderAuditRows').children[0];
 assert.doesNotMatch(tr.children[4].textContent,/vendor_1/);
});
