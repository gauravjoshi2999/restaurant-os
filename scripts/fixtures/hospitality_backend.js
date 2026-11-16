/* SYNTHETIC UI TRANSPORT ONLY. Never packaged or loaded by the public app. */
(function(){
 const factory=window.supabase.createClient;
 window.supabase.createClient=(...args)=>{
  const client=factory(...args),rpc=client.rpc.bind(client),requested=window.__BITE_HOSPITALITY_TYPE||'hotel',type=requested==='new'?'hotel':['cashier','new-restaurant'].includes(requested)?'restaurant':requested;
  let exists=!['new','new-restaurant'].includes(requested);
  const pid='12121212-1212-4212-8212-121212121212',rid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const p={id:pid,name:'Synthetic '+type+' property',business_type:type,capabilities:[...window.BiteCapabilities.defaults[type]],configured_capabilities:[...window.BiteCapabilities.defaults[type]],can_configure:true,role:'owner',outlets:type==='hotel'||!exists?[]:[rid],address:'Synthetic QA road',phone:'9999999999',tax_profile:{reviewed:false}};
  const day=()=>window.BiteOwner.day();
  const db={rooms:exists?[{id:'room-a',property_id:pid,number:'101',room_type:'Deluxe',nightly_rate:1000,adults:2,children:2,housekeeping:'ready',active:true},{id:'room-b',property_id:pid,number:'102',room_type:'Suite',nightly_rate:1500,adults:3,children:2,housekeeping:'ready',active:true}]:[],guests:[],stays:[],groups:[],folios:[],entries:[],audit:[],members:[],expenses:[],tasks:[],task_members:[],refund_requests:[],compliance:[],outlet_applications:[],available_outlets:[]};
  const commands=new Map();window.__BITE_HOTEL_QA={db,commands,property:p,calls:[]};
  if(requested==='cashier'){p.role='cashier';p.can_configure=false;p.capabilities=['restaurant_pos','restaurant_menu','dine_in','takeaway'];}
  db.closings=[];db.sales=[];
  function totals(f){
   const out={charges:0,paid:0,balance:0,deposit_held:0,pending:0};
   for(const e of db.entries.filter(e=>e.folio_id===f.id)){
    if(e.status==='pending'){out.pending+=e.amount;continue}
    if(e.kind==='charge')out.charges+=e.amount;
    if(['discount','reversal'].includes(e.kind))out.charges-=e.amount;
    if(['payment','advance','deposit_apply'].includes(e.kind))out.paid+=e.amount;
    if(e.kind==='refund')out.paid-=e.amount;
    if(e.kind==='deposit_hold')out.deposit_held+=e.amount;
    if(['deposit_return','deposit_apply'].includes(e.kind))out.deposit_held-=e.amount;
   }
   out.balance=out.charges-out.paid;return out;
  }
  client.rpc=async(name,args={})=>{
   if(!name.startsWith('bite_')||!['bite_owner_context','bite_create_property','bite_hotel_workspace','bite_property_command','bite_room_charge_targets','bite_property_report','bite_audit_search','bite_unified_audit','bite_reservation_quote','bite_checkout_policy_quote','bite_guest_link'].includes(name))return rpc(name,args);
   window.__BITE_HOTEL_QA.calls.push({name,args});
   if(name==='bite_hotel_workspace'&&window.__BITE_HOTEL_QA.delayMs)await new Promise(done=>setTimeout(done,window.__BITE_HOTEL_QA.delayMs));
   if(name==='bite_owner_context')return {data:exists?[structuredClone(p)]:[],error:null};
   if(name==='bite_create_property'){exists=true;p.name=args.p_name;p.business_type=args.p_type;p.capabilities=[...window.BiteCapabilities.defaults[args.p_type]];p.configured_capabilities=[...p.capabilities];return {data:pid,error:null}}
   if(name==='bite_hotel_workspace')return {data:structuredClone({...db,folios:db.folios.map(f=>({...f,totals:totals(f)}))}),error:null};
   if(name==='bite_reservation_quote'){const v=args.p_details,r=db.rooms.find(r=>r.id===v.room_id),amount=r.nightly_rate*((new Date(v.departure)-new Date(v.arrival))/86400000),early=p.hotel_policy?.reviewed&&v.mode==='checkin'?Number(p.hotel_policy.early_checkin_fee||0):0;return{data:{room:amount,room_tax:0,early_fee:early,early_tax:0,total:amount+early,nightly_rate:r.nightly_rate,quote_hash:'synthetic-quote'},error:null}}
   if(name==='bite_checkout_policy_quote')return{data:{early_credit:0,early_credit_tax:0,late_fee:0,late_tax:0,quote_hash:'synthetic-policy'},error:null};
   if(name==='bite_unified_audit')return{data:{rows:db.audit.filter(a=>a.action.includes(args.p_query||'')).map(a=>({...a,source:'Property',actor_name:'Synthetic owner'})),next_cursor:null},error:null};
   if(name==='bite_guest_link')return{data:{token:'a'.repeat(64),expires_at:new Date(Date.now()+72*3600000).toISOString()},error:null};
   if(name==='bite_audit_search')return {data:db.audit.filter(a=>a.action.includes(args.p_query||'')&&(!args.p_before||a.id<args.p_before)).slice(0,100),error:null};
   if(name==='bite_property_report'){
    const t=window.BiteCapabilities.hotelTotals(db.entries),food=db.entries.filter(e=>e.category==='food').reduce((n,e)=>n+e.amount,0)+db.sales.reduce((n,e)=>n+e.amount,0),cash=db.entries.filter(e=>e.status==='confirmed'&&e.method==='Cash'&&['payment','advance','deposit_hold','refund','deposit_return'].includes(e.kind)).reduce((n,e)=>n+(['refund','deposit_return'].includes(e.kind)?-e.amount:e.amount),0)+db.sales.filter(e=>e.method==='Cash').reduce((n,e)=>n+e.amount,0);
    return {data:{room_revenue:t.room,incidentals_revenue:t.incidentals,food_revenue:food,total_revenue:t.room+t.incidentals+food,cash_movement:cash,source_hash:'synthetic-'+db.entries.length,methods:[{payment_method:'Cash',net:cash}],closings:db.closings},error:null};
   }
   if(name==='bite_room_charge_targets')return {data:db.stays.filter(s=>s.status==='in_house').map(s=>({stay_id:s.id,folio_id:db.folios.find(f=>f.stay_id===s.id).id,room:db.rooms.find(r=>r.id===s.room_id).number,guest:db.guests.find(g=>g.id===s.guest_id).full_name})),error:null};
   if(name==='bite_property_command'){
    const {p_action:a,p_payload:v,p_request:k}=args;
    if(commands.has(k))return structuredClone(commands.get(k));
    let result={id:crypto.randomUUID(),confirmed:true};
    if(a==='guest_save'){const g=db.guests.find(g=>g.id===v.id);if(g)Object.assign(g,v);else db.guests.push({...v,id:result.id,property_id:pid,created_at:new Date().toISOString()});if(g)result.id=g.id;}
    else if(a==='reserve'){
     if(db.stays.some(s=>s.room_id===v.room_id&&['reserved','in_house'].includes(s.status)))return {data:null,error:{code:'P0001',message:'Room already reserved'}};
     const folio_id=crypto.randomUUID(),room=db.rooms.find(r=>r.id===v.room_id);db.stays.push({...v,id:result.id,status:'reserved',nightly_rate:room.nightly_rate});db.folios.push({id:folio_id,property_id:pid,stay_id:result.id,status:'open'});result.folio_id=folio_id;
     if(v.advance_amount>0)db.entries.push({id:crypto.randomUUID(),folio_id,kind:'advance',category:'payment',amount:v.advance_amount,status:['UPI','Card','Bank Transfer'].includes(v.advance_method)&&!v.advance_verified?'pending':'confirmed',method:v.advance_method,description:'Recorded booking advance',created_at:new Date().toISOString()});
    }else if(a==='reserve_group'){
     db.groups.push({id:result.id,name:v.name,payer_guest_id:v.guest_id});const stays=[];
     for(const unit of v.rooms){const s=await client.rpc('bite_property_command',{...args,p_action:'reserve',p_payload:{...unit,guest_id:v.guest_id,arrival:v.arrival,departure:v.departure},p_request:crypto.randomUUID()});if(s.error)return s;db.stays.find(x=>x.id===s.data.id).group_id=result.id;stays.push(s.data)}result.stays=stays;
    }else if(a==='room_pos'){
     const amount=v.items.reduce((n,i)=>n+i.quantity*i.unit_price,0),oid=result.id;
     await client.from('orders').insert({id:oid,restaurant_id:rid,order_code:'SYNTHETIC-ROOM-POS',channel:'POS - Counter',amount,waived_off_amount:Number(v.discount||0),status:'Received',order_date:new Date().toISOString(),is_demo:false});
     await client.from('order_items').insert(v.items.map(i=>({order_id:oid,item_name:i.name,quantity:i.quantity,unit_price:i.unit_price})));
     db.entries.push({id:crypto.randomUUID(),folio_id:v.folio_id,kind:'charge',category:'food',source_order_id:oid,amount:amount-Number(v.discount||0),tax_amount:0,status:'confirmed',description:'POS SYNTHETIC-ROOM-POS',created_at:new Date().toISOString()});result.order_id=oid;result.folio_id=v.folio_id;if(v.fulfilment==='room_service'){const stay=db.stays.find(s=>s.id===db.folios.find(f=>f.id===v.folio_id).stay_id);db.tasks.push({id:crypto.randomUUID(),kind:'room_service',room_id:stay.room_id,stay_id:stay.id,order_id:oid,status:'requested',note:v.service_note||'',items:v.items})}
    }else if(a==='pos_sale'){
     const amount=v.items.reduce((n,i)=>n+i.quantity*i.unit_price,0);if(v.paid_amount!==amount)return {data:null,error:{code:'P0001',message:'Full recorded payment required'}};
     await client.from('orders').insert({id:result.id,restaurant_id:rid,order_code:'SYNTHETIC-TYPED-POS',channel:v.channel,amount,status:'Received',order_date:new Date().toISOString(),is_demo:false});
     db.sales.push({amount,method:v.payment_method,channel:v.channel});result.order_id=result.id;
    }else if(a==='checkin'){
     const s=db.stays.find(s=>s.id===v.id),r=db.rooms.find(r=>r.id===s.room_id),f=db.folios.find(f=>f.stay_id===s.id);if(r.housekeeping!=='ready')return {data:null,error:{code:'P0001',message:'Room is not Ready'}};
     if(s.status!=='in_house'){s.status='in_house';const nights=(new Date(s.departure)-new Date(s.arrival))/86400000;db.entries.push({id:crypto.randomUUID(),folio_id:f.id,kind:'charge',category:'room',amount:nights*r.nightly_rate,tax_amount:0,status:'confirmed',description:nights+' room nights',created_at:new Date().toISOString()})}result.folio_id=f.id;
    }else if(['charge','payment','deposit_hold','deposit_return','deposit_apply','discount','refund'].includes(a)){
     db.entries.push({...v,id:result.id,kind:a,category:a==='charge'?'incidental':a.startsWith('deposit')?'deposit':'payment',amount:Number(v.amount),status:['payment','deposit_hold'].includes(a)&&['UPI','Card','Bank Transfer'].includes(v.method)?'pending':'confirmed',tax_amount:0,created_at:new Date().toISOString()});
    }else if(a==='payment_confirm'){const e=db.entries.find(e=>e.id===v.id);e.status='confirmed';e.reference=v.reference;}
    else if(a==='checkout'){
     const f=db.folios.find(f=>f.id===v.folio_id),t=totals(f);if(t.balance||t.pending||t.deposit_held)return {data:null,error:{code:'P0001',message:'Settle balance, pending payments and deposit before checkout'}};
     const s=db.stays.find(s=>s.id===f.stay_id),room=db.rooms.find(r=>r.id===s.room_id),guest=db.guests.find(g=>g.id===s.guest_id);s.status='checked_out';room.housekeeping='dirty';room.do_not_disturb=false;room.cleaning_requested=false;f.status='settled';f.invoice_number='SYNTHETIC-INVOICE';
     f.invoice_snapshot={number:f.invoice_number,property:p,guest:{name:guest.full_name},stay:s,room,entries:db.entries.filter(e=>e.folio_id===f.id),totals:t,tax_profile:p.tax_profile};
     if(f.payer_split)f.invoice_snapshot.splits=['first_name','second_name'].map((name,i)=>({...f.invoice_snapshot,number:f.invoice_number+'-'+i,guest:{name:f.payer_split[name]},totals:{...t,charges:t.charges*(i?100-f.payer_split.first_percent:f.payer_split.first_percent)/100}}));
    }else if(a==='room_status'){
     const r=db.rooms.find(r=>r.id===v.id);if(r.do_not_disturb&&v.status==='cleaning')return {data:null,error:{code:'P0001',message:'Do Not Disturb is active'}};r.housekeeping=v.status;
    }
    else if(a==='room_privacy'){Object.assign(db.rooms.find(r=>r.id===v.id),v);if(v.cleaning_requested&&!db.tasks.some(t=>t.room_id===v.id&&t.kind==='cleaning'&&!['completed','cancelled'].includes(t.status)))db.tasks.push({id:crypto.randomUUID(),kind:'cleaning',room_id:v.id,status:'requested',note:'Stayover cleaning'})}
    else if(a==='policy_save'){p.hotel_policy=v.policy;p.checkin_time=v.checkin_time;p.checkout_time=v.checkout_time}
    else if(a==='apply_checkout_policy')db.folios.find(f=>f.id===v.folio_id).checkout_policy=(await client.rpc('bite_checkout_policy_quote',{})).data;
    else if(a==='late_checkout')db.stays.find(s=>s.id===v.id).expected_checkout_at=v.until+'+05:30';
    else if(a==='task_update'){
     const t=db.tasks.find(t=>t.id===v.id),room=db.rooms.find(r=>r.id===t.room_id);
     if(t.kind==='cleaning'&&room.do_not_disturb&&v.status==='in_progress')return{data:null,error:{code:'P0001',message:'Do Not Disturb is active'}};
     Object.assign(t,v);if(t.kind==='cleaning'&&v.status==='completed')room.housekeeping='cleaning';
    }
    else if(a==='refund_request')db.refund_requests.push({...v,id:result.id,status:'requested'});
    else if(a==='refund_update'){
     const j=db.refund_requests.find(j=>j.id===v.id);if(v.status==='paid'&&(!v.return_verified||!v.reference))return{data:null,error:{code:'P0001',message:'Verify the actual return and reference'}};Object.assign(j,v);
    }
    else if(a==='guest_link_revoke'){}
    else if(a==='compliance_save'){const c=db.compliance.find(c=>c.stay_id===v.id);if(c)Object.assign(c,v);else db.compliance.push({...v,stay_id:v.id})}
    else if(a==='outlet_application')db.outlet_applications.push({...v,restaurant_id:result.id,onboarding_status:'pending',status:'Lead added'});
    else if(a==='outlet_application_edit'){}

    else if(a==='split_bill')db.folios.find(f=>f.id===v.folio_id).payer_split=v;
    else if(a==='close_shift'){const report=(await client.rpc('bite_property_report',{})).data;db.closings.push({...v,id:result.id,expected_cash:Number(v.opening_cash)+report.cash_movement,difference:Number(v.counted_cash)-Number(v.opening_cash)-report.cash_movement,snapshot:report})}
    else if(a==='room_save')db.rooms.push({...v,id:result.id,active:true,housekeeping:'ready'});
    else if(a==='member'){const m=db.members.find(m=>m.user_id===v.id||m.email===v.email);if(m)Object.assign(m,v);else db.members.push({...v,user_id:result.id,display_name:v.email})}
    else if(a==='config'){Object.assign(p,v);p.configured_capabilities=[...v.capabilities]}
    else return {data:null,error:{code:'P0001',message:'Synthetic transport does not implement '+a}};
    db.audit.unshift({id:db.audit.length+1,action:a,created_at:new Date().toISOString()});
    const response={data:result,error:null};commands.set(k,response);return structuredClone(response);
   }
  };return client;
 };
})();
