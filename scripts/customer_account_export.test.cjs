'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {buildSnapshot}=require('../assets/customer-account-export.js');
const html=fs.readFileSync('customer.html','utf8');
const hub=fs.readFileSync('assets/customer-account-center.js','utf8');
function clientFactory(opts={}){
  const calls=[];
  const userA={id:'private-A',email:'a@example.test',user_metadata:{full_name:'Customer A',bite_preferences_v1:{veg_only:true}}};
  const userB={id:'private-B',email:'b@example.test',user_metadata:{full_name:'Customer B'}};
  let userCalls=0;
  const rows={
    customer_contact_profiles:{full_name:'Customer A',phone:'9999999999',customer_id:'private-A',private_admin_field:'not-exported'},
    customer_addresses:[{label:'Home',address_line:'A Street',city:'Rajsamand',customer_id:'private-A',private_admin_field:'not-exported'}],
    customer_support_tickets:[{category:'Account',subject:'Test',message:'Help please',status:'Open',admin_response:null,created_at:'2026-11-16',customer_id:'private-A'}]
  };
  const query=table=>{
    const entry={table,filters:[],selected:null,limitValue:null};
    calls.push(entry);
    const q={select(columns){entry.selected=columns;return q},
      eq(key,value){entry.filters.push({key,value});return q},
      order(){return q},
      limit(n){entry.limitValue=n;return q},
      maybeSingle(){return Promise.resolve({data:rows[table],error:opts.fail===table?new Error('Unavailable'):null})},
      then(resolve,reject){return Promise.resolve({data:rows[table],error:opts.fail===table?new Error('Unavailable'):null}).then(resolve,reject)}
    };
    return q;
  };
  const client={
    auth:{async getUser(){userCalls++;return{data:{user:opts.switchUser&&userCalls>=2?userB:userA},error:null}}},
    from:query,
    async rpc(name){calls.push({rpc:name});return{data:[{order_code:'BITE-A',restaurant_name:'Example Restaurant',status:'Delivered',amount:170,internal_service_token:'never-export'}],error:opts.fail==='orders'?new Error('Unavailable'):null}}
  };
  return{client,calls};
}
test('private download uses customer_id filters plus RLS, rechecks signed-in identity and limits output keys',async()=>{
 const t=clientFactory();
 const data=await buildSnapshot(t.client,'private-A');
 assert.equal(data.format,'bite-customer-data-snapshot');
 assert.equal(data.account.email,'a@example.test');
 assert.equal(data.preferences.vegetarian_mode,true);
 assert.equal(data.saved_addresses[0].address_line,'A Street');
 assert.equal(data.order_history[0].order_code,'BITE-A');
 assert.equal(data.support_requests[0].subject,'Test');
 assert.equal(data.saved_addresses[0].customer_id,undefined);
 assert.equal(data.order_history[0].internal_service_token,undefined);
 assert.equal(data.account.private_admin_field,undefined);
 const q=t.calls.filter(x=>x.table);
 assert.equal(q.length,3);
 assert.ok(q.every(x=>x.filters.some(f=>f.key==='customer_id'&&f.value==='private-A')));
 assert.ok(q.filter(x=>x.limitValue!==null).every(x=>x.limitValue===500));
 assert.ok(t.calls.some(x=>x.rpc==='list_my_customer_orders'));
 assert.match(JSON.stringify(data),/Does not include payment gateway records/);
});
test('account change while loading forbids export even if first response belongs to previous user',async()=>{
 const t=clientFactory({switchUser:true});
 await assert.rejects(buildSnapshot(t.client,'private-A'),/Account changed/);
});
test('pending view generation invalidation stops personal export',async()=>{
 const t=clientFactory();
 let checks=0;
 await assert.rejects(buildSnapshot(t.client,'private-A',()=>++checks<4),/Account changed/);
});
test('read failure rejects entire export, preventing misleading partial file',async()=>{
 const t=clientFactory({fail:'customer_support_tickets'});
 await assert.rejects(buildSnapshot(t.client,'private-A'),/No partial export/);
});
test('unsigned customer cannot fetch account data',async()=>{
 const t=clientFactory();
 await assert.rejects(buildSnapshot(t.client,null),/sign in/);
 assert.equal(t.calls.length,0);
});
test('button is actionable, available in premium profile, and status text is not fake completion',()=>{
 assert.match(html,/data-bite-account-go="export" id="biteDownloadAccountData"/);
 assert.match(html,/id="biteDataExportStatus"[^>]*aria-live="polite"/);
 assert.match(html,/customer-account-export\.js\?v=20261116-data1/);
 assert.match(hub,/await root\.BiteAccountExport\.buildSnapshot\(sb,id,current\)/);
 assert.match(hub,/root\.BiteAccountExport\.downloadSnapshot\(snapshot\)/);
 assert.match(hub,/else if\(destination==='export'\)void requestExport\(\)/);
 assert.doesNotMatch(hub,/service_role|auth\.admin/);
});
