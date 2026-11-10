import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";
const cors={"access-control-allow-origin":"https://gauravjoshi2999.github.io","access-control-allow-headers":"authorization, apikey, content-type, x-client-info, x-supabase-api-version","access-control-allow-methods":"POST, OPTIONS"};
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json","cache-control":"no-store",...cors}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 if(Deno.env.get("BITE_LIVE_CHECKOUT_ENABLED")!=="true")return json({error:"Live checkout is not enabled; sandbox testing remains available"},503);
 const token=req.headers.get("authorization")||"";if(!token.startsWith("Bearer "))return json({error:"Login required"},401);
 const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const userClient=createClient(url,anon,{global:{headers:{Authorization:token}}});
 const {data:{user},error}=await userClient.auth.getUser();if(error||!user)return json({error:"Invalid session"},401);
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const app=Deno.env.get("CASHFREE_APP_ID"),secret=Deno.env.get("CASHFREE_SECRET_KEY");
 if(!app||!secret)return json({error:"Live provider not configured"},503);
 if(body?.action==="readiness")return json({ready:true,provider:"cashfree",environment:"production"});
 const id=String(body?.intent_id||"");if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return json({error:"Invalid checkout"},400);
 const db=createClient(url,service);
 const {data:intent,error:ie}=await db.from("bite_live_checkout_intents").select("id,customer_id,restaurant_id,amount,currency,status,provider_order_id,priced_items,food_subtotal,delivery_fee,discount_amount,customer_snapshot,created_at").eq("id",id).maybeSingle();
 if(ie)return json({error:"Database unavailable"},503);
 if(!intent||intent.customer_id!==user.id)return json({error:"Checkout not found"},404);
 if(intent.status!=="awaiting_payment")return json({error:"Checkout cannot be paid"},409);
 if(!Array.isArray(intent.priced_items)||intent.priced_items.length<1||intent.priced_items.length>50)return json({error:"Checkout item snapshot missing"},409);
 const snapshotTotal=intent.priced_items.reduce((sum:number,item:any)=>sum+Number(item.quantity)*Number(item.unit_price),0);
 if([intent.food_subtotal,intent.delivery_fee,intent.amount].some(n=>n==null||!Number.isFinite(Number(n)))||Number(intent.delivery_fee)<0||!Number.isFinite(snapshotTotal)||Math.abs(snapshotTotal-Number(intent.food_subtotal))>0.001||!Number.isFinite(Number(intent.discount_amount||0))||Number(intent.discount_amount||0)<0||Number(intent.discount_amount||0)>snapshotTotal||Math.abs(snapshotTotal+Number(intent.delivery_fee)-Number(intent.discount_amount||0)-Number(intent.amount))>0.001)return json({error:"Checkout total mismatch"},409);
 if(Date.now()-new Date(intent.created_at).getTime()>15*60*1000)return json({error:"Checkout expired; please refresh cart"},409);
 const cfId="bite_live_"+id.replaceAll("-","");
 if(intent.provider_order_id&&intent.provider_order_id!==cfId)return json({error:"Provider reference mismatch"},409);
 const {data:profile}=await db.from("customer_contact_profiles").select("full_name,phone").eq("customer_id",user.id).maybeSingle();
 const contact=intent.customer_snapshot||profile;
 if(!contact?.phone)return json({error:"Customer phone required"},409);
 const amount=Number(intent.amount);if(!Number.isFinite(amount)||amount<1||amount>1000000||intent.currency!=="INR")return json({error:"Invalid checkout amount"},409);
 const payload={order_id:cfId,order_expiry_time:new Date(new Date(intent.created_at).getTime()+15*60*1000).toISOString(),order_amount:amount,order_currency:"INR",customer_details:{customer_id:user.id,customer_name:contact.full_name||"Customer",customer_phone:contact.phone,customer_email:user.email||"customer@example.com"},order_meta:{return_url:"https://gauravjoshi2999.github.io/restaurant-os/customer.html?live_checkout_return="+encodeURIComponent(id)}};
 const {error:attemptError}=await db.from("bite_live_checkout_intents").update({provider_attempted_at:new Date().toISOString()}).eq("id",id).eq("status","awaiting_payment");
 if(attemptError)return json({error:"Could not record provider attempt; no payment session requested"},503);
 let res:Response;let data:any;
 const providerHeaders={"content-type":"application/json","x-api-version":"2023-08-01","x-client-id":app,"x-client-secret":secret};
 try{
  res=await fetch("https://api.cashfree.com/pg/orders",{method:"POST",headers:{...providerHeaders,"x-idempotency-key":id},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
  data=await res.json().catch(()=>({}));
  if(res.status===409){res=await fetch("https://api.cashfree.com/pg/orders/"+encodeURIComponent(cfId),{headers:providerHeaders,signal:AbortSignal.timeout(12000)});data=await res.json().catch(()=>({}));}
 }catch{return json({error:"Provider session uncertain. Retry this same checkout; do not create another payment."},503);}
 if(!res.ok||data.order_id!==cfId||!data.payment_session_id||data.order_currency!=="INR"||!Number.isFinite(Number(data.order_amount))||Math.abs(Number(data.order_amount)-amount)>0.001)return json({error:"Provider session unavailable or amount mismatch",provider_status:res.status},503);
 const {error:ue}=await db.from("bite_live_checkout_intents").update({provider_order_id:cfId,updated_at:new Date().toISOString()}).eq("id",id).eq("customer_id",user.id).eq("status","awaiting_payment");
 if(ue)return json({error:"Could not save provider session"},503);
 return json({intent_id:id,order_id:cfId,payment_session_id:data.payment_session_id,amount,priced_items:intent.priced_items,delivery_fee:Number(intent.delivery_fee),discount_amount:Number(intent.discount_amount||0),currency:"INR",environment:"production"});
});
