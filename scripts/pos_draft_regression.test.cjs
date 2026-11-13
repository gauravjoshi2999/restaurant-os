const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/bite-pos-drafts.js','utf8');
const page=fs.readFileSync('index.html','utf8');
const migration=fs.readFileSync('supabase/migrations/20261113165000_bite_pos_drafts_safe_corrections.sql','utf8');

test('POS draft script parses and is loaded by owner dashboard',()=>{
 assert.doesNotThrow(()=>new vm.Script(source));
 assert.match(page,/src="\.\/assets\/bite-pos-drafts\.js/);
 assert.match(page,/BitePOS\.refreshDrafts/);
 assert.match(page,/BitePOS\.editSavedPos/);
 assert.match(page,/BitePOS\.voidSavedPos/);
 assert.match(page,/replace_unpaid_pos_order/);
 assert.match(page,/BitePOS\?\.finishOrder/);
});

test('tenant bound cloud drafts and corrections retain marketplace boundary',()=>{
 assert.match(migration,/alter table public\.restaurant_pos_drafts enable row level security/i);
 assert.match(migration,/created_by=\(select auth\.uid\(\)\) and public\.has_restaurant_role\(restaurant_id,array\['owner'\]\)/i);
 assert.match(migration,/create or replace function public\.void_unpaid_pos_order/);
 assert.match(migration,/create or replace function public\.replace_unpaid_pos_order/);
 assert.match(migration,/v_order\.channel<>'POS - Counter'/);
 assert.match(migration,/v_order\.status<>'Received'/);
 assert.match(migration,/exists\(select 1 from public\.restaurant_order_payments/);
 assert.match(migration,/exists\(select 1 from public\.restaurant_cashbook_closings/);
 assert.match(migration,/status='Cancelled',status_note='Replaced by corrected POS bill'/);
 assert.match(migration,/old\.channel='POS - Counter'/);
 assert.match(migration,/raise exception 'Restaurant Owner may update only order status and status note\.'/);
});

test('draft local persistence keeps customer fields while cloud is unreachable',async()=>{
 const elements={};
 function el(id){
  if(!elements[id]){
   elements[id]={value:'',checked:false,innerHTML:'',textContent:'',dataset:{},
    classList:{contains:()=>id==='orderModal'},addEventListener:()=>{},querySelector:()=>null};
  }
  return elements[id];
 }
 el('orderCustomerName').value='Test Guest';
 el('orderCustomerPhone').value='9000000000';
 el('posPaidAmount').value='0';
 el('posPickerQuantity').value='1';
 const form=el('orderForm');form.elements={
  payment_method:{value:'Cash'},payment_date:{value:'2026-11-13'},
  payment_reference:{value:''},balance_action:{value:'udhar'}
 };
 const saved={};const localStorage={getItem:k=>saved[k]??null,setItem:(k,v)=>{saved[k]=v}};
 const sandbox={window:{},document:{getElementById:el,querySelectorAll:()=>[]},
  localStorage,crypto:{randomUUID:()=> '01234567-89ab-4def-8abc-0123456789ab'},
  console,setTimeout:()=>1,clearTimeout:()=>{},confirm:()=>true,alert:()=>{}};
 vm.runInNewContext(source,sandbox);
 const pos=sandbox.window.BitePOS;
 pos.init({sb:{from:()=>({upsert:async()=>({error:{message:'offline'}})})},
  getUser:()=>({id:'u1'}),getAccess:()=>({role:'owner',restaurantId:'r1'}),getState:()=>({})});
 pos.newBill();pos.touch();
 const key='bite_pos_drafts_v2:u1:r1';
 assert.equal(JSON.parse(saved[key])[0].payload.customerName,'Test Guest');
 assert.equal(JSON.parse(saved[key])[0].payload.customerPhone,'9000000000');
 assert.equal(pos.currentOrderCode(),'POS-0123456789AB4DEF8ABC0123');
 await pos.saveNow();
 assert.equal(JSON.parse(saved[key])[0].dirty,true);
 assert.match(el('posDraftStatus').textContent,/device/);
});
