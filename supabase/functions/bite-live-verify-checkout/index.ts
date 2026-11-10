import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";
import {liveCors,liveJson,liveUuid,liveReference,LivePaymentError,liveProvider,liveLookup,livePaymentsPending,liveRecord,liveActivate,liveClaim,liveErrorResult} from "../_shared/bite-payment.ts";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:liveCors});
 if(req.method!=="POST")return liveJson({error:"Method not allowed"},405);
 const bearer=req.headers.get("authorization")||"";if(!bearer.startsWith("Bearer "))return liveJson({error:"Authentication required"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return liveJson({error:"Server configuration unavailable"},503);
 const client=createClient(url,anon,{global:{headers:{Authorization:bearer}}});
 const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)return liveJson({error:"Session expire ho gayi. Dobara login karein."},401);
 let body;try{body=await req.json()}catch{return liveJson({error:"Invalid JSON"},400)}
 const id=String(body?.intent_id||""),action=body?.action||"verify";
 if(!liveUuid(id)||!["verify","cancel"].includes(action))return liveJson({error:"Invalid checkout request"},400);
 const db=createClient(url,service),token=crypto.randomUUID();let held=false;
 try{
  const claim=await liveClaim(db,id,user.id,token,action);if(claim.error)return liveJson(claim,claim.http);
  const intent=claim.intent;if(claim.already_activated)return liveJson({status:"activated",order_id:intent.activated_order_id,verified:true});held=true;
  if(intent.status==="payment_verified"){const {data,error}=await db.rpc("bite_finalize_verified_live_checkout",{p_intent_id:id});if(error)throw new LivePaymentError("Paid order activate ho raha hai. Dobara payment na karein.","activation_pending");return liveJson({status:"activated",order_id:data,verified:true});}
  let order=await liveLookup(intent);
  if(!order){
   // A generic 404, timeout or recent request is never proof of a failed payment.
   // Legacy requests expired at created_at +15m; quarantine a further 30m.
   const expiry=new Date(intent.provider_expires_at||new Date(new Date(intent.created_at).getTime()+15*60000)).getTime();
   const safe=!intent.provider_attempted_at&&!intent.provider_order_id||Number.isFinite(expiry)&&Date.now()>expiry+30*60000;
   const evidence={http_status:404,error_code:"order_not_found",order_status:"NOT_FOUND",...(safe?{safely_closed:true,closure_reason:!intent.provider_attempted_at&&!intent.provider_order_id?"never_requested":"provider_not_found_after_expiry"}:{})};
   const saved=await liveRecord(db,id,token,evidence);
   if(saved.status==="activated")return liveJson({...saved,verified:true});
   return liveJson({status:saved.status,verified:false,safely_closed:saved.safely_closed===true,provider_state:"NOT_FOUND",can_retry:!safe&&Date.now()-new Date(intent.created_at).getTime()<15*60000,message:safe?"Cashfree par payment order nahi mila. Checkout safely band hai; naya order kar sakte hain.":"Provider order abhi nahi mila. Failure confirm nahi hai. Isi checkout ko retry/status check karein; menu aur cart khule hain."});
  }
  await liveRecord(db,id,token,{provider_order_id:liveReference(id),http_status:200,error_code:"",order_status:order.order_status});
  if(order.order_status==="PAID")return liveJson(await liveActivate(db,intent,order));
  // Started payments may succeed after expiry; verify every attempt before closure/retry.
  let pending=await livePaymentsPending(liveReference(id));
  if(action==="cancel"&&order.order_status==="ACTIVE"&&!pending){
   await liveProvider("/orders/"+liveReference(id),{method:"PATCH",headers:{"x-idempotency-key":id},body:JSON.stringify({order_status:"TERMINATED"})});
   order=await liveLookup(intent);if(!order)throw new LivePaymentError("Cancellation ka final status abhi nahi mila.","cancellation_uncertain");
   if(order.order_status==="PAID")return liveJson(await liveActivate(db,intent,order));
   pending=await livePaymentsPending(liveReference(id));
  }
  const closed=["EXPIRED","TERMINATED"].includes(order.order_status)&&!pending;
  if(closed){const saved=await liveRecord(db,id,token,{http_status:200,order_status:order.order_status,safely_closed:true,closure_reason:"provider_closed_without_pending_payments",pending_payments:false});return liveJson({...saved,verified:saved.status==="activated",message:"Payment reconcile ho gaya. Checkout band hai; naya order kar sakte hain."});}
  return liveJson({status:"awaiting_payment",verified:false,safely_closed:false,provider_state:order.order_status,can_retry:order.order_status==="ACTIVE"&&!pending,message:pending?"Payment processing mein hai. Dobara payment na karein. Menu par ja sakte hain aur status baad mein check kar sakte hain.":action==="cancel"?"Cancellation confirm ho rahi hai. Status dobara check karein; browsing jaari rakh sakte hain.":"Payment complete nahi hua. Isi checkout ko retry kar sakte hain, ya checkout cancel karein."});
 }catch(error){if(held&&error instanceof LivePaymentError)await liveRecord(db,id,token,{http_status:error.http||null,error_code:error.code}).catch(()=>{});return liveErrorResult(error,id);}
 finally{if(held)await liveRecord(db,id,token,{release:true}).catch(()=>{});}
});
