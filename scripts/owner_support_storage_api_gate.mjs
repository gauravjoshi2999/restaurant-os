#!/usr/bin/env node
/**
 * Bite A13 Storage API permission gate.
 * USE ONLY against an isolated synthetic Supabase QA project.
 * Never run against production or upload real guest/customer images.
 * This intentionally leaves one synthetic file for out-of-band cleanup via
 * an authorized Storage API administrator; it never deletes production data.
 */
import assert from 'node:assert/strict';

const e=process.env;
const required=[
 'BITE_STORAGE_QA_URL','BITE_STORAGE_QA_ANON_KEY',
 'BITE_STORAGE_QA_OWNER_A_EMAIL','BITE_STORAGE_QA_OWNER_A_PASSWORD',
 'BITE_STORAGE_QA_OWNER_B_EMAIL','BITE_STORAGE_QA_OWNER_B_PASSWORD',
 'BITE_STORAGE_QA_STAFF_EMAIL','BITE_STORAGE_QA_STAFF_PASSWORD',
 'BITE_STORAGE_QA_ADMIN_EMAIL','BITE_STORAGE_QA_ADMIN_PASSWORD',
 'BITE_STORAGE_QA_OPEN_TICKET_ID','BITE_STORAGE_QA_CLOSED_TICKET_ID'
];
for(const key of required)assert.ok(e[key],key+' is required');
assert.equal(e.BITE_STORAGE_QA_APPROVAL,'SYNTHETIC_ISOLATED_PROJECT_ONLY',
 'Explicit isolated synthetic project approval is required');
const url=new URL(e.BITE_STORAGE_QA_URL);
assert.equal(url.protocol,'https:');
assert.match(url.hostname,/^[a-z0-9-]+\.supabase\.co$/);
assert.notEqual(url.hostname,'wedbgpybbgsszcmffoha.supabase.co',
 'This script MUST NOT run on Bite production');
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const openId=e.BITE_STORAGE_QA_OPEN_TICKET_ID,closedId=e.BITE_STORAGE_QA_CLOSED_TICKET_ID;
assert.ok(uuid.test(openId)&&uuid.test(closedId)&&openId!==closedId);
const bucket='bite-owner-support';
const shot=openId+'/screenshot';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9aV6rhwAAAAASUVORK5CYII=','base64');
const headers=(token,extra={})=>({
 apikey:e.BITE_STORAGE_QA_ANON_KEY,
 ...(token?{authorization:'Bearer '+token}:{}),
 ...extra
});
async function request(path,{method='GET',token=null,body=null,extraHeaders={}}={}){
 const response=await fetch(url.origin+path,{
  method,headers:headers(token,extraHeaders),body,redirect:'error',
  signal:AbortSignal.timeout(12000)
 });
 const payload=Buffer.from(await response.arrayBuffer());
 return {ok:response.ok,status:response.status,body:payload};
}
async function login(label){
 const email=e['BITE_STORAGE_QA_'+label+'_EMAIL'];
 const password=e['BITE_STORAGE_QA_'+label+'_PASSWORD'];
 const r=await request('/auth/v1/token?grant_type=password',{
  method:'POST',body:JSON.stringify({email,password}),
  extraHeaders:{'content-type':'application/json'}
 });
 assert.equal(r.status,200,'Synthetic '+label+' login failed');
 const json=JSON.parse(r.body.toString('utf8'));
 assert.ok(typeof json.access_token==='string'&&json.access_token.length>40);
 return json.access_token;
}
const objectPath='/storage/v1/object/'+bucket+'/';
const privateDownload='/storage/v1/object/authenticated/'+bucket+'/';
const publicDownload='/storage/v1/object/public/'+bucket+'/';
const listPath='/storage/v1/object/list/'+bucket;
async function upload(token,pathname,body=png,type='image/png'){
 return request(objectPath+pathname,{
  method:'POST',token,body,
  extraHeaders:{'content-type':type,'x-upsert':'false'}
 });
}
async function list(token,prefix){
 const r=await request(listPath,{
  method:'POST',token,body:JSON.stringify({prefix,limit:20,offset:0}),
  extraHeaders:{'content-type':'application/json'}
 });
 assert.ok(r.ok,'Authorized Storage list endpoint failed with '+r.status);
 const list=JSON.parse(r.body.toString('utf8'));
 assert.ok(Array.isArray(list),'List response must be an array');
 return list;
}
async function run(){
 const [a,b,staff,admin]=await Promise.all(
  ['OWNER_A','OWNER_B','STAFF','ADMIN'].map(login)
 );
 const first=await upload(a,shot);
 assert.ok(first.ok,'Owner A upload rejected; ensure synthetic ticket and migration exist (HTTP '+first.status+')');
 const own=await request(privateDownload+shot,{token:a});
 assert.ok(own.ok&&own.body.equals(png),'Owner A should read original screenshot');
 assert.ok((await list(a,openId+'/')).some(x=>x.name==='screenshot'),'Owner A list denied');
 for(const [label,token] of [['other owner',b],['staff',staff],['anonymous',null]]){
  const get=await request(privateDownload+shot,{token});
  assert.equal(get.ok,false,label+' unexpectedly downloaded another owner screenshot');
  const view=await request(listPath,{method:'POST',token,
   body:JSON.stringify({prefix:openId+'/',limit:20}),
   extraHeaders:{'content-type':'application/json'}});
  if(view.ok){
   const rows=JSON.parse(view.body.toString('utf8'));
   assert.ok(Array.isArray(rows)&&!rows.some(x=>x.name==='screenshot'),label+' listed private screenshot');
  }
 }
 assert.equal((await request(publicDownload+shot)).ok,false,'Public URL exposed private image');
 assert.ok((await request(privateDownload+shot,{token:admin})).ok,'Admin should read scoped ticket screenshot');
 for(const [label,token,path] of [
  ['other owner',b,openId+'/screenshot'],
  ['admin',admin,openId+'/screenshot'],
  ['closed ticket',a,closedId+'/screenshot'],
  ['alternate path',a,openId+'/other']
 ]){
  assert.equal((await upload(token,path)).ok,false,label+' upload unexpectedly accepted');
 }
 assert.equal((await upload(a,openId+'/bad-type',png,'text/html')).ok,false,'MIME boundary bypass');
 assert.equal((await upload(a,openId+'/too-large',Buffer.alloc(3145729),'image/png')).ok,false,'3MB bucket cap bypass');
 const overwrite=await request(objectPath+shot,{method:'PUT',token:a,body:png,extraHeaders:{'content-type':'image/png','x-upsert':'true'}});
 assert.equal(overwrite.ok,false,'Screenshot overwrite unexpectedly permitted');
 for(const [label,token] of [['owner',a],['admin',admin]]){
  const remove=await request(objectPath+shot,{method:'DELETE',token});
  assert.equal(remove.ok,false,label+' deletion unexpectedly permitted');
 }
 const final=await request(privateDownload+shot,{token:a});
 assert.ok(final.ok&&final.body.equals(png),'Stored screenshot changed after rejected mutations');
 console.log('PASS: isolated Storage API permission matrix; no production access or provider actions.');
 console.log('Synthetic test screenshot remains for authorized cleanup in isolated project.');
}
run().catch(error=>{
 console.error('FAIL: '+String(error?.message||error).slice(0,280));
 process.exitCode=1;
});
