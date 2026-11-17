/* Synthetic scenario seeds and lost-response faults. NEVER loaded by public pages. */
(function(){
 const factory=window.supabase.createClient;
 window.supabase.createClient=(...args)=>{
  const c=factory(...args),rpc=c.rpc.bind(c),q=window.__BITE_HOTEL_QA;
  q.db.register_version=1;q.db.next_register_number=1;
  const scenario=new URLSearchParams(location.search).get('scenario'),day=BiteOwner.day(),plus=n=>BiteOwner.day(new Date(Date.now()+n*86400000));
  const guest={id:'guest-old',full_name:'Synthetic Returning Guest',phone:'9999999999',address:'Synthetic old address',country:'India',email:'',id_type:'',id_last4:''};
  if(['occupied','overdue','reserved','returning','stale','same-name'].includes(scenario))q.db.guests.push(guest);
  if(['occupied','overdue','reserved','returning','stale'].includes(scenario)){
   q.db.stays.push({id:'stay-old',guest_id:guest.id,room_id:'room-a',arrival:plus(-2),departure:scenario==='overdue'?day:plus(1),adults:1,children:0,nightly_rate:750,status:scenario==='reserved'?'reserved':['returning','stale'].includes(scenario)?'checked_out':'in_house',created_at:new Date().toISOString(),registration:{arrived_from:'Udaipur',next_destination:'Jaipur',transport:'Car',vehicle_number:'RJ00QA0000',male:1,female:0,children:0}});
   q.db.folios.push({id:'folio-old',stay_id:'stay-old',status:['returning','stale'].includes(scenario)?'settled':'open'});
  }
  if(scenario==='same-name')q.db.guests.push({...guest,id:'guest-other',phone:'8888888888',address:'Different synthetic address'});
  if(scenario==='dirty')for(const r of q.db.rooms)r.housekeeping='dirty';
  const draftKey='bite_register_draft:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:'+q.property.id;
  if(['draft','stale'].includes(scenario))localStorage.setItem(draftKey,JSON.stringify({savedAt:Date.now(),fields:{full_name:'Synthetic unfinished guest',phone:'7777777777',address:'Draft address',arrival_time:'07:17',nightly_rate:'987',...(scenario==='stale'?{stay_id:'stay-old'}:{})}}));
  q.injectRace=()=>q.db.stays.push({id:'race-stay',guest_id:'other-guest',room_id:'room-a',arrival:day,departure:plus(1),status:'in_house'});
  q.replayLost=()=>rpc('bite_property_command',q.lostReserve);
  c.rpc=async(name,a={})=>{
   if(name==='bite_property_command'&&a.p_action==='reserve'&&q.loseBeforeReserve){q.loseBeforeReserve=false;q.lostReserve=structuredClone(a);throw Error('Synthetic response unknown before send')}
   const result=await rpc(name,a);
   if(name==='bite_property_command'&&a.p_action==='reserve'&&!result.error&&q.loseAfterReserve){q.loseAfterReserve=false;throw Error('Synthetic response unknown after commit')}
   return result;
  };
  return c;
 };
})();
