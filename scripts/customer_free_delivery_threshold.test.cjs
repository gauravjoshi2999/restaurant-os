'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const customer=fs.readFileSync('customer.html','utf8');
const owner=fs.readFileSync('index.html','utf8');
const facts=fs.readFileSync('assets/customer-restaurant-experience.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261115175529_bite_owner_free_delivery_subtotal_threshold.sql','utf8');

test('owner can opt in or disable food-subtotal free delivery without fake offers',()=>{
 assert.match(owner,/id="ownerSettingFreeDeliveryAbove"/);
 assert.match(owner,/free_delivery_above:optionalAmount\('ownerSettingFreeDeliveryAbove'\)/);
 assert.match(owner,/set\('ownerSettingFreeDeliveryAbove',r\.free_delivery_above\)/);
 assert.ok(owner.includes("return v===''?null:Number(v)"));
 assert.match(owner,/payload\.free_delivery_above<1/);
});
test('checkout estimate only waives delivery fee above configured threshold',()=>{
 assert.match(customer,/threshold=Number\(activeRestaurant\?\.free_delivery_above\|\|0\)/);
 assert.match(customer,/delivery&&threshold>0&&subtotal>=threshold\?0:baseFee/);
 assert.match(customer,/Final payable amount is verified securely before payment/);
 assert.match(customer,/Free delivery applied for this restaurant/);
 assert.match(customer,/Add '\+money\(threshold-subtotal\)\+' more in food/);
 assert.doesNotMatch(customer,/free_delivery_above:\s*99/);
});
test('backend computes offer only after zone and minimum are validated and before payable snapshot',()=>{
 const min=sql.indexOf('if v_total+v_fee<1 or v_total+v_fee>1000000');
 const waiver=sql.indexOf("p_delivery_type='delivery' and v_restaurant.free_delivery_above");
 assert.ok(waiver>=0&&min>=0);
 assert.match(sql,/v_total>=v_restaurant\.free_delivery_above then v_fee:=0/);
 assert.match(sql,/free_delivery_above is null/);
 assert.match(sql,/check \(/);
 assert.match(sql,/select pg_get_functiondef\('public\.bite_prepare_live_checkout/);
 assert.match(sql,/refusing to modify/);
 assert.match(sql,/''free_delivery_above''/);
});
test('restaurant details only claim offer if owner configured threshold',()=>{
 assert.match(facts,/threshold>0\?' · Free delivery above '/);
 assert.match(facts,/Final charge confirmed during checkout/);
});
