/* Bite restaurant-direct ordering and opt-in POS WhatsApp bill helpers. */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const BASE='https://gauravjoshi2999.github.io/restaurant-os/customer.html';
 function normalizeIndianMobile(value){
  let digits=String(value??'').replace(/\D/g,'');
  if(digits.length===12&&digits.startsWith('91'))digits=digits.slice(2);
  if(!/^[6-9]\d{9}$/.test(digits))return null;
  return '91'+digits;
 }
 function directRestaurantUrl(restaurantId){
  if(!UUID.test(String(restaurantId||'')))throw new Error('Valid restaurant is required.');
  const url=new URL(BASE);url.searchParams.set('direct','1');
  url.searchParams.set('restaurant',String(restaurantId).toLowerCase());
  return url.toString();
 }
 function billMessage(payload){
  const id=String(payload?.restaurantId||''),link=directRestaurantUrl(id);
  const name=String(payload?.restaurantName||'Your restaurant').trim().slice(0,100);
  const code=String(payload?.orderCode||'').trim().slice(0,70);
  const customer=String(payload?.customerName||'').trim().slice(0,100);
  const items=Array.isArray(payload?.items)?payload.items:[];
  const fmt=x=>'₹'+Number(x||0).toLocaleString('en-IN',{maximumFractionDigits:2,minimumFractionDigits:2});
  const total=Number(payload?.total||0),paid=Number(payload?.paid||0),due=Number(payload?.due||0),waived=Number(payload?.waived||0);
  if(!Number.isFinite(total)||total<0||!Number.isFinite(paid)||paid<0||!Number.isFinite(due)||due<0||!Number.isFinite(waived)||waived<0)
   throw new Error('Invalid invoice amount');
  if(!items.length)throw new Error('Bill has no items');
  const lines=[
   '🧾 '+name+' | Bite Bill',
   code?'Bill: '+code:null,
   customer?'Customer: '+customer:null,
   'Items:',
   ...items.slice(0,50).map(item=>{
    const qty=Number(item.quantity),unit=Number(item.unit_price??item.price);
    if(!Number.isFinite(qty)||qty<=0||!Number.isFinite(unit)||unit<0)throw new Error('Invalid bill item');
    return '• '+String(item.name||item.item_name||'Item').slice(0,90)+' × '+qty+' — '+fmt(qty*unit);
   }),
   'Total: '+fmt(total),
   'Received: '+fmt(paid),
   waived>0?'Waived: '+fmt(waived):null,
   due>0?'Balance due: '+fmt(due):null,
   '',
   '🍽️ Order again from '+name+':',
   link,
   'Only this restaurant’s menu will open from this link.',
   'Thank you for visiting!'
  ];
  return lines.filter(x=>x!==null).join('\n');
 }
 function whatsAppUrl(mobile,message){
  const digits=normalizeIndianMobile(mobile);
  if(!digits)throw new Error('Valid customer WhatsApp mobile number required.');
  if(!message||typeof message!=='string')throw new Error('Message required');
  return 'https://wa.me/'+digits+'?text='+encodeURIComponent(message);
 }
 const api=Object.freeze({normalizeIndianMobile,directRestaurantUrl,billMessage,whatsAppUrl});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.BiteDirectOrder=api;
})(typeof window!=='undefined'?window:globalThis);
