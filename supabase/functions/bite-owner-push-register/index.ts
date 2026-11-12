import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const allowedOrigin="https://gauravjoshi2999.github.io";
const cors={"Access-Control-Allow-Origin":allowedOrigin,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json",...cors}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return respond({error:"Method not allowed"},405);
 if(req.headers.get("origin")&&req.headers.get("origin")!==allowedOrigin)return respond({error:"Origin forbidden"},403);
 const bearer=req.headers.get("authorization")||"";
 if(!/^Bearer\s+\S+$/i.test(bearer))return respond({error:"Authentication required"},401);
 const url=Deno.env.get("SUPABASE_URL")||"";
 const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!url||!anon||!service)return respond({error:"Service unavailable"},503);
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(bearer.replace(/^Bearer\s+/i,""));
 if(authError||!user)return respond({error:"Invalid login session"},401);
 let body:any;try{body=await req.json();}catch{return respond({error:"Invalid JSON"},400);}
 const restaurantId=String(body?.restaurant_id||"");
 const token=String(body?.fcm_token||"");
 const action=body?.action==="unregister"?"unregister":"register";
 if(!uuid.test(restaurantId)||token.length<40||token.length>4096||/[^\x21-\x7e]/.test(token))return respond({error:"Invalid device or restaurant"},400);
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:membership,error:membershipError}=await db.from("restaurant_members")
   .select("role").eq("user_id",user.id).eq("restaurant_id",restaurantId).eq("role","owner").maybeSingle();
 if(membershipError)return respond({error:"Membership verification unavailable"},503);
 if(!membership)return respond({error:"Only the assigned restaurant owner can register this device"},403);
 if(action==="unregister"){
   const {error}=await db.from("bite_owner_push_devices").delete().eq("user_id",user.id).eq("restaurant_id",restaurantId).eq("fcm_token",token);
   return error?respond({error:"Could not unregister device"},503):respond({registered:false});
 }
 const {error}=await db.from("bite_owner_push_devices")
 .upsert({user_id:user.id,restaurant_id:restaurantId,fcm_token:token,app_id:"in.bite.partner",enabled:true,updated_at:new Date().toISOString(),last_seen_at:new Date().toISOString()},{onConflict:"fcm_token"});
 return error?respond({error:"Device registration unavailable"},503):respond({registered:true});
});