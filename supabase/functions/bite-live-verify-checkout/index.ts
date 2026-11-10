import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";
const cors={"access-control-allow-origin":"https://gauravjoshi2999.github.io","access-control-allow-headers":"authorization, apikey, content-type, x-client-info, x-supabase-api-version","access-control-allow-methods":"POST, OPTIONS"};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store",...cors}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return respond({error:"Method not allowed"},405);
 const bearer=req.headers.get("authorization")||"";
 if(!bearer.startsWith("Bearer "))return respond({error:"Authentication required"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return respond({error:"Server configuration missing"},503);
 const client=createClient(url,anon,{global:{headers:{Authorization:bearer}}});
 const {data:{user},error:authError}=await client.auth.getUser();
 if(authError||!user)return respond({error:"Invalid session"},401);
 let body;try{body=await req.json()}catch{return respond({error:"Invalid JSON"},400)}
 const id=String(body?.intent_id||"");
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return respond({error:"Invalid intent ID"},400);
 const db=createClient(url,service);
 const {data:intent,error:ie}=await db.from("bite_live_checkout_intents").select("id,customer_id,restaurant_id,amount,currency,status,provider_order_id,activated_order_id,created_at").eq("id",id).maybeSingle();
 if(ie)return respond({error:"Database unavailable"},503);
 if(!intent||intent.customer_id!==user.id)return respond({error:"Checkout not found"},404);
 if(intent.status==="activated")return respond({status:"activated",order_id:intent.activated_order_id});
 if(intent.status==="payment_verified"){const {data:orderId,error:finalError}=await db.rpc("bite_finalize_verified_live_checkout",{p_intent_id:id});if(finalError)return respond({status:"payment_verified",error:"Order activation pending reconciliation"},503);return respond({status:"activated",order_id:orderId,verified:true})}
 if(intent.status!=="awaiting_payment")return respond({status:intent.status,verified:false});
 const canonicalId="bite_live_"+id.replaceAll("-","");
 if(intent.provider_order_id&&intent.provider_order_id!==canonicalId)return respond({error:"Valid provider reference missing"},409);
 intent.provider_order_id=canonicalId;
 const app=Deno.env.get("CASHFREE_APP_ID"),secret=Deno.env.get("CASHFREE_SECRET_KEY");
 if(!app||!secret)return respond({error:"Live payment provider not configured"},503);
 let response:Response;
 try{response=await fetch("https://api.cashfree.com/pg/orders/"+encodeURIComponent(intent.provider_order_id),{headers:{"x-api-version":"2023-08-01","x-client-id":app,"x-client-secret":secret},signal:AbortSignal.timeout(12000)})}
 catch{return respond({error:"Payment provider unavailable"},503)}
 if(response.status===404)return respond({error:"Provider payment reference not found. Keep this checkout reference and contact support before paying again."},503);
 if(!response.ok)return respond({error:"Payment verification unavailable"},503);
 const cf=await response.json();
 if(cf.order_id!==intent.provider_order_id||cf.order_currency!=="INR"||intent.currency!=="INR"||!Number.isFinite(Number(cf.order_amount))||Math.abs(Number(cf.order_amount)-Number(intent.amount))>0.001)return respond({error:"Payment amount or currency mismatch"},409);
 if(["EXPIRED","TERMINATED"].includes(cf.order_status)){
  const {error:expireError}=await db.from("bite_live_checkout_intents").update({status:"expired",updated_at:new Date().toISOString()}).eq("id",id).eq("status","awaiting_payment");
  if(expireError)return respond({error:"Could not record checkout expiry"},503);
  return respond({status:"expired",verified:false});
 }
 if(cf.order_status!=="PAID")return respond({status:"awaiting_payment",verified:false});
 const {data:updated,error:ue}=await db.from("bite_live_checkout_intents").update({status:"payment_verified",provider_order_id:canonicalId,updated_at:new Date().toISOString()}).eq("id",id).eq("customer_id",user.id).eq("status","awaiting_payment").select("id,status").maybeSingle();
 if(ue)return respond({error:"Could not record verification"},503);
 if(!updated){const {data:latest}=await db.from("bite_live_checkout_intents").select("status,activated_order_id").eq("id",id).maybeSingle();return respond({status:latest?.status||"unknown",order_id:latest?.activated_order_id,verified:true})}
 const {data:orderId,error:finalError}=await db.rpc("bite_finalize_verified_live_checkout",{p_intent_id:id});
 if(finalError)return respond({status:"payment_verified",error:"Order activation pending reconciliation"},503);
 return respond({status:"activated",order_id:orderId,verified:true});
});
