import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";
const cors={"access-control-allow-origin":"https://gauravjoshi2999.github.io","access-control-allow-headers":"authorization, apikey, content-type, x-client-info, x-supabase-api-version","access-control-allow-methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store",...cors}});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const token=req.headers.get("authorization")||"";
 if(!token.startsWith("Bearer "))return reply({error:"Login required"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply({error:"Service unavailable"},503);
 const customer=createClient(url,anon,{global:{headers:{Authorization:token}}});
 const {data:{user},error:authError}=await customer.auth.getUser();
 if(authError||!user)return reply({error:"Session expired, sign in again"},401);
 let data:any;
 try{data=await req.json()}catch{return reply({error:"Invalid JSON"},400)}
 const id=String(data?.intent_id||"");
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return reply({error:"Invalid checkout ID"},400);
 const db=createClient(url,service);
 const {data:intent,error:dbError}=await db.from("bite_live_checkout_intents").select("id,customer_id,status,provider_order_id,provider_attempted_at,activated_order_id,created_at,amount,currency").eq("id",id).maybeSingle();
 if(dbError)return reply({error:"Payment records temporarily unavailable"},503);
 if(!intent||intent.customer_id!==user.id)return reply({error:"Checkout not found"},404);
 if(intent.status!=="awaiting_payment")return reply({status:intent.status,order_id:intent.activated_order_id||null,cancelled:false});
 const expire=async()=>{
  const {data:updated,error}=await db.from("bite_live_checkout_intents").update({status:"expired",updated_at:new Date().toISOString()}).eq("id",id).eq("customer_id",user.id).eq("status","awaiting_payment").select("id").maybeSingle();
  if(error)return reply({error:"Unable to cancel checkout"},503);
  if(!updated)return reply({error:"Checkout status changed; please check payment status"},409);
  return reply({status:"expired",cancelled:true});
 };
 // No provider request was ever made: safe atomic expiry, even if an attempt starts concurrently.
 if(!intent.provider_attempted_at&&!intent.provider_order_id){
  const {data:updated,error}=await db.from("bite_live_checkout_intents").update({status:"expired",updated_at:new Date().toISOString()}).eq("id",id).eq("customer_id",user.id).eq("status","awaiting_payment").is("provider_attempted_at",null).is("provider_order_id",null).select("id").maybeSingle();
  if(error)return reply({error:"Unable to cancel checkout"},503);
  return updated?reply({status:"expired",cancelled:true}):reply({error:"Payment may have started. Check status and retry cancellation."},409);
 }
 // An attempted Cashfree order must always be checked with Cashfree before marking it cancelled.
 // A missing locally saved provider_order_id does NOT prove Cashfree did not create an order.
 const app=Deno.env.get("CASHFREE_APP_ID"),secret=Deno.env.get("CASHFREE_SECRET_KEY");
 if(!app||!secret)return reply({error:"Payment provider verification unavailable. Checkout was not cancelled."},503);
 const ref="bite_live_"+id.replaceAll("-","");
 if(intent.provider_order_id&&intent.provider_order_id!==ref)return reply({error:"Provider order mismatch; contact support"},409);
 const headers={"x-api-version":"2023-08-01","x-client-id":app,"x-client-secret":secret};
 const endpoint="https://api.cashfree.com/pg/orders/"+encodeURIComponent(ref);
 let provider:Response;
 try{provider=await fetch(endpoint,{headers,signal:AbortSignal.timeout(12000)})}
 catch{return reply({error:"Cashfree status could not be checked. Checkout was not cancelled."},503)}
 if(provider.status===404){
  // Cashfree confirms the canonical order is absent. Do not cancel a recent in-flight attempt.
  const attemptMs=intent.provider_attempted_at?new Date(intent.provider_attempted_at).getTime():Date.now();
  if(!Number.isFinite(attemptMs)||Date.now()-attemptMs<120000)return reply({error:"Cashfree request may still be processing. Retry cancellation after checking status.",cancelled:false},409);
  if(intent.provider_order_id)return reply({error:"Saved provider order is currently unavailable; cancellation blocked for safety.",cancelled:false},409);
  const cutoff=new Date(Date.now()-120000).toISOString();
  const {data:unpaid,error:cancelError}=await db.from("bite_live_checkout_intents")
    .update({status:"expired",updated_at:new Date().toISOString()})
    .eq("id",id).eq("customer_id",user.id).eq("status","awaiting_payment")
    .is("provider_order_id",null).lt("provider_attempted_at",cutoff)
    .select("id").maybeSingle();
  if(cancelError)return reply({error:"Could not record cancellation; please try again.",cancelled:false},503);
  if(!unpaid)return reply({error:"Checkout changed during cancellation. Check payment status.",cancelled:false},409);
  return reply({status:"expired",cancelled:true,provider_checked:true});
 }
 if(!provider.ok)return reply({error:"Cashfree status unavailable. Checkout was not cancelled."},503);
 let order:any;try{order=await provider.json()}catch{return reply({error:"Invalid payment status response"},503)}
 if(order.order_id!==ref||order.order_currency!==intent.currency||Math.abs(Number(order.order_amount)-Number(intent.amount))>0.001)return reply({error:"Payment details mismatch; cancellation blocked for safety"},409);
 // Cashfree can return TERMINATION_REQUESTED (not yet terminated). Wait for a
 // verified terminal provider state, in the SAME user-initiated cancellation request.
 // Never treat ACTIVE/TERMINATION_REQUESTED as safe to create a fresh charge.
 const paymentFound=async()=>{
  const {data:marked,error:paidError}=await db.from("bite_live_checkout_intents").update({status:"payment_verified",provider_order_id:ref,updated_at:new Date().toISOString()}).eq("id",id).eq("customer_id",user.id).eq("status","awaiting_payment").select("id").maybeSingle();
  if(paidError)return reply({error:"Payment found; order verification requires support"},503);
  const {data:orderId,error:finalizeError}=await db.rpc("bite_finalize_verified_live_checkout",{p_intent_id:id});
  return finalizeError?reply({status:"payment_verified",cancelled:false,error:"Payment received; order reconciliation in progress"}):reply({status:"activated",order_id:orderId,cancelled:false});
 };
 const checkOrder=(value:any)=>value&&value.order_id===ref&&value.order_currency===intent.currency&&Number.isFinite(Number(value.order_amount))&&Math.abs(Number(value.order_amount)-Number(intent.amount))<=0.001;
 const getUpdatedOrder=async()=>{
  const response=await fetch(endpoint,{headers,signal:AbortSignal.timeout(5500)});
  if(!response.ok)throw Error("Provider status temporarily unavailable");
  const current=await response.json();
  if(!checkOrder(current))throw Error("Payment details changed");
  return current;
 };
 if(order.order_status==="PAID")return await paymentFound();
 if(order.order_status==="EXPIRED"||order.order_status==="TERMINATED")return await expire();
 if(order.order_status==="ACTIVE"){
  let terminated:Response;
  try{terminated=await fetch(endpoint,{method:"PATCH",headers:{"content-type":"application/json",...headers},body:JSON.stringify({order_status:"TERMINATED"}),signal:AbortSignal.timeout(10000)})}
  catch{return reply({status:"cancellation_processing",cancelled:false,error:"Cancellation could not be confirmed. Check again."})}
  // A failed PATCH doesn't prove no cancellation occurred; GET may still be terminal.
  if(terminated.ok){
   let outcome:any;try{outcome=await terminated.json()}catch{outcome=null;}
   if(outcome&&!checkOrder(outcome))return reply({status:"payment_check_required",cancelled:false,error:"Payment details mismatch; cancellation blocked."},409);
   if(outcome?.order_status==="PAID")return await paymentFound();
   if(["TERMINATED","EXPIRED"].includes(outcome?.order_status))return await expire();
  }
 }
 // Termination is asynchronous. Recheck up to several times automatically
 // so the customer doesn't have to press the same button repeatedly.
 for(const delay of [0,650,1100,1700,2400]){
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  try{
   const current=await getUpdatedOrder();
   if(current.order_status==="PAID")return await paymentFound();
   if(["TERMINATED","EXPIRED"].includes(current.order_status))return await expire();
   if(!["ACTIVE","TERMINATION_REQUESTED"].includes(current.order_status))
    return reply({status:"payment_check_required",cancelled:false,error:"Payment needs verification. A new charge is blocked."});
  }catch(error){
   console.warn("Cashfree cancellation status recheck unavailable",String(error));
   // Do not infer cancellation from a network timeout.
  }
 }
 return reply({status:"cancellation_processing",cancelled:false,retry_after_ms:3000,error:"Cashfree is still confirming cancellation. No new payment has been started."});

});