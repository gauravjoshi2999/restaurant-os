/* Bite Owner V3 A08: existing HR records, no new employee/attendance ledger.
 * Presentation and duplicate review only. All writes remain in RLS-scoped Owner handlers. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dayOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
 const norm=s=>String(s??'').trim().toLocaleLowerCase('en-IN').replace(/\s+/g,' ');
 const phone=s=>String(s??'').replace(/\D/g,'');
 const uuid=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s??''));
 const rupee=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 function duplicates(rows,draft,excludeId){
  const code=norm(draft?.employee_code),name=norm(draft?.full_name),number=phone(draft?.phone);
  return (Array.isArray(rows)?rows:[]).filter(e=>e&&e.id!==excludeId&&
   ((code&&norm(e.employee_code)===code)||
    (number.length>=10&&phone(e.phone).slice(-10)===number.slice(-10))||
    (name.length>=3&&norm(e.full_name)===name)));
 }
 function scoped(rows,restaurantId){
  return (Array.isArray(rows)?rows:[]).filter(e=>e&&e.restaurant_id===restaurantId&&uuid(e.id));
 }
 function attendanceDay(employees,attendance,date,restaurantId){
  if(!dayOK(date)||!restaurantId)return [];
  const saved=new Map((Array.isArray(attendance)?attendance:[])
   .filter(a=>a?.restaurant_id===restaurantId&&a.attendance_date===date&&uuid(a.employee_id))
   .map(a=>[a.employee_id,a]));
  return scoped(employees,restaurantId).filter(e=>e.status==='Active'||saved.has(e.id))
   .sort((a,b)=>a.full_name.localeCompare(b.full_name))
   .map(e=>({employee:e,entry:saved.get(e.id)||null}));
 }
 function filteredEmployees(employees,restaurantId,query='',filter='active'){
  const q=norm(query);
  return scoped(employees,restaurantId).filter(e=>
   (filter==='all'||(filter==='inactive'?e.status!=='Active':e.status==='Active'))&&
   (!q||[e.full_name,e.employee_code,e.position,e.phone].some(x=>norm(x).includes(q))))
   .sort((a,b)=>(a.status==='Active'?0:1)-(b.status==='Active'?0:1)||
    String(a.full_name||'').localeCompare(String(b.full_name||'')));
 }
 function employeeHTML(employees,attendance,{restaurantId,day,query='',filter='active',owner=false}={}){
  const list=filteredEmployees(employees,restaurantId,query,filter);
  const entries=new Map(attendanceDay(employees,attendance,day,restaurantId).map(x=>[x.employee.id,x.entry]));
  return '<p class="a08-count" role="status">'+list.length+' employee(s) · '+esc(filter)+' view</p>'+
   (list.length?'<div class="a08-employee-grid">'+list.map(e=>{
    const a=entries.get(e.id),name=esc(e.full_name),position=esc(e.position||'Team member');
    return '<article class="a08-employee-card"><div class="a08-avatar" aria-hidden="true">'+esc((e.full_name||'?').trim().slice(0,1).toUpperCase())+'</div>'+
     '<div class="a08-employee-info"><strong>'+name+'</strong><span>'+position+(e.employee_code?' · '+esc(e.employee_code):'')+'</span>'+
     '<span class="a08-attendance '+(a?'a08-marked':'')+'">'+esc(day)+' · '+esc(a?.status||'Not marked')+'</span>'+
     '<small>'+esc(e.phone||'No mobile')+' · '+(e.status==='Active'?'Active':'Inactive')+'</small></div>'+
     '<div class="a08-employee-actions"><button type="button" data-a08-action="edit" data-id="'+esc(e.id)+'">Edit profile</button>'+
     (e.status==='Active'?'<button type="button" data-a08-action="mark" data-id="'+esc(e.id)+'">Attendance</button>':'')+
     (owner&&e.status==='Active'?'<button type="button" class="a08-danger" data-a08-action="deactivate" data-id="'+esc(e.id)+'">Deactivate</button>':'')+
     '</div></article>';
   }).join('')+'</div>':'<p class="a08-empty">Is search mein koi employee nahi mila. Filter badlein ya Add employee karein.</p>');
 }
 function dayHTML(employees,attendance,{restaurantId,day}={}){
  const rows=attendanceDay(employees,attendance,day,restaurantId);
  if(!dayOK(day))return '<p class="a08-empty">Attendance date choose karein.</p>';
  const recorded=rows.filter(x=>x.entry).length;
  return '<div class="a08-day-head"><strong>'+esc(day)+' · Attendance register</strong><span>'+recorded+'/'+rows.length+' marked</span></div>'+
   (rows.length?'<div class="a08-day-list">'+rows.map(x=>
    '<div class="a08-day-item"><span><strong>'+esc(x.employee.full_name)+'</strong><small>'+esc(x.employee.position||'Team member')+'</small></span>'+
    '<span class="a08-day-status '+(x.entry?'a08-marked':'')+'">'+esc(x.entry?.status||'Not marked')+'</span>'+
    (x.employee.status==='Active'?'<button type="button" data-a08-action="mark" data-id="'+esc(x.employee.id)+'">'+(x.entry?'Review / correct':'Mark')+'</button>':'')+'</div>'
   ).join('')+'</div>':'<p class="a08-empty">No active employees on this register.</p>');
 }
 function render({cards,dayHost,employees,attendance,restaurantId,date,query,filter,role,onAction}={}){
  if(!cards||!dayHost||!restaurantId){
   if(cards)cards.textContent='Staff account not available.';
   if(dayHost)dayHost.textContent='Attendance not available.';
   return false;
  }
  const options={restaurantId,day:date,query,filter,owner:role==='owner'};
  cards.innerHTML=employeeHTML(employees,attendance,options);
  dayHost.innerHTML=dayHTML(employees,attendance,{restaurantId,day:date});
  for(const host of [cards,dayHost]){
   host._a08Action=onAction;
   if(host.dataset.a08Bound==='1')continue;
   host.dataset.a08Bound='1';
   host.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-a08-action][data-id]');
    if(!button||!host.contains(button))return;
    host._a08Action?.(button.dataset.a08Action,button.dataset.id);
   });
  }
  return true;
 }
 const api={dayOK,norm,phone,uuid,duplicates,scoped,attendanceDay,filteredEmployees,employeeHTML,dayHTML,render};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteOwnerA08=api;
})(typeof window!=='undefined'?window:globalThis);
