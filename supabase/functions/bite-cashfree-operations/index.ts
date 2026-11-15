import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";
import {parseCashfreeSplit} from "./split-evidence.mjs";
import {compareProviderVendorBank} from "./vendor-bank-match.mjs";
import {parseVendorSettlementRecon} from "./vendor-settlement-recon.mjs";
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
  if(!["reconcile","inspect_split","inspect_vendor","inspect_vendor_recon","inspect_refund","execute_refund","check_refund"].includes(body?.action))return json({error:"Invalid action"},400);
  if(body.action==="execute_refund"&&(Deno.env.get("BITE_PROVIDER_REFUNDS_ENABLED")!=="true"||body.confirm!=="EXECUTE APPROVED REFUND"))return json({error:"Real refunds require explicit rollout approval and confirmation"},409);
  const app=Deno.env.get("CASHFREE_APP_ID"),secret=Deno.env.get("CASHFREE_SECRET_KEY");if(!app||!secret)return json({error:"Provider not configured"},503);
  const db=createClient(url,service),headers={"content-type":"application/json","x-api-version":"2023-08-01","x-client-id":app,"x-client-secret":secret};
  async function provider(path:string,options:any={}){const r=await fetch("https://api.cashfree.com/pg"+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(12000)});const data=await r.json().catch(()=>null);return{r,data};}
  const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
  let job:any=null,orderId=body.order_id;
  if(!["reconcile","inspect_split","inspect_vendor","inspect_vendor_recon"].includes(body.action)){
   if(!uuid(body.refund_id))return json({error:"Invalid refund ID"},400);
   const {data,error}=await db.from("bite_refund_jobs").select("*").eq("id",body.refund_id).maybeSingle();if(error)return json({error:"Refund database unavailable"},503);job=data;
   if(!job)return json({error:"Refund not found"},404);
   // Provider inspection is intentionally allowed BEFORE approval, since a
   // preexisting Cashfree refund must be detected before any new payout decision.
   // Every existing check_refund / execute_refund approval guard is unchanged.
   if(body.action!=="inspect_refund"&&
      (!job.approved_by||!job.approved_at||["pending_approval","rejected"].includes(job.status)))
    return json({error:"Approved refund not found"},409);
   orderId=job.order_id;
  }
  if(!uuid(orderId))return json({error:"Invalid order ID"},400);
  const {data:order,error:oe}=await db.from("orders").select("id,restaurant_id,customer_id,amount,is_demo,channel").eq("id",orderId).maybeSingle();if(oe)return json({error:"Order database unavailable"},503);if(!order||order.is_demo||order.channel!=="Own Platform")return json({error:"Live marketplace order not found"},404);
  const {data:intent,error:ie}=await db.from("bite_live_checkout_intents").select("id,amount,currency,provider_order_id,status").eq("activated_order_id",order.id).maybeSingle();if(ie)return json({error:"Payment database unavailable"},503);if(!intent||intent.status!=="activated"||intent.currency!=="INR"||intent.provider_order_id!=="bite_live_"+intent.id.replaceAll("-",""))return json({error:"Trusted payment reference missing"},409);
  const cfId=encodeURIComponent(intent.provider_order_id);
  if(body.action==="inspect_refund"){
   // Provider-only GET. Does NOT approve a refund, create a transfer, update
   // Bite's ledger, or infer a restaurant-bank payout. A synthetic provider
   // refund reference may exist before anyone has issued a provider refund.
   if(!job||job.restaurant_id!==order.restaurant_id||job.customer_id!==order.customer_id)
    return json({error:"Refund is not linked to this customer and restaurant"},409);
   if(typeof job.provider_refund_id!=="string"||
      !/^[A-Za-z0-9_-]{1,80}$/.test(job.provider_refund_id)||
      !Number.isFinite(Number(job.amount))||Number(job.amount)<=0||
      Number(job.amount)>Number(intent.amount))
    return json({error:"Refund amount or provider reference invalid"},409);
   const {data:financial,error:fe}=await db.from("order_financials")
    .select("payment_status,customer_payable_amount")
    .eq("order_id",order.id).maybeSingle();
   if(fe)return json({error:"Payment record unavailable"},503);
   if(financial?.payment_status!=="paid"||
      !exactMoney(financial.customer_payable_amount,intent.amount))
    return json({error:"Paid order amount has not been independently matched"},409);
   const collection=await provider("/orders/"+cfId);
   if(!collection.r.ok)return json({error:"Cashfree collection lookup unavailable",provider_status:collection.r.status},503);
   if(collection.data?.order_id!==intent.provider_order_id||
      collection.data?.order_currency!=="INR"||
      collection.data?.order_status!=="PAID"||
      !exactMoney(collection.data.order_amount,intent.amount)||
      !exactMoney(collection.data.order_amount,order.amount))
    return json({error:"Provider PAID order evidence mismatched"},409);
   const record=await provider("/orders/"+cfId+"/refunds/"+
    encodeURIComponent(job.provider_refund_id));
   if(record.r.status===404)return json({status:"NO_PROVIDER_REFUND_RECORD",
    provider_refund_status:null,recorded_refund_status:job.status,
    amount:Number(job.amount),approved:!!(job.approved_by&&job.approved_at),
    no_action_taken:true,warning:"No refund record was found. Do not infer approval or automatically initiate a refund."});
   if(!record.r.ok)return json({error:"Provider refund lookup unavailable",provider_status:record.r.status},503);
   const cf=Array.isArray(record.data)?
    record.data.find((x:any)=>x?.refund_id===job.provider_refund_id):record.data;
   if(!cf||cf.order_id!==intent.provider_order_id||
      cf.refund_id!==job.provider_refund_id||
      cf.refund_currency!=="INR"||
      !exactMoney(cf.refund_amount,job.amount))
    return json({error:"Provider refund evidence mismatched"},409);
   const status=typeof cf.refund_status==="string"&&
     /^[A-Z][A-Z0-9_]{0,39}$/.test(cf.refund_status)?cf.refund_status:"UNKNOWN";
   return json({status:"PROVIDER_REFUND_RECORD_FOUND",
    provider_refund_status:status,recorded_refund_status:job.status,
    amount:Number(job.amount),approved:!!(job.approved_by&&job.approved_at),
    no_action_taken:true,
    warning:"Provider status is read-only evidence. No refund is approved, created, retried or bank-confirmed."});
  }
  if(body.action==="inspect_split"){
   // Only verified, activated Bite orders can be looked up. Never accept a
   // client-supplied Cashfree order ID or vendor ID for this admin-only request.
   const collection=await provider("/orders/"+cfId);
   if(!collection.r.ok)return json({error:"Provider collection lookup unavailable",provider_status:collection.r.status},503);
   if(collection.data?.order_id!==intent.provider_order_id||
      collection.data?.order_currency!=="INR"||
      collection.data?.order_status!=="PAID"||
      !exactMoney(collection.data.order_amount,intent.amount)||
      !exactMoney(collection.data.order_amount,order.amount))
    return json({error:"Trusted paid collection has not been verified"},409);
   // Cashfree's documented GET Easy Split API is read-only. It does not
   // create a vendor, split instruction, refund, transfer or bank payout.
   const split=await provider("/easy-split/orders/"+cfId,{headers:{"x-api-version":"2026-01-01"}});
   if(split.r.status===404)return json({split:{status:"NOT_FOUND",vendor_count:0,vendors:[],vendor_mapping:"NOT_VERIFIED",bank_payout:"NOT_VERIFIED"},restaurant_payout:"NOT_VERIFIED"});
   if(!split.r.ok)return json({error:"Easy Split provider lookup unavailable",provider_status:split.r.status},503);
   let evidence;
   try{evidence=parseCashfreeSplit(split.data,{orderId:intent.provider_order_id,orderAmount:intent.amount,currency:"INR"});}
   catch{return json({error:"Easy Split provider response mismatched or unsafe"},409);}
   return json({split:evidence,restaurant_payout:"NOT_VERIFIED",bank_credit:"NOT_VERIFIED",
    note:"Cashfree vendor references are not a restaurant bank confirmation. Verify vendor KYC, mapping and UTR independently."});
  }
  if(body.action==="inspect_vendor"){
   // A vendor ID supplied by an admin is only a *candidate*, never a payout
   // destination. Bind it afresh to this activated, PAID provider order.
   const candidate=body.vendor_id;
   if(typeof candidate!=="string"||!/^[A-Za-z0-9_-]{1,80}$/.test(candidate))
    return json({error:"Invalid Cashfree vendor ID"},400);
   const collection=await provider("/orders/"+cfId);
   if(!collection.r.ok)return json({error:"Provider collection lookup unavailable",provider_status:collection.r.status},503);
   if(collection.data?.order_id!==intent.provider_order_id||
      collection.data?.order_currency!=="INR"||
      collection.data?.order_status!=="PAID"||
      !exactMoney(collection.data.order_amount,intent.amount)||
      !exactMoney(collection.data.order_amount,order.amount))
    return json({error:"Trusted paid collection is not verified"},409);
   const split=await provider("/easy-split/orders/"+cfId,{headers:{"x-api-version":"2026-01-01"}});
   if(!split.r.ok)return json({error:"Verified order split details unavailable",provider_status:split.r.status},503);
   let splitEvidence;
   try{splitEvidence=parseCashfreeSplit(split.data,{orderId:intent.provider_order_id,
    orderAmount:intent.amount,currency:"INR"});}
   catch{return json({error:"Provider split evidence mismatch"},409);}
   if(!splitEvidence.vendors.some((v:any)=>v.vendor_id===candidate))
    return json({error:"Vendor ID is not in this paid order split. Do not map this restaurant."},409);
   const vendor=await provider("/easy-split/vendors/"+encodeURIComponent(candidate),
    {headers:{"x-api-version":"2026-01-01"}});
   if(!vendor.r.ok)return json({error:"Cashfree vendor details unavailable",provider_status:vendor.r.status},503);
   // Only a service-side comparison with the already-entered restaurant bank
   // profile is permitted. Never send the provider's bank details to a client.
   const {data:profile,error:pe}=await db.from("restaurant_payout_profiles")
    .select("restaurant_id,account_number,ifsc_code")
    .eq("restaurant_id",order.restaurant_id).maybeSingle();
   if(pe)return json({error:"Restaurant payout profile comparison unavailable"},503);
   let comparison;
   try{comparison=compareProviderVendorBank(vendor.data,profile,candidate);}
   catch{return json({error:"Provider vendor reference mismatch"},409);}
   return json({provider_vendor:comparison,split_order_checked:true,
    restaurant_payout:"NOT_VERIFIED",bank_credit:"NOT_VERIFIED",
    warning:"Matching bank settings do not verify KYC, beneficiary authorization or actual settlement."});
  }
  if(body.action==="inspect_vendor_recon"){
   // POST /split/order/vendor/recon is a reporting-only Cashfree API.
   // Do NOT accept arbitrary order references, provider payout instructions,
   // vendor bank details or merchant credentials from the browser.
   const candidate=body.vendor_id,bankUtr=body.bank_statement_utr??null;
   if(typeof candidate!=="string"||!/^[A-Za-z0-9_-]{1,80}$/.test(candidate))
    return json({error:"Invalid Cashfree vendor ID"},400);
   if(bankUtr!==null&&(typeof bankUtr!=="string"||!/^[A-Za-z0-9]{6,48}$/.test(bankUtr.trim())))
    return json({error:"Invalid bank statement UTR"},400);
   const collection=await provider("/orders/"+cfId);
   if(!collection.r.ok)return json({error:"Cashfree collection lookup unavailable",provider_status:collection.r.status},503);
   if(collection.data?.order_id!==intent.provider_order_id||
      collection.data?.order_currency!=="INR"||collection.data?.order_status!=="PAID"||
      !exactMoney(collection.data.order_amount,intent.amount)||
      !exactMoney(collection.data.order_amount,order.amount))
    return json({error:"Trusted Cashfree PAID order mismatch"},409);
   const split=await provider("/easy-split/orders/"+cfId,{headers:{"x-api-version":"2026-01-01"}});
   if(!split.r.ok)return json({error:"Cashfree split lookup unavailable",provider_status:split.r.status},503);
   let parsedSplit;
   try{parsedSplit=parseCashfreeSplit(split.data,{orderId:intent.provider_order_id,
    orderAmount:intent.amount,currency:"INR"});}
   catch{return json({error:"Cashfree order split does not match this paid order"},409);}
   const expectedVendor=parsedSplit.vendors.find((v:any)=>v.vendor_id===candidate);
   if(!expectedVendor)return json({error:"Vendor not in this verified paid order split"},409);
   // Before displaying a vendor's settlement history, re-validate the intended
   // restaurant bank destination server-side and fail closed on mismatch.
   const vendor=await provider("/easy-split/vendors/"+encodeURIComponent(candidate),
    {headers:{"x-api-version":"2026-01-01"}});
   if(!vendor.r.ok)return json({error:"Cashfree vendor details unavailable",provider_status:vendor.r.status},503);
   const {data:profile,error:pe}=await db.from("restaurant_payout_profiles")
    .select("restaurant_id,account_number,ifsc_code")
    .eq("restaurant_id",order.restaurant_id).maybeSingle();
   if(pe)return json({error:"Restaurant payout profile comparison unavailable"},503);
   let comparison;
   try{comparison=compareProviderVendorBank(vendor.data,profile,candidate);}
   catch{return json({error:"Cashfree vendor reference mismatch"},409);}
   if(comparison.bank_details_comparison!=="MATCH")
    return json({error:"Vendor bank does not match restaurant profile. STOP payout reconciliation.",bank_match:comparison.bank_details_comparison},409);
   // The method is POST but this exact route is documented as a *read-only*
   // reconciliation report, not an on-demand transfer or split creation.
   const recon=await provider("/split/order/vendor/recon",{
    method:"POST",headers:{"x-api-version":"2026-01-01"},
    body:JSON.stringify({
     pagination:{limit:50,cursor:null},
     filters:{start_date:null,end_date:null,order_ids:[intent.provider_order_id]}
    })
   });
   if(!recon.r.ok)return json({error:"Cashfree vendor recon report unavailable",provider_status:recon.r.status},503);
   let result;
   try{result=parseVendorSettlementRecon(recon.data,{
    orderId:intent.provider_order_id,vendorId:candidate,
    splitAmount:expectedVendor.amount,bankStatementUtr:bankUtr});}
   catch{return json({error:"Unsafe or inconsistent vendor settlement report"},409);}
   return json({vendor_reconciliation:result,bank_settings_match:"MATCH",
    restaurant_payout:"NOT_INDEPENDENTLY_VERIFIED",bank_credit:"NOT_INDEPENDENTLY_VERIFIED",
    warning:"Cashfree-reported settled status and an operator-entered UTR match are not independently verified restaurant bank credits."});
  }
  if(body.action==="reconcile"){
   const {r,data}=await provider("/orders/"+cfId);if(!r.ok)return json({error:"Provider collection lookup unavailable",provider_status:r.status},503);
   if(data?.order_id!==intent.provider_order_id||data.order_currency!=="INR"||!exactMoney(data.order_amount,intent.amount)||!exactMoney(data.order_amount,order.amount))return json({error:"Provider collection evidence mismatch"},409);
   const settlement=await provider("/orders/"+cfId+"/settlements");let evidence:any={lookup_http_status:settlement.r.status,status:"UNVERIFIED"};
   if(settlement.r.ok){const clean=settlementEvidence(settlement.data);if(clean.order.order_id!==intent.provider_order_id||clean.order.order_currency!=="INR"||!exactMoney(clean.order.order_amount,intent.amount))return json({error:"Provider settlement evidence mismatch"},409);evidence=clean;}
   const {error:saveError}=await db.from("bite_provider_checks").insert({order_id:order.id,restaurant_id:order.restaurant_id,customer_id:order.customer_id,provider_order_id:intent.provider_order_id,collection_status:data.order_status,collection_amount:Number(data.order_amount),settlement_evidence:evidence,checked_by:user.id});if(saveError)return json({error:"Could not save provider verification evidence"},503);
   return json({collection:{status:data.order_status,amount:Number(data.order_amount),currency:"INR"},platform_bank_settlement:evidence,restaurant_payout:"NOT_VERIFIED_BY_PG_COLLECTION",checked_at:new Date().toISOString()});
  }
  if(job.status==="succeeded")return json({status:"succeeded",provider_status:job.provider_status});
  if(body.action==="execute_refund"){
   // Manual live pilot is one-shot, just like trusted automatic refunds.
   // A timeout/uncertain previous POST may only be reconciled via GET.
   if(job.status!=="approved"||Number(job.attempts)!==0)
    return json({error:"Refund already attempted. Use read-only status check; no additional refund request will be sent."},409);
   if(job.restaurant_id!==order.restaurant_id||job.customer_id!==order.customer_id||
      !Number.isFinite(Number(job.amount))||Number(job.amount)<=0||
      Number(job.amount)>Number(intent.amount))
    return json({error:"Refund beneficiary or amount mismatch. No refund sent."},409);
   const {data:financial,error:fe}=await db.from("order_financials")
    .select("payment_status,currency,customer_payable_amount,refund_amount_actual")
    .eq("order_id",order.id).maybeSingle();
   if(fe||!financial||financial.payment_status!=="paid"||financial.currency!=="INR"||
      !exactMoney(financial.customer_payable_amount,intent.amount)||
      !exactMoney(order.amount,intent.amount)||
      Number(financial.refund_amount_actual||0)!==0)
    return json({error:"Trusted paid-order ledger mismatch. No refund sent."},409);
   const fresh=await provider("/orders/"+cfId);
   if(!fresh.r.ok)return json({error:"Cashfree PAID verification unavailable. No refund sent."},503);
   if(fresh.data?.order_id!==intent.provider_order_id||
      fresh.data?.order_currency!=="INR"||
      fresh.data?.order_status!=="PAID"||
      !exactMoney(fresh.data.order_amount,intent.amount))
    return json({error:"Cashfree PAID verification mismatch. No refund sent."},409);
  }
  const path="/orders/"+cfId+"/refunds/"+encodeURIComponent(job.provider_refund_id);
  let result=await provider(path);
  if(result.r.status===404&&body.action==="execute_refund"){
   // A missing exact reference does not prove that another refund wasn't
   // issued. Stop on any competing provider refund, including pending ones.
   const existingRefunds=await provider("/orders/"+cfId+"/refunds");
   if(!existingRefunds.r.ok||!Array.isArray(existingRefunds.data))
    return json({error:"Cashfree refund list unavailable. No refund sent."},503);
   if(existingRefunds.data.length!==0)
    return json({error:"Cashfree already has refund records for this order. No new refund sent."},409);
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
