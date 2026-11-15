'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const schedule=require('../assets/customer-scheduled-delivery.js');
const customer=fs.readFileSync('customer.html','utf8');
const owner=fs.readFileSync('index.html','utf8');
const js=fs.readFileSync('assets/customer-scheduled-delivery.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261115180752_bite_scheduled_delivery_opt_in_snapshot_v1.sql','utf8');
const published=fs.readFileSync('supabase/migrations/20261115181751_bite_public_schedule_capability_v1.sql','utf8');
const r={id:'restaurant-1',accepts_delivery:true,accepts_scheduled_delivery:true,
 scheduled_lead_minutes:90,scheduled_horizon_days:1,
 opening_time:'09:00:00',closing_time:'22:00:00',is_temporarily_closed:false};
test('schedule is opt-in and never invents slots without published hours',()=>{
 assert.deepEqual(schedule.generateSlots({...r,accepts_scheduled_delivery:false}),[]);
 assert.deepEqual(schedule.generateSlots({...r,accepts_delivery:false}),[]);
 assert.deepEqual(schedule.generateSlots({...r,opening_time:null}),[]);
 assert.deepEqual(schedule.generateSlots({...r,delivery_paused:true}),[]);
});
test('IST 30-minute slots respect lead time, restaurant hours and horizon',()=>{
 const now=Date.parse('2026-11-15T06:15:00Z');// IST 11:45
 const slots=schedule.generateSlots(r,now);
 assert.ok(slots.length>0);
 assert.equal(slots[0].iso,'2026-11-15T08:00:00.000Z');// IST 13:30
 assert.equal(slots[0].dayKey,'2026-11-15');
 assert.ok(slots.every(x=>Date.parse(x.iso)>=now+90*60*1000));
 assert.ok(slots.every(x=>Date.parse(x.iso)<=now+86400000));
 assert.ok(slots.every(x=>schedule.withinHours(r,Date.parse(x.iso))));
});
test('overnight restaurant can choose late evening and after-midnight slots',()=>{
 const o={...r,opening_time:'18:00',closing_time:'01:00'};
 assert.equal(schedule.withinHours(o,Date.parse('2026-11-15T18:00:00Z')),true);// IST 23:30
 assert.equal(schedule.withinHours(o,Date.parse('2026-11-15T19:00:00Z')),true);// IST 00:30
 assert.equal(schedule.withinHours(o,Date.parse('2026-11-15T19:30:00Z')),false);// IST 01:00
 assert.equal(schedule.withinHours(o,Date.parse('2026-11-15T10:00:00Z')),false);
});
test('owner must opt-in with bounded notice and visible slot in order queue',()=>{
 assert.match(owner,/id="ownerSettingScheduledDelivery"/);
 assert.match(owner,/scheduled_lead_minutes:Number\(/);
 assert.match(owner,/scheduled_horizon_days:Number\(/);
 assert.match(owner,/scheduledFor:x\.scheduled_for\|\|null/);
 assert.match(owner,/scheduledInbox/);
 assert.match(owner,/scheduledHtml/);
 assert.match(owner,/Scheduling ke liye delivery on aur proper opening/);
});
test('customer scheduling only for real delivery, not test charge or old payment intent',()=>{
 assert.match(customer,/assets\/customer-scheduled-delivery\.js\?v=20261115-schedule1/);
 assert.match(customer,/assets\/customer-scheduled-delivery\.css\?v=20261115-schedule1/);
 assert.match(customer,/window\.BiteSchedule\?\.sync\?\.\(\)/);
 assert.match(customer,/selectedDeliverySlot=!BITE_SANDBOX_CHECKOUT&&mode==='delivery'/);
 assert.match(customer,/selectedDeliverySlot\?'bite_prepare_scheduled_checkout_v1':'bite_prepare_checkout_v2'/);
 assert.match(customer,/checkoutArgs\.p_scheduled_for=selectedDeliverySlot/);
 assert.match(js,/BITE_SANDBOX_CHECKOUT/);
 assert.match(js,/pendingLiveCheckout/);
 assert.match(js,/clearCheckoutIdempotency/);
 assert.match(js,/window\.BiteCustomerExtras\?\.saveCheckoutKey\?\.\(null\)/);
 assert.doesNotMatch(js,/Cashfree\(|sb\.rpc|create_bite/);
});
test('server opt-in & immutable paid-order slot are validated at checkout before Cashfree',()=>{
 assert.match(sql,/accepts_scheduled_delivery boolean not null default false/);
 assert.match(sql,/p_scheduled_for<now\(\)\+\(r.scheduled_lead_minutes/);
 assert.match(sql,/mod\(extract\(minute from t\)::integer,30\)/);
 assert.match(sql,/perform public\.bite_validate_scheduled_delivery_v1/);
 assert.match(sql,/v_intent.provider_attempted_at is not null/);
 assert.match(sql,/Checkout key belongs to another delivery slot/);
 assert.match(sql,/v\.customer_note,false,v\.scheduled_for/);
 assert.match(sql,/revoke all on function public\.bite_prepare_scheduled_checkout_v1/);
 assert.match(published,/'accepts_scheduled_delivery'/);
 assert.match(published,/'scheduled_lead_minutes'/);
 assert.match(published,/'scheduled_horizon_days'/);
});
test('RLS reads customer-only scheduled rows without blocking the initial order cards',()=>{
 assert.match(customer,/sb\.from\('orders'\)\.select\('id,scheduled_for'\)\.eq\('customer_id',requestedCustomerId\)/);
 assert.match(customer,/order\.scheduled_for=ownSchedule\.get\(order\.id\)\|\|null/);
 assert.match(customer,/Preferred delivery:/);
 assert.match(customer,/Restaurant confirmation required/);
});

test('closed-now restaurant can request a future slot but cannot select ASAP without scheduling',()=>{
 const allDay={...r,opening_time:'00:00',closing_time:'23:59',scheduled_horizon_days:3};
 assert.equal(schedule.canSchedule(allDay),true);
 assert.ok(schedule.generateSlots(allDay,Date.now(),1).length===1);
 assert.equal(schedule.canSchedule({...allDay,accepts_scheduled_delivery:false}),false);
 assert.equal(schedule.canSchedule({...allDay,delivery_paused:true}),false);
 assert.match(js,/closedNow\|\|\(typeof pendingLiveCheckout/);
 assert.match(js,/Restaurant closed now. Select a future delivery slot/);
 assert.match(customer,/window\.BiteSchedule\?\.canSchedule\?\.\(activeRestaurant\)/);
 assert.match(customer,/Restaurant abhi closed hai\. Pay karne se pahle Schedule se future delivery time choose karein/);
 assert.match(customer,/BiteDiscovery\.isClosed\(activeRestaurant\)&&!window\.BiteSchedule\?\.canSchedule/);
});
test('future-slot exception is server-only, revalidated, and preserves ASAP closure guards',()=>{
 const migration=fs.readFileSync('supabase/migrations/20261115213814_bite_scheduled_future_hours_v1.sql','utf8');
 assert.match(migration,/perform public\.bite_validate_scheduled_delivery_v1/);
 assert.match(migration,/if v_scheduled_for is null and v_restaurant\.opening_time/);
 assert.match(migration,/if v_scheduled_for is null and v_restaurant\.is_temporarily_closed/);
 assert.match(migration,/p_delivery_type<>'delivery'/);
 assert.match(migration,/set_config\('app\.bite_scheduled_for',p_scheduled_for::text,true\)/);
 assert.match(migration,/set_config\('app\.bite_scheduled_for','',true\)/);
 assert.doesNotMatch(migration,/Cashfree|refund_jobs|order_financials|wallet/);
});

test('closed restaurant cannot pay without an accepted future slot',()=>{
 assert.match(customer,/const needsScheduleTime=!BITE_SANDBOX_CHECKOUT/);
 assert.match(customer,/missingSchedule=needsScheduleTime&&!window\.BiteSchedule\?\.getSelectedFor/);
 assert.match(customer,/checkoutPaymentReady\)\|\|missingSchedule/);
 assert.match(customer,/missingSchedule\?'Choose delivery time'/);
 assert.match(customer,/missingSchedule\?'Restaurant is closed now\. Select a preferred delivery slot before paying\.'/);
 assert.match(js,/if\(typeof syncCheckoutPaymentButton==='function'\)syncCheckoutPaymentButton\(\)/);
});
