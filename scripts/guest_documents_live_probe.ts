/** One-use, expiring integration probe. Not a product endpoint or Pages asset.
 * Deploy only with a fresh challenge hash/expiry; keep verify_jwt=true. Disable
 * the function after execution. It creates only synthetic accounts/property,
 * uploads a one-pixel PNG and removes all its records in finally. No emails,
 * real identities, orders, payments or provider calls are made.
 */
import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
const CHALLENGE_HASH='__CHALLENGE_HASH__';
const EXPIRES_AT=Number('__EXPIRES_AT__');
let used=false;
Deno.serve(async req=>{
 if(req.method!=='POST'||!Number.isFinite(EXPIRES_AT)||Date.now()>EXPIRES_AT)return new Response('Gone',{status:410});
 const input=await req.json().catch(()=>({}));
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(input.challenge||'')));
 const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==CHALLENGE_HASH)return new Response('Denied',{status:403});
 if(used)return new Response('Already used',{status:409});used=true;
 const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_ANON_KEY')||'';
 if(url!=='https://wedbgpybbgsszcmffoha.supabase.co')return new Response('Wrong project',{status:400});
 const opts={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',opts);
 const run=crypto.randomUUID(),users=[],checks=[],cleanupErrors=[];
 let property=null,business=null,guest=null,error='';
 const expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label)};
 const rpc=async(client,name,args)=>{
  const r=await client.rpc(name,args);if(r.error)throw Error(name+': '+r.error.code+' '+r.error.message);return r.data;
 };
 const account=async(label)=>{
  const email='bite-doc-qa-'+run.slice(0,16)+'-'+label+'@restaurantos.test',password=crypto.randomUUID()+'aA1!'+crypto.randomUUID().slice(0,12);
  const made=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Synthetic private-copy probe'}});
  if(made.error||!made.data.user)throw Error('Synthetic account creation failed: '+(made.error?.code||'unknown')+' '+(made.error?.message||''));
  const user={id:made.data.user.id,email};users.push(user);
  const client=createClient(url,key,opts),signed=await client.auth.signInWithPassword({email,password});
  if(signed.error||!signed.data.session)throw Error('Synthetic sign-in failed');return{client,user};
 };
 const bucket='bite-guest-documents';
 const body=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRSEAAAAASUVORK5CYII='),x=>x.charCodeAt(0));
 try{
  const owner=await account('owner'),staff=await account('staff'),outsider=await account('outsider');
  property=await rpc(owner.client,'bite_create_property',{p_name:'Synthetic private-copy API probe '+run.slice(0,8),p_type:'hotel',p_request:crypto.randomUUID()});
  const propertyRow=await admin.from('bite_properties').select('business_id').eq('id',property).single();
  if(propertyRow.error)throw Error('Synthetic property lookup failed');business=propertyRow.data.business_id;
  guest=(await rpc(owner.client,'bite_property_command',{p_property:property,p_action:'guest_save',p_payload:{full_name:'Synthetic private-copy API guest',phone:'0000000000'},p_request:crypto.randomUUID()})).id;
  const doc=crypto.randomUUID(),args={p_property:property,p_guest:guest,p_document:doc,p_action:'begin',p_details:{kind:'masked_id',mime_type:'image/png',byte_size:body.length,redacted_confirmed:true}};
  const prepared=await rpc(owner.client,'bite_guest_document_command',args),same=await rpc(owner.client,'bite_guest_document_command',args),path=prepared.object_path;
  expect(prepared.id===same.id,'Stable prepare request returns one document');
  const uploaded=await owner.client.storage.from(bucket).upload(path,body,{contentType:'image/png',cacheControl:'0',upsert:false});
  expect(!uploaded.error,'Actual authenticated Storage upload succeeds');
  const finish={p_property:property,p_guest:guest,p_document:doc,p_action:'finish'};
  expect((await rpc(owner.client,'bite_guest_document_command',finish)).status==='ready','Actual Storage metadata validates before completion');
  expect((await rpc(owner.client,'bite_guest_document_command',finish)).status==='ready','Repeated completion is safe');
  const copy=async client=>client.functions.invoke('guest-document-copy',{body:{p_property:property,p_guest:guest,p_document:doc}});
  const downloaded=await copy(owner.client);
  expect(!downloaded.error&&downloaded.data,'Authorized owner downloads through the fresh-access proxy');
  expect(new Uint8Array(await downloaded.data.arrayBuffer()).every((v,i)=>v===body[i])&&downloaded.data.size===body.length,'Actual downloaded bytes match synthetic PNG');
  const session=(await owner.client.auth.getSession()).data.session;
  const response=await fetch(url+'/functions/v1/guest-document-copy',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:key,'Content-Type':'application/json'},body:JSON.stringify({p_property:property,p_guest:guest,p_document:doc})});
  expect(response.ok&&response.headers.get('Cache-Control')?.includes('no-store'),'Private proxy response is explicitly non-cacheable');await response.arrayBuffer();
  expect(!!(await owner.client.storage.from(bucket).download(path)).error,'Even an owner cannot bypass the proxy through a raw Storage URL');
  const anon=createClient(url,key,opts);
  expect(!!(await anon.storage.from(bucket).download(path)).error,'Anonymous private URL cannot download known path');
  expect(!!(await copy(anon)).error,'Anonymous proxy download denied');
  expect(!(await fetch(url+'/storage/v1/object/public/'+bucket+'/'+path)).ok,'Public URL does not serve a private copy');
  expect(!!(await outsider.client.storage.from(bucket).download(path)).error,'Different authenticated owner cannot download known path');
  expect(!!(await copy(outsider.client)).error,'Different authenticated owner cannot use the proxy');
  const outsiderRows=await outsider.client.from('bite_guest_documents').select('id');
  expect(!outsiderRows.error&&outsiderRows.data?.length===0,'Cross-property metadata is hidden by RLS');
  expect(!!(await anon.from('bite_guest_documents').select('id')).error,'Anonymous document metadata denied');
  expect(!!(await owner.client.storage.from(bucket).createSignedUrl(path,60)).error,'Authenticated user cannot mint a bearer URL');
  expect(!!(await owner.client.storage.from(bucket).copy(path,path+'.copy')).error,'Storage copy operation denied');
  expect(!!(await owner.client.storage.from(bucket).update(path,body,{contentType:'image/png'})).error,'Storage overwrite denied');
  const member=async(role,active=true)=>rpc(owner.client,'bite_property_command',{p_property:property,p_action:'member',p_payload:{email:staff.user.email,role,active},p_request:crypto.randomUUID()});
  await member('receptionist');
  expect(!(await copy(staff.client)).error,'Authorized receptionist downloads within its property');
  await member('receptionist',false);
  expect(!!(await staff.client.rpc('bite_guest_document_list',{p_property:property,p_guest:guest})).error,'Revoked session cannot list copies');
  expect(!!(await copy(staff.client)).error,'Revocation blocks a repeated actual proxy download with the same session');
  for(const role of ['cashier','housekeeping','accountant']){
   await member(role);expect(!!(await copy(staff.client)).error,role+' cannot download private guest bytes');
  }
  const premature=await owner.client.rpc('bite_guest_document_command',{p_property:property,p_guest:guest,p_document:doc,p_action:'forget'});
  expect(!!premature.error,'Metadata cannot retire before actual deletion');
  const removed=await owner.client.storage.from(bucket).remove([path]);expect(!removed.error,'Actual Storage removal succeeds');
  expect(!!(await copy(owner.client)).error,'Removed object no longer serves authenticated proxy bytes');
  const forget={p_property:property,p_guest:guest,p_document:doc,p_action:'forget'};
  expect((await rpc(owner.client,'bite_guest_document_command',forget)).status==='deleted','Confirmed deletion retires metadata');
  expect((await rpc(owner.client,'bite_guest_document_command',forget)).status==='deleted','Repeated retirement is safe');
  expect((await rpc(owner.client,'bite_guest_document_list',{p_property:property,p_guest:guest})).length===0,'Guest list contains no retained copies after deletion');
 }catch(e){error=e instanceof Error?e.message:'Probe failed'}
 finally{
  if(property){
   const docs=await admin.from('bite_guest_documents').select('object_path').eq('property_id',property);
   if(docs.error)cleanupErrors.push('document lookup');
   else if(docs.data?.length){const r=await admin.storage.from(bucket).remove(docs.data.map(d=>d.object_path));if(r.error)cleanupErrors.push('Storage cleanup')}
   for(const table of ['bite_guest_documents','bite_property_commands','bite_property_audit','bite_guests','bite_property_outlets','bite_property_members']){
    const r=await admin.from(table).delete().eq('property_id',property);if(r.error)cleanupErrors.push(table);
   }
   const r=await admin.from('bite_properties').delete().eq('id',property);if(r.error)cleanupErrors.push('property');
  }
  if(business){const r=await admin.from('bite_businesses').delete().eq('id',business);if(r.error)cleanupErrors.push('business')}
  for(const u of users){
   const profile=await admin.from('profiles').delete().eq('id',u.id);if(profile.error)cleanupErrors.push('profile '+u.id);
   const r=await admin.auth.admin.deleteUser(u.id);if(r.error)cleanupErrors.push('synthetic account '+u.id);
  }
 }
 return Response.json({ok:!error&&!cleanupErrors.length,run,checks,error,cleanupErrors,syntheticUserIds:users.map(u=>u.id),syntheticPropertyId:property},
  {status:!error&&!cleanupErrors.length?200:500,headers:{'Cache-Control':'no-store'}});
});
