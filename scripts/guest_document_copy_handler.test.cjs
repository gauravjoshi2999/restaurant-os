'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ids={p_property:'12121212-1212-4212-8212-121212121212',p_guest:'90909090-9090-4090-8090-909090909090',p_document:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
function fixture(options={}){
 let handler;const calls={auth:0,reads:[],files:[]};
 const d={id:ids.p_document,kind:'masked_id',mime_type:'image/png',byte_size:8,object_path:ids.p_property+'/'+ids.p_guest+'/'+ids.p_document+'.png',...options.document};
 const caller={auth:{getUser:async token=>{calls.auth++;assert.equal(token,'test-access');return{data:{user:options.noUser?null:{id:'caller',user_metadata:{role:'owner'}}},error:options.authError?{}:null}}},rpc:async(name,args)=>{
  calls.reads.push({name,args});
  if(name==='bite_guest_document_read')return{data:d,error:options.readError?{code:options.readError}:null};
  return{data:options.removed?[]:[{id:d.id,status:'ready'}],error:options.revoked?{code:'42501'}:null};
 }};
 const server={storage:{from:bucket=>({download:async path=>{assert.equal(bucket,'bite-guest-documents');calls.files.push(path);return{data:new Blob([options.bytes||png]),error:options.fileMissing?{}:null}}})}};
 const env={SUPABASE_URL:'https://project.example.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:options.noSecret?'':'secret'};
 const context={Request,Response,Blob,Uint8Array,createClient:(url,key)=>key==='secret'?server:caller,Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn}};
 vm.runInNewContext(fs.readFileSync('supabase/functions/guest-document-copy/index.ts','utf8').replace(/^import[^\n]+\n/,''),context);
 return{calls,request:async(body=ids,headers={Authorization:'Bearer test-access'})=>handler(new Request('https://probe.example.invalid',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)})),handler};
}
test('private copy proxy checks Auth/current membership, reads a server-approved path, then rechecks access',async()=>{
 const f=fixture(),r=await f.request({...ids,object_path:'attacker/path'});
 assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),png);
 assert.equal(f.calls.auth,1);assert.deepEqual(f.calls.reads.map(r=>r.name),['bite_guest_document_read','bite_guest_document_list']);
 assert.equal(f.calls.files.length,1);assert(!f.calls.files[0].includes('attacker'));
 assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 assert(!r.headers.get('content-disposition').includes(ids.p_guest));
});
test('missing/expired Auth session never reaches private metadata or bytes',async()=>{
 for(const opts of [{noUser:true},{authError:true}]){const f=fixture(opts);assert.equal((await f.request()).status,401);assert.equal(f.calls.reads.length,0);assert.equal(f.calls.files.length,0)}
 const f=fixture();assert.equal((await f.request(ids,{})).status,401);assert.equal(f.calls.auth,0);
});
test('a forged Owner metadata claim cannot bypass a denied current property role',async()=>{
 const f=fixture({readError:'42501'});assert.equal((await f.request()).status,403);assert.equal(f.calls.files.length,0);
});
test('an in-flight revocation/removal suppresses the already-fetched file response',async()=>{
 for(const opts of [{revoked:true},{removed:true}]){const f=fixture(opts),r=await f.request();assert.equal(r.status,403);assert.match(r.headers.get('cache-control'),/no-store/);assert(!r.headers.get('content-type').includes('octet'));assert.equal(f.calls.files.length,1)}
});
test('cross-guest paths, excessive size, corrupt bytes and missing Storage objects fail closed',async()=>{
 for(const opts of [{document:{object_path:'other/guest/path.png'}},{document:{byte_size:4194305}},{bytes:new Uint8Array([1,2,3,4,5,6,7,8])}])assert.equal((await fixture(opts).request()).status,422);
 assert.equal((await fixture({fileMissing:true}).request()).status,404);
 assert.equal((await fixture({bytes:new Uint8Array([1])}).request()).status,422);
});
test('invalid document identifiers and unsupported methods do not reach Storage',async()=>{
 const f=fixture();assert.equal((await f.request({...ids,p_guest:'../../other'})).status,400);assert.equal(f.calls.files.length,0);
 assert.equal((await f.handler(new Request('https://probe.example.invalid',{method:'GET'}))).status,405);
 assert.equal((await f.handler(new Request('https://probe.example.invalid',{method:'OPTIONS'}))).status,204);
});
