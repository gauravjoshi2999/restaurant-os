'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Filter=require('../assets/customer-filter-sheet.js');
const Discovery=require('../assets/customer-discovery.js');
const html=fs.readFileSync('customer.html','utf8');
const css=fs.readFileSync('assets/customer-filter-sheet.css','utf8');
const js=fs.readFileSync('assets/customer-filter-sheet.js','utf8');
test('filter state sanitizes all user-adjustable selectors and resets to known defaults',()=>{
 assert.deepEqual(Filter.defaults(),{sort:'recommended',rating:'0',diet:'all',service:'all',openNow:false,scheduleOnly:false,category:'all',favourites:false});
 const s=Filter.normalized({sort:'hacked',rating:'5',diet:'mystery',service:'other',openNow:'true'});
 assert.equal(s.sort,'recommended');assert.equal(s.rating,'0');assert.equal(s.service,'all');
 assert.equal(s.openNow,false);
 assert.equal(s.scheduleOnly,false);
 assert.equal(Filter.normalized({scheduleOnly:true}).scheduleOnly,true);
 assert.equal(Filter.normalized({sort:'fast',rating:'4.5',diet:'veg',service:'delivery',openNow:true}).sort,'fast');
});
test('live filter options reuse restaurant public data, not synthetic ratings or ETA',()=>{
 const sort=Filter.filterOptions({sort:'fast',rating:'4',diet:'veg',service:'delivery',openNow:true},
  {pin:'313324',query:'thali'});
 assert.equal(sort.fast,true);
 assert.equal(sort.sort,'recommended');
 assert.equal(sort.minRating,4);
 assert.equal(sort.service,'delivery');
 assert.equal(sort.diet,'veg');
 assert.equal(sort.pin,'313324');
 assert.equal(sort.query,'thali');
 assert.equal(sort.openNow,true);
 assert.equal(sort.scheduledOnly,false);
 assert.equal(Filter.filterOptions({scheduleOnly:true,service:'pickup'}).service,'delivery');
});
test('filter sheet results use the same restaurant serviceability and rating rules as home',()=>{
 const restaurants=[
  {id:'r1',name:'Pure Veg',average_rating:4.4,has_veg:true,accepts_delivery:true,serviceable:true,accepts_pickup:true,
   opening_time:null,closing_time:null},
  {id:'r2',name:'No zone',average_rating:4.8,has_veg:true,accepts_delivery:true,serviceable:false,accepts_pickup:false},
  {id:'r3',name:'Not rated',average_rating:0,has_veg:true,accepts_delivery:true,serviceable:true,accepts_pickup:true},
  {id:'r4',name:'Non veg only',average_rating:4.9,has_veg:false,has_nonveg:true,accepts_delivery:true,serviceable:true}
 ];
 const opts=Filter.filterOptions({sort:'rating',rating:'4',diet:'veg',service:'delivery'},{pin:'313324'});
 const results=Discovery.selectRestaurants(restaurants,[],opts);
 assert.deepEqual(results.map(x=>x.restaurant.id),['r1']);
});
test('mobile sheet includes proper dialog, keyboard trap, immediate time-only and safe disabled scheduling',()=>{
 assert.match(html,/customer-filter-sheet\.css\?v=20261115-sheet1/);
 assert.match(html,/customer-filter-sheet\.js\?v=20261115-sheet1/);
 for(const token of [
  'role="dialog" aria-modal="true"','role="tablist"','role="tabpanel"','aria-orientation="vertical"',
  'biteFilterApply','biteFilterClear','biteFilterCancel','biteFilterCloseX',
  'biteFilterOpenNow','biteFilterFast','biteFilterScheduleOnly','id="biteFilterAppliedCount"',
  "if(event.key==='Escape')","if(event.key==='Tab')",
  'Schedule available'
 ])assert.ok(js.includes(token),'Missing accessibility or safe scheduling guard: '+token);
 assert.match(css, /@media\(max-width:767px\)/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/bite-filter-backdrop\[hidden\]/);
});
test('mobile filter sheet is scoped to real customer discovery; no checkout or hidden provider writes',()=>{
 assert.match(js,/root\.restaurantSortFast=next\.sort==='fast'/);
 assert.match(js,/root\.restaurantServiceFilter=next\.scheduleOnly\?'delivery':next\.service/);
 assert.match(js,/if\(typeof renderRestaurants==='function'\)renderRestaurants\(\)/);
 assert.match(js,/root\.biteStorefrontLoading/);
 assert.doesNotMatch(js,/Cashfree\(|sb\.rpc|sb\.from|create_bite|prepare_checkout|insert\(/);
 assert.doesNotMatch(js,/getLocation|navigator\.geolocation|random.*rating/i);
});

test('Schedule available filters by owner opt-in, published hours, live PIN serviceability and delivery status',()=>{
 const future=new Date(Date.now()+30*86400000).toISOString();
 const base={accepts_delivery:true,accepts_pickup:true,serviceable:true,accepts_scheduled_delivery:true,opening_time:'09:00',closing_time:'23:00',delivery_paused:false};
 const candidates=[
  {...base,id:'eligible',name:'Eligible'},
  {...base,id:'closed-now',name:'Currently closed',opening_time:'01:00',closing_time:'02:00'},
  {...base,id:'pickup',name:'Pickup only',accepts_delivery:false},
  {...base,id:'not-in-pin',name:'Outside area',serviceable:false},
  {...base,id:'no-hours',name:'No schedule hours',opening_time:null},
  {...base,id:'not-opted',name:'Not opted in',accepts_scheduled_delivery:false},
  {...base,id:'paused',name:'Delivery paused',delivery_paused:true},
  {...base,id:'indefinitely-closed',name:'Closed indefinitely',is_temporarily_closed:true},
  {...base,id:'temporarily-closed',name:'Scheduled reopening',is_temporarily_closed:true,temporary_closure_until:future},
 ];
 const selected=Discovery.selectRestaurants(candidates,[],Filter.filterOptions({scheduleOnly:true,service:'delivery'},{pin:'313324'}));
 assert.deepEqual(selected.map(x=>x.restaurant.id),['eligible','closed-now']);
 assert.equal(Filter.filterOptions({scheduleOnly:true,service:'pickup'}).service,'delivery');
 assert.equal(Filter.normalized({scheduleOnly:true}).scheduleOnly,true);
});
test('Schedule filter reset and customer discovery use the same state flag without touching Cashfree',()=>{
 assert.match(html,/window\.BiteScheduleDiscoveryOnly=false/);
 assert.match(html,/scheduledOnly:window\.BiteScheduleDiscoveryOnly===true/);
 assert.match(js,/root\.BiteScheduleDiscoveryOnly=next\.scheduleOnly/);
 assert.match(js,/if\(input\.checked\)draft\.service='delivery'/);
 assert.match(js,/if\(draft\.service==='pickup'\)draft\.scheduleOnly=false/);
 assert.doesNotMatch(js,/Cashfree\(|sb\.rpc|bite_prepare_checkout/);
});

test('schedule no-results has an actionable reset, without falsely claiming delivery',()=>{
 assert.match(html,/Scheduled delivery abhi available nahi hai/);
 assert.match(html,/data-discovery-reset>Clear scheduling filter/);
 assert.match(html,/window\.BiteScheduleDiscoveryOnly=false/);
});
