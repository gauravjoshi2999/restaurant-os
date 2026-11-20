'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/owner-historical-entries.js','utf8');
function setup(){
 let mode=false,user='owner-a',restaurant='restaurant-a';
 const requests=[],list={textContent:'',innerHTML:''},date={value:'2026-10-02'};
 const toggle={getAttribute:()=>String(mode)};
 const form={isConnected:true,elements:{namedItem:n=>n==='history_date'?date:null},querySelector:s=>s==='[data-bhe-list]'?list:s==='[data-bhe-month]'?toggle:s==='[data-bhe-calendar]'?{}:null};
 const document={querySelector:()=>null,addEventListener(){},body:{}};
 const window={BiteOwner:{day:()=> '2026-11-20'},document};
 const client={from(){const filters=[];const q={};for(const m of ['select','eq','gte','lt','order'])q[m]=(...v)=>{filters.push([m,...v]);return q;};q.limit=n=>new Promise((resolve,reject)=>requests.push({resolve,reject,n,filters}));return q;}};
 vm.runInNewContext(source,{window,document,MutationObserver:class{observe(){}},console});
 const api=window.BiteOwnerHistory;
 api.init({sb:client,getAccess:()=>({restaurantId:restaurant}),getUser:()=>({id:user})});
 return {api,form,list,date,requests,setMonth:v=>mode=v,setUser:v=>user=v,setRestaurant:v=>restaurant=v};
}
const row=(id,amount=20)=>({id,record_date:'2026-10-02',customer_name:id,amount,received_amount:0,visit_type:'takeaway'});
test('H15/R08: last requested day/month wins, including late rejected response',async()=>{
 const t=setup(),a=t.api.loadRows(t.form,'pos');
 t.setMonth(true);const b=t.api.loadRows(t.form,'pos');
 assert.equal(t.requests[1].n,201);
 t.requests[1].resolve({data:[row('month-result',45)],error:null});await b;
 assert.match(t.list.innerHTML,/Month: 1 record/);
 assert.match(t.list.innerHTML,/month-result/);
 t.requests[0].reject(Error('old-request-error'));await a;
 assert.match(t.list.innerHTML,/month-result/);
 assert.doesNotMatch(t.list.innerHTML,/old-request-error/);
 t.setMonth(false);const c=t.api.loadRows(t.form,'pos');
 t.setMonth(true);const d=t.api.loadRows(t.form,'pos');
 t.requests[3].resolve({data:[row('new-month')],error:null});await d;
 t.requests[2].resolve({data:[row('stale-day')],error:null});await c;
 assert.match(t.list.innerHTML,/new-month/);
 assert.doesNotMatch(t.list.innerHTML,/stale-day/);
});
test('H15/R08: changed user or restaurant discards old results',async()=>{
 const t=setup(),a=t.api.loadRows(t.form,'pos');t.setUser('owner-b');
 t.requests[0].resolve({data:[row('private-old-user')],error:null});await a;
 assert.doesNotMatch(t.list.innerHTML,/private-old-user/);
 const b=t.api.loadRows(t.form,'pos');t.setRestaurant('restaurant-b');
 t.requests[1].reject(Error('private-old-error'));await b;
 assert.doesNotMatch(t.list.innerHTML,/private-old-error/);
});
test('H15/R08: truncated, malformed or duplicate results never claim complete financial totals',async()=>{
 const t=setup(),s=t.api.historyListSummary;
 assert.equal(s([row('a',0),row('b','12.50')]).total,12.5);
 assert.equal(s([]).total,0);
 for(const bad of [null,undefined,'',' ',true,'NaN',Infinity,-1,1.001])assert.throws(()=>s([{...row('a'),amount:bad}]),/unavailable/);
 assert.throws(()=>s([row('a'),row('a')]),/unavailable/);
 assert.throws(()=>s([{...row('a'),received_amount:21}]),/unavailable/);
 const a=t.api.loadRows(t.form,'pos');
 t.requests[0].resolve({data:Array.from({length:201},(_,i)=>row('r'+i)),error:null});await a;
 assert.match(t.list.innerHTML,/More than 200 records/);
 assert.match(t.list.innerHTML,/No partial total shown/);
 assert.doesNotMatch(t.list.innerHTML,/record\(s\)/);
});
