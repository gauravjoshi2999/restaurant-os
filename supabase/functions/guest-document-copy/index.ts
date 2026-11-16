import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const PRIVATE={'Cache-Control':'private, no-store, no-cache, max-age=0','Pragma':'no-cache','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const extensions={'image/jpeg':'.jpg','image/png':'.png','application/pdf':'.pdf'};
const reply=(status,message)=>Response.json({message},{status,headers:{...CORS,...PRIVATE}});
function headerMatches(b,mime){
 if(mime==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255;
 const prefix=mime==='image/png'?[137,80,78,71,13,10,26,10]:mime==='application/pdf'?[37,80,68,70,45]:[];
 return prefix.length>0&&prefix.every((n,i)=>b[i]===n);
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 if(req.method!=='POST')return reply(405,'Use the private copy download button.');
 const authorization=req.headers.get('Authorization')||'';
 if(!/^Bearer \S+$/.test(authorization))return reply(401,'Sign in to download this copy.');
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!anon||!secret)return reply(503,'Private copy service is unavailable.');
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const caller=createClient(url,anon,{...options,global:{headers:{Authorization:authorization}}});
 try{
  // Validate against Auth as well as current DB membership; never trust a
  // client-supplied path, role or a previously cached Storage authorization.
  const user=await caller.auth.getUser(authorization.slice(7));
  if(user.error||!user.data.user)return reply(401,'Sign in again to download this copy.');
  const body=await req.json().catch(()=>null);
  if(!body||![body.p_property,body.p_guest,body.p_document].every(v=>typeof v==='string'&&UUID.test(v)))return reply(400,'Choose a valid guest copy.');
  const args={p_property:body.p_property,p_guest:body.p_guest,p_document:body.p_document};
  const read=await caller.rpc('bite_guest_document_read',args);
  if(read.error)return reply(read.error.code==='42501'?403:read.error.code==='P0002'?404:503,'This copy is unavailable or your access changed.');
  const d=read.data;
  if(!d||d.id!==body.p_document||!Object.hasOwn(extensions,d.mime_type)||!Number.isInteger(d.byte_size)||d.byte_size<1||d.byte_size>4194304)return reply(422,'Saved copy details are invalid.');
  const expected=body.p_property+'/'+body.p_guest+'/'+body.p_document+extensions[d.mime_type];
  if(d.object_path!==expected)return reply(422,'Saved copy details are invalid.');
  const server=createClient(url,secret,options),file=await server.storage.from('bite-guest-documents').download(expected);
  if(file.error||!file.data)return reply(404,'The retained file is unavailable.');
  if(file.data.size!==d.byte_size)return reply(422,'Saved copy size is invalid.');
  const bytes=new Uint8Array(await file.data.arrayBuffer());
  if(!headerMatches(bytes,d.mime_type))return reply(422,'Saved copy format is invalid.');
  // Recheck after the file read so an in-flight revocation cannot use the
  // earlier permission result. The response itself is never cacheable.
  const latest=await caller.rpc('bite_guest_document_list',{p_property:body.p_property,p_guest:body.p_guest});
  if(latest.error||!latest.data?.some(row=>row.id===d.id&&row.status==='ready'))return reply(403,'This copy is unavailable or your access changed.');
  const filename='Bite-private-copy-'+d.id.slice(0,8)+extensions[d.mime_type];
  return new Response(bytes,{status:200,headers:{...CORS,...PRIVATE,'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+filename+'"'}});
 }catch{return reply(503,'Could not verify the private copy. Reconnect and retry.')}
});
