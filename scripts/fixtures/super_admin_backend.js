/* Synthetic Super Admin transport; injected only by browser QA. */
(function(){
 const original=window.supabase.createClient;
 const uid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',rid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',oid='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const uuid=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
 const data={restaurants:[],orders:[],order_financials:[],order_items:[],order_status_history:[],restaurant_settlements:[],bite_refund_jobs:[],menu_items:[],restaurant_delivery_zones:[],platform_settings:[{id:1,default_commission_rate:10}],platform_audit_logs:[],customer_support_tickets:[{id:uuid(999),customer_id:uid,category:'Payment',subject:'Synthetic support question',message:'Please check the payment reference.',status:'Open',updated_at:new Date().toISOString(),created_at:new Date().toISOString()}]};
 for(let i=0;i<29;i++)data.restaurants.push({id:i===0?rid:uuid(i),name:i===0?'QA Rajsamand Kitchen':'Synthetic Restaurant '+String(i).padStart(2,'0'),city:'Rajsamand',address:'QA market road',phone:'9999999999',status:i===0?'Pending':'Active',onboarding_status:i===0?'pending':'approved',is_published:i!==0&&i!==2,created_at:new Date(Date.now()-i*60000).toISOString(),updated_at:'2026-11-17T10:00:00.000Z',accepts_delivery:true,accepts_pickup:true,platform_commission_rate:null});
 for(let i=0;i<32;i++){
  const o={id:i===0?oid:uuid(100+i),restaurant_id:rid,order_code:'QA-LIVE-'+String(i).padStart(2,'0'),channel:'Own Platform',is_demo:false,status:i===0?'Received':'Completed',order_date:new Date(Date.now()-i*60000-3600000).toISOString(),customer_name:'Synthetic Customer',customer_phone:'9999999999',amount:170,delivery_type:'pickup'};data.orders.push(o);
  data.order_financials.push({id:uuid(200+i),order_id:o.id,restaurant_id:rid,channel:'Own Platform',is_demo:false,payment_status:i===2?'refunded':'paid',commission_rate:10,commission_amount:15,customer_payable_amount:170,food_subtotal:150,delivery_fee:20,platform_discount:0,refund_amount_actual:i===2?170:0,provider_fee_actual:i===1?null:3,settlement_status:'pending',created_at:o.order_date});
  data.order_items.push({id:uuid(300+i),order_id:o.id,item_name:'Synthetic Veg Thali',quantity:1,unit_price:150,line_total:150});
  data.order_status_history.push({id:uuid(400+i),order_id:o.id,to_status:o.status,changed_at:o.order_date,note:'Synthetic history'});
 }
 data.menu_items=[{id:uuid(500),restaurant_id:rid,name:'Synthetic Veg Thali',price:150,is_available:true,is_vegetarian:true}];
 data.restaurant_delivery_zones=[{id:uuid(501),restaurant_id:rid,name:'313324 delivery zone',is_active:true,restaurant_delivery_zone_pincodes:[{postal_code:'313324'}]}];
 data.bite_refund_jobs=[{id:uuid(600),order_id:oid,restaurant_id:rid,amount:170,reason:'Synthetic provider follow-up',status:'processing',provider_status:'PENDING',provider_refund_id:'QA-REFUND-001',created_at:new Date().toISOString()}];
 data.restaurant_settlements=[{id:uuid(700),restaurant_id:rid,period_start:'2026-11-02',period_end:'2026-11-08',gross_order_value:1000,commission_total:100,provider_fees_actual:20,refunds_actual:0,net_payable:880,amount_paid:0,status:'draft'}];
 data.bite_refund_jobs.push({...data.bite_refund_jobs[0],id:uuid(601),status:'refunded',created_at:'2026-01-01T10:00:00Z'});
 data.restaurant_settlements.push({...data.restaurant_settlements[0],id:uuid(701),status:'paid',period_start:'2026-10-01',period_end:'2026-10-07'});
 data.platform_audit_logs.push({id:uuid(998),actor_id:uid,entity_type:'customer_support_ticket',entity_id:uuid(999),action:'customer_support_ticket_created',details:{status:'Open'},created_at:new Date().toISOString()});
 const calls=[];const qa=window.__BITE_SUPER_ADMIN_QA={data,calls,failNext:false,providerFailure:false};
 function value(row,key){return key.split('.').reduce((v,k)=>v?.[k],row);}
 function query(table){let filters=[],single=false,start=0,end=Infinity,payload=null,mode='read',withOrder=false,sort=[];const q={
  select:cols=>{withOrder=String(cols).includes('orders!inner');return q;},eq:(k,v)=>{filters.push(r=>value(r,k)===v);return q;},neq:(k,v)=>{filters.push(r=>value(r,k)!==v);return q;},in:(k,v)=>{filters.push(r=>v.includes(value(r,k)));return q;},ilike:(k,v)=>{const needle=v.replace(/^%|%$/g,'').toLowerCase();filters.push(r=>String(r[k]||'').toLowerCase().includes(needle));return q;},order:(k,o={})=>{sort.push([k,o.ascending!==false]);return q;},range:(a,b)=>{start=a;end=b;return q;},limit:n=>{end=n-1;return q;},single:()=>{single=true;return q;},maybeSingle:()=>{single=true;return q;},update:p=>{mode='update';payload=p;return q;},insert:p=>{mode='insert';payload=p;return q;},then:resolve=>{
   calls.push({table,mode});if(qa.failNext){qa.failNext=false;resolve({data:null,error:{message:'Synthetic read failure'}});return;}
   let all=(data[table]||[]).map(r=>withOrder?{...r,orders:data.orders.find(o=>o.id===r.order_id)}:r).filter(r=>filters.every(f=>f(r)));
   const count=all.length;for(const [k,asc]of sort.slice().reverse())all.sort((a,b)=>(String(a[k]||'').localeCompare(String(b[k]||'')))*(asc?1:-1));
   if(mode==='update')all.forEach(r=>Object.assign(r,payload));
   if(mode==='insert'){all=[{id:crypto.randomUUID(),...payload}];data[table].push(...all);}
   all=all.slice(start,end+1);resolve({data:structuredClone(single?all[0]||null:all),count,error:null});
  }};return q;}
 window.supabase.createClient=(...args)=>{
  const c=original(...args),from=c.from.bind(c),rpc=c.rpc.bind(c),invoke=c.functions.invoke.bind(c.functions);
  c.from=table=>table in data?query(table):from(table);
  c.rpc=async(name,p={})=>{
   calls.push({rpc:name,args:structuredClone(p)});let result=null;
   if(qa.failNext){qa.failNext=false;return{data:null,error:{message:'Synthetic read failure'}};}
   if(name==='bite_super_admin_overview_v1')result={business_date:'2026-11-18',orders_today:32,collections_today:5440,pending_restaurants:1,delayed_orders:1,refund_followups:1,pending_settlements:1,owner_unassigned:28,open_support:1,checked_at:new Date().toISOString()};
   else if(name==='bite_super_admin_attention_v1'){const all=p.p_kind==='delayed'?data.orders.filter(o=>o.status==='Received'):data.restaurants.slice(1);result={rows:all.slice(p.p_offset,p.p_offset+25),total_count:all.length};}
   else if(name==='admin_list_owner_assignments')result=[{restaurant_id:rid,owner_user_id:uid,owner_name:'Synthetic Owner',owner_email:'owner@example.invalid',restaurant_owner_count:1,user_restaurant_count:1}];
   else if(name==='bite_platform_owner_contexts')result=[];
   else if(name==='bite_super_admin_review_v1'){
    const r=data.restaurants.find(r=>r.id===p.p_restaurant_id);if(r.updated_at!==p.p_expected_updated_at)return{data:null,error:{message:'Restaurant changed. Refresh the review before saving.'}};
    if(p.p_action==='approve'){r.onboarding_status='approved';r.status='Active';r.is_published=false;}
    if(p.p_action==='publish')r.is_published=true;
    if(p.p_action==='pause')r.is_published=false;
    if(p.p_action==='request_changes'){r.onboarding_status='rejected';r.is_published=false;r.onboarding_rejection_reason=p.p_note;}
    r.updated_at=new Date().toISOString();data.platform_audit_logs.push({id:uuid(800+calls.length),action:'restaurant_'+p.p_action,created_at:new Date().toISOString(),details:{note:p.p_note}});result={saved:true};
   }else if(name==='bite_super_admin_commission_v1'){
    const r=p.p_restaurant_id?data.restaurants.find(r=>r.id===p.p_restaurant_id):data.platform_settings[0],key=p.p_restaurant_id?'platform_commission_rate':'default_commission_rate';
    if(r[key]!==p.p_expected_rate)return{data:null,error:{message:'Commission changed. Reload before saving.'}};r[key]=p.p_rate;result={saved:true};
   }else if(name==='bite_admin_business_metrics')result={paid_order_count:32,verified_collections:5440,completed_orders:31,commission_booked:480,provider_confirmed_refunds:170,gateway_fee_actual:null,coverage_note:'Synthetic records only; fees incomplete.'};
   else return rpc(name,p);
   return{data:structuredClone(result),error:null};
  };
  c.functions.invoke=async(name,args={})=>{
   calls.push({edge:name,body:args.body});if(name!=='bite-cashfree-operations')return invoke(name,args);
   if(qa.providerFailure)return{data:null,error:{message:'Synthetic gateway unavailable'}};
   if(args.body.action==='inspect_refund')return{data:{status:'PROVIDER_REFUND_RECORD_FOUND',no_action_taken:true,recorded_refund_status:'processing',provider_refund_status:'PENDING',amount:170},error:null};
   return{data:{collection:{status:'PAID',amount:170},platform_bank_settlement:{status:'PENDING'},restaurant_payout:'NOT_VERIFIED_BY_PG_COLLECTION'},error:null};
  };return c;
 };
})();
