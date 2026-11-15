'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Discovery=require('../assets/customer-discovery.js');
const html=fs.readFileSync('customer.html','utf8');
const picker=fs.readFileSync('assets/customer-premium.js','utf8');

test('wrong PIN does not expose delivery; GPS opt-in reveals only pickup alternatives',()=>{
 const nearby={id:'near',name:'Nearby Food',accepts_pickup:true,accepts_delivery:true,serviceable:false,latitude:25.07,longitude:73.89,cuisine_tags:[]};
 const deliveryOnly={id:'far',name:'Delivery Only',accepts_pickup:false,accepts_delivery:true,serviceable:false,latitude:25.07,longitude:73.88,cuisine_tags:[]};
 const opts={pin:'313300',service:'all'};
 assert.deepEqual(Discovery.selectRestaurants([nearby,deliveryOnly],[],opts).map(x=>x.restaurant.id),[]);
 const gps={latitude:25.07,longitude:73.88};
 assert.deepEqual(Discovery.selectRestaurants([nearby,deliveryOnly],[],{...opts,geo:gps}).map(x=>x.restaurant.id),['near']);
 assert.deepEqual(Discovery.selectRestaurants([nearby,deliveryOnly],[],{...opts,geo:gps,service:'delivery'}),[]);
 assert.equal(nearby.serviceable,false,'GPS never changes the verified delivery area');
});

function geocodeFixture(original,postcode){
 const nodes=new Map([
  ['addressPostal',{value:original}],
  ['addressLine',{value:''}],['addressLandmark',{value:''}],
  ['addressCity',{value:''}],['addressState',{value:'Rajasthan'}]
 ]);
 const $=id=>nodes.get(id);
 const hints=[];
 const start=html.indexOf('async function reverseGeocodeAddress(lat,lon){');
 const end=html.indexOf('function placeAddressPin(',start);
 assert.ok(start>=0&&end>start);
 const ctx=vm.createContext({
  $,
  addressLookupToken:0,
  encodeURIComponent,
  setAddressMapHint:(message,isError)=>hints.push({message,isError}),
  fetch:async()=>({ok:true,json:async()=>({address:{postcode,city:'Rajsamand',state:'Rajasthan',road:'Test street'}})}),
  console
 });
 vm.runInContext(html.slice(start,end)+';globalThis.runReverse=reverseGeocodeAddress;',ctx);
 return{ctx,nodes,hints};
}
test('map returning 313300 never overwrites customer-confirmed PIN 313324',async()=>{
 const f=geocodeFixture('313324','313300');
 await f.ctx.runReverse(25.07,73.88);
 assert.equal(f.nodes.get('addressPostal').value,'313324');
 assert.match(f.hints.at(-1).message,/313300/);
 assert.match(f.hints.at(-1).message,/313324/);
 assert.equal(f.hints.at(-1).isError,true);
});
test('an unknown PIN is a suggested value, not a verified service area',async()=>{
 const f=geocodeFixture('','313300');
 await f.ctx.runReverse(25.07,73.88);
 assert.equal(f.nodes.get('addressPostal').value,'313300');
 assert.match(f.hints.at(-1).message,/suggest/i);
 assert.match(f.hints.at(-1).message,/verify/i);
});
test('invalid reverse postcode is ignored and existing PIN preserved',async()=>{
 const f=geocodeFixture('313324','31330');
 await f.ctx.runReverse(25.07,73.88);
 assert.equal(f.nodes.get('addressPostal').value,'313324');
});
test('location intro asks permission on explicit action; no auto-geolocation request',()=>{
 assert.match(picker,/scheduleLocationIntroduction\('no-pin'\)/);
 assert.match(picker,/sessionStorage\.setItem\(locationIntroKey,'1'\)/);
 assert.match(picker,/if\(BITE_DIRECT_MODE\|\|locationIntroTimer/);
 assert.match(picker,/if\(!locationSheet\.hidden\|\|document\.body\.dataset\.view!=='home'/);
 assert.match(picker,/geoButton\.addEventListener\('click'/);
 assert.match(html,/navigator\.geolocation\.getCurrentPosition\(pos=>/);
 assert.doesNotMatch(picker,/navigator\.geolocation\.getCurrentPosition/);
 assert.match(picker,/bite:location-detected/);
 assert.match(html,/BiteLocationExperience\?\.onDiscoveryUpdated/);
});
test('GPS never auto sets delivery PIN or changes customer auth/payment code',()=>{
 const start=html.indexOf('function enableCustomerLocation(){'),end=html.indexOf('function discoveryEmptyMarkup(){',start);
 assert.ok(start>=0&&end>start);
 const segment=html.slice(start,end);
 assert.doesNotMatch(segment,/bite_discovery_pin|currentDiscoveryPin\s*=|addressPostal\)\.value\s*=/);
 assert.match(segment,/customerGeo=\{latitude,longitude\}/);
 assert.doesNotMatch(segment,/payment|Cashfree|service_role/i);
});
