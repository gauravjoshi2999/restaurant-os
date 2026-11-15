import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";

// Automatic refund processing is strictly opt-in through bite_operations_config.
// All eligibility is created by a trusted DB order transition, NEVER by a client.
// No legacy job is retroactively authorized.
const cors={"access-control-allow-origin":"https://gauravjoshi2999.github.io",
 "access-control-allow-headers":"authorization, apikey, content-type, x-client-info",
 "access-control-allow-methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{...cors,"content-type":"application/json","cache-control":"no-store"}});
const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const exactMoney=(value:unknown,expected:unknown)=>
 ((typeof value==="number"&&Number.isFinite(value))||(typeof value==="string"&&/^\d+(\.\d{1,2})?$/.test(value))) &&
 Number.isFinite(Number(expected))&&Number(expected)>0 &&
 Math.abs(Number(value)-Number(expected))<0.001;
const approvedRules=new Set(["CUSTOMER_BEFORE_ACCEPTANCE","RESTAURANT_REJECTED","OWNER_ACCEPTED_CANCELLATION"]);
const allowRefund=(job:any,order:any,intent:any,ledger:any,config:any)=>{
 if(config?.auto_refunds_enabled!==true||!job?.auto_authorized_at||!approvedRules.has(job.auto_rule)||
    !["approved","processing","submitted","succeeded"].includes(job.status))return false;
 return !!order&&!order.is_demo&&order.channel==="Own Platform"&&
  ["Cancelled","Rejected"].includes(order.status)&&order.id===job.order_id&&
  order.customer_id===job.customer_id&&order.restaurant_id===job.restaurant_id&&
  !!intent&&intent.status==="activated"&&intent.currency==="INR"&&
  intent.provider_order_id==="bite_live_"+String(intent.id).replaceAll("-","")&&
  intent.customer_id===job.customer_id&&intent.restaurant_id===job.restaurant_id&&
  exactMoney(intent.amount,job.amount)&&exactMoney(order.amount,job.amount)&&
  ledger?.payment_status==="paid"&&ledger.currency==="INR"&&
  Number(ledger.refund_amount_actual||0)===0&&exactMoney(ledger.customer_payable_amount,job.amount)&&
  Number(job.amount)>0&&Number(job.amount)<=Number(config.auto_refund_max_amount)&&
  typeof job.provider_refund_id==="string"&&/^bite_rf_[0-9a-f]{32}$/.test(job.provider_refund_id);
};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 if(Number(req.headers.get("content-length")||0)>2048)return json({error:"Request too large"},413);
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),
   service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return json({error:"Server unavailable"},503);
  const body=await req.json().catch(()=>null);
  if(!body||!["run","drain"].includes(body.action))return json({error:"Invalid action"},400);
  const auth=req.headers.get("authorization")||"";
  let actor:string|null=null;
  if(body.action==="drain"){
   const maintenanceSecret=Deno.env.get("BITE_MAINTENANCE_SECRET");
   if(!maintenanceSecret||auth!=="Bearer "+maintenanceSecret)return json({error:"Unauthorized"},401);
  }else{
   if(!auth.startsWith("Bearer "))return json({error:"Login required"},401);
   const client=createClient(url,anon,{global:{headers:{Authorization:auth}}});
   const {data:{user},error}=await client.auth.getUser();
   if(error||!user)return json({error:"Invalid session"},401);
   actor=user.id;
   if(!uuid(body.order_id))return json({error:"Invalid order"},400);
  }
  const db=createClient(url,service);
  const {data:config,error:configError}=await db.from("bite_operations_config")
    .select("auto_refunds_enabled,auto_refund_max_amount").eq("id",true).maybeSingle();
  if(configError||!config)return json({error:"Refund policy unavailable"},503);
  if(config.auto_refunds_enabled!==true)return json({status:"not_enabled",refund_sent:false});
  const key=Deno.env.get("CASHFREE_APP_ID"),secret=Deno.env.get("CASHFREE_SECRET_KEY");
  if(!key||!secret)return json({error:"Refund provider unavailable"},503);
  const headers={"content-type":"application/json","x-api-version":"2023-08-01",
   "x-client-id":key,"x-client-secret":secret};
  async function provider(path:string,options:RequestInit={}){
   const response=await fetch("https://api.cashfree.com/pg"+path,{
    ...options,headers:{...headers,...(options.headers||{})},signal:AbortSignal.timeout(9000)});
   const data=await response.json().catch(()=>null);
   return {response,data};
  }
  async function processOne(job:any){
   if(!job?.auto_authorized_at||!approvedRules.has(job.auto_rule))return "review_required";
   if(job.status==="succeeded")return "succeeded";
   const [o,i,f]=await Promise.all([
    db.from("orders").select("id,status,restaurant_id,customer_id,channel,is_demo,amount").eq("id",job.order_id).maybeSingle(),
    db.from("bite_live_checkout_intents").select("id,status,provider_order_id,currency,amount,restaurant_id,customer_id").eq("activated_order_id",job.order_id).maybeSingle(),
    db.from("order_financials").select("payment_status,currency,customer_payable_amount,refund_amount_actual").eq("order_id",job.order_id).maybeSingle()
   ]);
   if(o.error||i.error||f.error||!allowRefund(job,o.data,i.data,f.data,config))return "review_required";
   const id=encodeURIComponent(i.data.provider_order_id);
   const orderResponse=await provider("/orders/"+id);
   if(!orderResponse.response.ok)return "provider_unavailable";
   const paid=orderResponse.data;
   if(paid?.order_id!==i.data.provider_order_id||paid?.order_status!=="PAID"||
      paid?.order_currency!=="INR"||!exactMoney(paid.order_amount,job.amount))return "review_required";
   const ref=encodeURIComponent(job.provider_refund_id);
   let existing=await provider("/orders/"+id+"/refunds/"+ref);
   if(existing.response.status===404&&job.status==="approved"&&Number(job.attempts)===0){
    // Query all refunds before any POST. Any other reference requires manual review.
    const all=await provider("/orders/"+id+"/refunds");
    if(!all.response.ok||!Array.isArray(all.data))return "provider_unavailable";
    if(all.data.some((r:any)=>r?.refund_id!==job.provider_refund_id))return "review_required";
    const {data:claimed,error:claimError}=await db.rpc("bite_claim_auto_refund",{p_job_id:job.id});
    if(claimError||claimed!==true)return "already_processing";
    // This is the one and only provider creation attempt. Further retries only GET.
    const created=await provider("/orders/"+id+"/refunds",{
     method:"POST",
     headers:{"x-idempotency-key":job.id},
     body:JSON.stringify({refund_id:job.provider_refund_id,refund_amount:Number(job.amount),
      refund_note:"Bite verified cancellation",refund_speed:"STANDARD"})
    });
    if(!created.response.ok&&created.response.status!==409)return "provider_uncertain";
    existing=await provider("/orders/"+id+"/refunds/"+ref);
   }
   if(!existing.response.ok)return existing.response.status===404?"provider_uncertain":"provider_unavailable";
   const refund=existing.data;
   if(!refund||refund.order_id!==i.data.provider_order_id||
      refund.refund_id!==job.provider_refund_id||refund.refund_currency!=="INR"||
      !exactMoney(refund.refund_amount,job.amount))return "review_required";
   if(!["SUCCESS","PENDING","PENDING_APPROVAL","CANCELLED","ONHOLD","REJECTED"].includes(refund.refund_status))
    return "review_required";
   const {data:recorded,error:recordError}=await db.rpc("bite_record_provider_refund",{
    p_job_id:job.id,p_provider_refund_id:job.provider_refund_id,
    p_status:refund.refund_status,p_amount:Number(job.amount),p_currency:"INR"});
   if(recordError)return "needs_reconciliation";
   return recorded==="succeeded"?"succeeded":recorded==="submitted"?"processing":"review_required";
  }
  let jobs:any[]=[];
  if(body.action==="run"){
   const {data:order,error:ownerError}=await db.from("orders")
    .select("id,customer_id").eq("id",body.order_id).maybeSingle();
   if(ownerError)return json({error:"Order lookup unavailable"},503);
   if(!order||order.customer_id!==actor)return json({error:"Order not found"},404);
   const {data:job,error}=await db.from("bite_refund_jobs")
    .select("id,order_id,status,auto_authorized_at,auto_rule,amount,provider_refund_id,attempts,restaurant_id,customer_id")
    .eq("order_id",body.order_id).maybeSingle();
   if(error)return json({error:"Refund status unavailable"},503);
   if(job)jobs=[job];
  }else{
   const {data,error}=await db.from("bite_refund_jobs")
    .select("id,order_id,status,auto_authorized_at,auto_rule,amount,provider_refund_id,attempts,restaurant_id,customer_id")
    .not("auto_authorized_at","is",null).in("status",["approved","processing","submitted"])
    .order("created_at",{ascending:true}).limit(10);
   if(error)return json({error:"Refund queue unavailable"},503);
   jobs=data||[];
  }
  const counts:Record<string,number>={};
  for(const job of jobs){
   let result="provider_uncertain";
   try{result=await processOne(job)}catch{result="provider_uncertain";}
   counts[result]=(counts[result]||0)+1;
  }
  if(body.action==="run")return json({status:jobs.length?Object.keys(counts)[0]:"no_refund_job",
   refund_sent:!!counts.processing||!!counts.succeeded});
  return json({status:"checked",jobs:jobs.length,outcomes:counts});
 }catch{return json({error:"Automatic refund check unavailable; original refund reference is retained"},503);}
});
