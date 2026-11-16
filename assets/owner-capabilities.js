/* Navigation uses server-issued property capabilities; SQL remains authoritative. */
(function(root){
 'use strict';
 const hotel=[['hotel-register','Register','guest_register'],['reservations','Reservations','reservations'],['rooms','Rooms','hotel_rooms'],['guests','Guests','guest_register'],['folios','Folios & Bills','folios'],['housekeeping','Housekeeping','housekeeping']];
 const restaurant=[['orders','Orders','online_food_orders'],['pos','POS & Billing','restaurant_pos'],['menu','Menu','restaurant_menu'],['tables','Tables','dine_in'],['khata','Customer Khata','restaurant_pos'],['cashbook','Cashbook','restaurant_pos'],['purchases','Suppliers','inventory'],['inventory','Stock','inventory']];
 const common=[['expenses','Expenses','expenses'],['reports','Reports','reporting'],['hr','Staff','staff_management']];
 const defaults={
  restaurant:['restaurant_pos','restaurant_menu','dine_in','takeaway','online_food_orders','inventory','expenses','staff_management','reporting'],
  hotel:['hotel_rooms','guest_register','reservations','folios','housekeeping','hotel_incidentals','expenses','staff_management','reporting']
 };
 defaults.hybrid=[...new Set([...defaults.restaurant,...defaults.hotel,'room_service','charge_to_room'])];
 function has(property,cap){return Array.isArray(property?.capabilities)&&property.capabilities.includes(cap)}
 function routes(property,restaurantAccess=true){
  if(!property)return null;
  return ['overview',...hotel.filter(r=>has(property,r[2])).map(r=>r[0]),
   ...(restaurantAccess?restaurant.filter(r=>has(property,r[2])).map(r=>r[0]):[]),
   ...common.filter(r=>has(property,r[2])).map(r=>r[0]),'settings',...(property.can_configure?['business-modules']:[])];
 }
 function tabs(property,restaurantAccess=true){
  const allowed=routes(property,restaurantAccess);
  const source=has(property,'hotel_rooms')?[['overview','Home','home'],['hotel-register','Register','orders'],['rooms','Rooms','pos'],['folios','Folios','menu']]:[['overview','Home','home'],['orders','Orders','orders'],['pos','POS','pos'],['menu','Menu','menu']];
  return [...source.filter(r=>!allowed||allowed.includes(r[0])).map(([page,label,icon])=>({page,label,icon})),{page:'more',label:'More',icon:'more'}];
 }
 function validateModules(caps){
  if(!Array.isArray(caps)||caps.some(c=>!defaults.hybrid.includes(c)))throw Error('Unknown module');
  const has=c=>caps.includes(c),hotel=defaults.hotel.filter(c=>c.startsWith('hotel_')||['guest_register','reservations','folios','housekeeping'].includes(c));
  if(hotel.some(has)&&!hotel.every(has))throw Error('Keep hotel rooms, register, reservations, folios, housekeeping and incidentals together.');
  if(['room_service','charge_to_room'].some(has)&&!['hotel_rooms','folios','restaurant_pos','restaurant_menu'].every(has))throw Error('Room charging needs hotel folios and restaurant POS/menu.');
  if(['restaurant_pos','online_food_orders'].some(has)&&!has('restaurant_menu'))throw Error('POS and online orders require Menu.');
  if(['dine_in','takeaway'].some(has)&&!has('restaurant_pos'))throw Error('Dine-in and takeaway require POS.');
  return caps;
 }
 // A folio collects a linked POS sale; it must never recognize it a second time.
 function hotelTotals(entries){
  const out={room:0,incidentals:0,foodOnFolios:0,collections:0,deposits:0,pending:0};
  for(const e of entries||[]){
   const amount=Math.round((Number(e.amount||0)+Number(e.tax_amount||0))*100)/100;
   if(e.status==='pending'){out.pending+=Number(e.amount||0);continue}
   if(e.status!=='confirmed')continue;
   const sign=['discount','reversal'].includes(e.kind)?-1:1;
   if(['charge','discount','reversal'].includes(e.kind)){
    if(e.category==='food')out.foodOnFolios+=sign*amount;
    else out[e.category==='room'?'room':'incidentals']+=sign*amount;
   }
   if(['payment','advance'].includes(e.kind))out.collections+=amount;
   if(e.kind==='refund')out.collections-=amount;
   if(e.kind==='deposit_hold')out.deposits+=amount;
   if(['deposit_return','deposit_apply'].includes(e.kind))out.deposits-=amount;
  }
  for(const k of Object.keys(out))out[k]=Math.round(out[k]*100)/100;
  return out;
 }
 const api={hotel,restaurant,common,defaults,has,routes,tabs,validateModules,hotelTotals};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BiteCapabilities=api;
})(typeof window!=='undefined'?window:globalThis);
