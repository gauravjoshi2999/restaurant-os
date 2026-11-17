import {shouldDisableOwnerFcmToken} from "./fcm-token-policy.mjs";
import {awaitingOwnerDevicePolicy} from "./device-retry-policy.mjs";

// Prepayment requests are NOT paid orders; never expose customer information,
// or offer unauthenticated Accept/Reject buttons on the Android lock screen.
// FCM 'sent' means provider accepted the message, not phone delivery.
export async function dispatchApprovalPush({db,fetcher,bearer,projectId,clock=()=>new Date()}){
 const result={processed:0,sent:0,failed:0,skipped:0};
 let events;
 try{
  const res=await db.from("bite_owner_approval_push_events")
   .select("intent_id,restaurant_id,delivery_status,attempts,created_at")
   .in("delivery_status",["queued","retry"])
   .order("created_at",{ascending:true}).limit(12);
  if(res.error){result.unavailable=true;return result;}
  events=res.data||[];
 }catch{result.unavailable=true;return result;}
 for(const ev of events){
  const claim=await db.from("bite_owner_approval_push_events")
   .update({delivery_status:"processing",attempts:ev.attempts+1,last_attempt_at:clock().toISOString()})
   .eq("intent_id",ev.intent_id).eq("delivery_status",ev.delivery_status)
   .select("intent_id,restaurant_id,attempts").maybeSingle();
  if(claim.error||!claim.data)continue;
  result.processed++;
  let next="failed",errorText=null;
  try{
   const {data:request,error:requestError}=await db.from("bite_order_confirmations")
    .select("intent_id,restaurant_id,customer_id,state,expires_at")
    .eq("intent_id",ev.intent_id).eq("restaurant_id",ev.restaurant_id).maybeSingle();
   const deadline=Date.parse(request?.expires_at||"");
   const timeLeft=Math.ceil((deadline-clock().getTime())/1000);
   if(requestError||!request||request.state!=="pending"||
      !Number.isFinite(timeLeft)||timeLeft<=0){
    next="skipped";result.skipped++;
   }else{
    const {data:intent,error:intentError}=await db.from("bite_live_checkout_intents")
     .select("id,restaurant_id,customer_id,confirmation_required,status,provider_order_id,provider_attempted_at")
     .eq("id",ev.intent_id).eq("restaurant_id",ev.restaurant_id).maybeSingle();
    if(intentError||!intent||intent.customer_id!==request.customer_id||
      intent.confirmation_required!==true||intent.status!=="awaiting_payment"||
      intent.provider_order_id||intent.provider_attempted_at){
     next="skipped";result.skipped++;
    }else{
     const {data:owners,error:ownerError}=await db.from("restaurant_members")
      .select("user_id").eq("restaurant_id",ev.restaurant_id).eq("role","owner");
     if(ownerError||!owners||owners.length!==1)throw Error("Owner mapping not unique");
     const {data:devices,error:deviceError}=await db.from("bite_owner_push_devices")
      .select("fcm_token,user_id,supports_order_actions")
      .eq("restaurant_id",ev.restaurant_id).eq("enabled",true)
      .eq("user_id",owners[0].user_id);
     if(deviceError)throw Error("Owner device lookup unavailable");
     if(!devices?.length){
      const wait=awaitingOwnerDevicePolicy(claim.data.attempts,ev.created_at,clock().getTime());
      next=wait.status;errorText=wait.reason;result.skipped++;
     }else{
      let errors=0;
      for(const device of devices){
       const fields={
        event_type:"bite_approval_request",
        intent_id:String(ev.intent_id),
        restaurant_id:String(ev.restaurant_id),
        screen:"orders",
        title:"Bite: New confirmation request",
        body:"Confirm or reject this order in Bite Partner before the timer ends."
       };
       const notification=device.supports_order_actions===true?{
        token:device.fcm_token,data:fields,
        android:{priority:"HIGH",ttl:Math.min(180,Math.max(1,timeLeft))+"s"}
       }:{
        token:device.fcm_token,
        notification:{title:fields.title,body:fields.body},data:fields,
        android:{priority:"HIGH",ttl:Math.min(180,Math.max(1,timeLeft))+"s",
          notification:{channel_id:"bite_owner_new_orders_v1",
            tag:"bite-confirm-"+ev.intent_id,sound:"default"}}
       };
       try{
        const response=await fetcher("https://fcm.googleapis.com/v1/projects/"+
         encodeURIComponent(projectId)+"/messages:send",{
          method:"POST",
          headers:{"Authorization":"Bearer "+bearer,"Content-Type":"application/json"},
          body:JSON.stringify({message:notification}),signal:AbortSignal.timeout(12000)});
        if(!response.ok){
         errors++;
         if(await shouldDisableOwnerFcmToken(response))
          await db.from("bite_owner_push_devices")
           .update({enabled:false,updated_at:clock().toISOString()})
           .eq("fcm_token",device.fcm_token).eq("restaurant_id",ev.restaurant_id);
        }
       }catch{errors++;}
      }
      if(errors===0){next="sent";result.sent++;}
      else{next=claim.data.attempts>=4?"failed":"retry";errorText="FCM approval request rejected";result.failed++;}
     }
    }
   }
  }catch(e){
   next=claim.data.attempts>=4?"failed":"retry";
   errorText=String(e).slice(0,110);result.failed++;
  }
  await db.from("bite_owner_approval_push_events")
   .update({delivery_status:next,last_error:errorText,sent_at:next==="sent"?clock().toISOString():null})
   .eq("intent_id",ev.intent_id).eq("delivery_status","processing");
 }
 return result;
}
