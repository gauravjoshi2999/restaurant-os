/* Customer-only payment visibility. An activated checkout is a Bite payment record,
   not independent bank settlement evidence or a customer-bank refund credit. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>'₹'+Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
 function classify(order,intent,unavailable=false){
  if(unavailable)return {kind:'unknown',title:'Payment status unavailable',
   note:'We cannot check this payment right now. If money was deducted, please contact Bite support with your order ID. Do not pay again until it is checked.'};
  if(!intent)return {kind:'unknown',title:'Payment not verified',
   note:'No confirmed Bite payment record is available for this order. If money was deducted, contact support with the order ID before trying again.'};
  const expected=Number(order?.amount),actual=Number(intent.amount);
  const matches=!!order&&intent.activated_order_id===order.id&&intent.restaurant_id===order.restaurant_id&&
   intent.status==='activated'&&intent.currency==='INR'&&Number.isFinite(expected)&&expected>0&&
   Number.isFinite(actual)&&actual>0&&Math.abs(actual-expected)<.001;
  if(!matches)return {kind:'review',title:'Payment needs verification',
   note:'The recorded checkout does not match this order. Please contact Bite support before making another payment.'};
  return {kind:'recorded',title:'Payment recorded by Bite',
   note:'Bite has confirmed this order payment. Cashfree merchant settlement and restaurant bank payout are separate.'};
 }
 function summary(order,intent,unavailable=false){
  const state=classify(order,intent,unavailable);
  return '<div class="bite-payment-chip bite-payment-'+esc(state.kind)+'" role="status">'+
   '<span class="bite-payment-dot" aria-hidden="true"></span>'+
   '<span>'+esc(state.title)+'</span></div>';
 }
 function details(order,intent,unavailable=false,refund=null,refundUnavailable=false){
  const state=classify(order,intent,unavailable);
  const recorded=state.kind==='recorded';
  const refundMissing=recorded&&['Cancelled','Rejected'].includes(String(order?.status||''))&&!refund&&!refundUnavailable;
  const note=refundMissing?
   '<p class="bite-payment-alert">No refund record is available yet for this cancelled payment. Contact Bite support with the order ID if you need a refund.</p>':'';
  const checked=recorded&&intent?.updated_at&&Number.isFinite(new Date(intent.updated_at).getTime())?
   '<small class="bite-payment-checked">Bite record updated: '+esc(new Date(intent.updated_at).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric'}))+'</small>':'';
  return '<section class="bite-detail-panel bite-detail-payment" aria-label="Payment status">'+
   '<div class="bite-payment-head"><span class="bite-payment-label">PAYMENT STATUS</span>'+
   '<strong class="bite-payment-title bite-payment-'+esc(state.kind)+'">'+esc(state.title)+'</strong></div>'+
   (recorded?'<strong class="bite-payment-amount">'+esc(money(intent.amount))+'</strong>':'')+
   '<p class="bite-payment-note">'+esc(state.note)+'</p>'+checked+note+
   '<button type="button" class="bite-payment-refresh" data-bite-refresh-payment>Refresh payment status</button>'+
   '</section>';
 }
 const api={classify,summary,details};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.BiteCustomerPaymentTracker=api;
})(typeof window!=='undefined'?window:globalThis);
