'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../assets/owner-capabilities.js');
const property=type=>({id:'property-a',business_type:type,capabilities:[...C.defaults[type]],can_configure:true});
test('restaurant, hotel and hybrid have one adaptive route map and shared tools',()=>{
 const r=C.routes(property('restaurant')),h=C.routes(property('hotel'),false),hy=C.routes(property('hybrid'));
 assert(r.includes('pos'));assert(!r.includes('rooms'));assert(!r.includes('folios'));
 assert(h.includes('hotel-register'));assert(h.includes('folios'));assert(!h.includes('orders'));assert(!h.includes('pos'));assert(!h.includes('menu'));
 for(const route of ['reports','settings','hr'])assert.equal(hy.filter(r=>r===route).length,1);
 assert(hy.includes('pos')&&hy.includes('rooms'));
});
test('mobile tabs adapt to server capabilities and cloud kitchen settings',()=>{
 assert.deepEqual(C.tabs(property('hotel'),false).map(t=>t.page),['overview','hotel-register','rooms','folios','more']);
 assert.deepEqual(C.tabs(property('hybrid')).map(t=>t.page),['overview','hotel-register','rooms','folios','more']);
 const r=property('restaurant');r.capabilities=r.capabilities.filter(c=>!['online_food_orders','dine_in'].includes(c));
 assert(!C.routes(r).includes('orders'));assert(!C.routes(r).includes('tables'));
 assert.deepEqual(C.tabs(r).map(t=>t.page),['overview','pos','menu','more']);
});
test('missing outlet access cannot grant restaurant routes to hotel staff',()=>{
 const p=property('hybrid');p.capabilities=['hotel_rooms','housekeeping'];p.can_configure=false;
 assert.deepEqual(C.routes(p,false),['overview','rooms','housekeeping','settings']);
 assert(!C.routes(p,false).includes('business-modules'));
 assert(!C.routes(property('hybrid'),false).includes('pos'));
});
test('dependency validation rejects incomplete hotel modules and orphan room charging',()=>{
 assert.throws(()=>C.validateModules(['folios']));
 assert.throws(()=>C.validateModules(['restaurant_pos']));
 assert.throws(()=>C.validateModules(['charge_to_room',...C.defaults.hotel]));
 assert.throws(()=>C.validateModules(['dine_in','restaurant_menu']));
 assert.throws(()=>C.validateModules(['invented_admin']));
 for(const d of Object.values(C.defaults))assert.doesNotThrow(()=>C.validateModules(d));
});
test('folio food is a source reference; deposits and pending payments are not sales',()=>{
 const e=(kind,category,amount,status='confirmed',tax_amount=0)=>({kind,category,amount,status,tax_amount});
 assert.deepEqual(C.hotelTotals([e('charge','room',1000,'confirmed',50),e('charge','food',200),e('reversal','food',50),e('charge','incidental',100),e('deposit_hold','deposit',500),e('deposit_apply','deposit',100),e('payment','payment',100),e('payment','payment',600,'pending')]),
 {room:1050,incidentals:100,foodOnFolios:150,collections:100,deposits:400,pending:600});
});
function client(){
 const store=new Map(),calls=[];let handler=async()=>({data:{id:'saved'},error:null});
 const access={role:'owner',restaurantId:'rest-a',property:property('hotel')};let user={id:'user-a'};
 const w={BiteCapabilities:C,BiteOwner:{day:()=> '2026-11-16'},addEventListener(){},setInterval(){},clearInterval(){},alert(){}};
 const context={window:w,document:{querySelector:()=>null},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},console,Date,Event:class{},navigator:{}};
 vm.runInNewContext(fs.readFileSync('assets/owner-hospitality.js','utf8'),context);
 w.BiteHospitality.init({sb:{rpc:async(name,args)=>{calls.push({name,args});return handler(name,args)}},getAccess:()=>access,getState:()=>({orders:[]}),getUser:()=>user});
 return {api:w.BiteHospitality,store,calls,access,setHandler:f=>handler=f,setUser:u=>user=u,setOffline:()=>context.navigator.onLine=false};
}
test('uncertain ledger response retains the same request UUID and rejects edited retries',async()=>{
 const c=client();c.setHandler(async()=>{throw Error('network interrupted')});
 await assert.rejects(c.api.command('payment',{folio_id:'folio-a',amount:100,method:'Cash'}));
 const first=c.calls[0].args.p_request;assert.equal(c.store.size,1);
 await assert.rejects(c.api.command('payment',{folio_id:'folio-a',amount:200,method:'Cash'}),/verification pending/);
 assert.equal(c.calls.length,1);
 c.setHandler(async()=>({data:{id:'same-receipt'},error:null}));
 await c.api.command('payment',{folio_id:'folio-a',amount:100,method:'Cash'});
 assert.equal(c.calls[1].args.p_request,first);assert.equal(c.store.size,0);
});
test('server permission rejection clears a definitively rejected attempt',async()=>{
 const c=client();c.setHandler(async()=>({data:null,error:{code:'42501',message:'Revoked'}}));
 await assert.rejects(c.api.command('charge',{folio_id:'f',amount:5,description:'water'}),/Revoked/);
 assert.equal(c.store.size,0);
});
test('recovery markers are scoped to both authenticated user and property',async()=>{
 const c=client();c.setHandler(async()=>{throw Error('offline')});
 await assert.rejects(c.api.command('payment',{folio_id:'f',amount:5}));
 c.access.property={...property('hotel'),id:'property-b'};
 await assert.rejects(c.api.command('payment',{folio_id:'f',amount:5}));
 c.setUser({id:'user-b'});
 await assert.rejects(c.api.command('payment',{folio_id:'f',amount:5}));
 assert.equal(c.store.size,3);assert(c.calls.every(c=>c.args.p_property));
});
test('offline check-in confirmation never sends a server mutation',async()=>{
 const c=client();c.setOffline();
 await assert.rejects(c.api.command('checkin',{id:'stay-a'}),/Offline/);
 assert.equal(c.calls.length,0);assert.equal(c.store.size,0);
});
test('numeric validation rejection can be corrected without an indefinite pending marker',async()=>{
 const c=client();c.setHandler(async()=>({data:null,error:{code:'22003',message:'numeric overflow'}}));
 await assert.rejects(c.api.command('charge',{folio_id:'f',amount:1e30,description:'invalid'}));
 assert.equal(c.store.size,0);
});
test('pre-arrival advances are collections, not room or food revenue',()=>{
 const t=C.hotelTotals([{kind:'advance',category:'payment',amount:500,status:'confirmed'}]);
 assert.equal(t.collections,500);assert.equal(t.room,0);assert.equal(t.foodOnFolios,0);
});
