import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";

// Automatic refund processing is strictly opt-in through bite_operations_config.
// All eligibility is created by a trusted DB order transition, NEVER by a client.
// No legacy job is retroactively authorized.
const cors={"access-control-allow-origin":"https://gauravjoshi2999.github.io",
 "access-control-allow-headers":"authorization, apikey, content-type, x-client-info, x-supabase-api-version",
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
  if(!body||!["run","drain","preflight"].includes(body.action))return json({error:"Invalid action"},400);
  // Signed diagnostic is read-only and valid even while the refund rollout is
  // OFF. This is not available through the customer's authenticated "run".
  if(body.mode!==undefined&&!(body.action==="drain"&&["preflight","reconcile"].includes(body.mode)))
   return json({error:"Invalid mode"},400);
  const auth=req.headers.get("authorization")||"";
  const db=createClient(url,service);
  let actor:string|null=null;
  if(body.action==="drain"){
   // Optional maintenance secret; the default self-contained scheduler uses
   // a 90-second Vault HMAC signature checked by a service-only database RPC.
   const maintenanceSecret=Deno.env.get("BITE_MAINTENANCE_SECRET");
   let trusted=!!maintenanceSecret&&auth==="Bearer "+maintenanceSecret;
   if(!trusted){
    const stamp=req.headers.get("x-bite-auto-refund-ts")||"";
    const signature=req.headers.get("x-bite-auto-refund-signature")||"";
    if(/^\d{10}$/.test(stamp)&&/^[a-f0-9]{64}$/.test(signature)){
     const result=await db.rpc("bite_verify_auto_refund_dispatch",{
      p_timestamp:Number(stamp),p_signature:signature});
     trusted=!result.error&&result.data===true;
    }
   }
   if(!trusted)return json({error:"Unauthorized"},401);
  }else{
   if(!auth.startsWith("Bearer "))return json({error:"Login required"},401);
   const client=createClient(url,anon,{global:{headers:{Authorization:auth}}});
   const {data:{user},error}=await client.auth.getUser();
   if(error||!user)return json({error:"Invalid session"},401);
   actor=user.id;
   if(!uuid(body.order_id))return json({error:"Invalid order"},400);
   if(body.action==="preflight"){
    // Only a genuine Super Admin session can request provider-only diagnostics.
    // Normal customers cannot use the signed scheduled service path.
    const {data:admin,error:roleError}=await client.rpc("is_platform_admin");
    if(roleError||admin!==true)return json({error:"Super Admin required"},403);
   }
  }
  const {data:config,error:configError}=await db.from("bite_operations_config")
    .select("auto_refunds_enabled,auto_refund_max_amount").eq("id",true).maybeSingle();
  if(configError||!config)return json({error:"Refund policy unavailable"},503);
  // Independent status sync for an already-issued Cashfree refund. This route
  // uses the existing Vault-signed scheduler authentication, but deliberately
  // ignores the money-issuance switch: only provider GETs and the narrowly
  // granted bite_record_verified_refund_observation RPC are permitted.
  // It never calls processOne(), claim_auto_refund or POST /orders/.../refunds.
  if(body.action==="drain"&&body.mode==="reconcile"){
   const app=Deno.env.get("CASHFREE_APP_ID"),providerSecret=Deno.env.get("CASHFREE_SECRET_KEY");
   if(!app||!providerSecret)return json({error:"Provider status lookup unavailable",refund_sent:false},503);
   const {data:jobs,error:queueError}=await db.from("bite_refund_jobs")
    .select("id,order_id,restaurant_id,customer_id,amount,provider_refund_id,status,attempts")
    .in("status",["pending_approval","approved","processing","submitted","failed","rejected"])
    .not("provider_refund_id","is",null)
    .gte("created_at",new Date(Date.now()-90*86400000).toISOString())
    .order("created_at",{ascending:false}).limit(6);
   if(queueError)return json({error:"Refund status queue unavailable",refund_sent:false},503);
   const stats={examined:0,observed:0,verified_not_initiated:0,missing_exact_refund:0,unresolved:0};
   const allowed=new Set(["SUCCESS","PENDING","PENDING_APPROVAL","CANCELLED","ONHOLD","FAILED","REJECTED"]);
   async function inspectOne(job:any){
    stats.examined++;
    try{
     if(!uuid(job?.id)||!uuid(job?.order_id)||!uuid(job?.restaurant_id)||!uuid(job?.customer_id)||
        typeof job.provider_refund_id!=="string"||
        !/^[A-Za-z0-9_-]{1,80}$/.test(job.provider_refund_id)||
        !Number.isFinite(Number(job.amount))||Number(job.amount)<=0)return "unresolved";
     const [o,i,f]=await Promise.all([
      db.from("orders").select("id,restaurant_id,customer_id,amount,channel,is_demo")
       .eq("id",job.order_id).maybeSingle(),
      db.from("bite_live_checkout_intents")
       .select("id,activated_order_id,restaurant_id,customer_id,amount,currency,status,provider_order_id")
       .eq("activated_order_id",job.order_id).maybeSingle(),
      db.from("order_financials")
       .select("order_id,restaurant_id,customer_payable_amount,currency,payment_status")
       .eq("order_id",job.order_id).maybeSingle()
     ]);
     if(o.error||i.error||f.error)return "unresolved";
     const order=o.data,intent=i.data,fin=f.data;
     if(!order||!intent||!fin||order.id!==job.order_id||
        order.channel!=="Own Platform"||order.is_demo===true||
        order.restaurant_id!==job.restaurant_id||order.customer_id!==job.customer_id||
        intent.activated_order_id!==job.order_id||
        intent.restaurant_id!==job.restaurant_id||intent.customer_id!==job.customer_id||
        intent.status!=="activated"||intent.currency!=="INR"||!uuid(intent.id)||
        intent.provider_order_id!=="bite_live_"+intent.id.replaceAll("-","")||
        fin.order_id!==job.order_id||fin.restaurant_id!==job.restaurant_id||
        fin.currency!=="INR"||
        !["paid","partially_refunded","refunded"].includes(fin.payment_status)||
        !exactMoney(order.amount,intent.amount)||
        !exactMoney(fin.customer_payable_amount,intent.amount)||
        Number(job.amount)>Number(intent.amount))return "unresolved";
     const headers={"x-api-version":"2023-08-01","x-client-id":app,"x-client-secret":providerSecret};
     const get=async(path:string)=>{
      const r=await fetch("https://api.cashfree.com/pg"+path,{method:"GET",
       headers,signal:AbortSignal.timeout(9000)});
      return {status:r.status,ok:r.ok,data:r.ok?await r.json():null};
     };
     const id=encodeURIComponent(intent.provider_order_id);
     const payment=await get("/orders/"+id);
     if(!payment.ok||payment.data?.order_id!==intent.provider_order_id||
        payment.data?.order_status!=="PAID"||payment.data?.order_currency!=="INR"||
        !exactMoney(payment.data?.order_amount,intent.amount))return "unresolved";
     const refund=await get("/orders/"+id+"/refunds/"+encodeURIComponent(job.provider_refund_id));
     if(refund.status===404){
      // Exact-refund 404 alone does NOT mean no refund happened: it could
      // exist with another reference. Only a verified empty provider list
      // proves that no refund has yet been initiated for this order.
      // Don't claim absence after an uncertain prior POST attempt.
      const all=await get("/orders/"+id+"/refunds");
      if(!all.ok||!Array.isArray(all.data))return "unresolved";
      if(all.data.length!==0)return "missing";
      if(Number(job.attempts)!==0)return "unresolved";
      const noRefund=await db.rpc("bite_record_verified_refund_observation",{
       p_job_id:job.id,p_provider_refund_id:job.provider_refund_id,
       p_status:"NOT_INITIATED",p_amount:Number(job.amount),p_currency:"INR"
      });
      if(noRefund.error||!["pending_approval","approved","processing","submitted","failed","rejected"].includes(noRefund.data))
       return "unresolved";
      return "not_initiated";
     }
     if(!refund.ok)return "unresolved";
     const record=Array.isArray(refund.data)?
      refund.data.find((x:any)=>x?.refund_id===job.provider_refund_id):refund.data;
     if(!record||record.order_id!==intent.provider_order_id||
        record.refund_id!==job.provider_refund_id||
        record.refund_currency!=="INR"||
        !exactMoney(record.refund_amount,job.amount)||
        !allowed.has(record.refund_status))return "unresolved";
     const result=await db.rpc("bite_record_verified_refund_observation",{
      p_job_id:job.id,p_provider_refund_id:job.provider_refund_id,
      p_status:record.refund_status,p_amount:Number(job.amount),p_currency:"INR"
     });
     if(result.error||!["succeeded","submitted","failed","pending_approval","approved","rejected"].includes(result.data))
      return "unresolved";
     return "observed";
    }catch{return "unresolved";}
   }
   for(let offset=0;offset<(jobs||[]).length;offset+=2){
    const results=await Promise.all(jobs.slice(offset,offset+2).map(inspectOne));
    for(const result of results){
     if(result==="observed")stats.observed++;
     else if(result==="not_initiated")stats.verified_not_initiated++;
     else if(result==="missing")stats.missing_exact_refund++;
     else stats.unresolved++;
    }
   }
   // Aggregate-only diagnostics: never expose customer/order IDs or credentials.
   return json({status:"refund_status_checked",...stats,refund_sent:false,
    provider_bank_credit_independently_verified:false});
  }
  // Do not contact Cashfree unless the switch is enabled OR this is a
  // separately authenticated, explicitly read-only production preflight.
  const preflight=body.action==="preflight"||(body.action==="drain"&&body.mode==="preflight");
  if(!preflight&&config.auto_refunds_enabled!==true)
   return json({status:"not_enabled",refund_sent:false});
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
  if(preflight){
   if(!uuid(body.order_id))return json({error:"Invalid order"},400);
   // This branch only performs SELECT and Cashfree GET. In particular, it
   // NEVER claims a job or calls POST /refunds, even when rollout is ON.
   const [o,i,f,j]=await Promise.all([
    db.from("orders").select("id,status,restaurant_id,customer_id,channel,is_demo,amount")
     .eq("id",body.order_id).maybeSingle(),
    db.from("bite_live_checkout_intents")
     .select("id,status,provider_order_id,currency,amount,restaurant_id,customer_id")
     .eq("activated_order_id",body.order_id).maybeSingle(),
    db.from("order_financials").select("payment_status,currency,customer_payable_amount,refund_amount_actual")
     .eq("order_id",body.order_id).maybeSingle(),
    db.from("bite_refund_jobs")
     .select("order_id,status,amount,provider_refund_id,restaurant_id,customer_id")
     .eq("order_id",body.order_id).maybeSingle()
   ]);
   if(o.error||i.error||f.error||j.error)return json({status:"preflight",result:"DB_UNAVAILABLE",refund_sent:false},503);
   const order=o.data,intent=i.data,ledger=f.data,job=j.data;
   const valid=!!order&&!order.is_demo&&order.channel==="Own Platform"&&
    ["Cancelled","Rejected"].includes(order.status)&&
    !!intent&&intent.status==="activated"&&intent.currency==="INR"&&
    intent.provider_order_id==="bite_live_"+String(intent.id).replaceAll("-","")&&
    intent.customer_id===order.customer_id&&intent.restaurant_id===order.restaurant_id&&
    !!ledger&&ledger.payment_status==="paid"&&ledger.currency==="INR"&&
    Number(ledger.refund_amount_actual||0)===0&&
    !!job&&job.order_id===order.id&&job.customer_id===order.customer_id&&
    job.restaurant_id===order.restaurant_id&&
    exactMoney(intent.amount,order.amount)&&
    exactMoney(ledger.customer_payable_amount,order.amount)&&
    exactMoney(job.amount,order.amount)&&
    typeof job.provider_refund_id==="string"&&
    /^bite_rf_[0-9a-f]{32}$/.test(job.provider_refund_id);
   if(!valid)return json({status:"preflight",result:"INTERNAL_MISMATCH_OR_INELIGIBLE",refund_sent:false});
   const id=encodeURIComponent(intent.provider_order_id);
   const p=await provider("/orders/"+id);
   if(!p.response.ok)return json({status:"preflight",result:"PROVIDER_LOOKUP_UNAVAILABLE",
    provider_http_status:p.response.status,refund_sent:false});
   if(p.data?.order_id!==intent.provider_order_id||p.data?.order_status!=="PAID"||
      p.data?.order_currency!=="INR"||!exactMoney(p.data?.order_amount,order.amount))
    return json({status:"preflight",result:"CASHFREE_PAYMENT_MISMATCH",
     provider_payment_status:typeof p.data?.order_status==="string"?p.data.order_status.slice(0,24):"UNKNOWN",
     refund_sent:false});
   const all=await provider("/orders/"+id+"/refunds");
   if(!all.response.ok||!Array.isArray(all.data))
    return json({status:"preflight",result:"REFUND_LOOKUP_UNAVAILABLE",
     provider_http_status:all.response.status,refund_sent:false});
   const matching=all.data.find((r:any)=>r?.refund_id===job.provider_refund_id);
   const refundMatch=!matching||(matching.order_id===intent.provider_order_id&&
     matching.refund_currency==="INR"&&exactMoney(matching.refund_amount,job.amount));
   return json({status:"preflight",result:!refundMatch?"REFUND_EVIDENCE_MISMATCH":
    all.data.length?"EXISTING_REFUND_RECORD":"PAID_MATCHES_NO_REFUND",
    existing_refund_count:all.data.length,
    existing_refund_status:matching&&typeof matching.refund_status==="string"?
     matching.refund_status.slice(0,24):null,
    refund_sent:false,refund_created:false,
    live_refunds_enabled:config.auto_refunds_enabled===true});
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
    if(all.data.length!==0)return "review_required"; // Never POST while any refund exists, even if exact lookup is lagging.
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
    .order("created_at",{ascending:true}).limit(2);
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
