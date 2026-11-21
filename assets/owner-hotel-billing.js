/* Hotel billing actions: draft tax, visible checkout blockers and one guest / multiple rooms. */
(function(root){
 'use strict';
 const H=()=>root.BiteHospitality,A=()=>root.BiteHotelAccounts,p=()=>H()?.prop(),db=()=>H()?.getWorkspace()||{};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const button=(a,label,id='',extra='')=>'<button type="button" class="btn secondary" data-bill-action="'+a+'" data-id="'+esc(id)+'" '+extra+'>'+esc(label)+'</button>';
 const field=(n,label,value='',extra='')=>'<label class="bh-field"><span>'+esc(label)+'</span><input name="'+n+'" value="'+esc(value)+'" '+extra+'></label>';
 const note=()=>'<p class="bh-message" role="status"></p>';
 const methods='<label class="bh-field"><span>Payment received by</span><select name="method"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Card</option></select></label>';
 let ctx,bound=false,active=0,generation=0;
 const key=()=>ctx?.getUser()?.id+':'+p()?.id,manager=()=>['owner','manager'].includes(p()?.role);
 function assertScope(scope,version){if(scope!==key()||version!==generation)throw Error('Account changed. Reopen this bill.')}
 function init(context){ctx=context;if(bound)return;bound=true;document.querySelector('#mainApp .content')?.addEventListener('click',click);document.querySelector('#mainApp .content')?.addEventListener('submit',submit);}
 function clear(){generation++}
 function mode(){return p()?.tax_profile?.gstin?'gst':'plain'}
 function booking(stay){return stay?.group_id?(db().stays||[]).filter(s=>s.group_id===stay.group_id&&!['cancelled','no_show'].includes(s.status)):(db().stays||[]).filter(s=>s.guest_id===stay?.guest_id&&!s.group_id&&!['cancelled','no_show'].includes(s.status)&&s.arrival<stay.departure&&stay.arrival<s.departure)}
 function getFolio(id){return(db().folios||[]).find(f=>f.id===id)}
 function rowsFor(stay){return booking(stay).map(s=>({stay:s,folio:(db().folios||[]).find(f=>f.stay_id===s.id),room:(db().rooms||[]).find(r=>r.id===s.room_id)})).filter(r=>r.folio)}
 function linkedBalanceLabel(folio){const raw=folio?.totals?.balance;if(raw===null||raw===undefined||raw===''||!Number.isFinite(Number(raw)))return 'Balance unavailable';const amount=Number(raw);return amount>0?'Due '+money(amount):amount<0?'Credit to review '+money(Math.abs(amount)):'No balance due';}
 function checkoutAmountCents(raw){
  if(typeof raw!=='number'&&!(typeof raw==='string'&&/^-?\d+(?:\.\d{1,2})?$/.test(raw.trim())))return null;
  const n=Number(raw),cents=Math.round(n*100);
  return Number.isFinite(n)&&Number.isSafeInteger(cents)&&Math.abs(n*100-cents)<0.00001?cents:null;
 }
 function checkoutTotalsReady(rows){
  if(!Array.isArray(rows)||!rows.length)return false;
  for(const field of ['charges','paid','balance','deposit_held','pending']){
   let sum=0;
   for(const r of rows){
    const cents=checkoutAmountCents(r?.folio?.totals?.[field]);
    if(cents===null||(['deposit_held','pending'].includes(field)&&cents<0))return false;
    sum+=cents;if(!Number.isSafeInteger(sum))return false;
   }
  }
  return true;
 }
 function familyBillSummary(stay,workspace){
  if(!stay?.group_id)return null;
  const stays=(workspace.stays||[]).filter(s=>s.group_id===stay.group_id&&!['cancelled','no_show'].includes(s.status));
  const fields=['charges','paid','balance','deposit_held','pending'],totals=Object.fromEntries(fields.map(k=>[k,0]));
  const seenFolios=new Set(),seenEntries=new Set();let ready=stays.length>0;
  const rows=stays.map(s=>{
   const matches=(workspace.folios||[]).filter(f=>f.stay_id===s.id),folio=matches.length===1?matches[0]:null;
   const room=(workspace.rooms||[]).find(r=>r.id===s.room_id);
   if(!folio||!folio.id||seenFolios.has(folio.id)){ready=false;return{stay:s,room,folio:null,entries:[]}}
   seenFolios.add(folio.id);
   for(const k of fields){const c=checkoutAmountCents(folio.totals?.[k]);if(c===null||(['deposit_held','pending'].includes(k)&&c<0)||!Number.isSafeInteger(totals[k]+c)){ready=false;continue}totals[k]+=c}
   const entries=(workspace.entries||[]).filter(e=>e.folio_id===folio.id).filter(e=>{if(!e.id||seenEntries.has(e.id)){ready=false;return false}seenEntries.add(e.id);return true});
   return{stay:s,room,folio,entries};
  });
  return{rows,totals:ready?Object.fromEntries(fields.map(k=>[k,totals[k]/100])):null};
 }
 function familyBillMarkup(summary){
  if(!summary||summary.rows.length<2)return '';
  const t=summary.totals;
  const amount=v=>checkoutAmountCents(v)===null?'Unavailable':money(v);
  const pairs=t?'<div class="bh-guest-bill-summary"><div><span>Total charges</span><strong>'+money(t.charges)+'</strong></div><div><span>Received &amp; applied</span><strong>'+money(t.paid)+'</strong></div><div><span>Net balance</span><strong>'+money(t.balance)+'</strong></div><div><span>Deposit held separately</span><strong>'+money(t.deposit_held)+'</strong></div><div><span>Pending verification</span><strong>'+money(t.pending)+'</strong></div></div>':'<p class="bh-note">Combined totals unavailable. Review every room bill before collecting.</p>';
  const rows=summary.rows.map(r=>'<details class="bh-guest-advanced"><summary>Room '+esc(r.room?.number||'—')+' · '+esc(linkedBalanceLabel(r.folio))+'</summary>'+(!r.folio?'<p>Room bill unavailable.</p>':r.entries.map(e=>{
   const a=checkoutAmountCents(e.amount),tax=checkoutAmountCents(e.tax_amount??0),total=a===null||tax===null||!Number.isSafeInteger(a+tax)?'Unavailable':money((a+tax)/100);
   return '<div class="bh-guest-bill-line"><div><strong>'+esc(e.description||e.kind)+'</strong><small>'+esc(e.kind)+' · '+esc(e.status||'Status unavailable')+'</small>'+(e.source_order_id?'<small>Linked original food sale · open room bill to view POS</small>':'')+'</div><strong>'+total+'</strong></div>';
  }).join('')+button('open-room','Open room bill',r.folio.id))+'</details>').join('');
  return '<section class="bh-panel" data-h12-family-bill><h2>Family bill · '+summary.rows.length+' rooms</h2>'+pairs+rows+'<p class="bh-note">Combined view of existing room folios, not a new sale or collection. Collect through the individual room bill or authorized group checkout.</p></section>';
 }
 function needsTax(f){const current=p()?.tax_profile||{},saved=f.bill_tax_profile;if(!saved)return mode()==='gst'||(db().entries||[]).some(e=>e.folio_id===f.id&&e.status==='confirmed'&&Number(e.tax_amount));return(saved.billing_mode||'plain')!==mode()||mode()==='gst'&&(saved.gstin!==current.gstin||Number(saved.food_rate)!==Number(current.food_rate)||Number(saved.incidental_rate)!==Number(current.incidental_rate))}
 async function ensureTax(id){const f=getFolio(id);if(f?.status==='open'&&needsTax(f))await H().command('folio_tax',{folio_id:id,mode:mode()})}
 function decorateRegister(form,draft={}){
  if(draft.booking_stay_id){const s=(db().stays||[]).find(s=>s.id===draft.booking_stay_id);if(s&&s.guest_id===form.elements.guest_id.value)linkRoom(form,s)}
 }
 function linkRoom(form,stay){
  let input=form.elements.booking_stay_id;if(!input){input=document.createElement('input');input.type='hidden';input.name='booking_stay_id';form.append(input)}input.value=stay.id;
  form.querySelector('[data-linked-room-note]')?.remove();const room=(db().rooms||[]).find(r=>r.id===stay.room_id),banner=document.createElement('p');banner.dataset.linkedRoomNote='';banner.className='bh-note';banner.textContent='Another room for the same guest · Linked with Room '+room?.number+'. Enter the guests and agreed rent for this new room.';form.querySelector('.ha-register-meta')?.after(banner);const separate=document.createElement('button');separate.type='button';separate.className='ha-text-button';separate.textContent='Separate booking';separate.onclick=()=>{input.value='';banner.remove();form.dispatchEvent(new Event('input',{bubbles:true}))};banner.append(separate);
  form.elements.departure.value=stay.departure;if(stay.arrival>form.elements.arrival.value)form.elements.arrival.value=stay.arrival;
  form.elements.guest_id.addEventListener('change',()=>{if(form.elements.guest_id.value!==stay.guest_id){input.value='';banner.remove()}});
  root.BiteCheckinGuard?.rooms(form);H().persistRegistration(form);
 }
 function decorateFolio(target,folio,stay){
  if(!stay)return;const entries=(db().entries||[]).filter(e=>e.folio_id===folio.id&&e.status==='confirmed'),gst=entries.reduce((n,e)=>n+(['charge'].includes(e.kind)?1:['reversal','discount'].includes(e.kind)?-1:0)*Number(e.tax_amount||0),0),profile=folio.bill_tax_profile||p().tax_profile||{},registered=!!profile.gstin;
  const groups=A().billTaxGroups(entries.filter(e=>['charge','reversal','discount'].includes(e.kind))),cgst=groups.reduce((n,g)=>n+g.cgst,0),sgst=groups.reduce((n,g)=>n+g.sgst,0);
  const card=document.createElement('section');card.className='bh-bill-tax-card';card.innerHTML='<div><strong>'+(registered?'GST invoice':'Guest bill · No GST')+'</strong><p>'+(registered?'CGST '+money(cgst)+' + SGST '+money(sgst):'GST is off for this hotel.')+'</p></div>'+(folio.status==='open'&&p().can_configure?button('tax-settings','Billing & GST',folio.id):'');
  target.querySelector('.bh-guest-bill-summary')?.after(card);const guest=(db().guests||[]).find(g=>g.id===stay.guest_id);if(guest){const contact=document.createElement('p');contact.className='bh-room-guest-contact';contact.textContent=[guest.phone,guest.address].filter(Boolean).join(' · ');target.querySelector('.bh-stay-dates')?.after(contact)}
  if(folio.status==='open'&&['owner','manager','receptionist'].includes(p().role))target.querySelector('.bh-guest-bill-buttons')?.insertAdjacentHTML('beforeend','<button type="button" class="btn secondary" data-hotel-action="add-guest-room" data-id="'+esc(stay.id)+'">＋ Another room for this guest</button>');
  const rows=rowsFor(stay);if(rows.length>1){const box=document.createElement('section');box.className='bh-panel bh-linked-booking';box.innerHTML='<h2>'+(stay.group_id?'One booking':'This guest')+' · '+rows.length+' rooms</h2>'+rows.map(r=>'<div class="bh-room-line"><span>Room '+esc(r.room?.number)+' · '+esc(r.stay.status==='in_house'?'Staying':r.stay.status==='checked_out'?'Checked out':'Reserved')+' · '+esc(linkedBalanceLabel(r.folio))+'</span>'+button('open-room','Open',r.folio.id)+(stay.group_id&&r.stay.status==='in_house'&&r.folio.status==='open'&&H().has('charge_to_room')?button('food-room','＋ Food',r.folio.id):'')+'</div>').join('')+'<div class="bh-actions">'+button('booking-bill','Combined bill',stay.id)+(stay.group_id&&rows.filter(r=>r.stay.status==='in_house'&&r.folio.status==='open').length>1?button('booking-checkout','Checkout all rooms',stay.id):'')+'</div>';target.querySelector('.bh-guest-bill-top')?.after(box)}
  const family=familyBillMarkup(familyBillSummary(stay,db()));if(family)target.querySelector('.bh-guest-bill-summary')?.insertAdjacentHTML('afterend',family);
  if(stay.status==='checked_out'){const done=document.createElement('p');done.className='bh-note';done.innerHTML='Checkout complete. '+(!H().housekeepingVisible()?'Room is available again. ':'')+'<button type="button" class="ha-text-button" data-bill-action="rooms">Back to rooms</button>';target.querySelector('.bh-guest-bill-top')?.after(done)}
 }
 function paymentFields(){return methods+field('account_note','Online account · Short note',p().tax_profile?.primary_account||'','maxlength="80"')+field('reference','Online transaction reference','','maxlength="100"')+'<label class="bh-check" data-online-verify><input type="checkbox" name="verified"> I verified this online receipt in the selected account.</label>'}
 function wireMoney(form){const update=()=>{const online=form.elements.method.value!=='Cash';for(const name of ['account_note','reference','verified']){const el=form.elements[name];el.closest('label').hidden=!online;if(name==='reference')el.required=online;if(!online&&name==='verified')el.checked=false}};form.elements.method.addEventListener('change',update);update()}
 async function checkout(id,group=false){
  const scope=key(),version=generation;
  let f=getFolio(id),s=(db().stays||[]).find(s=>s.id===f?.stay_id);if(!f||!s)return;
  let rows=group?rowsFor(s).filter(r=>r.stay.status==='in_house'&&r.folio.status==='open'):[{folio:f,stay:s,room:(db().rooms||[]).find(r=>r.id===s.room_id)}];
  for(const r of rows){await ensureTax(r.folio.id);assertScope(scope,version)}
  await H().reload();assertScope(scope,version);f=getFolio(id);if(!f)throw Error('This guest bill changed. Reopen the stay before checkout.');s=(db().stays||[]).find(s=>s.id===f.stay_id);if(!s)throw Error('This stay is no longer available. Reopen the Hotel Register.');rows=group?rowsFor(s).filter(r=>r.stay.status==='in_house'&&r.folio.status==='open'):[{folio:f,stay:s,room:(db().rooms||[]).find(r=>r.id===s.room_id)}];
  if(!checkoutTotalsReady(rows)){H().editor('<section class="bh-form"><h2>Checkout needs bill review</h2><p class="bh-note">One or more room bill totals are unavailable. Reopen the Guest Bill and review each linked room before checkout. No payment or checkout was recorded.</p><div class="bh-actions">'+button('close','Close')+'</div></section>');return;}
  const ids=rows.map(r=>r.folio.id),entries=(db().entries||[]).filter(e=>ids.includes(e.folio_id)),pending=entries.filter(e=>e.status==='pending'),sum=k=>rows.reduce((n,r)=>n+checkoutAmountCents(r.folio.totals[k]),0)/100,balance=sum('balance'),held=sum('deposit_held'),pendingTotal=sum('pending'),credit=rows.some(r=>Number(r.folio.totals?.balance)<0),blocked=pending.length||pendingTotal>0||held||credit;
  H().editor('<form class="bh-form" data-bill-form="checkout" data-id="'+esc(id)+'" data-group="'+(group?'true':'false')+'"><h2>'+(group?'Checkout '+rows.length+' rooms':'Checkout')+'</h2><div class="ha-checkout-summary"><span>Total room + food bill <strong>'+money(sum('charges'))+'</strong></span><span>Received & verified <strong>'+money(sum('paid'))+'</strong></span><span>'+ (balance<0?'Credit / refund due':'To collect')+' <strong>'+money(Math.abs(balance))+'</strong></span></div>'+
   '<p class="bh-note">'+(mode()==='gst'?'GST is included in this total.':'Guest bill without GST.')+(p().can_configure?' '+button('tax-settings','Change billing / GST',id):'')+'</p>'+
   (pendingTotal>0&&!pending.length?'<p class="bh-note">Pending receipt totals still need verification. Refresh the guest bill and review its receipts before checkout.</p>':'')+
   pending.map(e=>'<section class="bh-checkout-blocker"><strong>'+money(e.amount)+' '+esc(e.method)+' · Not yet verified</strong><p>Choose what actually happened to this receipt.</p>'+(manager()?'<div class="bh-actions">'+button('receipt-yes','Received',e.id,'data-return="'+esc(id)+'" data-group="'+group+'"')+button('receipt-no','Not received',e.id,'data-return="'+esc(id)+'" data-group="'+group+'"')+'</div>':'<p>Ask the owner or manager to verify it.</p>')+'</section>').join('')+
   rows.filter(r=>Number(r.folio.totals?.deposit_held)>0).map(r=>'<section class="bh-checkout-blocker"><strong>Room '+esc(r.room?.number)+' · Deposit held '+money(r.folio.totals.deposit_held)+'</strong><div class="bh-actions">'+(Number(r.folio.totals.balance)>0?button('deposit-apply','Use deposit for bill',r.folio.id,'data-return="'+esc(id)+'" data-group="'+group+'"'):'')+button('deposit-return','Record deposit returned',r.folio.id,'data-return="'+esc(id)+'" data-group="'+group+'"')+'</div></section>').join('')+
   (credit?'<p class="bh-note">A room has an overpayment. Record its actual refund under Bill adjustments before closing this booking.</p>':'')+
   '<input type="hidden" name="amount" value="'+balance+'"><input type="hidden" name="folio_ids" value="'+esc(JSON.stringify(ids.sort()))+'">'+(balance>0?paymentFields():'')+note()+'<div class="bh-actions">'+button('close','Cancel')+'<button type="submit" class="btn" '+(blocked?'disabled':'')+'>Confirm checkout & bill</button></div></form>');
  const form=document.querySelector('[data-bill-form=checkout]');if(form.elements.method)wireMoney(form);
 }
 function taxEditor(id){const tax=p().tax_profile||{};H().editor('<form class="bh-form" data-bill-form="tax" data-id="'+esc(id)+'"><h2>Hotel bill & GST</h2><label class="bh-field"><span>Billing type</span><select name="mode"><option value="plain" '+(!tax.gstin?'selected':'')+'>Guest bill · Hotel has no GST registration</option><option value="gst" '+(tax.gstin?'selected':'')+'>GST invoice · Registered hotel</option></select></label><div data-gst-fields>'+field('gstin','Hotel GSTIN',tax.gstin||'','maxlength="15" autocomplete="off"')+'<p class="bh-note">Room GST is 5% up to ₹7,500 per room / day and 18% above it. Each bill shows equal CGST and SGST components.</p><label class="bh-field"><span>Food GST · Total</span><select name="food_rate"><option value="5" '+(Number(tax.food_rate)!==18?'selected':'')+'>5% · 2.5% CGST + 2.5% SGST</option><option value="18" '+(Number(tax.food_rate)===18?'selected':'')+'>18% · 9% CGST + 9% SGST</option></select></label><label class="bh-field"><span>Extra charges GST · Total</span><select name="incidental_rate">'+[0,5,18].map(rate=>'<option value="'+rate+'" '+(rate===(tax.gstin?Number(tax.incidental_rate||0):5)?'selected':'')+'>'+rate+'%</option>').join('')+'</select></label></div><label class="bh-check"><input type="checkbox" name="reviewed" required> I confirm this hotel’s GST registration and applicable food rate.</label>'+note()+'<div class="bh-actions">'+button('close','Cancel')+'<button class="btn" type="submit">Save & update this bill</button></div></form>');const form=document.querySelector('[data-bill-form=tax]'),update=()=>{const on=form.elements.mode.value==='gst';form.querySelector('[data-gst-fields]').hidden=!on;form.elements.gstin.required=on};form.elements.mode.addEventListener('change',update);update()}
 async function preview(id){const win=root.open('','_blank');if(!win)throw Error('Allow pop-ups to view the bill.');win.opener=null;const scope=key(),version=generation;try{await ensureTax(id);await H().reload();assertScope(scope,version);win.document.write(A().billHTML(H().statement(id)));win.document.close();H().redraw()}catch(e){win.close();throw e}}
 async function combined(stayId){const stay=(db().stays||[]).find(s=>s.id===stayId);if(!stay)return;const win=root.open('','_blank');if(!win)throw Error('Allow pop-ups to view the booking bill.');win.opener=null;const scope=key(),version=generation;try{for(const row of rowsFor(stay)){await ensureTax(row.folio.id);assertScope(scope,version)}await H().reload();assertScope(scope,version);const snapshots=rowsFor(stay).map(r=>H().statement(r.folio.id)),html=A().combinedBillHTML(snapshots);win.document.write(html);win.document.close()}catch(e){win.close();throw e}}
 async function click(e){
  const b=e.target.closest('[data-bill-action]');if(!b){const card=e.target.closest('.bh-room-card');if(card&&!e.target.closest('button,a,input,select,details'))card.querySelector('[data-hotel-action=room-guest]')?.click();return}if(active)return;e.preventDefault();const a=b.dataset.billAction,id=b.dataset.id,scope=key(),version=generation;
  try{
   if(a==='close'){document.getElementById('bhActionEditor')?.remove();return}
   if(a==='rooms'){await H().navigate('rooms');return}
   if(a==='open-room'){await H().openFolio(id);return}
   if(a==='food-room'){
    const folio=getFolio(id),selected=(db().stays||[]).find(s=>s.id===folio?.stay_id);
    if(!folio||folio.status!=='open'||selected?.status!=='in_house'||!H().has('charge_to_room'))throw Error('Food can only be added to a checked-in room with charge-to-room enabled.');
    await H().openFolio(id);
    const picker=document.querySelector('#folios [data-hotel-action="food-menu"]');
    if(!picker)throw Error('Room menu is unavailable. Open Restaurant POS and choose Charge to room.');
    picker.click();
    return;
   }
   if(a==='tax-settings'){taxEditor(id);return}
   if(a==='booking-bill'){active++;await combined(id);return}
   if(a==='booking-checkout'){active++;const row=rowsFor((db().stays||[]).find(s=>s.id===id)).find(r=>r.stay.status==='in_house'&&r.folio.status==='open');if(row)await checkout(row.folio.id,true);return}
   const entry=(db().entries||[]).find(x=>x.id===id);
   if(a==='receipt-yes'&&entry){H().editor('<form class="bh-form" data-bill-form="receipt" data-id="'+esc(id)+'" data-return="'+esc(b.dataset.return)+'" data-group="'+esc(b.dataset.group)+'"><h2>Verify '+money(entry.amount)+' '+esc(entry.method)+'</h2>'+field('reference','Bank / UPI reference',entry.reference||'','required maxlength="100"')+field('account_note','Received in account',entry.account_note||p().tax_profile?.primary_account||'','maxlength="80"')+'<label class="bh-check"><input type="checkbox" name="received" required> I checked that this amount was actually received.</label>'+note()+'<button class="btn" type="submit">Confirm receipt</button></form>');return}
   if(a==='receipt-no'&&entry){active++;b.disabled=true;await H().command('payment_void',{id,folio_id:entry.folio_id,description:'Pending receipt was not received'});assertScope(scope,version);await H().reload();await checkout(b.dataset.return,b.dataset.group==='true');return}
   if(a==='deposit-apply'){active++;b.disabled=true;const f=getFolio(id);await H().command('deposit_apply',{folio_id:id,amount:Math.min(Number(f.totals.deposit_held),Number(f.totals.balance)),description:'Deposit applied to guest bill'});assertScope(scope,version);await H().reload();await checkout(b.dataset.return,b.dataset.group==='true');return}
   if(a==='deposit-return'){const f=getFolio(id);H().editor('<form class="bh-form" data-bill-form="deposit" data-id="'+esc(id)+'" data-return="'+esc(b.dataset.return)+'" data-group="'+esc(b.dataset.group)+'"><h2>Record deposit returned</h2>'+field('amount','Amount already returned',f.totals.deposit_held,'type="number" min="0.01" max="'+f.totals.deposit_held+'" step="0.01" required')+methods+field('reference','Reference · For online return','','maxlength="100"')+'<label class="bh-check"><input type="checkbox" name="returned" required> I have returned this money to the guest.</label>'+note()+'<button class="btn" type="submit">Record returned deposit</button></form>');return}
  }catch(err){const msg=document.querySelector('.page.active .bh-message');if(msg)msg.textContent=err.message;else root.alert(err.message)}finally{active=Math.max(0,active-1);if(b.isConnected)b.disabled=false}
 }
 async function submit(e){
  const form=e.target.closest('[data-bill-form]');if(!form)return;e.preventDefault();e.stopImmediatePropagation();if(active)return;const values=Object.fromEntries(new FormData(form)),type=form.dataset.billForm,id=form.dataset.id,msg=form.querySelector('.bh-message'),b=form.querySelector('[type=submit]'),scope=key(),version=generation;active++;b.disabled=true;
  try{
   if(type==='tax'){if(!form.elements.reviewed.checked)throw Error('Review the registration first.');const gst=values.mode==='gst',series=db().invoice_series||{};await H().command('billing_settings',{prefix:series.prefix||'H',next_number:Number(series.next_number||1),primary_account:p().tax_profile?.primary_account||'',tax_profile:{reviewed:true,gstin:gst?values.gstin.trim().toUpperCase():'',room_rate:gst?5:0,food_rate:gst?Number(values.food_rate):0,incidental_rate:gst?Number(values.incidental_rate):0}});assertScope(scope,version);await H().refreshContext();await H().command('folio_tax',{folio_id:id,mode:values.mode});await H().reload();H().redraw();return}
   if(type==='receipt'){if(!form.elements.received.checked)throw Error('Confirm the actual receipt.');const entry=(db().entries||[]).find(x=>x.id===id);await H().command('payment_confirm',{id,folio_id:entry.folio_id,reference:values.reference,account_note:values.account_note,description:'Receipt verified at checkout'});assertScope(scope,version);await H().reload();await checkout(form.dataset.return,form.dataset.group==='true');return}
   if(type==='deposit'){if(!form.elements.returned.checked)throw Error('Record only money already returned.');await H().command('deposit_return',{folio_id:id,amount:Number(values.amount),method:values.method,reference:values.reference,description:'Security deposit returned at checkout'});assertScope(scope,version);await H().reload();await checkout(form.dataset.return,form.dataset.group==='true');return}
   if(type==='checkout'){if(values.method&&values.method!=='Cash'&&!form.elements.verified.checked)throw Error('Verify the online receipt first.');const f=getFolio(id),stay=(db().stays||[]).find(s=>s.id===f.stay_id);await H().command(form.dataset.group==='true'?'booking_checkout_collect':'checkout_collect',{folio_id:id,...(form.dataset.group==='true'?{group_id:stay.group_id,folio_ids:JSON.parse(values.folio_ids)}:{}),amount:Number(values.amount),method:values.method||'Cash',reference:values.reference||'',account_note:values.account_note||'',verified:values.verified==='on'});assertScope(scope,version);await H().reload();H().redraw();return}
  }catch(err){if(form.isConnected)msg.textContent=err.message||String(err)}finally{active=Math.max(0,active-1);if(b.isConnected)b.disabled=false}
 }
 const api={init,clear,linkedBalanceLabel,familyBillSummary,familyBillMarkup,checkoutTotalsReady,busy:()=>active>0,decorateRegister,decorateFolio,linkRoom,checkout:async(id,group=false)=>{if(active)return;active++;try{return await checkout(id,group)}finally{active--}},preview:async id=>{if(active)return;active++;try{return await preview(id)}finally{active--}}};root.BiteHotelBilling=api;
})(typeof window!=='undefined'?window:globalThis);
