import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";
import {liveCors,liveJson,liveUuid,liveReference,liveMoney,liveStableJson,LivePaymentError,liveProvider,liveLookup,livePaymentsPending,liveRecord,liveActivate,liveClaim,liveErrorResult} from "../_shared/bite-payment.ts";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:liveCors});
 if(req.method!=="POST")return liveJson({error:"Method not allowed"},405);
 if(Deno.env.get("BITE_LIVE_CHECKOUT_ENABLED")!=="true")return liveJson({error:"Online payment abhi available nahi hai."},503);
 const bearer=req.headers.get("authorization")||"";
 if(!bearer.startsWith("Bearer "))return liveJson({error:"Login required"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return liveJson({error:"Server configuration unavailable"},503);
 const client=createClient(url,anon,{global:{headers:{Authorization:bearer}}});
 const {data:{user},error:authError}=await client.auth.getUser();
 if(authError||!user)return liveJson({error:"Session expire ho gayi. Dobara login karein."},401);
 let body;try{body=await req.json()}catch{return liveJson({error:"Invalid JSON"},400)}
 if(!Deno.env.get("CASHFREE_APP_ID")||!Deno.env.get("CASHFREE_SECRET_KEY"))return liveJson({error:"Live provider not configured"},503);
 // This only certifies configuration, not merchant activation or a successful payment.
 if(body?.action==="readiness")return liveJson({ready:true,provider:"cashfree",environment:"production"});
 const id=String(body?.intent_id||"");if(!liveUuid(id))return liveJson({error:"Invalid checkout"},400);
 const db=createClient(url,service),token=crypto.randomUUID();let held=false;
 try{
  const claim=await liveClaim(db,id,user.id,token,"create");if(claim.error)return liveJson(claim,claim.http);
  const intent=claim.intent;if(claim.already_activated)return liveJson({status:"activated",order_id:intent.activated_order_id});held=true;
  if(!Array.isArray(intent.priced_items)||intent.priced_items.length<1||intent.priced_items.length>50)throw new LivePaymentError("Checkout item snapshot missing.","invalid_snapshot",409);
  const total=intent.priced_items.reduce((s:number,i:any)=>s+Number(i.quantity)*Number(i.unit_price),0);
  if(!Number.isFinite(total)||[intent.food_subtotal,intent.delivery_fee,intent.amount,intent.discount_amount].some(n=>n==null||!Number.isFinite(Number(n)))||Number(intent.delivery_fee)<0||Number(intent.discount_amount)<0||Number(intent.discount_amount)>total||Math.abs(total-Number(intent.food_subtotal))>0.001||Math.abs(total+Number(intent.delivery_fee)-Number(intent.discount_amount)-Number(intent.amount))>0.001||Number(intent.amount)<1||Number(intent.amount)>1000000||intent.currency!=="INR")throw new LivePaymentError("Checkout total mismatch. Cart ko dobara review karein.","invalid_snapshot",409);
  // Recover an existing canonical order even after the local price quote expires.
  let order=await liveLookup(intent);
  if(order?.order_status==="PAID")return liveJson(await liveActivate(db,intent,order));
  if(!order){
   if(Date.now()-new Date(intent.created_at).getTime()>15*60*1000||new Date(intent.provider_expires_at).getTime()<=Date.now()+15*60*1000)throw new LivePaymentError("Price quote expire ho gayi. Status check/cancel karke naya cart checkout karein.","quote_expired",409);
   const {data:profile}=await db.from("customer_contact_profiles").select("full_name,phone").eq("customer_id",user.id).maybeSingle();
   const contact=intent.customer_snapshot||profile;let phone=String(contact?.phone||"").replace(/\D/g,"");if(phone.length===12&&phone.startsWith("91"))phone=phone.slice(2);
   if(!/^[6-9]\d{9}$/.test(phone))throw new LivePaymentError("Sahi 10-digit Indian mobile number save karein.","invalid_customer_phone",409);
   const payload=intent.provider_payload||{order_id:liveReference(id),order_expiry_time:intent.provider_expires_at,order_amount:Number(intent.amount),order_currency:"INR",customer_details:{customer_id:user.id,customer_name:contact.full_name||"Customer",customer_phone:phone,...(user.email?{customer_email:user.email}:{})},order_meta:{return_url:"https://gauravjoshi2999.github.io/restaurant-os/customer.html?live_checkout_return="+encodeURIComponent(id)}};
   await liveRecord(db,id,token,{payload,attempting:true});
   try{order=await liveProvider("/orders",{method:"POST",headers:{"x-idempotency-key":id},body:liveStableJson(payload)});}
   catch(error){if(error instanceof LivePaymentError&&[409,422].includes(error.http)){order=await liveLookup(intent);if(!order)throw error;}else throw error;}
   if(order.order_id!==liveReference(id)||order.order_currency!=="INR"||!liveMoney(order.order_amount,intent.amount))throw new LivePaymentError("Provider amount mismatch. Status check karein.","amount_mismatch",409);
  }
  await liveRecord(db,id,token,{provider_order_id:liveReference(id),http_status:200,error_code:"",order_status:order.order_status});
  if(order.order_status==="PAID")return liveJson(await liveActivate(db,intent,order));
  if(order.order_status!=="ACTIVE"||typeof order.payment_session_id!=="string"||!order.payment_session_id)throw new LivePaymentError("Payment session active nahi hai. Status check/cancel karein.","session_not_active",409);
  if(await livePaymentsPending(liveReference(id)))throw new LivePaymentError("Pichhla payment attempt processing mein hai. Dobara pay na karein; status check karein.","payment_in_progress",409);
  return liveJson({intent_id:id,order_id:liveReference(id),payment_session_id:order.payment_session_id,amount:Number(intent.amount),priced_items:intent.priced_items,delivery_fee:Number(intent.delivery_fee),discount_amount:Number(intent.discount_amount),currency:"INR",environment:"production"});
 }catch(error){if(held&&error instanceof LivePaymentError)await liveRecord(db,id,token,{http_status:error.http||null,error_code:error.code}).catch(()=>{});return liveErrorResult(error,id);}
 finally{if(held)await liveRecord(db,id,token,{release:true}).catch(()=>{});}
});
