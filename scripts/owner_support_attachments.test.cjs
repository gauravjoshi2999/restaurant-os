'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../assets/owner-support-tickets.js');
const id='20000000-0000-0000-0000-000000000001',path=id+'/screenshot';
const png=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])],{type:'image/png'});
test('screenshot paths cannot inject folders or escape ticket scope',()=>{
 assert.equal(api.attachmentPath(id),path);
 assert.throws(()=>api.attachmentPath('../other'));
});
test('verify image type, size and signature',async()=>{
 assert.equal(await api.validateScreenshot(png),png);
 await assert.rejects(api.validateScreenshot(new Blob(['malicious text'],{type:'image/png'})),/does not match/);
 await assert.rejects(api.validateScreenshot(new Blob(['<html>'],{type:'text/html'})),/Choose/);
 await assert.rejects(api.validateScreenshot(new Blob([new Uint8Array(3145729)],{type:'image/png'})),/Choose/);
});
test('upload is scoped and cannot overwrite existing screenshot',async()=>{
 const calls=[],client={storage:{from(bucket){calls.push(bucket);return {async upload(...args){calls.push(args);return {data:{path}};}};}}};
 assert.equal(await api.uploadScreenshot(client,id,png),true);
 assert.deepEqual(calls,['bite-owner-support',[path,png,{contentType:'image/png',upsert:false}]]);
 await assert.rejects(api.uploadScreenshot(client,id,png,()=>false),/Session changed/);
 assert.equal(calls.length,2);
});
test('attachment state fails closed on storage errors and only exact name matches',async()=>{
 const client=data=>({storage:{from(){return {async list(folder,opts){assert.equal(folder,id);assert.equal(opts.search,'screenshot');return data;}};}}});
 assert.equal(await api.screenshotInfo(client({data:[{name:'screenshot-other'}]}),id),false);
 assert.equal(await api.screenshotInfo(client({data:[{name:'screenshot'}]}),id),true);
 await assert.rejects(api.screenshotInfo(client({error:{}}),id),/could not be confirmed/);
});
