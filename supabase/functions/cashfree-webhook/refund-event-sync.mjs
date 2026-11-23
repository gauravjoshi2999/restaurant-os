/**
 * Cashfree refund-event synchronizer.
 * An authenticated webhook is only a hint: every update requires matching
 * Bite-owned records AND fresh GETs for the PAID order and exact refund.
 * This module makes no POST requests to Cashfree; never initiates money movement.
 */
export const REFUND_EVENTS=new Set(['REFUND_STATUS_WEBHOOK','AUTO_REFUND_STATUS_WEBHOOK']);
const refundIdOK=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
const uuidOK=v=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const money=v=>{
 if((typeof v!=='number'||!Number.isFinite(v))&&
    (typeof v!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(v)))return null;
 const n=Number(v),c=Math.round(n*100);
 return n>=0&&Number.isSafeInteger(c)&&Math.abs(n*100-c)<0.001?c:null;
};
const supported=new Set(['SUCCESS','PENDING','PENDING_APPROVAL','CANCELLED','ONHOLD','FAILED','REJECTED']);
export function eventHint(event){
 if(!REFUND_EVENTS.has(event?.type))return null;
 const r=event?.data?.refund||event?.data?.refund_details||{};
 const id=r.refund_id||event?.data?.refund_id;
 const orderId=event?.data?.order?.order_id||r.order_id||event?.data?.order_id;
 return refundIdOK(id)?{refundId:id,providerOrderId:typeof orderId==='string'?orderId:null}:null;
}
export async function syncVerifiedRefund({event,db,providerFetch,appId,secret}){
 const hint=eventHint(event);
 if(!hint)return {ignored:true,reason:'unrecognized_refund_event'};
 if(!db?.from||!db?.rpc||!providerFetch||!appId||!secret)throw Error('Refund synchronizer not configured');
 const jobResult=await db.from('bite_refund_jobs')
  .select('id,order_id,customer_id,restaurant_id,amount,provider_refund_id,status')
  .eq('provider_refund_id',hint.refundId).limit(2);
 if(jobResult.error||!Array.isArray(jobResult.data))throw Error('Refund job lookup unavailable');
 if(jobResult.data.length!==1)return {ignored:true,needs_reconciliation:true,reason:'unmatched_refund_reference'};
 const job=jobResult.data[0];
 if(!uuidOK(job.id)||!uuidOK(job.order_id)||!uuidOK(job.restaurant_id)||
    !uuidOK(job.customer_id)||money(job.amount)===null||money(job.amount)===0||
    job.provider_refund_id!==hint.refundId)throw Error('Invalid refund job scope');
 const [oi,ii,fi]=await Promise.all([
  db.from('orders').select('id,restaurant_id,customer_id,amount,channel,is_demo')
   .eq('id',job.order_id).maybeSingle(),
  db.from('bite_live_checkout_intents').select('id,activated_order_id,restaurant_id,customer_id,amount,currency,status,provider_order_id')
   .eq('activated_order_id',job.order_id).maybeSingle(),
  db.from('order_financials').select('order_id,restaurant_id,customer_payable_amount,currency,payment_status,refund_amount_actual')
   .eq('order_id',job.order_id).maybeSingle()
 ]);
 if(oi.error||ii.error||fi.error)throw Error('Refund financial scope lookup unavailable');
 const order=oi.data,intent=ii.data,fin=fi.data;
 if(!order||!intent||!fin||order.id!==job.order_id||
    order.channel!=='Own Platform'||order.is_demo===true||
    order.restaurant_id!==job.restaurant_id||order.customer_id!==job.customer_id||
    intent.activated_order_id!==job.order_id||
    intent.restaurant_id!==job.restaurant_id||intent.customer_id!==job.customer_id||
    intent.status!=='activated'||intent.currency!=='INR'||fin.currency!=='INR'||
    fin.order_id!==job.order_id||fin.restaurant_id!==job.restaurant_id||
    !['paid','partially_refunded','refunded'].includes(fin.payment_status)||
    !uuidOK(intent.id)||intent.provider_order_id!=='bite_live_'+intent.id.replaceAll('-','')||
    (hint.providerOrderId!==null&&hint.providerOrderId!==intent.provider_order_id)||
    money(order.amount)!==money(intent.amount)||
    money(fin.customer_payable_amount)!==money(intent.amount)||
    money(job.amount)>money(intent.amount))
    throw Error('Refund financial or provider reference mismatch');
 const headers={'x-api-version':'2023-08-01','x-client-id':appId,'x-client-secret':secret};
 const fetchExact=async path=>{
  const response=await providerFetch('https://api.cashfree.com/pg'+path,{
   method:'GET',headers,signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw Error('Cashfree verified lookup unavailable');
  return response.json();
 };
 const p=encodeURIComponent(intent.provider_order_id),r=encodeURIComponent(hint.refundId);
 const providerOrder=await fetchExact('/orders/'+p);
 if(providerOrder?.order_id!==intent.provider_order_id||
    providerOrder?.order_currency!=='INR'||providerOrder?.order_status!=='PAID'||
    money(providerOrder?.order_amount)!==money(intent.amount))
    throw Error('Cashfree original PAID payment mismatch');
 const providerRefund=await fetchExact('/orders/'+p+'/refunds/'+r);
 const record=Array.isArray(providerRefund)?
  providerRefund.find(x=>x?.refund_id===hint.refundId):providerRefund;
 if(!record||record.order_id!==intent.provider_order_id||
    record.refund_id!==hint.refundId||record.refund_currency!=='INR'||
    money(record.refund_amount)!==money(job.amount)||
    !supported.has(record.refund_status))
    throw Error('Cashfree exact refund evidence mismatch');
 const result=await db.rpc('bite_record_verified_refund_observation',{
  p_job_id:job.id,p_provider_refund_id:hint.refundId,
  p_status:record.refund_status,p_amount:Number(job.amount),p_currency:'INR'
 });
 if(result.error||!['succeeded','submitted','failed','pending_approval','approved'].includes(result.data))
  throw Error('Refund evidence ledger synchronization unavailable');
 return {ok:true,recorded:true,status:result.data,provider_status:record.refund_status};
}
