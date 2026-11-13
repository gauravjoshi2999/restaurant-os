/* Owner POS payment modal: verify a pending receipt before permitting a retry.
   Keep this separate from the large workspace script for focused browser QA. */
(function(root){
 'use strict';
 let busy=false;
 const el=id=>document.getElementById(id);
 const core=()=>root.BitePOSPayment;
 function identity(ctx){return {uid:ctx.userId,restaurantId:ctx.restaurantId,orderId:ctx.orderId}}
 function eligible(ctx){
  return ['owner','manager','staff'].includes(ctx.role)&&
   ctx.order&&ctx.order.restaurant===ctx.restaurantId&&
   String(ctx.order.channel||'').startsWith('POS - ')&&
   !['Rejected','Cancelled'].includes(ctx.order.status);
 }
 function pendingUI(pending){
  el('paymentCheckBtn').style.display=pending?'inline-flex':'none';
  el('paymentSaveBtn').textContent=pending?'Retry same payment':'Save payment';
 }
 function lock(value){
  busy=value;
  el('paymentSaveBtn').disabled=value;
  el('paymentCheckBtn').disabled=value;
 }
 function open(ctx){
  if(busy||!eligible(ctx))return;
  const id=identity(ctx),summary=ctx.paymentSummaryFor(ctx.orderId);
  let pending;
  try{pending=core().getPending(localStorage,id)}
  catch(err){alert(err.message);return}
  if(Number(summary.balance_amount)<=0&&!pending){alert('Is order ka balance zero hai.');return}
  el('paymentOrderId').value=ctx.orderId;
  el('paymentOrderLabel').textContent=(ctx.order.code||ctx.orderId.slice(0,8))+
   ' · Total '+ctx.money(ctx.order.amount)+' · Paid '+ctx.money(summary.paid_amount)+
   ' · Due '+ctx.money(summary.balance_amount);
  el('paymentAmount').value=pending?pending.details.amount:Number(summary.balance_amount).toFixed(2);
  el('paymentAmount').max=Number(summary.balance_amount).toFixed(2);
  el('paymentMethod').value=pending?.details.method||'Cash';
  el('paymentDate').value=pending?.details.date||ctx.today();
  el('paymentReference').value=pending?.details.reference||'';
  el('paymentNotes').value=pending?.details.notes||'';
  el('paymentMessage').textContent=pending?
   'Pichhla payment pending hai. Check status karein; wahi payment ID retry hogi.':'';
  pendingUI(!!pending);
  el('paymentModal').classList.add('show');
  if(pending)void check(ctx);
 }
 async function check(ctx){
  if(busy||!eligible(ctx)||el('paymentOrderId').value!==ctx.orderId)return;
  const id=identity(ctx),message=el('paymentMessage');
  lock(true);
  try{
   const result=await core().reconcile({sb:ctx.sb,storage:localStorage,identity:id});
   if(el('paymentOrderId').value!==ctx.orderId)return;
   if(result.status==='confirmed'){
    ctx.closeModal('paymentModal');
    try{await ctx.loadCloudData()}catch(err){console.warn('Payment confirmed; dashboard refresh postponed',err)}
    alert('Pichhla payment confirm ho gaya. Nayi payment entry nahi banayi.');
   }else if(result.status==='not_found'){
    message.textContent='Pichhla payment abhi database mein nahi mila. Retry same payment wahi ID use karega; naya payment mat banayein.';
   }else if(result.status==='unknown'){
    message.textContent='Network se payment verify nahi ho pa raha. Connection aane par Check status dabayein; nayi entry mat banayein.';
   }else if(result.status==='conflict'){
    message.textContent='Payment details mismatch. Safety ke liye entry blocked hai; support se verify karein.';
   }else message.textContent='Koi pending payment nahi hai.';
   pendingUI(!!core().getPending(localStorage,id));
  }catch(err){message.textContent='Payment status check nahi hua: '+err.message}
  finally{lock(false)}
 }
 async function save(ctx){
  if(busy||!eligible(ctx)||el('paymentOrderId').value!==ctx.orderId)return;
  const id=identity(ctx),summary=ctx.paymentSummaryFor(ctx.orderId),message=el('paymentMessage');
  const details={
   amount:Number(el('paymentAmount').value),method:el('paymentMethod').value,
   date:el('paymentDate').value,reference:el('paymentReference').value.trim(),
   notes:el('paymentNotes').value.trim()
  };
  if(Number(summary.balance_amount)<=0){
   if(core().getPending(localStorage,id))return check(ctx);
   message.textContent='Is bill ka due zero hai. Dashboard refresh karein.';return;
  }
  if(!details.date||!Number.isFinite(details.amount)||details.amount<=0||
     details.amount>Number(summary.balance_amount)){
   message.textContent='Valid amount bharein; amount remaining due se zyada nahi ho sakta.';return;
  }
  lock(true);
  try{
   const result=await core().save({sb:ctx.sb,storage:localStorage,identity:id,
    details,uuid:()=>crypto.randomUUID()});
   if(el('paymentOrderId').value!==ctx.orderId)return;
   if(result.status==='confirmed'){
    ctx.closeModal('paymentModal');
    // A dashboard refresh failure is NOT a failed payment.
    try{await ctx.loadCloudData()}catch(err){console.warn('Payment saved; dashboard refresh postponed',err)}
   }else if(result.status==='rejected'){
    message.textContent='Payment reject hua: '+(result.error?.message||'Details check karein.');
    pendingUI(false);
   }else{
    message.textContent='Payment verification pending. Nayi payment entry mat banayein. Check status karein ya wahi payment retry karein.';
    pendingUI(true);
   }
  }catch(err){message.textContent='Payment abhi save nahi hua: '+err.message}
  finally{lock(false)}
 }
 const api={open,check,save};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.BitePOSPaymentUI=api;
})(typeof window!=='undefined'?window:globalThis);
