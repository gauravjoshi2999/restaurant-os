'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('let supportAdminLoadSequence=0;');
const end=html.indexOf('async function loadAuditLogWorkspace(){',start);
assert.ok(start>=0&&end>start,'Existing support controller is present');

function scenario(role='super_admin'){
 const calls=[];
 const tickets=[
  {id:'1',customer_id:null,order_id:null,category:'Payment',subject:'Payment declined',message:'Please check my transaction',status:'Open',admin_response:null,updated_at:'2026-11-19T10:00:00.000Z',created_at:'2026-11-19T09:00:00.000Z'},
  {id:'2',customer_id:null,order_id:null,category:'Account',subject:'Login assistance',message:'Please help me sign in',status:'Resolved',admin_response:'Resolved',updated_at:'2026-11-19T11:00:00.000Z',created_at:'2026-11-19T08:00:00.000Z'}
 ];
 const orders=[{id:'order-100',order_code:'BITE-ORDER-100',status:'Completed',channel:'Own Platform',is_demo:false}];
 const history=[{entity_id:'1',entity_type:'customer_support_ticket',action:'customer_support_ticket_created',details:{status:'Open'},created_at:'2026-11-19T09:00:01.000Z'}];
 const filters={elements:{status:{value:'all'},subject:{value:''}},addEventListener(){},reset(){this.elements.status.value='all';this.elements.subject.value='';}};
 const body={innerHTML:'',onclick:null},message={textContent:''},empty={style:{display:''}};
 const elements={supportAdminRows:body,supportAdminStatus:message,supportAdminEmpty:empty,supportAdminFilters:filters,supportAdminClearFilters:{addEventListener(){}}};
 const document={getElementById:id=>elements[id]||null};
 const sb={from(table){
   assert.ok(['customer_support_tickets','platform_audit_logs','orders'].includes(table),'Only established support/audit/linked-order tables used');
   const where=[],req={table,where,mode:'read',payload:null};
   calls.push(req);
   const query={
    select(){return this;},
    order(){return this;},
    limit(){return this;},
    eq(k,v){where.push([k,v]);return this;},
    in(k,values){where.push(['in:'+k,values]);return this;},
    ilike(k,v){where.push(['ilike:'+k,v]);return this;},
    update(v){req.mode='update';req.payload=v;return this;},
    maybeSingle(){return this;},
    then(resolve){
      const match=row=>where.every(([key,val])=>key.startsWith('ilike:')?String(row[key.slice(6)]).toLowerCase().includes(String(val).replace(/^%|%$/g,'').toLowerCase()):key.startsWith('in:')?val.includes(row[key.slice(3)]):row[key]===val);
      const matching=(table==='platform_audit_logs'?history:table==='orders'?orders:tickets).filter(match);
      if(req.mode==='update'){
        for(const row of matching){Object.assign(row,req.payload);row.updated_at='2026-11-19T12:00:00.000Z';}
        return Promise.resolve({data:matching[0]||null,error:null}).then(resolve);
      }
      return Promise.resolve({data:matching.map(x=>({...x})),count:matching.length,error:null}).then(resolve);
    }
   };return query;
 }};
 const access={role};
 const sandbox={document,sb,access,esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),console,Promise,Set,Object,Date,Error};
 vm.runInNewContext(html.slice(start,end)+'\nthis.load=loadSupportWorkspace;this.save=saveSupportTicket;',sandbox);
 return {sandbox,tickets,orders,history,calls,filters,body,message,access};
}
test('server-side status and subject filters identify matching support tickets before the 200 cap',async()=>{
 const s=scenario();
 s.filters.elements.status.value='Open';
 s.filters.elements.subject.value='Payment';
 await s.sandbox.load();
 assert.match(s.body.innerHTML,/Payment declined/);
 assert.doesNotMatch(s.body.innerHTML,/Login assistance/);
 assert.match(s.body.innerHTML,/data-support-updated-at="2026-11-19T10:00:00.000Z"/);
 assert.ok(s.calls[0].where.some(([k,v])=>k==='status'&&v==='Open'));
 assert.ok(s.calls[0].where.some(([k,v])=>k==='ilike:subject'&&v==='%Payment%'));
 assert.match(s.message.textContent,/Showing 1 of 1 matching/);
 s.filters.elements.subject.value='unmatched';
 await s.sandbox.load();
 assert.equal(s.body.innerHTML,'');
 assert.equal(s.message.textContent.includes('Showing 0 of 0'),true);
 s.filters.reset();
 await s.sandbox.load();
 assert.match(s.body.innerHTML,/Login assistance/);
});
test('support reply uses exact ticket revision and fails closed on another operator update',async()=>{
 const s=scenario();
 await s.sandbox.load();
 const row={dataset:{supportUpdatedAt:'2026-11-19T10:00:00.000Z'},querySelector(sel){return sel==='[data-support-status]'?{value:'In Progress'}:{value:'We are checking.'};}};
 const button={closest(){return row;},disabled:false,textContent:'Save'};
 s.tickets[0].updated_at='2026-11-19T10:05:00.000Z';
 await s.sandbox.save('1',button);
 assert.equal(s.tickets[0].status,'Open');
 assert.match(s.message.textContent,/changed by another operator/);
 assert.equal(button.disabled,false);
 assert.ok(s.calls.some(c=>c.mode==='update'&&c.where.some(([k,v])=>k==='updated_at'&&v==='2026-11-19T10:00:00.000Z')));
 row.dataset.supportUpdatedAt='2026-11-19T10:05:00.000Z';
 await s.sandbox.save('1',button);
 assert.equal(s.tickets[0].status,'In Progress');
 assert.equal(s.tickets[0].admin_response,'We are checking.');
});
test('resolved and closed cases require a customer-visible response',async()=>{
 const s=scenario();
 const row={dataset:{supportUpdatedAt:s.tickets[0].updated_at},querySelector(sel){return sel==='[data-support-status]'?{value:'Resolved'}:{value:''};}};
 await s.sandbox.save('1',{closest:()=>row,disabled:false,textContent:'Save'});
 assert.equal(s.calls.filter(c=>c.mode==='update').length,0);
 assert.match(s.message.textContent,/response likhein/);
});
test('Owner cannot load or change Super Admin support tickets',async()=>{
 const s=scenario('owner');
 await s.sandbox.load();
 await s.sandbox.save('1',{closest(){throw Error('must not access row');}});
 assert.equal(s.calls.length,0);
});

test('existing admin-only platform audit events are scoped to visible tickets and rendered as sanitized history',async()=>{
 const s=scenario();
 s.filters.elements.status.value='Open';
 await s.sandbox.load();
 const audit=s.calls.find(c=>c.table==='platform_audit_logs');
 assert.ok(audit);
 assert.ok(audit.where.some(([k,v])=>k==='entity_type'&&v==='customer_support_ticket'));
 assert.ok(audit.where.some(([k,v])=>k==='in:entity_id'&&v.includes('1')&&!v.includes('2')));
 assert.match(s.body.innerHTML,/History \(1\)/);
 assert.match(s.body.innerHTML,/Ticket opened/);
 assert.match(s.body.innerHTML,/Initial status: Open/);
 assert.doesNotMatch(s.body.innerHTML,/internal note/);
});

test('linked support order shows real code and status from RLS-scoped website order read',async()=>{
 const s=scenario();
 s.tickets[0].order_id='order-100';
 await s.sandbox.load();
 assert.match(s.body.innerHTML,/BITE-ORDER-100/);
 assert.match(s.body.innerHTML,/Completed/);
 const query=s.calls.find(c=>c.table==='orders');
 assert.ok(query);
 assert.equal(query.mode,'read');
 assert.ok(query.where.some(([key,v])=>key==='in:id'&&v.includes('order-100')));
 assert.ok(query.where.some(([key,v])=>key==='channel'&&v==='Own Platform'));
 assert.ok(query.where.some(([key,v])=>key==='is_demo'&&v===false));
});
test('unlinked ticket stays General; linked inaccessible order never exposes another order',async()=>{
 const s=scenario();
 s.tickets[0].order_id='missing-order';
 await s.sandbox.load();
 assert.match(s.body.innerHTML,/Order reference …ing-order/);
 assert.match(s.body.innerHTML,/Not accessible/);
 assert.doesNotMatch(s.body.innerHTML,/BITE-ORDER-100/);
 assert.match(s.body.innerHTML,/General/);
});
