/* Bite POS payment retry safety.
   One persisted client-generated UUID per payment attempt; never silently create
   another receipt when the server may have committed the previous attempt.
   The existing database payment PK, RLS and balance trigger remain authoritative. */
(function(root){
 'use strict';
 const PREFIX='bite_pos_payment_attempt_v1:';
 const METHODS=['Cash','UPI','Card','Bank Transfer','Other'];
 const DEFINITE_REJECTION=new Set(['23502','23503','23514','42501','P0001','22P02','22003']);
 function key(identity){
  if(!identity?.uid||!identity.restaurantId||!identity.orderId)throw Error('Payment identity unavailable');
  return PREFIX+[identity.uid,identity.restaurantId,identity.orderId].join(':');
 }
 function normalize(details){
  const value=Number(details?.amount),cents=Math.round(value*100);
  if(!Number.isFinite(value)||value<=0||!Number.isSafeInteger(cents)||Math.abs(value*100-cents)>0.000001)
   throw Error('Valid amount (maximum two decimal places) bharein.');
  const method=String(details?.method||'');
  if(!METHODS.includes(method))throw Error('Valid payment method select karein.');
  const date=String(details?.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Valid payment date bharein.');
  const reference=String(details?.reference||'').trim(),notes=String(details?.notes||'').trim();
  if(reference.length>100||notes.length>250)throw Error('Payment reference/note too long.');
  return {amount:cents/100,method,date,reference,notes};
 }
 function getPending(storage,identity){
  let raw;
  try{raw=storage.getItem(key(identity))}catch{throw Error('Device storage unavailable. Payment save karna safe nahi hai.')}
  if(!raw)return null;
  let attempt;
  try{attempt=JSON.parse(raw)}catch{throw Error('Saved payment attempt unreadable. Please contact support before retrying.')}
  if(!attempt||!/^[-a-f0-9]{36}$/i.test(attempt.id||'')||
    attempt.uid!==identity.uid||attempt.restaurantId!==identity.restaurantId||
    attempt.orderId!==identity.orderId||!attempt.details)
    throw Error('Saved payment attempt invalid. Please contact support before retrying.');
  return attempt;
 }
 function clear(storage,identity){
  try{storage.removeItem(key(identity))}catch{/* A stale marker is safe: reconciliation will clear it later. */}
 }
 function begin(storage,identity,details,uuid){
  const normalized=normalize(details),existing=getPending(storage,identity);
  if(existing){
   if(JSON.stringify(normalize(existing.details))!==JSON.stringify(normalized))
    throw Error('Pichhla payment verification pending hai. Purane amount/details restore karke wahi payment retry karein; naya payment na banayein.');
   return {attempt:existing,retry:true};
  }
  if(typeof uuid!=='function')throw Error('Secure payment attempt ID unavailable');
  const id=uuid();
  if(!/^[-a-f0-9]{36}$/i.test(id||''))throw Error('Secure payment attempt ID invalid');
  const attempt={id,uid:identity.uid,restaurantId:identity.restaurantId,orderId:identity.orderId,details:normalized};
  try{storage.setItem(key(identity),JSON.stringify(attempt))}
  catch{throw Error('Device storage unavailable. Payment save nahi kiya; storage allow karein.')}
  return {attempt,retry:false};
 }
 async function reconcile({sb,storage,identity}){
  const attempt=getPending(storage,identity);
  if(!attempt)return {status:'none'};
  try{
   const {data,error}=await sb.from('restaurant_order_payments')
    .select('id,order_id,restaurant_id,amount,payment_method,payment_date,reference')
    .eq('id',attempt.id).eq('order_id',identity.orderId)
    .eq('restaurant_id',identity.restaurantId).maybeSingle();
   if(error)return {status:'unknown',attempt,error};
   if(!data)return {status:'not_found',attempt};
   const expected=normalize(attempt.details);
   if(data.id!==attempt.id||data.order_id!==identity.orderId||
      data.restaurant_id!==identity.restaurantId||
      Math.round(Number(data.amount)*100)!==Math.round(expected.amount*100)||
      data.payment_method!==expected.method||data.payment_date!==expected.date||
      String(data.reference||'')!==expected.reference)
    return {status:'conflict',attempt,error:Error('Payment ID matched unexpected data')};
   clear(storage,identity);
   return {status:'confirmed',attempt,recovered:true};
  }catch(error){return {status:'unknown',attempt,error}}
 }
 async function save({sb,storage,identity,details,uuid}){
  const {attempt,retry}=begin(storage,identity,details,uuid);
  if(retry){
   const previous=await reconcile({sb,storage,identity});
   if(previous.status==='confirmed')return previous;
   if(previous.status!=='not_found')return {status:'pending',attempt,error:previous.error};
  }
  let error;
  try{
   const response=await sb.from('restaurant_order_payments').insert({
    id:attempt.id,order_id:identity.orderId,restaurant_id:identity.restaurantId,
    amount:attempt.details.amount,payment_method:attempt.details.method,
    payment_date:attempt.details.date,reference:attempt.details.reference||null,
    notes:attempt.details.notes||null,created_by:identity.uid
   });
   error=response.error;
   if(!error){clear(storage,identity);return {status:'confirmed',attempt,recovered:false}}
  }catch(err){error=err}
  const check=await reconcile({sb,storage,identity});
  if(check.status==='confirmed')return check;
  if(check.status==='not_found'&&DEFINITE_REJECTION.has(String(error?.code||''))){
   clear(storage,identity);
   return {status:'rejected',error,attempt};
  }
  return {status:'pending',error:check.error||error,attempt};
 }
 const api={key,normalize,getPending,begin,reconcile,save};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.BitePOSPayment=api;
})(typeof window!=='undefined'?window:globalThis);
