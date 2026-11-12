import {createClient} from "npm:@supabase/supabase-js@2.95.0";
declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void};

const origin="https://gauravjoshi2999.github.io";
const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};
const result=(json:unknown,status=200)=>new Response(JSON.stringify(json),{status,headers:{...headers,"Content-Type":"application/json"}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function b64url(value:Uint8Array|string){
 const bytes=typeof value==="string"?new TextEncoder().encode(value):value;
 let raw="";for(const x of bytes)raw+=String.fromCharCode(x);
 return btoa(raw).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
async function fcmAccessToken(account:{client_email:string,private_key:string}){
 const now=Math.floor(Date.now()/1000);
 const data=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}))+"."+
   b64url(JSON.stringify({iss:account.client_email,scope:"https://www.googleapis.com/auth/firebase.messaging",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3300}));
 const keyData=account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");
 const der=Uint8Array.from(atob(keyData),x=>x.charCodeAt(0));
 const key=await crypto.subtle.importKey("pkcs8",der,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
 const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(data));
 const request=await fetch("https://oauth2.googleapis.com/token",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:data+"."+b64url(new Uint8Array(signature))}),
  signal:AbortSignal.timeout(12000)
 });
 if(!request.ok)throw Error("Firebase OAuth unavailable ("+request.status+")");
 const payload=await request.json();
 if(typeof payload.access_token!=="string"||!payload.access_token)throw Error("Firebase OAuth missing token");
 return payload.access_token as string;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return result({error:"Method not allowed"},405);
 if(req.headers.get("origin")&&req.headers.get("origin")!==origin)return result({error:"Origin not allowed"},403);
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(token.length<30)return result({error:"Owner login required"},401);
 const url=Deno.env.get("SUPABASE_URL")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 const rawAccount=Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")||"";
 if(!url||!anon||!service)return result({error:"Service unavailable"},503);
 let account:any;
 try{account=JSON.parse(rawAccount)}catch{return result({error:"Firebase service account not configured"},503)}
 if(!account?.project_id||!account?.client_email||!account?.private_key)return result({error:"Firebase service account not configured"},503);
 const auth=createClient(url,anon,{auth:{autoRefreshToken:false,persistSession:false}});
 const userResult=await auth.auth.getUser(token);
 const user=userResult.data?.user;
 if(userResult.error||!user)return result({error:"Session expired. Reopen Partner app."},401);
 let body:any;try{body=await req.json()}catch{return result({error:"Invalid request body"},400)}
 const restaurant=String(body?.restaurant_id||"");
 if(!uuid.test(restaurant))return result({error:"Invalid restaurant"},400);
 const db=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:owners,error:ownerError}=await db.from("restaurant_members").select("user_id")
   .eq("restaurant_id",restaurant).eq("role","owner");
 if(ownerError)return result({error:"Could not check owner mapping"},503);
 if(!owners||owners.length!==1||owners[0].user_id!==user.id)return result({error:"Not the verified restaurant owner"},403);
 // Confirm Google credentials BEFORE taking a rate-limit slot.
 let access:string;
 try{access=await fcmAccessToken(account)}catch(e){
  console.warn("Owner push test cannot authenticate to FCM:",String(e));
  return result({error:"Firebase connection not ready; verify service account and Cloud Messaging API"},503)
 }
 const since=new Date(Date.now()-60000).toISOString();
 const {data:devices,error:devicesError}=await db.from("bite_owner_push_devices")
  .update({last_test_at:new Date().toISOString()})
  .eq("restaurant_id",restaurant).eq("user_id",user.id).eq("enabled",true)
  .or("last_test_at.is.null,last_test_at.lt."+since)
  .select("fcm_token");
 if(devicesError)return result({error:"Device check unavailable"},503);
 if(!devices?.length){
  const {data:existing,error:lookupError}=await db.from("bite_owner_push_devices")
    .select("last_test_at").eq("restaurant_id",restaurant)
    .eq("user_id",user.id).eq("enabled",true).limit(20);
  if(lookupError)return result({error:"Registered device check temporarily unavailable"},503);
  if(!existing?.length)return result({error:"No registered Bite Partner device. Open the signed Partner APK and allow notifications.",code:"no_device"},409);
  const remaining=existing.map(row=>Math.max(1,Math.ceil(
    (Date.parse(row.last_test_at||"")+60000-Date.now())/1000
  ))).filter(Number.isFinite);
  const retryAfterSeconds=Math.min(60,Math.max(1,...remaining));
  return result({error:"Previous push test already requested. Wait for the cooldown.",code:"test_cooldown",retry_after_seconds:retryAfterSeconds},429);
 }
 // Deliberate short delay gives the owner time to lock the screen for a test.
 EdgeRuntime.waitUntil((async()=>{
  await new Promise(resolve=>setTimeout(resolve,8000));
  for(const device of devices){
   try{
    const fcmMessage={message:{
      token:device.fcm_token,
      notification:{title:"Bite test notification",body:"Push test successful — no real customer order."},
      data:{event_type:"bite_push_test",restaurant_id:restaurant},
      android:{priority:"HIGH",ttl:"120s",notification:{channel_id:"bite_owner_new_orders_v2",sound:"default",tag:"bite-test"}}
    }};
    const response=await fetch("https://fcm.googleapis.com/v1/projects/"+
      encodeURIComponent(account.project_id)+"/messages:send",{
       method:"POST",headers:{"Authorization":"Bearer "+access,"Content-Type":"application/json"},
       body:JSON.stringify(fcmMessage),signal:AbortSignal.timeout(12000)
      });
    if(!response.ok)console.warn("Bite owner FCM test not accepted:",response.status);
    else console.info("Bite owner FCM test accepted by provider");
   }catch(e){console.warn("Bite owner push test delivery attempt failed:",String(e))}
  }
 })());
 return result({scheduled:true,delay_seconds:8,device_count:devices.length});
});