import {shouldDisableOwnerFcmToken} from "./fcm-token-policy.mjs";
import {awaitingOwnerDevicePolicy} from "./device-retry-policy.mjs";
/* Server-only FCM sender for real pending customer cancellation requests.
   No direct client entrypoint, no customer PII, no automatic owner decisions. */
export async function dispatchCancellationPush({db,fetcher,bearer,projectId,clock=()=>new Date()}){
 const result={processed:0,sent:0,failed:0,skipped:0};
 let events;
 try{
  const query=await db.from("bite_owner_cancellation_push_events")
   .select("request_id,order_id,restaurant_id,delivery_status,attempts,created_at")
   .in("delivery_status",["queued","retry"]).order("created_at",{ascending:true}).limit(12);
  if(query.error){result.unavailable=true;return result;}
  events=query.data||[];
 }catch{result.unavailable=true;return result;}
 for(const ev of events){
  const claimed=await db.from("bite_owner_cancellation_push_events")
   .update({delivery_status:"processing",attempts:ev.attempts+1,last_attempt_at:clock().toISOString()})
   .eq("request_id",ev.request_id).eq("delivery_status",ev.delivery_status)
   .select("request_id,restaurant_id,order_id,attempts").maybeSingle();
  if(claimed.error||!claimed.data)continue;
  result.processed++;
  let next="failed",errorText=null;
  try{
   const rq=await db.from("restaurant_customer_order_requests")
    .select("id,restaurant_id,order_id,request_type,status,customer_id")
    .eq("id",ev.request_id).eq("restaurant_id",ev.restaurant_id).maybeSingle();
   const request=rq.data;
   if(rq.error||!request||request.status!=="Pending"||request.request_type!=="cancel_request"||
      request.order_id!==ev.order_id){
    next="skipped";result.skipped++;
   }else{
    const ord=await db.from("orders").select("id,restaurant_id,customer_id,channel,is_demo,status")
     .eq("id",ev.order_id).eq("restaurant_id",ev.restaurant_id).maybeSingle();
    const order=ord.data;
    if(ord.error||!order||order.customer_id!==request.customer_id||
       !["Accepted","Preparing","Ready"].includes(order.status)||
       order.channel!=="Own Platform"||order.is_demo===true){
     next="skipped";result.skipped++;
    }else{
     const ledger=await db.from("order_financials").select("payment_status")
      .eq("order_id",ev.order_id).eq("restaurant_id",ev.restaurant_id).maybeSingle();
     if(ledger.error||ledger.data?.payment_status!=="paid"){
      next="skipped";result.skipped++;
     }else{
      const owner=await db.from("restaurant_members").select("user_id")
       .eq("restaurant_id",ev.restaurant_id).eq("role","owner");
      if(owner.error||owner.data?.length!==1)throw Error("Owner mapping unavailable");
      const devices=await db.from("bite_owner_push_devices")
       .select("fcm_token,user_id,supports_order_actions")
       .eq("restaurant_id",ev.restaurant_id).eq("enabled",true)
       .eq("user_id",owner.data[0].user_id);
      if(devices.error)throw Error("Owner device lookup unavailable");
      if(!devices.data?.length){
       const wait=awaitingOwnerDevicePolicy(claimed.data.attempts,ev.created_at,clock().getTime());
       next=wait.status;errorText=wait.reason;result.skipped++;
      }
      else{
       let errors=0;
       for(const device of devices.data){
        const fields={
         event_type:"bite_cancel_request",screen:"orders",
         order_id:String(ev.order_id),restaurant_id:String(ev.restaurant_id),
         request_id:String(ev.request_id),
         title:"Bite cancellation request",
         body:"Customer has requested cancellation. Open Bite Partner to review."
        };
        // Data-only message is handled by the installed Partner FCM service;
        // its "bite_order" action buttons are deliberately NOT shown.
        const message=device.supports_order_actions===true?
         {token:device.fcm_token,data:fields,android:{priority:"HIGH",ttl:"600s"}}:
         {token:device.fcm_token,
          notification:{title:fields.title,body:fields.body},
          data:fields,
          android:{priority:"HIGH",ttl:"600s",notification:{
           channel_id:"bite_owner_new_orders_v1",tag:"bite-cancel-"+ev.request_id,sound:"default"}}};
        const response=await fetcher("https://fcm.googleapis.com/v1/projects/"+
          encodeURIComponent(projectId)+"/messages:send",{
           method:"POST",headers:{"Authorization":"Bearer "+bearer,"Content-Type":"application/json"},
           body:JSON.stringify({message}),signal:AbortSignal.timeout(12000)});
        if(!response.ok){
         errors++;
         if(await shouldDisableOwnerFcmToken(response))
          await db.from("bite_owner_push_devices")
           .update({enabled:false,updated_at:clock().toISOString()})
           .eq("fcm_token",device.fcm_token).eq("restaurant_id",ev.restaurant_id);
        }
       }
       if(errors===0){next="sent";result.sent++;}
       else{next=claimed.data.attempts>=4?"failed":"retry";errorText="FCM cancellation push unavailable";result.failed++;}
      }
     }
    }
   }
  }catch(e){next=claimed.data.attempts>=4?"failed":"retry";errorText=String(e).slice(0,120);result.failed++;}
  await db.from("bite_owner_cancellation_push_events")
   .update({delivery_status:next,last_error:errorText,sent_at:next==="sent"?clock().toISOString():null})
   .eq("request_id",ev.request_id).eq("delivery_status","processing");
 }
 return result;
}
