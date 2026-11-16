'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-account-center.css','utf8');
const source=fs.readFileSync('assets/customer-account-center.js','utf8');
const account=html.slice(html.indexOf('<section id="accountView"'),html.indexOf('</main>',html.indexOf('<section id="accountView"')));
function fixture(){
 const handlers={},elements={},writes=[],changes=[];
 const el=id=>{
  if(!elements[id])elements[id]={id,textContent:'',value:'',checked:false,disabled:false,dataset:{},style:{},getAttribute(){return 'false'},focus(){},click(){(handlers[id+':click']||(()=>{}))({preventDefault(){},stopImmediatePropagation(){}})},querySelector(){return {textContent:''}},addEventListener(type,fn){handlers[id+':'+type]=fn},dispatchEvent(event){changes.push({id,type:event.type})},classList:{contains:()=>false}};
  return elements[id];
 };
 const section=el('accountView');section.contains=()=>true;
 const u={id:'userA',email:'one@example.test',user_metadata:{full_name:'Old Name'}};
 const state={user:u};
 const sb={
  auth:{
   onAuthStateChange(fn){handlers.authChanged=fn},
   async getSession(){return{data:{session:{user:state.user}}}},
   async getUser(){return{data:{user:state.user},error:null}},
   async updateUser({data,email}){if(email){writes.push({type:'email',email});return{data:{user:state.user},error:null}}writes.push({type:'metadata',data});state.user={...state.user,user_metadata:{...state.user.user_metadata,...data}};return{data:{user:state.user},error:null}}
  },
  async rpc(name){assert.equal(name,'bite_request_account_deletion');writes.push({type:'deletion-request'});return{data:null,error:null}},
  from(table){
   assert.equal(table,'customer_contact_profiles');
   return{upsert(record,args){writes.push({type:'profile',record,args});return{select(){return{async single(){return {data:{full_name:record.full_name,phone:record.phone},error:null}}}}}}};
  }
 };
 const document={getElementById:el,activeElement:null,querySelector(){return null}};
 const root={scrollTo(){},confirm(){return true},BiteAccountHub:null};
 const ctx=vm.createContext({window:root,document,sb,Event:class {constructor(type){this.type=type}},console,Date,Set});
 vm.runInContext(source,ctx);
 return{handlers,elements,el,writes,changes,state,hub:root.BiteAccountHub};
}
test('account overview has real navigation instead of fake wallet and empty membership promotions',()=>{
 for(const label of ['Edit profile','Saved addresses','Food preferences','Order updates &amp; notifications','Help &amp; support','Request account deletion'])assert.ok(account.includes(label),label);
 for(const target of ['profile','addresses','support','preferences','notifications','about','orders','favorites'])assert.ok(account.includes('data-bite-account-go="'+target+'"'),target);
 assert.doesNotMatch(account,/Zomato Gold|Swiggy Money|Add Card|Bite Wallet|Buy Gift Card/);
 assert.match(html,/window\.BiteAccountHub\?\.open\(\{user:data\.session\.user\}\)/);
 assert.match(html,/window\.BiteAccountHub\?\.setProfile\(p,data\.session\.user\)/);
 assert.match(html,/assets\/customer-account-center\.js/);
 assert.match(css,/data-section="addresses"/);
 assert.match(css,/@media\(max-width:600px\)/);
});
test('edit profile saves only to signed-in customer RLS table and syncs display name',async()=>{
 const t=fixture();t.hub.open({user:t.state.user});t.hub.setProfile({full_name:'Old Name',phone:'9876543210'},t.state.user);
 t.el('biteProfileName').value='New Display Name';
 t.el('biteProfilePhone').value='9123456789';
 await t.handlers['biteProfileForm:submit']({preventDefault(){}});
 const saved=t.writes.find(x=>x.type==='profile');
 assert.ok(saved);assert.equal(saved.record.customer_id,'userA');
 assert.equal(saved.record.full_name,'New Display Name');
 assert.equal(saved.record.phone,'9123456789');
 assert.equal(saved.args.onConflict,'customer_id');
 assert.equal(t.el('biteAccountName').textContent,'New Display Name');
 assert.match(t.el('biteProfileMessage').textContent,/saved/i);
});
test('invalid profile form does not submit writes',async()=>{
 const t=fixture();t.hub.open({user:t.state.user});
 t.el('biteProfileName').value='A';t.el('biteProfilePhone').value='123';
 await t.handlers['biteProfileForm:submit']({preventDefault(){}});
 assert.equal(t.writes.length,0);
 assert.match(t.el('biteProfileMessage').textContent,/valid/);
});
test('vegetarian preference persists via authenticated metadata, drives real existing filters',async()=>{
 const t=fixture();t.hub.open({user:t.state.user});
 t.el('biteAccountVeg').checked=true;
 await t.handlers['biteAccountVeg:change']({currentTarget:t.el('biteAccountVeg')});
 const saved=t.writes.find(x=>x.type==='metadata');
 assert.deepEqual(JSON.parse(JSON.stringify(saved.data)),{bite_preferences_v1:{veg_only:true}});
 assert.equal(t.el('discoveryDiet').value,'veg');
 assert.equal(t.el('menuVegToggle').checked,true);
 assert.ok(t.changes.some(x=>x.id==='discoveryDiet'));
 assert.ok(t.changes.some(x=>x.id==='menuVegToggle'));
});
test('account switch invalidates old profile and handles signed out without personal data',()=>{
 const t=fixture();t.hub.open({user:t.state.user});
 t.hub.setProfile({full_name:'First Person',phone:'9876543210'},t.state.user);
 assert.equal(t.el('biteAccountName').textContent,'First Person');
 const second={id:'userB',email:'second@example.test',user_metadata:{full_name:'Second Person'}};
 t.hub.open({user:second});
 assert.equal(t.el('biteAccountName').textContent,'Second Person');
 t.hub.setProfile({full_name:'First Person'},t.state.user);
 assert.equal(t.el('biteAccountName').textContent,'Second Person');
 t.handlers.authChanged('SIGNED_OUT',null);
 assert.equal(t.el('biteAccountName').textContent,'Welcome to Bite');
 assert.equal(t.el('biteAccountEmail').textContent,'Your account, your way.');
});
test('notification options are honest; no unsupported channel or security promises',()=>{
 assert.match(account,/Customer channel subscriptions are not active/);
 assert.match(account,/Requests do not immediately erase your account or financial records/);
 assert.doesNotMatch(source,/service_role|auth\.admin\.deleteUser|removeUser\(.*userId/);
 assert.match(source,/verified\.data\?\.user\?\.id!==id/);
 assert.match(source,/state\.epoch/);
});

test('login email change uses authenticated Supabase verification request, never a direct profile overwrite',async()=>{
 const t=fixture();t.hub.open({user:t.state.user});
 t.el('biteEmailChangeTo').value='new@example.test';
 await t.handlers['biteEmailChangeForm:submit']({preventDefault(){}});
 const emailChange=t.writes.find(x=>x.type==='email');
 assert.equal(emailChange?.email,'new@example.test');
 assert.equal(t.state.user.email,'one@example.test');
 assert.match(t.el('biteEmailChangeStatus').textContent,/verification requested/i);
});
test('account deletion requires consent and records existing server-side authenticated request, not instant removal',async()=>{
 const t=fixture();t.hub.open({user:t.state.user});
 t.handlers['accountView:click']({target:{closest:()=>({dataset:{biteAccountGo:'deletion'}})},preventDefault(){}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(t.writes.some(x=>x.type==='deletion-request'));
 assert.match(t.el('biteProfileMessage').textContent,/request recorded.*not been deleted/i);
 assert.match(source,/sb\.rpc\('bite_request_account_deletion'\)/);
 assert.doesNotMatch(source,/auth\.admin\.deleteUser/);
});
