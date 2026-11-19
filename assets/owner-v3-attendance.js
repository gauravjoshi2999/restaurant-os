/* Bite Owner V3 A08 — read-only attendance-by-date register.
 * Exact-day tenant query; no salary, payment, or automatic attendance writes. */
(function(root){
 'use strict';
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
   Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 const statuses=Object.freeze(['Present','Half Day','Absent','Leave','Holiday']);
 function summarize({employees,records,date,restaurantId}){
  if(!iso(date)||!restaurantId||!Array.isArray(employees)||!Array.isArray(records))throw Error('Invalid attendance register scope.');
  const people=new Map(),allPeople=new Set();
  for(const e of employees){
   if(!e?.id||e.restaurant_id!==restaurantId||allPeople.has(e.id))throw Error('Invalid or duplicated employee scope.');
   allPeople.add(e.id);
   if(e.status==='Active')people.set(e.id,e);
  }
  const byPerson=new Map();
  for(const a of records){
   if(!a?.id||a.restaurant_id!==restaurantId||a.attendance_date!==date||!allPeople.has(a.employee_id)||
      !statuses.includes(a.status)||byPerson.has(a.employee_id))
    throw Error('Incomplete or inconsistent attendance day: do not guess missing staff status.');
   if(people.has(a.employee_id))byPerson.set(a.employee_id,a);
  }
  let present=0,half=0,absent=0,leave=0,holiday=0;
  const rows=[...people.values()].sort((a,b)=>String(a.full_name||'').localeCompare(String(b.full_name||''))).map(e=>{
   const a=byPerson.get(e.id),status=a?a.status:'Not marked';
   if(status==='Present')present++;
   else if(status==='Half Day')half++;
   else if(status==='Absent')absent++;
   else if(status==='Leave')leave++;
   else if(status==='Holiday')holiday++;
   return {id:e.id,name:e.full_name||'Employee',position:e.position||'',status,
    recorded:!!a,check_in:a?.check_in||'',check_out:a?.check_out||'',notes:a?.notes||''};
  });
  return {date,rows,total:rows.length,present,half,absent,leave,holiday,
   notMarked:rows.length-byPerson.size,recorded:byPerson.size};
 }
 async function load({client,restaurantId,date,isCurrent,pageSize=250,maxRows=10000}){
  if(!client?.from||!restaurantId||!iso(date)||!Number.isInteger(pageSize)||pageSize<1||pageSize>500||
   !Number.isInteger(maxRows)||maxRows<pageSize||maxRows%pageSize!==0)throw Error('Attendance query invalid.');
  const result=[];
  for(let offset=0;offset<maxRows;offset+=pageSize){
   if(isCurrent?.()===false)throw Error('Attendance scope changed.');
   const {data,error}=await client.from('restaurant_employee_attendance')
    .select('id,restaurant_id,employee_id,attendance_date,status,check_in,check_out,notes')
    .eq('restaurant_id',restaurantId).eq('attendance_date',date)
    .order('employee_id',{ascending:true}).range(offset,offset+pageSize-1);
   if(isCurrent?.()===false)throw Error('Attendance scope changed.');
   if(error)throw error;
   if(!Array.isArray(data))throw Error('Attendance day returned incomplete data.');
   result.push(...data);
   if(data.length<pageSize)return result;
  }
  throw Error('Too many attendance rows for one date; totals were not shown.');
 }
 function html(summary){
  if(!summary?.rows)return '<p role="alert">Attendance date report unavailable.</p>';
  const s=summary;
  const metric=(title,value)=>'<div><span>'+escape(title)+'</span><strong>'+value+'</strong></div>';
  return '<div class="v3-attendance-head"><div><h2>Attendance register</h2><p>'+escape(s.date)+' · exact recorded day</p></div><small>Old date bhi dekh sakte hain</small></div>'+
   '<div class="v3-attendance-counts">'+metric('Present',s.present)+metric('Half day',s.half)+metric('Absent',s.absent)+metric('Leave / Holiday',s.leave+s.holiday)+metric('Not marked',s.notMarked)+'</div>'+
   '<p class="v3-attendance-help">Not marked ka matlab absent nahi hai. Sirf saved attendance status dikhaya hai; salary/payments automatic calculate nahi hote.</p>'+
   (s.rows.length?'<div class="v3-attendance-list">'+s.rows.map(p=>
    '<article class="v3-attendance-person"><div class="v3-attendance-person-main"><strong>'+escape(p.name)+'</strong><small>'+escape(p.position||'Staff')+'</small></div>'+
    '<span class="v3-attendance-status" data-status="'+escape(p.status)+'">'+escape(p.status)+'</span>'+
    '<button type="button" data-v3-attendance-employee="'+escape(p.id)+'" aria-label="'+(p.recorded?'Edit saved':'Mark')+' attendance for '+escape(p.name)+'">'+(p.recorded?'Review / Edit':'Mark attendance')+'</button></article>').join('')+'</div>':'<p class="v3-attendance-empty">No active employees in this restaurant.</p>');
 }
 const api={iso,statuses,summarize,load,html};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteV3Attendance=api;
})(typeof window!=='undefined'?window:globalThis);
