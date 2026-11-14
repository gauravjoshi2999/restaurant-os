import {createClient} from "npm:@supabase/supabase-js@2.95.0";
import {summarizePushHealth} from "./summary.mjs";

// Read-only health report for ONE authenticated restaurant Owner.
// "sent" means submitted to FCM, NEVER delivered to an Android device.
const origin="https://gauravjoshi2999.github.io";
const cors={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store",...cors}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 if(req.headers.get("origin")&&req.headers.get("origin")!==origin)
  return reply({error:"Origin not allowed"},403);
 if(Number(req.headers.get("content-length")||0)>1024)
  return reply({error:"Request too large"},413);
 const bearer=req.headers.get("authorization")||"";
 if(!/^Bearer\s+\S+$/i.test(bearer))return reply({error:"Owner login required"},401);
 const url=Deno.env.get("SUPABASE_URL")||"";
 const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
 const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!url||!anon||!secret)return reply({error:"Server unavailable"},503);
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:ae}=await auth.auth.getUser(bearer.replace(/^Bearer\s+/i,""));
 if(ae||!user)return reply({error:"Invalid Owner session"},401);
 let body:any;
 try{body=await req.json()}catch{return reply({error:"Invalid JSON"},400)}
 const restaurantId=body?.restaurant_id;
 if(typeof restaurantId!=="string"||!uuid.test(restaurantId))
  return reply({error:"Invalid restaurant"},400);
 const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 // Service-role reads are intentionally restricted to the EXACT authenticated
 // owner + restaurant before any device or event query. Never trust JWT metadata.
 const {data:members,error:me}=await db.from("restaurant_members")
  .select("user_id").eq("user_id",user.id)
  .eq("restaurant_id",restaurantId).eq("role","owner").limit(2);
 if(me)return reply({error:"Owner membership lookup unavailable"},503);
 if(!members||members.length!==1)return reply({error:"Restaurant Owner access required"},403);
 const [deviceResult,eventResult]=await Promise.all([
  db.from("bite_owner_push_devices").select("enabled,supports_order_actions,last_seen_at")
   .eq("restaurant_id",restaurantId).eq("user_id",user.id).limit(30),
  db.from("bite_owner_push_events").select("delivery_status")
   .eq("restaurant_id",restaurantId).order("created_at",{ascending:false}).limit(100)
 ]);
 if(deviceResult.error||eventResult.error)
  return reply({error:"Notification health temporarily unavailable"},503);
 const summary=summarizePushHealth(deviceResult.data||[],eventResult.data||[]);
 return reply(summary);
});
