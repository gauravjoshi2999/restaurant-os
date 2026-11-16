/* SYNTHETIC UI TRANSPORT ONLY. Never packaged or loaded by the public app. */
(function(){
 const factory=window.supabase.createClient;
 window.supabase.createClient=(...args)=>{
  const client=factory(...args),rpc=client.rpc.bind(client),requested=window.__BITE_HOSPITALITY_TYPE||'hotel',type=requested==='new'?'hotel':requested;
  let exists=requested!=='new';
  const pid='12121212-1212-4212-8212-121212121212',rid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const p={id:pid,name:'Synthetic '+type+' property',business_type:type,capabilities:[...window.BiteCapabilities.defaults[type]],configured_capabilities:[...window.BiteCapabilities.defaults[type]],can_configure:true,role:'owner',outlets:type==='hotel'?[]:[rid],address:'Synthetic QA road',phone:'9999999999',tax_profile:{reviewed:false}};
  const day=()=>window.BiteOwner.day();
  const db={rooms:exists?[{id:'room-a',property_id:pid,number:'101',room_type:'Deluxe',nightly_rate:1000,adults:2,children:2,housekeeping:'ready',active:true},{id:'room-b',property_id:pid,number:'102',room_type:'Suite',nightly_rate:1500,adults:3,children:2,housekeeping:'ready',active:true}]:[],guests:[],stays:[],groups:[],folios:[],entries:[],audit:[],members:[],expenses:[]};
  const commands=new Map();window.__BITE_HOTEL_QA={db,commands,property:p,calls:[]};
  function totals(f){
   const out={charges:0,paid:0,balance:0,deposit_held:0,pending:0};
   for(const e of db.entries.filter(e=>e.folio_id===f.id)){
    if(e.status==='pending'){out.pending+=e.amount;continue}
    if(e.kind==='charge')out.charges+=e.amount;
    if(['discount','reversal'].includes(e.kind))out.charges-=e.amount;
    if(['payment','deposit_apply'].includes(e.kind))out.paid+=e.amount;
    if(e.kind==='refund')out.paid-=e.amount;
    if(e.kind==='deposit_hold')out.deposit_held+=e.amount;
    if(['deposit_return','deposit_apply'].includes(e.kind))out.deposit_held-=e.amount;
   }
   out.balance=out.charges-out.paid;return out;
  }
  client.rpc=async(name,args={})=>{
   if(!name.startsWith('bite_')||!['bite_owner_context','bite_create_property','bite_hotel_workspace','bite_property_command','bite_room_charge_targets'].includes(name))return rpc(name,args);
   window.__BITE_HOTEL_QA.calls.push({name,args});
   if(name==='bite_owner_context')return {data:exists?[structuredClone(p)]:[],error:null};
   if(name==='bite_create_property'){exists=true;p.name=args.p_name;p.business_type=args.p_type;p.capabilities=[...window.BiteCapabilities.defaults[args.p_type]];p.configured_capabilities=[...p.capabilities];return {data:pid,error:null}}
   if(name==='bite_hotel_workspace')return {data:structuredClone({...db,folios:db.folios.map(f=>({...f,totals:totals(f)}))}),error:null};
   if(name==='bite_room_charge_targets')return {data:db.stays.filter(s=>s.status==='in_house').map(s=>({stay_id:s.id,folio_id:db.folios.find(f=>f.stay_id===s.id).id,room:db.rooms.find(r=>r.id===s.room_id).number,guest:db.guests.find(g=>g.id===s.guest_id).full_name})),error:null};
   if(name==='bite_property_command'){
    const {p_action:a,p_payload:v,p_request:k}=args;
    if(commands.has(k))return structuredClone(commands.get(k));
    let result={id:crypto.randomUUID(),confirmed:true};
    if(a==='guest_save'){const g=db.guests.find(g=>g.id===v.id);if(g)Object.assign(g,v);else db.guests.push({...v,id:result.id,property_id:pid,created_at:new Date().toISOString()});if(g)result.id=g.id;}
    else if(a==='reserve'){
     if(db.stays.some(s=>s.room_id===v.room_id&&['reserved','in_house'].includes(s.status)))return {data:null,error:{code:'P0001',message:'Room already reserved'}};
     const folio_id=crypto.randomUUID(),room=db.rooms.find(r=>r.id===v.room_id);db.stays.push({...v,id:result.id,status:'reserved',nightly_rate:room.nightly_rate});db.folios.push({id:folio_id,property_id:pid,stay_id:result.id,status:'open'});result.folio_id=folio_id;
    }else if(a==='reserve_group'){
     db.groups.push({id:result.id,name:v.name,payer_guest_id:v.guest_id});const stays=[];
     for(const unit of v.rooms){const s=await client.rpc('bite_property_command',{...args,p_action:'reserve',p_payload:{...unit,guest_id:v.guest_id,arrival:v.arrival,departure:v.departure},p_request:crypto.randomUUID()});if(s.error)return s;db.stays.find(x=>x.id===s.data.id).group_id=result.id;stays.push(s.data)}result.stays=stays;
    }else if(a==='room_pos'){
     const amount=v.items.reduce((n,i)=>n+i.quantity*i.unit_price,0),oid=result.id;
     await client.from('orders').insert({id:oid,restaurant_id:rid,order_code:'SYNTHETIC-ROOM-POS',channel:'POS - Counter',amount,status:'Received',order_date:new Date().toISOString(),is_demo:false});
     await client.from('order_items').insert(v.items.map(i=>({order_id:oid,item_name:i.name,quantity:i.quantity,unit_price:i.unit_price})));
     db.entries.push({id:crypto.randomUUID(),folio_id:v.folio_id,kind:'charge',category:'food',source_order_id:oid,amount,tax_amount:0,status:'confirmed',description:'POS SYNTHETIC-ROOM-POS',created_at:new Date().toISOString()});result.order_id=oid;result.folio_id=v.folio_id;
    }else if(a==='checkin'){
     const s=db.stays.find(s=>s.id===v.id),r=db.rooms.find(r=>r.id===s.room_id),f=db.folios.find(f=>f.stay_id===s.id);if(r.housekeeping!=='ready')return {data:null,error:{code:'P0001',message:'Room is not Ready'}};
     if(s.status!=='in_house'){s.status='in_house';const nights=(new Date(s.departure)-new Date(s.arrival))/86400000;db.entries.push({id:crypto.randomUUID(),folio_id:f.id,kind:'charge',category:'room',amount:nights*r.nightly_rate,tax_amount:0,status:'confirmed',description:nights+' room nights',created_at:new Date().toISOString()})}result.folio_id=f.id;
    }else if(['charge','payment','deposit_hold','deposit_return','deposit_apply','discount','refund'].includes(a)){
     db.entries.push({...v,id:result.id,kind:a,category:a==='charge'?'incidental':a.startsWith('deposit')?'deposit':'payment',amount:Number(v.amount),status:['payment','deposit_hold'].includes(a)&&['UPI','Card','Bank Transfer'].includes(v.method)?'pending':'confirmed',tax_amount:0,created_at:new Date().toISOString()});
    }else if(a==='payment_confirm'){const e=db.entries.find(e=>e.id===v.id);e.status='confirmed';e.reference=v.reference;}
    else if(a==='checkout'){
     const f=db.folios.find(f=>f.id===v.folio_id),t=totals(f);if(t.balance||t.pending||t.deposit_held)return {data:null,error:{code:'P0001',message:'Settle balance, pending payments and deposit before checkout'}};
     const s=db.stays.find(s=>s.id===f.stay_id);s.status='checked_out';db.rooms.find(r=>r.id===s.room_id).housekeeping='dirty';f.status='settled';f.invoice_number='SYNTHETIC-INVOICE';
    }else if(a==='room_status')db.rooms.find(r=>r.id===v.id).housekeeping=v.status;
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
