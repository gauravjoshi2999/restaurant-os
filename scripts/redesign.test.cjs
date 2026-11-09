const test=require('node:test');
const assert=require('node:assert/strict');
const discovery=require('../assets/customer-discovery.js');
const dashboard=require('../assets/owner-dashboard.js');

test('delivery discovery excludes paused and temporarily closed restaurants',()=>{
  const restaurants=[
    {id:'open',name:'Open',accepts_delivery:true},
    {id:'paused',name:'Paused',accepts_delivery:true,delivery_paused:true},
    {id:'closed',name:'Closed',accepts_delivery:true,is_temporarily_closed:true},
    {id:'pickup',name:'Pickup',accepts_pickup:true}
  ];
  assert.deepEqual(discovery.selectRestaurants(restaurants,[],{service:'delivery'}).map(x=>x.restaurant.id),['open']);
  assert.equal(discovery.isClosed({is_temporarily_closed:true,temporary_closure_until:'2000-01-01'}),false);
});

test('fastest preparation is respected even after proximity is enabled',()=>{
  const restaurants=[{id:'near',latitude:24,longitude:73,estimated_prep_minutes:50},{id:'fast',latitude:25,longitude:74,estimated_prep_minutes:15}];
  assert.equal(discovery.selectRestaurants(restaurants,[],{geo:{latitude:24,longitude:73}})[0].restaurant.id,'near');
  assert.equal(discovery.selectRestaurants(restaurants,[],{fast:true,geo:{latitude:24,longitude:73}})[0].restaurant.id,'fast');
});

test('dish search joins only the matching restaurant and respects cuisine filters',()=>{
  const restaurants=[{id:'a',name:'Local Kitchen',cuisine_tags:['North Indian']},{id:'b',name:'Another Kitchen',cuisine_tags:['Pizza']}];
  const items=[{restaurant_id:'a',name:'Paneer thali'},{restaurant_id:'b',name:'Margherita'}];
  assert.deepEqual(discovery.selectRestaurants(restaurants,items,{query:'PANEER'}).map(x=>x.restaurant.id),['a']);
  assert.equal(discovery.selectRestaurants(restaurants,items,{query:'paneer',category:'Pizza'}).length,0);
});

test('menu search, category and verified vegetarian flag combine without altering source items',()=>{
  const items=[{id:1,category_id:'a',name:'Paneer tikka',is_vegetarian:true},{id:2,category_id:'b',name:'Paneer roll',is_vegetarian:true},{id:3,category_id:'a',name:'Chicken tikka',is_vegetarian:false},{id:4,category_id:'a',name:'Unknown tikka',is_vegetarian:null}];
  assert.deepEqual(discovery.selectMenu(items,{category:'a',query:'tikka',vegOnly:true}).map(i=>i.id),[1]);
  assert.equal(items.length,4);
  assert.equal(discovery.safeImage('javascript:alert(1)','fallback'),'fallback');
  assert.equal(discovery.safeImage('https://example.com/food.jpg','fallback'),'https://example.com/food.jpg');
});

test('Owner dashboard excludes other tenants, demos and legacy POS; all-date queue retains yesterday work',()=>{
  const state={orders:[
    {id:'paid',restaurant:'a',channel:'Own Platform',createdAt:'2026-11-08T20:00:00Z',status:'Completed'},
    {id:'yesterday',restaurant:'a',channel:'Own Platform',createdAt:'2026-11-07T10:00:00Z',status:'Ready'},
    {id:'demo',restaurant:'a',channel:'Own Platform',createdAt:'2026-11-09T01:00:00Z',status:'Received',isDemo:true},
    {id:'pos',restaurant:'a',channel:'POS - Dine-in',createdAt:'2026-11-09T01:00:00Z',status:'Received'},
    {id:'foreign',restaurant:'b',channel:'Own Platform',createdAt:'2026-11-09T01:00:00Z',status:'Received'}
  ],financials:[{order_id:'paid',payment_status:'partially_refunded',customer_payable_amount:500,refund_amount_actual:50},{order_id:'demo',payment_status:'paid',customer_payable_amount:99999,is_demo:true}]};
  const result=dashboard.summarize(state,'a',new Date('2026-11-09T01:00:00Z'));
  assert.equal(result.todaySales,450);
  assert.equal(result.todayOrders.length,1);
  assert.equal(result.delivered,1);
  assert.equal(result.active.length,1);
  assert.equal(result.stages.Ready,1);
  assert.equal(result.stages.Received,0);
  assert.equal(result.week.reduce((n,d)=>n+d.amount,0),450);
  assert.equal(result.week.at(-1).key,'2026-11-09');
});

test('today expenses exclude samples, other days and foreign restaurants',()=>{
  const expenses=[
    {restaurant_id:'a',expense_date:'2026-11-09',amount:125},
    {restaurant_id:'a',expense_date:'2026-11-09',amount:500,is_demo:true},
    {restaurant_id:'b',expense_date:'2026-11-09',amount:900},
    {restaurant_id:'a',expense_date:'2026-11-08',amount:300}
  ];
  assert.equal(dashboard.summarize({expenses},'a',new Date('2026-11-09T01:00:00Z')).todayExpenses,125);
});

test('restaurant opening hours use India time and an exclusive closing boundary',()=>{
 const r={opening_time:'10:00:00',closing_time:'22:00:00'};
 assert.equal(discovery.isClosed(r,Date.parse('2026-11-09T04:29:59Z')),true);
 assert.equal(discovery.isClosed(r,Date.parse('2026-11-09T04:30:00Z')),false);
 assert.equal(discovery.isClosed(r,Date.parse('2026-11-09T16:30:00Z')),true);
});
test('overnight hours, equal all-day times and expired temporary closure are handled',()=>{
 const r={opening_time:'18:00:00',closing_time:'06:00:00',is_temporarily_closed:true,temporary_closure_until:'2000-01-01'};
 assert.equal(discovery.isClosed(r,Date.parse('2026-11-09T17:30:00Z')),false);
 assert.equal(discovery.isClosed(r,Date.parse('2026-11-09T06:30:00Z')),true);
 assert.equal(discovery.isClosed({opening_time:'00:00:00',closing_time:'00:00:00'},Date.parse('2026-11-09T06:30:00Z')),false);
});
