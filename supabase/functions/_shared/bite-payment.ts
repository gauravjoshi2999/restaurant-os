// Server-only transport: no raw provider bodies, credentials or contact data in responses/logs.
export const liveCors={"access-control-allow-origin":"https://gauravjoshi2999.github.io","access-control-allow-headers":"authorization, apikey, content-type, x-client-info, x-supabase-api-version","access-control-allow-methods":"POST, OPTIONS"};
export const liveJson=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json","cache-control":"no-store",...liveCors}});
export const liveReference=(id:string)=>"bite_live_"+id.replaceAll("-","");
export const liveUuid=(id:string)=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
export function liveMoney(value:any,expected:any){return (typeof value==="number"||typeof value==="string"&&/^\d+(\.\d{1,2})?$/.test(value))&&Number.isFinite(Number(value))&&Number.isFinite(Number(expected))&&Math.abs(Number(value)-Number(expected))<0.001;}
export class LivePaymentError extends Error{
 status:number;code:string;http:number;
 constructor(message:string,code="provider_unavailable",status=503,http=0){super(message);this.code=code;this.status=status;this.http=http;}
}
export function liveStableJson(value:any):string{if(Array.isArray(value))return '['+value.map(liveStableJson).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+liveStableJson(value[key])).join(',')+'}';return JSON.stringify(value);}
export async function liveProvider(path:string,options:any={}){
 const app=Deno.env.get("CASHFREE_APP_ID"),secret=Deno.env.get("CASHFREE_SECRET_KEY");
 if(!app||!secret)throw new LivePaymentError("Online payment configuration unavailable.","provider_not_configured");
 let response:Response;
 try{response=await fetch("https://api.cashfree.com/pg"+path,{...options,headers:{"content-type":"application/json","x-api-version":"2023-08-01","x-client-id":app,"x-client-secret":secret,...options.headers},signal:AbortSignal.timeout(12000)});}
 catch{throw new LivePaymentError("Payment provider se jawab nahi mila. Status check karein; browsing jaari rakh sakte hain.","provider_timeout");}
 const data=await response.json().catch(()=>null);
 const code=typeof data?.code==="string"&&/^[a-zA-Z0-9_]{1,80}$/.test(data.code)?data.code:"provider_response_unavailable";
 if(!response.ok)throw new LivePaymentError("Payment provider abhi request complete nahi kar paaya. Status check karein ya menu par laut jaayein.",code,503,response.status);
 if(!data||typeof data!=="object")throw new LivePaymentError("Payment provider ka jawab verify nahi hua.","invalid_provider_response",503,response.status);
 return data;
}
export async function liveLookup(intent:any){
 const reference=liveReference(intent.id);
 if(intent.provider_order_id&&intent.provider_order_id!==reference)throw new LivePaymentError("Payment reference mismatch. Support se sampark karein.","reference_mismatch",409);
 let order:any;
 try{order=await liveProvider("/orders/"+reference);}
 catch(error){if(error instanceof LivePaymentError&&error.http===404&&error.code==="order_not_found")return null;throw error;}
 if(order.order_id!==reference||order.order_currency!=="INR"||intent.currency!=="INR"||!liveMoney(order.order_amount,intent.amount))throw new LivePaymentError("Payment amount ya currency match nahi hui. Dobara payment na karein.","amount_mismatch",409);
 return order;
}
export async function livePaymentsPending(reference:string){
 const payments=await liveProvider("/orders/"+reference+"/payments");
 if(!Array.isArray(payments))throw new LivePaymentError("Payment attempts verify nahi hue.","invalid_payments_response");
 // Unknown states and SUCCESS awaiting order reconciliation are non-terminal.
 return payments.some((p:any)=>p.order_id!==reference||!["FAILED","USER_DROPPED","VOID","CANCELLED","NOT_ATTEMPTED"].includes(p.payment_status));
}
export async function liveRecord(db:any,id:string,token:string,evidence:any){
 const {data,error}=await db.rpc("bite_record_checkout_provider",{p_intent_id:id,p_token:token,p_evidence:evidence});
 if(error)throw new LivePaymentError("Payment update save nahi hua. Isi checkout ka status check karein.","record_pending");
 return data;
}
export async function liveActivate(db:any,intent:any,order:any){
 const {data,error}=await db.rpc("bite_activate_paid_checkout",{p_intent_id:intent.id,p_provider_order_id:order.order_id,p_amount:Number(order.order_amount),p_currency:order.order_currency});
 if(error)throw new LivePaymentError("Payment verify hua; order activation reconcile ho raha hai. Dobara payment na karein.","activation_pending");
 return {status:"activated",order_id:data,verified:true};
}
export async function liveClaim(db:any,id:string,customer:string,token:string,action:string){
 const {data,error}=await db.rpc("bite_claim_checkout_provider",{p_intent_id:id,p_customer_id:customer,p_token:token,p_action:action});
 if(error)throw new LivePaymentError("Checkout database abhi available nahi hai.","claim_unavailable");
 if(data?.error){const messages:any={not_found:"Checkout nahi mila.",busy:"Payment update ho raha hai. Thodi der mein status check karein.",closed:"Yeh checkout band hai. Menu se naya cart banayein.",earlier_payment_unresolved:"Pichhle payment ka status pehle check ya cancel karein. Naya cart taiyar rakh sakte hain."};return {error:messages[data.error]||"Checkout unavailable",code:data.error,blocking_intent_id:data.blocking_intent_id,http:data.error==="not_found"?404:409};}
 if(!data?.intent)throw new LivePaymentError("Checkout response missing.","invalid_claim");
 return data;
}
export function liveErrorResult(error:any,id:string){
 const e=error instanceof LivePaymentError?error:new LivePaymentError("Payment update complete nahi hua. Status check karein.");
 console.warn(JSON.stringify({event:"bite_payment_error",intent_id:id,code:e.code,provider_http_status:e.http}));
 return liveJson({error:e.message,code:e.code,provider_status:e.http||undefined,intent_id:id,can_browse:true},e.status);
}
