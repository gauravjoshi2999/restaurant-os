/* Owner A12 — safe existing HR payment save, using the original payment ledger.
 * No additional Cashbook, bank transfer or payroll record is created.
 * The database trigger enforces the approved due cap for every Salary/Bonus insert.
 */
(function(root){
 'use strict';
 const methods=['Cash','UPI','Card','Bank Transfer','Other'];
 const types=['Salary','Advance','Bonus','Deduction'];
 let pendingId='',pendingSignature='',inFlight=false;
 const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 const monthOK=s=>s===null||typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])-01$/.test(s);
 function normalize(data){
  if(!data?.restaurant_id||!data.employee_id||!data.created_by||
   !dateOK(data.payment_date)||!monthOK(data.period_month)||
   !types.includes(data.payment_type)||!methods.includes(data.payment_method))
   throw Error('Choose a valid employee, payment date, salary month, type and actual payment mode.');
  const n=Number(data.amount);
  if(!Number.isFinite(n)||n<=0||n>99999999.99||Math.abs(n*100-Math.round(n*100))>1e-6)
   throw Error('Enter a positive payment with no more than two decimal places.');
  const reference=String(data.reference||'').trim();
  const notes=String(data.notes||'').trim();
  if(reference.length>100||notes.length>250)throw Error('Payment reference or note is too long.');
  return {restaurant_id:data.restaurant_id,employee_id:data.employee_id,
   payment_date:data.payment_date,period_month:data.period_month,
   payment_type:data.payment_type,amount:Math.round(n*100)/100,
   payment_method:data.payment_method,reference:reference||null,notes:notes||null,
   created_by:data.created_by};
 }
 function match(row,input){
  return !!row&&row.id===input.id&&
   ['restaurant_id','employee_id','payment_date','period_month','payment_type','payment_method','created_by']
    .every(k=>(row[k]??null)===(input[k]??null))&&
   Math.abs(Number(row.amount)-input.amount)<0.000001&&
   (row.reference??null)===(input.reference??null)&&
   (row.notes??null)===(input.notes??null);
 }
 async function save({client,data,stillCurrent}={}){
  if(inFlight)return {ok:false,busy:true,message:'Payment save is already in progress.'};
  if(!client?.from||stillCurrent?.()===false)
   return {ok:false,message:'Owner session or restaurant changed. Payment was not submitted.'};
  let record;
  try{record=normalize(data)}catch(e){return {ok:false,message:e.message}}
  const signature=JSON.stringify(record);
  if(signature!==pendingSignature){
   if(!root.crypto?.randomUUID)return {ok:false,message:'Secure payment ID unavailable; use a modern secure browser.'};
   pendingSignature=signature;pendingId=root.crypto.randomUUID();
  }
  record={...record,id:pendingId};
  inFlight=true;
  try{
   const {error}=await client.from('restaurant_employee_payments').insert(record);
   if(!error){
    pendingSignature='';pendingId='';
    return {ok:true,verified:true,message:'Payment recorded once in the existing HR ledger.'};
   }
   // A timed-out response may have committed; do not issue a second INSERT.
   // Look up the same client-generated ID and accept only an exact source match.
   const response=await client.from('restaurant_employee_payments')
    .select('id,restaurant_id,employee_id,payment_date,period_month,payment_type,amount,payment_method,reference,notes,created_by')
    .eq('id',record.id).eq('restaurant_id',record.restaurant_id).maybeSingle();
   if(!response.error&&match(response.data,record)){
    pendingSignature='';pendingId='';
    return {ok:true,verified:true,message:'Earlier payment was already saved. No duplicate was created.'};
   }
   return {ok:false,message:'Payment was not confirmed: '+(error.message||'Database rejected this payment')+
    '. The approved salary balance and current day must be checked before retrying.'};
  }catch(e){
   return {ok:false,message:'Payment status is uncertain ('+(e?.message||'network error')+
    '). Check the HR register before retrying. The same payment ID will be reused.'};
  }finally{inFlight=false}
 }
 function reset(){if(!inFlight){pendingSignature='';pendingId=''}}
 const api={normalize,match,save,reset,isBusy:()=>inFlight};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteOwnerSafeStaffPayment=api;
})(typeof window!=='undefined'?window:globalThis);
