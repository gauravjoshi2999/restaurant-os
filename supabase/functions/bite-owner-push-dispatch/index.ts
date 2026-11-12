import {createClient} from "npm:@supabase/supabase-js@2.95.0";

const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
function safeEqual(a:string,b:string){
 if(!a||!b||a.length!==b.length)return false;
 let result=0;for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);
 return result===0;
}
function b64url(value:Uint8Array|string){
 const raw=typeof value==="string"?new TextEncoder().encode(value):value;
 let chars="";for(const byte of raw)chars+=String.fromCharCode(byte);
 return btoa(chars).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
async function googleToken(account:{client_email:string;private_key:string}){
 const now=Math.floor(Date.now()/1000);
 const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
 const claim=b64url(JSON.stringify({iss:account.client_email,scope:"https://www.googleapis.com/auth/firebase.messaging",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3300}));
 const message=header+"."+claim;
 const pem=account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");
 const der=Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey("pkcs8",der,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
 const sig=new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(message)));
 const form=new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:message+"."+b64url(sig)});
 const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error("Google OAuth unavailable");
 const result=await response.json();
 if(typeof result.access_token!=="string"||!result.access_token)throw Error("No OAuth token");
 return result.access_token as string;
}
Deno.serve(async req=>{
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const expected=Deno.env.get("BITE_PUSH_DISPATCH_SECRET")||"";
 const supplied=req.headers.get("x-bite-push-secret")||"";
 if(!safeEqual(expected,supplied))return reply({error:"Forbidden"},403);
 const accountJson=Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")||"";
 let account:any;
 try{account=JSON.parse(accountJson)}catch{return reply({error:"FCM not configured"},503)}
 if(!account?.project_id||!account?.client_email||!account?.private_key)return reply({error:"FCM not configured"},503);
 const url=Deno.env.get("SUPABASE_URL")||"";
 const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!url||!secret)return reply({error:"Supabase credentials unavailable"},503);
 const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 let bearer:string;
 try{bearer=await googleToken(account)}catch(e){console.warn("FCM OAuth unavailable",String(e));return reply({error:"Push sender unavailable"},503)}
 const {data:events,error}=await db.from("bite_owner_push_events").select("order_id,restaurant_id,delivery_status,attempts").in("delivery_status",["queued","retry"]).order("created_at",{ascending:true}).limit(12);
 if(error)return reply({error:"Outbox unavailable"},503);
 let sent=0,failed=0,skipped=0;
 for(const ev of events||[]){
  const {data:claimed,error:claimError}=await db.from("bite_owner_push_events")
   .update({delivery_status:"processing",attempts:ev.attempts+1,last_attempt_at:new Date().toISOString()})
   .eq("order_id",ev.order_id).eq("delivery_status",ev.delivery_status)
   .select("order_id,restaurant_id,attempts").maybeSingle();
  if(claimError||!claimed)continue;
  let state="failed",lastError:string|null=null;
  try{
   const {data:order,error:orderError}=await db.from("orders")
     .select("id,restaurant_id,status,channel,is_demo,code")
     .eq("id",ev.order_id).eq("restaurant_id",ev.restaurant_id).maybeSingle();
   if(orderError||!order)throw Error("Order unavailable");
   if(order.status!=="Received"||String(order.channel||"").toLowerCase()!=="own platform"||order.is_demo===true){
    state="failed";lastError="Not an eligible new paid order";skipped++;
   }else{
    const {data:members,error:memberError}=await db.from("restaurant_members").select("user_id")
     .eq("restaurant_id",ev.restaurant_id).eq("role","owner");
    if(memberError)throw Error("Owner mapping unavailable");
    const ids=(members||[]).map(x=>x.user_id);
    if(ids.length!==1)throw Error("Owner mapping not unique");
    const {data:devices,error:devicesError}=await db.from("bite_owner_push_devices").select("fcm_token,user_id")
      .eq("restaurant_id",ev.restaurant_id).eq("enabled",true).in("user_id",ids);
    if(devicesError)throw Error("Device lookup unavailable");
    if(!devices?.length){state="no_devices";skipped++;}
    else{
     let errors=0;
     for(const device of devices){
      const push={message:{
       token:device.fcm_token,
       notification:{title:"New Bite order",body:"New order received. Open Bite Partner to accept or reject."},
       data:{order_id:String(order.id),restaurant_id:String(ev.restaurant_id),screen:"orders"},
       android:{priority:"HIGH",ttl:"600s",notification:{channel_id:"bite_owner_new_orders_v1",tag:"bite-"+order.id,sound:"default"}}
      }};
      const response=await fetch("https://fcm.googleapis.com/v1/projects/"+encodeURIComponent(account.project_id)+"/messages:send",
       {method:"POST",headers:{"Authorization":"Bearer "+bearer,"Content-Type":"application/json"},
        body:JSON.stringify(push),signal:AbortSignal.timeout(12000)});
      if(!response.ok){
       errors++;
       if(response.status===404||response.status===400){
        // A dead device token is not a reason to keep retrying the same owner device.
        await db.from("bite_owner_push_devices").update({enabled:false,updated_at:new Date().toISOString()})
          .eq("fcm_token",device.fcm_token).eq("restaurant_id",ev.restaurant_id);
       }
      }
     }
     if(errors===0){state="sent";sent++}
     else {state=ev.attempts>=4?"failed":"retry";failed++;lastError="FCM delivery failed for one or more registered devices"}
    }
   }
  }catch(error){state=ev.attempts>=4?"failed":"retry";lastError=String(error).slice(0,130);failed++}
  await db.from("bite_owner_push_events")
   .update({delivery_status:state,last_error:lastError,sent_at:state==="sent"?new Date().toISOString():null})
   .eq("order_id",ev.order_id).eq("delivery_status","processing");
 }
 return reply({processed:(events||[]).length,sent,failed,skipped});
});