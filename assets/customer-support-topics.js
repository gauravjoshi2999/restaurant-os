/* Bite customer Help & Support topic shortcuts.
 * UI-only: uses the existing customer_support_tickets category, subject and message fields.
 * Never invent payment status or promise a support response timeframe.
 */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BiteSupportTopics=api;
 if(typeof document!=='undefined')api.mount(document);
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const allowedCategories=Object.freeze(['Order','Payment','Account','Restaurant','Other']);
 const options=Object.freeze({
  'order-delayed':Object.freeze({label:'Order is delayed',category:'Order',suggestion:'My order is delayed',
   guidance:'Check My Orders for the latest verified status. If delivery is delayed, share your order ID with support.'}),
  'restaurant-rejected':Object.freeze({label:'Restaurant rejected',category:'Order',suggestion:'Restaurant rejected my order',
   guidance:'If an online payment was made, check the recorded refund status in My Orders. Rejection alone does not confirm a refund.'}),
  'cancel-order':Object.freeze({label:'Cancellation help',category:'Order',suggestion:'Help with order cancellation',
   guidance:'Cancellation availability depends on the real order status. This support request does not cancel your order.'}),
  'payment-deducted':Object.freeze({label:'Money deducted, no order',category:'Payment',suggestion:'Payment deducted but order not confirmed',
   guidance:'Do not pay again until the previous Cashfree payment has been checked. Include the payment or order reference if available.'}),
  'refund-status':Object.freeze({label:'Refund status',category:'Payment',suggestion:'Need help with a refund',
   guidance:'The refund status shown in My Orders is based on verified provider records. A support request does not initiate a refund.'}),
  'sign-in':Object.freeze({label:'Login or account',category:'Account',suggestion:'Unable to access my account',
   guidance:'Never share your password, OTP or complete card details in a support request.'}),
  'other':Object.freeze({label:'Something else',category:'Other',suggestion:'General help request',
   guidance:'Describe the problem clearly. Include an order reference only if it relates to your request.'})
 });
 function selection(key,currentSubject='',lastSuggested=''){
  const item=options[key];if(!item)return null;
  const existing=String(currentSubject??'').trim();
  const subject=(!existing||existing===lastSuggested)?item.suggestion:String(currentSubject);
  return {key,label:item.label,category:item.category,subject,suggested:item.suggestion,guidance:item.guidance};
 }
 function mount(doc){
  const group=doc.getElementById('biteSupportTopics');
  const category=doc.getElementById('customerSupportCategory');
  const subject=doc.getElementById('customerSupportSubject');
  const help=doc.getElementById('biteSupportTopicHelp');
  const message=doc.getElementById('customerSupportMessage');
  if(!group||!category||!subject||!help||!message)return false;
  if(group.dataset.biteMounted==='1')return true;
  group.dataset.biteMounted='1';
  let lastSuggested='';
  group.addEventListener('click',event=>{
   const button=event.target.closest?.('[data-bite-support-topic]');
   if(!button||!group.contains(button))return;
   const chosen=selection(button.dataset.biteSupportTopic,subject.value,lastSuggested);
   if(!chosen)return;
   category.value=chosen.category;
   subject.value=chosen.subject;
   lastSuggested=chosen.suggested;
   help.textContent=chosen.guidance;
   help.hidden=false;
   for(const chip of group.querySelectorAll('[data-bite-support-topic]'))
    chip.setAttribute('aria-pressed',String(chip===button));
   message.focus({preventScroll:true});
  });
  category.addEventListener('change',()=>{
   for(const chip of group.querySelectorAll('[data-bite-support-topic]'))
    chip.setAttribute('aria-pressed','false');
   help.hidden=true;
   lastSuggested='';
  });
  doc.getElementById('customerSupportForm')?.addEventListener('reset',()=>{
   for(const chip of group.querySelectorAll('[data-bite-support-topic]'))
    chip.setAttribute('aria-pressed','false');
   help.hidden=true;
   lastSuggested='';
  });
  return true;
 }
 return {allowedCategories,options,selection,mount};
});
