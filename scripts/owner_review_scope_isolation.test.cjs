const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('var ownerReviewVersion='),html.indexOf('async function loadCustomerOrderRequestsWorkspace()'));
function setup({reviews,orders}={}){
 const list={innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';}};
 const calls=[],pending=[];
 const ctx=vm.createContext({access:{role:'owner',restaurantId:'r1'},currentUser:{id:'u1'},console:{error(){}},esc:String,money:String,alert(){},
 document:{getElementById:()=>list,querySelectorAll:()=>[]},
 sb:{from(table){calls.push(table);const q={select(){return q},eq(){return q},order(){return q},limit(){return Promise.resolve({data:reviews,error:null})},in(){return Promise.resolve({data:orders,error:null})}};return q},
 rpc(){return new Promise(resolve=>pending.push(resolve))}}});
 vm.runInContext(source,ctx);return {ctx,list,calls,pending};
}
const review={id:'review1',restaurant_id:'r1',order_id:'o1',rating:5,status:'Published',review:'Synthetic'};
test('Owner review context rejects null, wrong tenant and duplicate linked orders',async()=>{
 for(const orders of [null,[{id:'o1',restaurant_id:'r2',customer_name:'PRIVATE'}],[{id:'o2',restaurant_id:'r1'}],[{id:'o1',restaurant_id:'r1'},{id:'o1',restaurant_id:'r1'}]]){
  const {ctx,list}=setup({reviews:[review],orders});await ctx.loadRestaurantReviewsWorkspace();
  assert.match(list.innerHTML,/Incomplete linked order scope/);assert.doesNotMatch(list.innerHTML,/PRIVATE/);
  assert.equal(ctx.ownerReviewRows.length,0);
 }
});
test('Owner reviews without a linked order avoid empty IN and still render the review',async()=>{
 const {ctx,list,calls}=setup({reviews:[{...review,order_id:null}]});await ctx.loadRestaurantReviewsWorkspace();
 assert.deepEqual(calls,['restaurant_reviews']);assert.match(list.innerHTML,/Linked order unavailable/);
});
test('Pending reply after same-account relogin cannot clear a new reply busy flag',async()=>{
 const {ctx,pending}=setup();
 function form(){const status={},button={};return {dataset:{ownerReviewId:'review1'},isConnected:true,elements:{response:{value:'Synthetic reply'}},querySelector(s){return s==='[data-review-reply-status]'?status:button}}}
 const start=()=>{ctx.ownerReviewScope='u1:r1';ctx.ownerReviewRows=[review];return ctx.replyRestaurantReview({preventDefault(){},currentTarget:form()})};
 const old=start();ctx.clearOwnerReviews();const fresh=start();assert.equal(pending.length,2);
 pending[0]({error:new Error('old request')});await old;assert.equal(ctx.ownerReviewBusy.has('u1:r1:review1'),true);
 pending[1]({error:new Error('new request')});await fresh;assert.equal(ctx.ownerReviewBusy.has('u1:r1:review1'),false);
});
