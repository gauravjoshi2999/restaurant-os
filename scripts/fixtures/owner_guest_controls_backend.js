/* Synthetic transport for UI-only scenarios. PostgreSQL tests exercise the real RPCs. */
(function(){
 const factory=window.supabase.createClient;
 window.supabase.createClient=(...args)=>{
  const c=factory(...args),rpc=c.rpc.bind(c),q=window.__BITE_HOTEL_QA,db=q.db,p=q.property,requests=new Map();
  const expenseEntryScenario=new URLSearchParams(location.search).get('scenario')==='expense-entry';
  if(expenseEntryScenario){
   p.role='receptionist';p.can_configure=false;p.capabilities=['hotel_rooms'];
   p.permissions=['hotel_rooms','expense_entry'];
  }
  c.rpc=async(name,a={})=>{
   if(expenseEntryScenario&&name==='bite_property_command'&&a.p_action==='expense'){
    q.expense=structuredClone(a);
    return{data:{id:'synthetic-expense',confirmed:true},error:null};
   }
   if(name==='bite_family_booking'){
    if(requests.has(a.p_request))return structuredClone(requests.get(a.p_request));
    const v=a.p_payload,all=structuredClone(db),stays=[],gid=crypto.randomUUID();let advance=Number(v.advance_amount||0);
    if(v.mode==='checkin'&&(v.rooms[0].registration.family_guest_ids||[]).length<1)return{error:{code:'P0001',message:'2 guest IDs required'}};
    for(const unit of v.rooms){
     const allocation=Math.min(advance,unit.nightly_rate*((Date.parse(v.departure)-Date.parse(v.arrival))/86400000));advance-=allocation;
     const r=await rpc('bite_property_command',{p_property:a.p_property,p_action:'reserve',p_payload:{...unit,guest_id:v.guest_id,arrival:v.arrival,departure:v.departure,arrival_time:v.arrival_time,advance_amount:allocation,advance_method:v.advance_method||'Cash',advance_verified:v.advance_verified},p_request:crypto.randomUUID()});
     if(r.error){Object.assign(db,all);return r}
     db.stays.find(s=>s.id===r.data.id).group_id=gid;
     if(v.mode==='checkin'){const entered=await rpc('bite_property_command',{p_property:a.p_property,p_action:'checkin',p_payload:{id:r.data.id},p_request:crypto.randomUUID()});if(entered.error){Object.assign(db,all);return entered}}
     stays.push({...r.data,room_id:unit.room_id});
    }
    db.groups.push({id:gid,name:v.name,payer_guest_id:v.guest_id});const result={data:{id:gid,stays,confirmed:true},error:null};requests.set(a.p_request,result);return structuredClone(result);
   }
   if(name==='bite_save_staff_access'){
    if(p.role!=='owner')return{error:{code:'42501',message:'Owner only'}};
    const user=a.p_user||'staff-synthetic',member={user_id:user,email:a.p_email,display_name:'Synthetic Staff',role:a.p_role,active:a.p_active,permissions:a.p_permissions};const old=db.members.find(m=>m.user_id===user);if(old)Object.assign(old,member);else db.members.push(member);q.savedAccess=structuredClone(a);return{data:{id:user,...member},error:null};
   }
   if(name==='bite_owner_data_preview'){
    if(p.role!=='owner')return{error:{code:'42501',message:'Owner only'}};
    const source=a.p_scope==='rooms'?db.rooms:a.p_scope==='guests'?db.guests:db.stays,rows=source.filter(x=>!a.p_ids?.length||a.p_ids.includes(x.id));
    return {data:{count:rows.length,preview_hash:'synthetic-'+source.length,records:rows.map(r=>({id:r.id,label:r.full_name||r.number||r.id,date:r.arrival||'',status:r.status||''}))},error:null};
   }
   if(name==='bite_owner_data_delete'){
    if(p.role!=='owner'||a.p_confirmation!==p.name)return{error:{code:'42501',message:'Owner confirmation required'}};
    const ids=a.p_ids||[],source=a.p_scope==='rooms'?'rooms':a.p_scope==='guests'?'guests':'stays';
    if(source==='stays'){const folios=db.folios.filter(f=>ids.includes(f.stay_id)).map(f=>f.id);db.folios=db.folios.filter(f=>!folios.includes(f.id));db.entries=db.entries.filter(e=>!folios.includes(e.folio_id))}
    const count=db[source].filter(x=>ids.includes(x.id)).length;db[source]=db[source].filter(x=>!ids.includes(x.id));q.lastDelete=structuredClone(a);return{data:{deleted:count},error:null};
   }
   return rpc(name,a);
  };return c;
 };
})();
