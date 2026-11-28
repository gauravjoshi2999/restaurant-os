/* Owner-decided account access and scoped operational data removal. */
(function(root){
 'use strict';
 let ctx,operation=0;
 const H=()=>root.BiteHospitality,p=()=>ctx?.getAccess().property;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const groups=[
 ['Hotel screens',[['hotel_rooms','Room status'],['guest_register','Guest register & IDs'],['reservations','Reservations'],['folios','Guest bills / checkout list'],['housekeeping','Housekeeping'],['room_service','Room service']]],
 ['Hotel work',[['guest_entry','Add / update guests and ID photos'],['reservation_entry','Create reservations'],['checkin','Check in guests'],['stay_manage','Move, extend or cancel stays'],['checkout','Complete checkout'],['room_manage','Add / edit rooms'],['housekeeping_work','Update cleaning status'],['room_service_work','Update room service']]],
 ['Money & accounts',[['payment_entry','Record received money / advances'],['payment_verify','Verify bank / UPI receipts'],['discount','Apply discounts / corrections'],['refund','Record / approve refunds'],['reporting','View reports & Daily Book'],['daybook_entry','Add Daily Book entries'],['close_day','Close / lock the day'],['expenses','View expense history'],['expense_entry','Record expenses']]],
 ['Restaurant',[['restaurant_pos','View POS bills'],['restaurant_menu','View menu'],['pos_entry','Create POS bills'],['room_charge','Add food to room bill'],['online_food_orders','View Bite orders'],['orders_manage','Accept / update Bite orders'],['menu_manage','Edit menu'],['inventory','View stock / purchases'],['stock_entry','Record stock / purchases']]],
 ['Staff',[['staff_management','View staff / attendance'],['staff_entry','Add staff / attendance entries'],['salary_manage','Record salary / advances']]]
 ];
 const defaults=role=>role==='cashier'?['restaurant_pos','restaurant_menu','dine_in','takeaway','pos_entry','payment_entry']:role==='housekeeping'?['hotel_rooms','housekeeping','housekeeping_work']:role==='accountant'?['reporting','folios','expenses']:['hotel_rooms','guest_register','reservations','folios','hotel_incidentals','guest_entry','reservation_entry','checkin'];
 const owner=()=>p()?.role==='owner';
 function can(permission){return !p()||owner()||Array.isArray(p().permissions)&&p().permissions.includes(permission)}
 function init(context){ctx=context;
  const content=root.document.querySelector('#mainApp .content');if(!content)return;
  content.addEventListener('click',click);content.addEventListener('submit',submit);
  if(root.MutationObserver)new root.MutationObserver(()=>apply(content)).observe(content,{childList:true,subtree:true});
 }
 function permissionsHTML(selected){return '<div class="bac-permissions">'+groups.map(([label,rows])=>'<details open><summary>'+esc(label)+'</summary>'+rows.map(([key,text])=>'<label><input type="checkbox" name="permissions" value="'+key+'" '+(selected.includes(key)?'checked':'')+'><span>'+esc(text)+'</span></label>').join('')+'</details>').join('')+'</div>'}
 function renderStaff(target,embedded=false){
  if(!owner()){target.innerHTML='<p class="bh-note">The hotel owner decides staff access.</p>';return}
  const db=H().getWorkspace();
  target.innerHTML=(embedded?'<h2>Staff account access</h2>':H().header('Staff access','Choose the screens and work each account can use.'))+
   '<p class="bh-note">New manager and reception accounts start with guest entry, reservations and check-in. Deleting records and changing account permissions stay with the hotel owner.</p>'+
   '<div class="bac-member-list">'+(db.members||[]).map(m=>'<article class="bh-record"><div><strong>'+esc(m.display_name||m.email||m.role)+'</strong><p>'+esc(m.email||'')+' · '+esc(m.role)+' · '+(m.active?'Active':'Revoked')+'</p><small>'+(m.role==='owner'?'All owner permissions':(m.permissions||defaults(m.role)).length+' permissions')+'</small></div>'+(m.role==='owner'?'':'<button type="button" class="btn secondary" data-access-edit="'+esc(m.user_id)+'">Edit access</button>')+'</article>').join('')+'</div>'+
   '<form class="bh-form bh-panel bac-access-form" data-access-form="staff"><h2 data-access-title>Add staff login access</h2><input type="hidden" name="user_id"><label class="bh-field"><span>Registered staff email</span><input type="email" name="email" required maxlength="254" autocomplete="off"></label>'+
   '<label class="bh-field"><span>Role template</span><select name="role">'+['receptionist','manager','cashier','housekeeping','accountant'].map(r=>'<option>'+r+'</option>').join('')+'</select></label>'+
   '<label class="bh-check"><input type="checkbox" name="active" checked> Account access active</label>'+permissionsHTML(defaults('receptionist'))+
   '<p class="bh-note">Manager template supports payment verification and advanced corrections when you enable them. Staff must first register with this email. No invitation is sent.</p><p role="status" class="bh-message"></p><div class="bh-actions"><button type="submit" class="btn">Save staff access</button><button type="button" class="btn secondary" data-access-new>New staff</button></div></form>';
  target.querySelector('[name=role]').onchange=e=>{const set=new Set(defaults(e.target.value));target.querySelectorAll('[name=permissions]').forEach(x=>x.checked=set.has(x.value))};
 }
 function settings(target){
  target.querySelector('#biteOwnerDataControls')?.remove();if(!owner())return;
  const section=root.document.createElement('section');section.id='biteOwnerDataControls';section.className='bh-workspace bh-panel bac-data';
  section.innerHTML='<h2>Manage / delete records</h2><p>Select this hotel’s records, review the count, then confirm removal. Related hotel bills are removed with a stay; separately recorded restaurant food sales remain in restaurant accounts.</p>'+
   '<label class="bh-field"><span>Data section</span><select data-data-scope>'+[['stays','Hotel stays & related guest bills'],['guests','Guest profiles & saved ID references'],['rooms','Room setup'],['daybook','Daily Book entries'],['expenses','Hotel expenses'],...(ctx.getAccess().restaurantId?[['pos_drafts','POS drafts'],['restaurant_expenses','Restaurant expenses'],['menu_items','Unused menu items'],['tables','Unused restaurant tables']]:[])].map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+'</select></label>'+
   '<button type="button" class="btn secondary" data-data-load>Load records</button><div data-data-body></div><p class="bh-message" role="status"></p>';
  target.append(section);
 }
 async function rpc(name,args){const id=p()?.id,user=ctx.getUser()?.id;const r=await ctx.sb.rpc(name,{p_property:id,...args});if(id!==p()?.id||user!==ctx.getUser()?.id)throw Error('Account or hotel changed. Reopen this screen.');if(r.error)throw Error(r.error.message||'The request failed.');return r.data}
 async function click(e){
  const edit=e.target.closest('[data-access-edit]');if(edit&&owner()){
   const m=H().getWorkspace().members.find(x=>x.user_id===edit.dataset.accessEdit),f=edit.closest('.bh-workspace,.page').querySelector('[data-access-form=staff]');if(!m||!f)return;
   f.elements.user_id.value=m.user_id;f.elements.email.value=m.email||'';f.elements.email.readOnly=true;f.elements.role.value=m.role;f.elements.active.checked=m.active;const chosen=new Set(m.permissions||defaults(m.role));f.querySelectorAll('[name=permissions]').forEach(x=>x.checked=chosen.has(x.value));f.querySelector('[data-access-title]').textContent='Edit '+(m.display_name||m.email||'staff')+' access';f.scrollIntoView({block:'start',behavior:'smooth'});return;
  }
  if(e.target.closest('[data-access-new]')){const f=e.target.closest('form');renderStaff(f.parentElement,!!f.closest('#bitePropertyStaffAccess'));return}
  const load=e.target.closest('[data-data-load]');if(load&&owner()){
   const card=load.closest('.bac-data'),status=card.querySelector('[role=status]'),scope=card.querySelector('[data-data-scope]').value,seq=++operation;load.disabled=true;status.textContent='Loading records…';
   try{const preview=await rpc('bite_owner_data_preview',{p_scope:scope,p_ids:[]});if(seq!==operation||!card.isConnected)return;
    const db=H().getWorkspace();card.dataset.scope=scope;card.__preview=preview;
    const rows=preview.records||[];card.querySelector('[data-data-body]').innerHTML=rows.length?'<p><strong>'+preview.count+' records</strong></p><label class="bh-check"><input type="checkbox" data-data-all> Select all</label><div class="bac-records">'+rows.map(r=>{const stay=scope==='stays'?db.stays.find(x=>x.id===r.id):null,guest=stay?db.guests.find(x=>x.id===stay.guest_id):null,room=stay?db.rooms.find(x=>x.id===stay.room_id):null;return '<label class="bac-record"><input type="checkbox" name="data_ids" value="'+esc(r.id)+'"><span><strong>'+esc(guest?guest.full_name+' · Room '+(room?.number||'—'):r.label)+'</strong><small>'+esc(String(r.date||'').slice(0,10))+' · '+esc(r.status)+'</small></span></label>'}).join('')+'</div><form data-access-form="delete"><button type="button" class="btn secondary" data-data-review>Review selected removal</button><div data-data-confirm hidden></div></form>':'<p>No records in this section.</p>';
    card.querySelector('[data-data-all]')?.addEventListener('change',ev=>card.querySelectorAll('[name=data_ids]').forEach(x=>x.checked=ev.target.checked));status.textContent='Select the records you want to remove.';
   }catch(error){status.textContent=error.message}finally{load.disabled=false}return;
  }
  const review=e.target.closest('[data-data-review]');if(review&&owner()){
   const card=review.closest('.bac-data'),status=card.querySelector('[role=status]'),ids=[...card.querySelectorAll('[name=data_ids]:checked')].map(x=>x.value),scope=card.dataset.scope;
   if(!ids.length){status.textContent='Select at least one record.';return}
   review.disabled=true;
   try{const preview=await rpc('bite_owner_data_preview',{p_scope:scope,p_ids:ids});if(!card.isConnected)return;
    card.__deletion={scope,ids,preview,request:root.crypto.randomUUID()};const body=card.querySelector('[data-data-confirm]');body.hidden=false;body.innerHTML='<p><strong>Remove '+preview.count+' selected records?</strong></p>'+(preview.linked_food_bills?'<p>'+preview.linked_food_bills+' linked restaurant food bill(s) will remain in restaurant accounts.</p>':'')+'<label class="bh-field"><span>Type '+esc(p().name)+' to confirm</span><input name="confirmation" autocomplete="off" required></label><button type="submit" class="btn danger">Delete selected records</button>';status.textContent='Review the selected records before confirming.';
   }catch(error){status.textContent=error.message}finally{review.disabled=false}
  }
 }
 async function submit(e){
  const form=e.target.closest('[data-access-form]');if(!form)return;e.preventDefault();e.stopPropagation();if(!owner())return;
  const b=form.querySelector('button[type=submit]'),status=form.querySelector('[role=status]')||form.closest('.bac-data')?.querySelector('[role=status]');if(b.disabled)return;b.disabled=true;
  try{
   if(form.dataset.accessForm==='staff'){
    await rpc('bite_save_staff_access',{p_user:form.elements.user_id.value||null,p_email:form.elements.email.value,p_role:form.elements.role.value,p_active:form.elements.active.checked,p_permissions:[...form.querySelectorAll('[name=permissions]:checked')].map(x=>x.value)});
    await H().reload();if(form.isConnected)renderStaff(form.parentElement,!!form.closest('#bitePropertyStaffAccess'));
   }else{
    const card=form.closest('.bac-data'),d=card.__deletion;if(!d)throw Error('Review selected records first.');if(form.elements.confirmation.value!==p().name)throw Error('Type the hotel name exactly to confirm.');
    const r=await rpc('bite_owner_data_delete',{p_scope:d.scope,p_ids:d.ids,p_preview_hash:d.preview.preview_hash,p_confirmation:form.elements.confirmation.value,p_request:d.request});
    for(const key of ['bite_register_draft:','bite_family_request:'])try{root.localStorage.removeItem(key+ctx.getUser().id+':'+p().id)}catch{}
    await H().reload();if(card.isConnected)card.querySelector('[data-data-body]').replaceChildren();const resultStatus=root.document.querySelector('#biteOwnerDataControls .bh-message')||status;if(resultStatus?.isConnected)resultStatus.textContent=r.deleted+' records deleted.'
   }
  }catch(error){if(status?.isConnected)status.textContent=error.message}finally{if(b.isConnected)b.disabled=false}
 }
 function apply(target=root.document){
  if(!p()||owner())return;
  const map={checkout:'checkout',checkin:'checkin','register':'reservation_entry','new-room':'room_manage','edit-room':'room_manage','edit-guest':'guest_entry','guest-use':'reservation_entry','food-menu':'room_charge','charge':'room_charge','payment':'payment_entry','payment-confirm':'payment_verify','payment-void':'payment_verify','discount':'discount','reverse':'discount','refund':'refund','stay-options':'stay_manage','room-status':'housekeeping_work','room-privacy':'housekeeping_work'};
  target.querySelectorAll('[data-hotel-action]').forEach(b=>{const a=b.dataset.hotelAction,key=a==='entry'?(['payment','deposit_hold','deposit_apply','deposit_return'].includes(b.dataset.id)?'payment_entry':b.dataset.id==='refund'?'refund':b.dataset.id==='discount'?'discount':'room_charge'):({'verify-payment':'payment_verify','void-payment':'payment_verify','split-bill':'checkout','group-booking':'reservation_entry','close-shift':'close_day','room-release':'room_manage','food-save':'room_charge','fresh-register':'reservation_entry'}[a]||map[a]);if(key&&!can(key))b.hidden=true});
  target.querySelectorAll('[data-ha-action]').forEach(b=>{const a=b.dataset.haAction,key=a==='checkout'?'checkout':a==='extra'?'room_charge':['income','expense','staff_advance','salary','accounts','opening','transfer_in','transfer_out','salary_expense','salary_payment'].includes(a)?'daybook_entry':a==='note'?'payment_verify':null;if(key&&!can(key))b.hidden=true});
  target.querySelectorAll('[data-bill-action]').forEach(b=>{const a=b.dataset.billAction,key=a==='booking-checkout'?'checkout':a==='food-room'?'room_charge':['receipt-yes','receipt-no'].includes(a)?'payment_verify':['deposit-apply','deposit-return'].includes(a)?'payment_entry':null;if(key&&!can(key))b.hidden=true});
  target.querySelectorAll('[data-gr-action=repeat]').forEach(b=>{if(!can('reservation_entry'))b.hidden=true});
  target.querySelectorAll('[onclick]').forEach(b=>{if(/delete|reset|removeMenu|clearAll/i.test(b.getAttribute('onclick')||''))b.hidden=true});
 }
 root.BiteOwnerAccess={init,can,owner,defaults,groups,renderStaff,settings,apply,clear:()=>{operation++}};
 if(typeof module==='object'&&module.exports)module.exports={defaults,groups};
})(typeof window!=='undefined'?window:globalThis);
