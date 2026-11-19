/* Bite Owner V3 A08 / Employee profile cards.
 * Read-only presentation over canonical restaurant_employees & verified A08 attendance.
 * No new HR tables, payment records, or parallel attendance engine. */
(function(root){
'use strict';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=x=>String(x??'').trim().toLocaleLowerCase('en-IN').replace(/\s+/g,' ');
const digits=x=>String(x??'').replace(/\D/g,'');
const uuid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x??''));
function duplicates(list,payload,exceptId){
 const code=norm(payload?.employee_code),name=norm(payload?.full_name),mobile=digits(payload?.phone);
 return (Array.isArray(list)?list:[]).filter(e=>e&&e.id!==exceptId&&(
  (code&&norm(e.employee_code)===code)||
  (name.length>=3&&name===norm(e.full_name))||
  (mobile.length>=10&&digits(e.phone).length>=10&&mobile.slice(-10)===digits(e.phone).slice(-10))));
}
function filter(list,restaurantId,query='',visibility='active'){
 const q=norm(query);
 return (Array.isArray(list)?list:[]).filter(e=>
 e?.restaurant_id===restaurantId&&uuid(e.id)&&
 (visibility==='all'||(visibility==='inactive'?e.status==='Inactive':e.status==='Active'))&&
 (!q||[e.full_name,e.employee_code,e.position,e.phone].some(t=>norm(t).includes(q))))
 .sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name)));
}
function html(list,{restaurantId,query='',visibility='active',day='',verifiedDay=null}={}){
 const rows=filter(list,restaurantId,query,visibility);
 const statuses=verifiedDay?.date===day?new Map((verifiedDay.rows||[]).map(x=>[x.id,x.status])):null;
 return '<p class="a08p-count" role="status">'+rows.length+' employee(s) · '+esc(visibility)+' view</p>'+
 (rows.length?'<div class="a08p-cards">'+rows.map(e=>{
  const status=statuses?(statuses.get(e.id)||'Inactive / not in day register'):'Attendance not verified';
  return '<article class="a08p-card"><div class="a08p-avatar" aria-hidden="true">'+esc(String(e.full_name||'?').charAt(0).toUpperCase())+'</div>'+
   '<div class="a08p-details"><strong>'+esc(e.full_name)+'</strong><span>'+esc(e.position||'Team member')+
   (e.employee_code?' · '+esc(e.employee_code):'')+'</span><small>'+esc(e.phone||'No mobile')+'</small>'+
   '<small>Day '+esc(day||'—')+' · '+esc(status)+'</small><small>'+esc(e.status)+'</small></div>'+
   '<div class="a08p-actions"><button type="button" data-a08p-action="edit" data-id="'+esc(e.id)+'">Edit</button>'+
   (e.status==='Active'?'<button type="button" data-a08p-action="attendance" data-id="'+esc(e.id)+'">Attendance</button>'+
   '<button type="button" class="a08p-danger" data-a08p-action="deactivate" data-id="'+esc(e.id)+'">Deactivate</button>':'')+
   '</div></article>';
 }).join('')+'</div>':'<p class="a08p-empty">No employees match your search. Try another filter.</p>');
}
const api={norm,digits,uuid,duplicates,filter,html};
if(typeof module==='object'&&module.exports)module.exports=api;
else root.BiteOwnerA08Profiles=api;
})(typeof window!=='undefined'?window:globalThis);
