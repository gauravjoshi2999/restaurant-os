import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.8";
const cors={"access-control-allow-origin":"https://gauravjoshi2999.github.io","access-control-allow-headers":"authorization,apikey,content-type,x-client-info,x-supabase-api-version","access-control-allow-methods":"POST,OPTIONS"};
const reply=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json",...cors}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const auth=req.headers.get("authorization")||"";if(!auth.startsWith("Bearer "))return reply({error:"Login required"},401);
 const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
 const {data:{user}}=await userClient.auth.getUser();if(!user)return reply({error:"Invalid login"},401);
 const {draft_id}=await req.json().catch(()=>({}));if(typeof draft_id!=="string"||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(draft_id))return reply({error:"Invalid draft"},400);
 const admin=createClient(url,service);
 const {data:draft}=await admin.from("bite_sandbox_order_drafts").select("id,customer_id,payable_amount,payment_status,fulfillment_status").eq("id",draft_id).maybeSingle();
 if(!draft||draft.customer_id!==user.id)return reply({error:"Draft not found"},404);
 const app=Deno.env.get("CASHFREE_TEST_APP_ID"),secret=Deno.env.get("CASHFREE_TEST_SECRET_KEY");if(!app||!secret)return reply({error:"Sandbox credentials unavailable"},503);
 const cfId="bite_draft_"+draft.id.replaceAll("-","");
 const res=await fetch("https://sandbox.cashfree.com/pg/orders/"+encodeURIComponent(cfId),{headers:{"x-api-version":"2023-08-01","x-client-id":app,"x-client-secret":secret}});
 if(res.status===404)return reply({status:"NOT_CREATED",verified:false});
 if(!res.ok)return reply({error:"Cashfree verification failed"},502);
 const cf=await res.json();
 if(cf.order_id!==cfId||cf.order_currency!=="INR"||Math.abs(Number(cf.order_amount)-Number(draft.payable_amount))>0.001)return reply({error:"Payment amount mismatch"},409);
 if(cf.order_status!=="PAID")return reply({status:cf.order_status,verified:false});
 const {error}=await admin.from("bite_sandbox_order_drafts").update({payment_status:"sandbox_paid"}).eq("id",draft.id);
 if(error)return reply({error:"Could not record sandbox payment"},503);
 // Payment and fulfilment are separate; a verified test payment must become actionable
 // for the owner, but cannot overwrite an order already Accepted/Ready/Completed.
 if(draft.fulfillment_status==="Awaiting Payment"){
  const {error:statusError}=await admin.from("bite_sandbox_order_drafts")
   .update({fulfillment_status:"Received"}).eq("id",draft.id)
   .eq("payment_status","sandbox_paid").eq("fulfillment_status","Awaiting Payment");
  if(statusError)return reply({error:"Payment verified, but owner queue status could not be refreshed"},503);
 }
 return reply({status:"SANDBOX_PAID",verified:true,draft_id:draft.id});
});