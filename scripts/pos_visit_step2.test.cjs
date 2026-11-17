'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const f=path=>fs.readFileSync(path,'utf8');
const ui=f('assets/bite-pos-visits.js');
const css=f('assets/bite-pos-visits.css');
const html=f('index.html');
const desk=f('assets/bite-pos-v2.js');
const sql=f('supabase/migrations/20261117143000_pos_visit_counts_step2.sql');
const hospitality=f('assets/owner-hospitality.js');
const draft=f('assets/bite-pos-drafts.js');
function module(){
 const w={document:{getElementById(){return null}},console,Event:function(){}};
 vm.runInNewContext(ui,{window:w,Date,Number,Map,console,Event:w.Event});
 return w.BitePOSVisits;
}
test('Real diner count is integer 1–200 and takeaway contributes zero seated people',()=>{
 const v=module();
 assert.equal(v.valid('dine_in',3).guestCount,3);
 assert.equal(v.valid('takeaway',null).guestCount,null);
 for(const raw of [null,0,-1,1.5,201,'abc','3.5'])
  assert.throws(()=>v.valid('dine_in',raw),/Dine-in/);
 assert.throws(()=>v.valid('other',5),/Dine-in/);
});
test('Canonical bill form has one Dine-in/Takeaway control; hotel room tender unchanged',()=>{
 for(const id of ['bitePOSVisitControls','posGuestCount','posVisitDineIn','posVisitTakeaway','posNewSaleBtn','posPaymentSection','posItemSummary','posWhatsAppConsent','posDraftCards'])
  assert.ok(html.includes(id),'Missing '+id);
 assert.match(css,/#bitePOSOrderType>label:not\(#bitePOSTableField\)/);
 assert.match(hospitality,/roomPOSSelected\(\)/);
 assert.match(hospitality,/function createRoomPOS/);
 assert.match(hospitality,/biteRoomPOSFolio/);
 assert.match(hospitality,/pos_visit_type:visit\.visitType/);
 assert.match(hospitality,/guest_count:visit\.guestCount/);
 assert.match(ui,/root\.BitePOSVisits=\{init,set,reset,selected,valid,detail,label,syncPropertyType,refresh,clear\}/);
});
test('Visit is transactionally attached to one POS bill and one payment — never later posted alone',()=>{
 assert.match(html,/sb\.rpc\('bite_create_counter_pos_visit_v1'/);
 assert.match(sql,/v_order:=public\.create_pos_order_with_balance_action/);
 assert.match(sql,/v_order:=public\.replace_unpaid_pos_order/);
 assert.match(sql,/insert into public\.restaurant_pos_visit_details/);
 assert.match(sql,/after insert on public\.bite_property_commands/);
 assert.match(sql,/new\.action <> 'pos_sale'/);
 assert.match(sql,/new\.payload \? 'pos_visit_type'/);
 assert.match(sql,/v_creator is distinct from new\.created_by/);
 assert.match(sql,/v_channel is distinct from/);
 assert.match(sql,/on delete restrict/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/for select to authenticated/);
 assert.match(sql,/for insert to authenticated/);
 assert.doesNotMatch(sql,/drop table|truncate table|delete from public\.orders/);
});
test('Draft restores diner counts and saved POS history displays genuine service',()=>{
 assert.match(draft,/visitType:/);
 assert.match(draft,/guestCount:/);
 assert.match(draft,/window\.BitePOSVisits\?\.set\?\./);
 assert.match(html,/window\.BitePOSVisits\?\.refresh\?\.\(sb,access\.restaurantId/);
 assert.match(html,/window\.BitePOSVisits\?\.detail\?\.\(o\.id\)/);
 assert.match(html,/Service: /);
 assert.match(html,/POS recorded receipt:/);
 assert.match(desk,/dineInBills/);
 assert.match(desk,/untrackedBills/);
 assert.match(desk,/n\.people\+' people served/);
});
