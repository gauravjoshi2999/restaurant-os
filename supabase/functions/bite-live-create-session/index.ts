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
 const {data:intent,error:ie}=await db.from("bite_live_checkout_intents").select("id,customer_id,restaurant_id,amount,currency,status,provider_order_id,provider_attempted_at,priced_items,food_subtotal,delivery_fee,discount_amount,customer_snapshot,created_at").eq("id",id).maybeSingle();
 if(ie)return json({error:"Database unavailable"},503);
 if(!intent||intent.customer_id!==user.id)return json({error:"Checkout not found"},404);
 if(intent.status!=="awaiting_payment")return json({error:"Checkout cannot be paid"},409);
 if(!Array.isArray(intent.priced_items)||intent.priced_items.length<1||intent.priced_items.length>50)return json({error:"Checkout item snapshot missing"},409);
 const snapshotTotal=intent.priced_items.reduce((sum:number,item:any)=>sum+Number(item.quantity)*Number(item.unit_price),0);
 if([intent.food_subtotal,intent.delivery_fee,intent.amount].some(n=>n==null||!Number.isFinite(Number(n)))||Number(intent.delivery_fee)<0||!Number.isFinite(snapshotTotal)||Math.abs(snapshotTotal-Number(intent.food_subtotal))>0.001||!Number.isFinite(Number(intent.discount_amount||0))||Number(intent.discount_amount||0)<0||Number(intent.discount_amount||0)>snapshotTotal||Math.abs(snapshotTotal+Number(intent.delivery_fee)-Number(intent.discount_amount||0)-Number(intent.amount))>0.001)return json({error:"Checkout total mismatch"},409);
 if(Date.now()-new Date(intent.created_at).getTime()>15*60*1000){
  // An old checkout is not payable. Expire it only after confirming no payment
  // session exists, or confirming Cashfree says the canonical order does not exist.
  if(intent.provider_order_id)return json({error:"Old checkout has a provider reference. Verify or cancel before starting over.",status:"awaiting_payment"},409);
  const cutoff=new Date(Date.now()-120000).toISOString();
  if(intent.provider_attempted_at){
   if(new Date(intent.provider_attempted_at).getTime()>Date.parse(cutoff))
    return json({error:"Payment request is still settling. Check status before cancelling.",status:"awaiting_payment"},409);
   const ref="bite_live_"+id.replaceAll("-","");
   let payment:Response;
   try{
    payment=await fetch("https://api.cashfree.com/pg/orders/"+encodeURIComponent(ref),{headers:{"x-api-version":"2023-08-01","x-client-id":app,"x-client-secret":secret},signal:AbortSignal.timeout(12000)});
   }catch{return json({error:"Cannot check old payment safely; Cashfree is unavailable",status:"awaiting_payment"},503)}
   if(payment.status!==404)return json({error:"Old provider order needs verification or cancellation before a new payment.",status:"awaiting_payment"},409);
  }
  let update=db.from("bite_live_checkout_intents").update({status:"expired",updated_at:new Date().toISOString()})
    .eq("id",id).eq("customer_id",user.id).eq("status","awaiting_payment").is("provider_order_id",null);
  update=intent.provider_attempted_at?update.lt("provider_attempted_at",cutoff):update.is("provider_attempted_at",null);
  const {data:expired,error:expireError}=await update.select("id").maybeSingle();
  if(expireError||!expired)return json({error:"Old checkout changed during verification. Please check payment status.",status:"awaiting_payment"},409);
  return json({status:"expired",error:"Unpaid checkout expired. Start a fresh checkout; no order was placed."},409);
 }
 const cfId="bite_live_"+id.replaceAll("-","");
 if(intent.provider_order_id&&intent.provider_order_id!==cfId)return json({error:"Provider reference mismatch"},409);
 const {data:profile}=await db.from("customer_contact_profiles").select("full_name,phone").eq("customer_id",user.id).maybeSingle();
 const contact=intent.customer_snapshot||profile;
 if(!contact?.phone)return json({error:"Customer phone required"},409);
 const amount=Number(intent.amount);if(!Number.isFinite(amount)||amount<1||amount>1000000||intent.currency!=="INR")return json({error:"Invalid checkout amount"},409);
 const payload={order_id:cfId,order_amount:amount,order_currency:"INR",customer_details:{customer_id:user.id,customer_name:contact.full_name||"Customer",customer_phone:contact.phone,customer_email:user.email||"customer@example.com"},order_meta:{return_url:"https://gauravjoshi2999.github.io/restaurant-os/customer.html?live_checkout_return="+encodeURIComponent(id)}};
 const {error:attemptError}=await db.from("bite_live_checkout_intents").update({provider_attempted_at:new Date().toISOString()}).eq("id",id).eq("status","awaiting_payment");
 if(attemptError)return json({error:"Could not record provider attempt; no payment session requested"},503);
 let res:Response;let data:any;
 const providerHeaders={"content-type":"application/json","x-api-version":"2023-08-01","x-client-id":app,"x-client-secret":secret};
 try{
  res=await fetch("https://api.cashfree.com/pg/orders",{method:"POST",headers:{...providerHeaders,"x-idempotency-key":id},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
  data=await res.json().catch(()=>({}));
  if(res.status===409){res=await fetch("https://api.cashfree.com/pg/orders/"+encodeURIComponent(cfId),{headers:providerHeaders,signal:AbortSignal.timeout(12000)});data=await res.json().catch(()=>({}));}
 }catch{return json({error:"Provider session uncertain. Retry this same checkout; do not create another payment."},503);}
 if(!res.ok||data.order_id!==cfId||!data.payment_session_id||data.order_currency!=="INR"||!Number.isFinite(Number(data.order_amount))||Math.abs(Number(data.order_amount)-amount)>0.001){
  const providerCode=String(data?.code||data?.type||"ORDER_CREATE_FAILED").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,64);
  console.warn("Cashfree order creation rejected:",{status:res.status,providerCode,has_session:!!data?.payment_session_id});
  return json({error:"Cashfree order creation was rejected; retry or cancel this checkout",provider_status:res.status,provider_code:providerCode},503);
 }

 // Never forward a stale or already-paid provider session to Cashfree SDK.
 if(data.order_status==="PAID")return json({error:"Cashfree reports payment paid. Verify order status instead of paying again.",status:"payment_check_required"},409);
 if(["EXPIRED","TERMINATED"].includes(data.order_status)){
  const {data:expirySaved,error:expiryError}=await db.from("bite_live_checkout_intents").update({status:"expired",updated_at:new Date().toISOString()}).eq("id",id).eq("customer_id",user.id).eq("status","awaiting_payment").select("id").maybeSingle();
  if(expiryError)return json({error:"Provider expiry confirmed but status update failed. Verify payment status.",status:"payment_check_required"},503);
  if(!expirySaved)return json({error:"Checkout status changed while checking provider expiry. Verify payment status.",status:"payment_check_required"},409);
  return json({error:"Cashfree order has expired. Check status then start a new checkout.",status:"expired"},409);
 }
 if(data.order_status!=="ACTIVE")return json({error:"Cashfree status uncertain. Verify payment before retrying.",status:"payment_check_required"},409);
 const expiryMs=data.order_expiry_time?Date.parse(String(data.order_expiry_time)):NaN;
 if(data.order_expiry_time&&!Number.isFinite(expiryMs))return json({error:"Provider expiry invalid. Payment session withheld.",status:"payment_check_required"},409);
 if(Number.isFinite(expiryMs)&&expiryMs<Date.now()+120000)return json({error:"Cashfree order is close to expiry. Check or cancel the old checkout to start fresh.",status:"session_expiring"},409);
 const {data:savedIntent,error:ue}=await db.from("bite_live_checkout_intents").update({provider_order_id:cfId,updated_at:new Date().toISOString()}).eq("id",id).eq("customer_id",user.id).eq("status","awaiting_payment").select("id").maybeSingle();
 if(ue||!savedIntent)return json({error:"Checkout was cancelled or expired before session confirmation; no payment session was issued"},409);
 return json({intent_id:id,order_id:cfId,payment_session_id:data.payment_session_id,amount,priced_items:intent.priced_items,delivery_fee:Number(intent.delivery_fee),discount_amount:Number(intent.discount_amount||0),currency:"INR",environment:"production",expires_at:data.order_expiry_time||null});
});
