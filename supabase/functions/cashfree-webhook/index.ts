import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const enc=new TextEncoder();
function safeEqual(a:string,b:string){const x=enc.encode(a),y=enc.encode(b);if(x.length!==y.length)return false;let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0}
Deno.serve(async req=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const secret=Deno.env.get("CASHFREE_SECRET_KEY"),appId=Deno.env.get("CASHFREE_APP_ID");
 if(!secret||!appId)return json({error:"Provider not configured"},503);
 const signature=req.headers.get("x-webhook-signature")||"",stamp=req.headers.get("x-webhook-timestamp")||"";
 if(!signature||!/^\d{10,13}$/.test(stamp))return json({error:"Missing signature"},401);
 const time=Number(stamp);const ms=stamp.length===10?time*1000:time;
 if(!Number.isFinite(ms)||Math.abs(Date.now()-ms)>10*60*1000)return json({error:"Expired webhook"},401);
 const raw=await req.text();if(raw.length>100000)return json({error:"Too large"},413);
 const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(stamp+raw)));
 const expected=btoa(String.fromCharCode(...digest));
 if(!safeEqual(expected,signature))return json({error:"Invalid signature"},401);
 let event;try{event=JSON.parse(raw)}catch{return json({error:"Invalid JSON"},400)}
 if(event?.type!=="PAYMENT_SUCCESS_WEBHOOK")return json({ok:true,ignored:true});
 const cfId=String(event?.data?.order?.order_id||"");
 if(/^bite_live_[0-9a-f]{32}$/i.test(cfId)){
 const id=cfId.slice(10).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,"$1-$2-$3-$4-$5");
 const url=Deno.env.get("SUPABASE_URL")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const db=createClient(url,service);
 const {data:intent,error:ie}=await db.from("bite_live_checkout_intents").select("id,status,amount,currency,provider_order_id,activated_order_id").eq("id",id).maybeSingle();
 if(ie)return json({error:"Database unavailable"},503);
 if(!intent||intent.provider_order_id!==cfId)return json({ok:true,ignored:true});
 if(intent.status==="activated")return json({ok:true,already_activated:true});
 const provider=await fetch("https://api.cashfree.com/pg/orders/"+encodeURIComponent(cfId),{headers:{"x-api-version":"2023-08-01","x-client-id":appId,"x-client-secret":secret},signal:AbortSignal.timeout(12000)}).catch(()=>null);
 if(!provider||!provider.ok)return json({error:"Provider verification unavailable"},503);
 const verified=await provider.json();
 if(verified.order_id!==cfId||verified.order_status!=="PAID"||verified.order_currency!=="INR"||intent.currency!=="INR"||!Number.isFinite(Number(verified.order_amount))||!Number.isFinite(Number(intent.amount))||Math.abs(Number(verified.order_amount)-Number(intent.amount))>0.001)return json({error:"Payment not verified"},409);
 if(intent.status==="awaiting_payment"){
 const {error:ue}=await db.from("bite_live_checkout_intents").update({status:"payment_verified",updated_at:new Date().toISOString()}).eq("id",id).eq("status","awaiting_payment");
 if(ue)return json({error:"Verification update failed"},503);
 }
 const {data:orderId,error:fe}=await db.rpc("bite_finalize_verified_live_checkout",{p_intent_id:id});
 if(fe)return json({error:"Payment verified; activation requires reconciliation"},503);
 return json({ok:true,verified:true,order_id:orderId});
 }
 if(!/^bite_[0-9a-f]{32}$/i.test(cfId))return json({ok:true,ignored:true});
 const id=cfId.slice(5).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,"$1-$2-$3-$4-$5");
 const url=Deno.env.get("SUPABASE_URL")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const db=createClient(url,service);
 const {data:order,error:oe}=await db.from("orders").select("id,is_demo,status").eq("id",id).maybeSingle();
 const {data:financial,error:fe}=await db.from("order_financials").select("id,customer_payable_amount,payment_status,currency,is_demo").eq("order_id",id).maybeSingle();
 if(oe||fe)return json({error:"Database unavailable"},503);
 if(!order||!financial||order.is_demo||financial.is_demo)return json({ok:true,ignored:true});
 if(["Cancelled","Rejected"].includes(String(order.status)))return json({error:"Order cancelled or rejected; requires refund reconciliation"},409);
 const res=await fetch("https://api.cashfree.com/pg/orders/"+encodeURIComponent(cfId),{headers:{"x-api-version":"2023-08-01","x-client-id":appId,"x-client-secret":secret}});
 if(!res.ok)return json({error:"Provider verification unavailable"},503);
 const verified=await res.json();
 const amount=Number(financial.customer_payable_amount);
 if(verified.order_id!==cfId||verified.order_status!=="PAID"||verified.order_currency!=="INR"||financial.currency!=="INR"||!Number.isFinite(Number(verified.order_amount))||!Number.isFinite(amount)||Math.abs(Number(verified.order_amount)-amount)>0.001)return json({error:"Payment not verified"},409);
 if(financial.payment_status==="paid")return json({ok:true,already_paid:true});
 const {error:ue}=await db.from("order_financials").update({payment_status:"paid"}).eq("id",financial.id).neq("payment_status","paid");
 if(ue)return json({error:"Could not record payment"},503);
 return json({ok:true,verified:true});
});
