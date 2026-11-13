const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('assets/bite-pos-drafts.js','utf8');
const UUID_A='11111111-1111-4111-8111-111111111111';
const UUID_B='22222222-2222-4222-8222-222222222222';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({deletionError=false,storageFail=false,delayedUpsert=false}={}){
 const map=new Map(),remote=new Map(),listeners={},elements={};
 const stats={upserts:0,deletes:0,opens:0};
 const localStorage={
  getItem:key=>map.get(key)||null,
  setItem(key,value){if(storageFail&&key.startsWith('bite_pos_draft_deletions_v1:'))throw Error('Storage full');map.set(key,value)},
  removeItem:key=>map.delete(key)
 };
 function el(id){
  if(!elements[id]){
   elements[id]={value:'',checked:false,innerHTML:'',textContent:'',dataset:{},
    classList:{contains:()=>id==='orderModal'},addEventListener:()=>{},querySelector:()=>null};
  }
  return elements[id];
 }
 el('orderCustomerName').value='Counter customer';
 el('orderCustomerPhone').value='9999999999';
 el('posPickerQuantity').value='1';
 el('posPaidAmount').value='';
 const form=el('orderForm');form.elements={
  payment_method:{value:'Cash'},payment_date:{value:'2026-11-13'},
  payment_reference:{value:''},balance_action:{value:'udhar'}
 };
 let resolveGate,started;
 const upsertStarted=new Promise(resolve=>started=resolve);
 const upsertGate=delayedUpsert?new Promise(resolve=>resolveGate=resolve):null;
 let uid='owner1',restaurantId='rest1';
 const sb={from(table){
  assert.equal(table,'restaurant_pos_drafts');
  return {
   async upsert(rec){stats.upserts++;started();
    if(delayedUpsert)await upsertGate;
    remote.set(rec.id,{...rec,updated_at:new Date().toISOString()});return {error:null};
   },
   delete(){return {
     eq(){return this},
     then(resolve,reject){
      stats.deletes++;
      const result=deletionError?{error:{message:'offline'}}:
       (remote.delete(this.idHint||UUID_A),{error:null});
      Promise.resolve(result).then(resolve,reject);
     }
   }},
   select(){const query={
    filters:{},
    eq(field,value){this.filters[field]=value;return this},
    order(){return this},limit(){return this},
    maybeSingle(){return Promise.resolve({data:remote.get(this.filters.id)||null,error:null})},
    then(resolve,reject){
     const rows=[...remote.values()].filter(row=>
      Object.entries(this.filters).every(([field,value])=>row[field]===value));
     Promise.resolve({data:rows,error:null}).then(resolve,reject);
    }
   };return query}
  };
 }};
 // Attach deletion ID to a mock per-call query so it can actually delete
 sb.from=function(table){
  assert.equal(table,'restaurant_pos_drafts');
  return {
   async upsert(rec){stats.upserts++;started();if(delayedUpsert)await upsertGate;
    remote.set(rec.id,{...rec,updated_at:new Date().toISOString()});return {error:null}},
   delete(){const q={filters:{},eq(field,value){this.filters[field]=value;return this},
    then(resolve,reject){stats.deletes++;
     const row=remote.get(this.filters.id);
     const valid=row&&row.restaurant_id===this.filters.restaurant_id&&row.created_by===this.filters.created_by;
     if(!deletionError&&valid)remote.delete(this.filters.id);
     Promise.resolve({error:deletionError?{message:'offline'}:null}).then(resolve,reject);
    }};return q},
   select(){const q={filters:{},eq(field,value){this.filters[field]=value;return this},
    order(){return this},limit(){return this},
    maybeSingle(){return Promise.resolve({data:remote.get(this.filters.id)||null,error:null})},
    then(resolve,reject){
     const rows=[...remote.values()].filter(row=>
      Object.entries(this.filters).every(([field,value])=>row[field]===value));
     Promise.resolve({data:rows,error:null}).then(resolve,reject);
    }};return q}
  };
 };
 const sandbox={window:{addEventListener:(name,cb)=>listeners[name]=cb,
  openOrder:async()=>{stats.opens++},closeModal:()=>{},
  addOrderItemRow:()=>{},renderPosItemSummary:()=>{},updateOrderTotal:()=>{}},
  document:{getElementById:el,querySelectorAll:()=>[]},localStorage,
  crypto:{randomUUID:()=>UUID_A},console:{warn:()=>{},log:()=>{}},
  setTimeout:()=>1,clearTimeout:()=>{},confirm:()=>true,alert:()=>{}};
 vm.runInNewContext(source,sandbox);
 const api=sandbox.window.BitePOS;
 api.init({sb,getUser:()=>({id:uid}),getAccess:()=>({role:'owner',restaurantId}),getState:()=>({})});
 function setTenant(u,r){uid=u;restaurantId=r}
 return {api,localStorage,map,remote,stats,elements,uid:()=>uid,rest:()=>restaurantId,
  setTenant,resolveGate,upsertStarted,goOnline:()=>listeners.online?.(),
  setDeletionError:value=>deletionError=value};
}
function drafts(h,uid='owner1',rid='rest1'){
 return JSON.parse(h.localStorage.getItem('bite_pos_drafts_v2:'+uid+':'+rid)||'[]');
}
function tombstones(h,uid='owner1',rid='rest1'){
 return JSON.parse(h.localStorage.getItem('bite_pos_draft_deletions_v1:'+uid+':'+rid)||'[]');
}

test('completed sale does not resurrect if cloud draft cleanup fails',async()=>{
 const h=harness({deletionError:true});
 h.api.newBill();h.api.touch();
 await h.api.saveNow();
 assert.equal(h.remote.has(UUID_A),true);
 await h.api.finishOrder();
 await tick();
 assert.equal(drafts(h).length,0,'local card removed');
 assert.equal(tombstones(h).find(x=>x.id===UUID_A)?.pending,true);
 await h.api.refreshDrafts();
 assert.equal(drafts(h).length,0,'remote stale ghost must stay hidden');
 h.setDeletionError(false);
 h.goOnline();
 for(let i=0;i<5;i++)await tick();
 assert.equal(h.remote.has(UUID_A),false,'remote deleted on reconnect');
 assert.equal(tombstones(h).find(x=>x.id===UUID_A)?.pending,false,'fence retained');
});

test('late cloud upsert after completed bill is fenced and removed',async()=>{
 const h=harness({delayedUpsert:true});
 h.api.newBill();h.api.touch();
 const syncing=h.api.saveNow();
 await h.upsertStarted;
 await h.api.finishOrder();
 for(let i=0;i<3;i++)await tick();
 h.resolveGate();
 await syncing;
 for(let i=0;i<3;i++)await tick();
 assert.equal(h.remote.has(UUID_A),false,'late upsert immediately removed');
 assert.equal(drafts(h).length,0);
 assert.ok(h.stats.deletes>=2,'delete attempted both before and after late upsert');
});

test('offline draft delete removes local card and queues server cleanup',async()=>{
 const h=harness({deletionError:true});
 h.api.newBill();h.api.touch();await h.api.saveNow();
 assert.equal(h.remote.has(UUID_A),true);
 await h.api.discardDraft(UUID_A);
 for(let i=0;i<3;i++)await tick();
 assert.equal(drafts(h).length,0);
 assert.equal(tombstones(h).find(x=>x.id===UUID_A)?.pending,true);
 await h.api.refreshDrafts();
 assert.equal(drafts(h).length,0,'deleted draft must not be re-downloaded');
 h.setDeletionError(false);h.goOnline();
 for(let i=0;i<5;i++)await tick();
 assert.equal(h.remote.has(UUID_A),false);
});

test('storage unavailable prevents offline delete from hiding a recoverable draft',async()=>{
 const h=harness({storageFail:true,deletionError:true});
 h.api.newBill();h.api.touch();await h.api.saveNow();
 await h.api.discardDraft(UUID_A);
 assert.equal(drafts(h).length,1,'failed tombstone must not hide original draft');
 assert.equal(tombstones(h).length,0);
});

test('draft data for one owner and restaurant never appears in another tenant',async()=>{
 const h=harness();
 h.api.newBill();h.api.touch();await h.api.saveNow();
 assert.equal(drafts(h).length,1);
 h.setTenant('owner2','rest2');
 await h.api.refreshDrafts();
 assert.equal(drafts(h,'owner2','rest2').length,0);
 h.setTenant('owner1','rest1');
 await h.api.refreshDrafts();
 assert.equal(drafts(h).length,1);
});

test('POS draft recovery retains existing safe edit and void guards',()=>{
 const s=source,m=fs.readFileSync('supabase/migrations/20261113165000_bite_pos_drafts_safe_corrections.sql','utf8');
 assert.match(s,/replaceOrderId/);
 assert.match(s,/editSavedPos/);
 assert.match(s,/voidSavedPos/);
 assert.match(m,/paid, refunded or closed-day bills cannot be edited/i);
 assert.match(m,/Only unpaid, open POS counter bills can be voided/i);
 assert.match(fs.readFileSync('index.html','utf8'),/BitePOS\.editSavedPos/);
 for(const page of ['orders','menu','settings'])
  assert.match(fs.readFileSync('index.html','utf8'),new RegExp('id="'+page+'"'));
});
