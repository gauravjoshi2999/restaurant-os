'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const api=require('../assets/owner-support-tickets.js');
const makeClient=(result)=>{
 const calls=[];
 const q={select(...x){calls.push(['select',...x]);return q;},eq(...x){calls.push(['eq',...x]);return q;},order(...x){calls.push(['order',...x]);return q;},async limit(n){calls.push(['limit',n]);return result;}};
 return {calls,from(table){calls.push(['from',table]);return q;}};
};
test('case history queries only the exact ticket, preserves newest first and reports actual count',async()=>{
 const event={id:1,ticket_id:'ticket1',event_kind:'Opened',status:'Open'};
 const db=makeClient({data:[event],count:103});
 assert.deepEqual(await api.readHistory(db,'ticket1'),{events:[event],count:103});
 assert.deepEqual(db.calls.slice(2),[['eq','ticket_id','ticket1'],['order','id',{ascending:false}],['limit',100]]);
});
test('unavailable or cross-ticket history fails closed',async()=>{
 for(const result of [{error:{}},{data:null},{data:[{ticket_id:'ticket2'}]}])await assert.rejects(api.readHistory(makeClient(result),'ticket1'),/could not be verified/);
});
test('history UI uses text content and ignores stale results',()=>{
 const js=fs.readFileSync('assets/owner-support-tickets.js','utf8');
 assert.match(js,/sequence===historyVersion/);
 assert.match(js,/history\.open&&sequence===historyVersion/);
 assert.doesNotMatch(js,/\.innerHTML\s*=/);
});
