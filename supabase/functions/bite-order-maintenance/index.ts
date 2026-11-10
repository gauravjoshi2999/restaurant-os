import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";
// Deployment flags + a separate scheduler secret are required. Never issues a refund or payout.
Deno.serve(async req=>{
 const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const secret=Deno.env.get("BITE_MAINTENANCE_SECRET");if(!secret||req.headers.get("authorization")!=="Bearer "+secret)return json({error:"Unauthorized"},401);
 if(Deno.env.get("BITE_MAINTENANCE_ENABLED")!=="true")return json({error:"Maintenance rollout disabled"},409);
 try{const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
 const {data:cancelled,error}=await db.rpc("bite_cancel_unanswered_orders");if(error)return json({error:"Order maintenance failed"},503);
 const unstarted=await db.rpc("bite_expire_unstarted_checkouts");if(unstarted.error)return json({error:"Checkout maintenance failed"},503);
 let expired=Number(unstarted.data||0),unknown=0;
 const app=Deno.env.get("CASHFREE_APP_ID"),providerSecret=Deno.env.get("CASHFREE_SECRET_KEY");
 if(app&&providerSecret){
  const {data:pending,error:pendingError}=await db.from("bite_live_checkout_intents").select("id,provider_order_id,amount,currency").eq("status","awaiting_payment").lt("created_at",new Date(Date.now()-20*60*1000).toISOString()).not("provider_attempted_at","is",null).limit(15);
  if(pendingError)return json({error:"Could not inspect pending payments"},503);
  // Bound concurrency and time. A timeout/404/PAID response never releases a reservation as unpaid.
  for(let i=0;i<(pending||[]).length;i+=3)await Promise.all(pending.slice(i,i+3).map(async(intent:any)=>{
   try{const providerId="bite_live_"+intent.id.replaceAll("-","");if(intent.provider_order_id&&intent.provider_order_id!==providerId){unknown++;return;}
    const r=await fetch("https://api.cashfree.com/pg/orders/"+encodeURIComponent(providerId),{headers:{"x-api-version":"2023-08-01","x-client-id":app,"x-client-secret":providerSecret},signal:AbortSignal.timeout(8000)});if(!r.ok){unknown++;return;}const cf=await r.json();
    if(cf.order_id!==providerId||cf.order_currency!=="INR"||!Number.isFinite(Number(cf.order_amount))||Math.abs(Number(cf.order_amount)-Number(intent.amount))>0.001){unknown++;return;}
    if(["EXPIRED","TERMINATED"].includes(cf.order_status)){const {error:saveError}=await db.from("bite_live_checkout_intents").update({status:"expired",updated_at:new Date().toISOString()}).eq("id",intent.id).eq("status","awaiting_payment");if(saveError)unknown++;else expired++;}
   }catch{unknown++;}
  }));
 }
 const heartbeat=await db.from("bite_operations_config").update({last_maintenance_at:new Date().toISOString()}).eq("id",true);if(heartbeat.error)return json({error:"Could not record scheduler heartbeat"},503);
 return json({cancelled_orders:cancelled,expired_checkouts:expired,unverified_pending_checks:unknown,refunds:"Queued for explicit Admin approval; no provider refunds or payouts executed"});
 }catch{return json({error:"Maintenance unavailable"},503);}
});
