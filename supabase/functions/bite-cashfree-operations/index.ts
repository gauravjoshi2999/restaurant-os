import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";
const cors={"access-control-allow-origin":"https://gauravjoshi2999.github.io","access-control-allow-headers":"authorization, apikey, content-type, x-client-info, x-supabase-api-version","access-control-allow-methods":"POST, OPTIONS"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json","cache-control":"no-store",...cors}});
export function exactMoney(value:unknown,expected:unknown):boolean{
 const valid=(v:unknown)=>(typeof v==="number"&&Number.isFinite(v))||(typeof v==="string"&&/^\d+(\.\d{1,2})?$/.test(v));
 return valid(value)&&valid(expected)&&Number(value)>=0&&Math.abs(Number(value)-Number(expected))<0.001;
}
export function settlementEvidence(raw:any){
 const take=(obj:any,keys:string[])=>Object.fromEntries(keys.filter(k=>obj?.[k]!==undefined).map(k=>[k,obj[k]]));
 return {order:take(raw?.order_details,["order_id","order_amount","order_currency"]),payment:take(raw?.payment_details,["cf_payment_id","payment_amount","payment_currency","pg_service_charge","pg_service_tax","split_service_charge","split_service_tax","settlement_amount","charged_to"]),settlement:take(raw?.settlement_details,["cf_settlement_id","status","status_description","settlement_utr","settlement_initiated_on","settlement_processed_on","settlement_currency","settlement_type"])};
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  if(Number(req.headers.get("content-length")||0)>4096)return json({error:"Request too large"},413);
  const bearer=req.headers.get("authorization")||"";if(!bearer.startsWith("Bearer "))return json({error:"Login required"},401);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!anon||!service)return json({error:"Server configuration missing"},503);
  const client=createClient(url,anon,{global:{headers:{Authorization:bearer}}}),{data:{user},error:ae}=await client.auth.getUser();if(ae||!user)return json({error:"Invalid session"},401);
  const {data:admin,error:roleError}=await client.rpc("is_platform_admin");if(roleError||admin!==true)return json({error:"Admin access required"},403);
  let body:any;try{body=await req.json();}catch{return json({error:"Invalid JSON"},400);}
  if(!["reconcile","execute_refund","check_refund"].includes(body?.action))return json({error:"Invalid action"},400);
  if(body.action==="execute_refund"&&(Deno.env.get("BITE_PROVIDER_REFUNDS_ENABLED")!=="true"||body.confirm!=="EXECUTE APPROVED REFUND"))return json({error:"Real refunds require explicit rollout approval and confirmation"},409);
  const app=Deno.env.get("CASHFREE_APP_ID"),secret=Deno.env.get("CASHFREE_SECRET_KEY");if(!app||!secret)return json({error:"Provider not configured"},503);
  const db=createClient(url,service),headers={"content-type":"application/json","x-api-version":"2023-08-01","x-client-id":app,"x-client-secret":secret};
  async function provider(path:string,options:any={}){const r=await fetch("https://api.cashfree.com/pg"+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(12000)});const data=await r.json().catch(()=>null);return{r,data};}
  const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
  let job:any=null,orderId=body.order_id;
  if(body.action!=="reconcile"){
   if(!uuid(body.refund_id))return json({error:"Invalid refund ID"},400);
   const {data,error}=await db.from("bite_refund_jobs").select("*").eq("id",body.refund_id).maybeSingle();if(error)return json({error:"Refund database unavailable"},503);job=data;
   if(!job||!job.approved_by||!job.approved_at||["pending_approval","rejected"].includes(job.status))return json({error:"Approved refund not found"},409);orderId=job.order_id;
  }
  if(!uuid(orderId))return json({error:"Invalid order ID"},400);
  const {data:order,error:oe}=await db.from("orders").select("id,restaurant_id,customer_id,amount,is_demo,channel").eq("id",orderId).maybeSingle();if(oe)return json({error:"Order database unavailable"},503);if(!order||order.is_demo||order.channel!=="Own Platform")return json({error:"Live marketplace order not found"},404);
  const {data:intent,error:ie}=await db.from("bite_live_checkout_intents").select("id,amount,currency,provider_order_id,status").eq("activated_order_id",order.id).maybeSingle();if(ie)return json({error:"Payment database unavailable"},503);if(!intent||intent.status!=="activated"||intent.currency!=="INR"||intent.provider_order_id!=="bite_live_"+intent.id.replaceAll("-",""))return json({error:"Trusted payment reference missing"},409);
  const cfId=encodeURIComponent(intent.provider_order_id);
  if(body.action==="reconcile"){
   const {r,data}=await provider("/orders/"+cfId);if(!r.ok)return json({error:"Provider collection lookup unavailable",provider_status:r.status},503);
   if(data?.order_id!==intent.provider_order_id||data.order_currency!=="INR"||!exactMoney(data.order_amount,intent.amount)||!exactMoney(data.order_amount,order.amount))return json({error:"Provider collection evidence mismatch"},409);
   const settlement=await provider("/orders/"+cfId+"/settlements");let evidence:any={lookup_http_status:settlement.r.status,status:"UNVERIFIED"};
   if(settlement.r.ok){const clean=settlementEvidence(settlement.data);if(clean.order.order_id!==intent.provider_order_id||clean.order.order_currency!=="INR"||!exactMoney(clean.order.order_amount,intent.amount))return json({error:"Provider settlement evidence mismatch"},409);evidence=clean;}
   const {error:saveError}=await db.from("bite_provider_checks").insert({order_id:order.id,restaurant_id:order.restaurant_id,customer_id:order.customer_id,provider_order_id:intent.provider_order_id,collection_status:data.order_status,collection_amount:Number(data.order_amount),settlement_evidence:evidence,checked_by:user.id});if(saveError)return json({error:"Could not save provider verification evidence"},503);
   return json({collection:{status:data.order_status,amount:Number(data.order_amount),currency:"INR"},platform_bank_settlement:evidence,restaurant_payout:"NOT_VERIFIED_BY_PG_COLLECTION",checked_at:new Date().toISOString()});
  }
  if(job.status==="succeeded")return json({status:"succeeded",provider_status:job.provider_status});
  const path="/orders/"+cfId+"/refunds/"+encodeURIComponent(job.provider_refund_id);
  let result=await provider(path);
  if(result.r.status===404&&body.action==="execute_refund"){
   if(!(job.status==="approved"||(job.status==="processing"&&Date.now()-new Date(job.updated_at).getTime()>30000&&job.attempts<5)))return json({error:"A refund attempt already exists. Check provider status; do not create another refund."},409);
   const {data:claim,error:ce}=await db.from("bite_refund_jobs").update({status:"processing",attempts:job.attempts+1,updated_at:new Date().toISOString()}).eq("id",job.id).eq("status",job.status).eq("updated_at",job.updated_at).select("id").maybeSingle();if(ce||!claim)return json({error:"Refund already processing or unavailable"},409);
   result=await provider("/orders/"+cfId+"/refunds",{method:"POST",headers:{"x-idempotency-key":job.id},body:JSON.stringify({refund_id:job.provider_refund_id,refund_amount:Number(job.amount),refund_note:String(job.reason).slice(0,100),refund_speed:"STANDARD"})});
   // Even an accepted create response is re-read from the provider before updating financial totals.
   if(result.r.ok||result.r.status===409)result=await provider(path);
  }
  if(!result.r.ok)return json({error:"Refund status uncertain. Retry status check using the same refund reference.",provider_status:result.r.status},503);
  const cf=Array.isArray(result.data)?result.data.find((x:any)=>x.refund_id===job.provider_refund_id):result.data;
  if(!cf||cf.order_id!==intent.provider_order_id||cf.refund_id!==job.provider_refund_id||cf.refund_currency!=="INR"||!exactMoney(cf.refund_amount,job.amount))return json({error:"Provider refund evidence mismatch"},409);
  const {data:state,error:recordError}=await db.rpc("bite_record_provider_refund",{p_job_id:job.id,p_provider_refund_id:cf.refund_id,p_status:cf.refund_status,p_amount:cf.refund_amount,p_currency:cf.refund_currency});if(recordError)return json({error:"Refund evidence needs reconciliation; do not issue a second refund"},503);
  return json({status:state,provider_status:cf.refund_status,amount:Number(cf.refund_amount)});
 }catch{return json({error:"Operation unavailable or uncertain. Check the existing provider reference before retrying."},503);}
});
