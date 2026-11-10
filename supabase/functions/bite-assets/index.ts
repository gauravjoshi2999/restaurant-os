import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";
const cors={"access-control-allow-origin":"https://gauravjoshi2999.github.io","access-control-allow-headers":"authorization, apikey, content-type, x-client-info, x-supabase-api-version","access-control-allow-methods":"POST, OPTIONS"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json","cache-control":"no-store",...cors}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{const bearer=req.headers.get("authorization")||"";if(!bearer.startsWith("Bearer "))return json({error:"Login required"},401);
 const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const client=createClient(url,anon,{global:{headers:{Authorization:bearer}}}),{data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:"Invalid session"},401);
 const role=await client.rpc("is_platform_admin");if(role.error||role.data!==true)return json({error:"Admin access required"},403);
 let body;try{body=await req.json();}catch{return json({error:"Invalid JSON"},400);}if(body.action!=="provision")return json({error:"Invalid action"},400);
 const db=createClient(url,service);
 for(const bucket of [{id:"bite-menu",public:true,limit:5*1024*1024,mime:["image/jpeg","image/png","image/webp"]},{id:"bite-private",public:false,limit:8*1024*1024,mime:["image/jpeg","image/png","image/webp","application/pdf"]}]){
  const existing=await db.storage.getBucket(bucket.id);
  if(existing.error){const result=await db.storage.createBucket(bucket.id,{public:bucket.public,fileSizeLimit:bucket.limit,allowedMimeTypes:bucket.mime});if(result.error)return json({error:"Bucket provisioning failed"},503);}
  else if(existing.data.public!==bucket.public)return json({error:"Bucket visibility mismatch; manual review required"},409);
  else{const restricted=await db.storage.updateBucket(bucket.id,{public:bucket.public,fileSizeLimit:bucket.limit,allowedMimeTypes:bucket.mime});if(restricted.error)return json({error:"Could not apply bucket upload restrictions"},503);}
 }
 return json({ready:true,buckets:["bite-menu","bite-private"]});
 }catch{return json({error:"Storage provisioning unavailable"},503);}
});
