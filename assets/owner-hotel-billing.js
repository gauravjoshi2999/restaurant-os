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
 function linkedBalanceLabel(folio){const cents=checkoutAmountCents(folio?.totals?.balance);if(cents===null)return 'Balance unavailable';const amount=cents/100;return amount>0?'Due '+money(amount):amount<0?'Credit to review '+money(Math.abs(amount)):'No balance due';}
 function checkoutAmountCents(raw){
  if(typeof raw!=='number'&&!(typeof raw==='string'&&/^-?\d+(?:\.\d{1,2})?$/.test(raw.trim())))return null;
  const n=Number(raw),cents=Math.round(n*100);
  return Number.isFinite(n)&&Number.isSafeInteger(cents)&&Math.abs(n*100-cents)<0.00001?cents:null;
 }
 function verifiedFolioTotals(folio){
  const t=folio?.totals,fields=['charges','paid','balance','deposit_held','pending'];
  const values=Object.fromEntries(fields.map(k=>[k,checkoutAmountCents(t?.[k])]));
  if(fields.some(k=>values[k]===null)||values.deposit_held<0||values.pending<0)return false;
  const due=values.charges-values.paid;
  return Number.isSafeInteger(due)&&due===values.balance;
 }
 function checkoutTotalsReady(rows){
  if(!Array.isArray(rows)||!rows.length)return false;
  const ids=new Set();for(const row of rows){if(!verifiedFolioTotals(row?.folio))return false;const id=row.folio.id;if(id){if(ids.has(id))return false;ids.add(id);}}
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
   if(!verifiedFolioTotals(folio))ready=false;
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
 function availableCheckoutRooms(stay,workspace){
  if(!stay?.group_id)return [];
  const active=(workspace.stays||[]).filter(s=>s.group_id===stay.group_id&&s.status==='in_house');
  const result=[];
  for(const s of active){
   const matches=(workspace.folios||[]).filter(f=>f.stay_id===s.id&&f.status==='open');
   if(matches.length!==1||!matches[0].id||result.some(r=>r.folio.id===matches[0].id))throw Error('A room bill is missing or duplicated. Review the family booking before checkout.');
   result.push({stay:s,folio:matches[0],room:(workspace.rooms||[]).find(r=>r.id===s.room_id)});
  }
  return result;
 }
 function selectedCheckoutRows(stay,workspace,ids){
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('Choose one or more distinct active rooms.');
  const rows=availableCheckoutRooms(stay,workspace),selected=rows.filter(r=>ids.includes(r.folio.id));
  if(selected.length!==ids.length)throw Error('Room selection changed. Review active rooms again.');
  return selected;
 }
 function selectedIds(raw){if(!raw)return null;const ids=JSON.parse(raw);if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('Invalid room selection. Reopen checkout.');return ids}
 function showRoomSelection(stayId){
  const stay=(db().stays||[]).find(s=>s.id===stayId),rows=availableCheckoutRooms(stay,db());
  if(!rows.length)throw Error('No active room is available to checkout.');
  H().editor('<form class="bh-form" data-bill-form="select-rooms" data-id="'+esc(stayId)+'"><h2>Family checkout · Choose rooms</h2><p class="bh-note">Select the departing rooms. Unselected rooms remain checked in.</p>'+rows.map(r=>'<label class="bh-check"><input type="checkbox" name="selection" value="'+esc(r.folio.id)+'"> <span>Room '+esc(r.room?.number||'—')+' · '+esc(linkedBalanceLabel(r.folio))+'</span></label>').join('')+'<p class="bh-note">Selecting a room does not record payment or checkout. Review the bill before confirming.</p>'+note()+'<div class="bh-actions">'+button('close','Back')+'<button type="submit" class="btn">Review selected checkout</button></div></form>');
 }
 function creditNav(){return manager()?button('credit-list','Guest Khata · Outstanding bills'):''}
 function creditEligible(f,stay){return manager()&&f?.status==='open'&&stay?.status==='in_house'&&checkoutTotalsReady([{folio:f}])&&checkoutAmountCents(f.totals.balance)>0&&checkoutAmountCents(f.totals.pending)===0&&checkoutAmountCents(f.totals.deposit_held)===0}
 function creditEditor(id){
  const f=getFolio(id),stay=(db().stays||[]).find(s=>s.id===f?.stay_id);
  if(!creditEligible(f,stay))throw Error('Review the active room, balance, pending receipts and deposit first.');
  H().editor('<form class="bh-form" data-bill-form="credit-checkout" data-id="'+esc(id)+'"><h2>Checkout on credit</h2><p>Only the already recorded unpaid balance will carry forward. Record any money actually received on the Guest Bill first.</p><div class="ha-checkout-summary"><span>Outstanding <strong>'+money(f.totals.balance)+'</strong></span></div><input type="hidden" name="balance" value="'+esc(f.totals.balance)+'">'+field('due_date','Payment due date','','type="date" required')+field('reason','Reason for credit approval','','required minlength="10" maxlength="250"')+'<label class="bh-check"><input type="checkbox" name="approved" required> I authorize this unpaid amount and understand no payment is being recorded.</label>'+note()+'<div class="bh-actions">'+button('close','Cancel')+'<button type="submit" class="btn">Authorize credit &amp; checkout</button></div></form>');
 }
 function verifiedCreditAccounts(data){
  if(!Array.isArray(data?.accounts))throw Error('Guest Khata could not be loaded.');
  const rows=data.accounts,seen=new Set();let due=0;
  for(const row of rows){
   const id=row?.folio_id,approved=checkoutAmountCents(row?.approved_balance),balance=checkoutAmountCents(row?.balance);
   if(typeof id!=='string'||!id.trim()||seen.has(id)||approved===null||approved<=0||balance===null||balance<0||balance>approved)throw Error('Guest Khata balances unavailable. Refresh before collecting.');
   seen.add(id);due+=balance;
   if(!Number.isSafeInteger(due))throw Error('Guest Khata total unavailable.');
  }
  return {rows,due};
 }
 async function creditList(){
  if(!manager())throw Error('Owner or manager access required.');
  const scope=key(),version=generation;
  const data=await H().command('hotel_credit_list',{});assertScope(scope,version);
  const {rows,due}=verifiedCreditAccounts(data);
  H().editor('<section class="bh-form" data-credit-list><h2>Guest Khata</h2><div class="ha-checkout-summary"><span>Total outstanding <strong>'+money(due/100)+'</strong></span></div><p>Original invoices remain unchanged. Only actual receipts reduce the live balance.</p>'+rows.map(r=>'<article class="bh-panel"><strong>'+esc(r.guest_name||'Guest')+' · Room '+esc(r.room||'—')+'</strong><p>'+esc(r.invoice_number||'Invoice')+' · Due '+esc(r.due_date)+'</p><p>Outstanding <strong>'+money(r.balance)+'</strong></p><div class="bh-actions">'+button('open-room','View bill',r.folio_id)+(Number(r.balance)>0?button('credit-collect','Collect due',r.folio_id,'data-balance="'+esc(r.balance)+'"'):'<span>Recovered</span>')+'</div></article>').join('')+(!rows.length?'<p>No approved hotel credit accounts.</p>':'')+note()+button('close','Close')+'</section>');
 }
 function depositReturnPayload(folio,reviewedHeld,values){
  const cap=checkoutAmountCents(reviewedHeld),held=checkoutAmountCents(folio?.totals?.deposit_held),amount=checkoutAmountCents(values?.amount);
  const reference=String(values?.reference||'').trim();
  if(folio?.status!=='open'||!checkoutTotalsReady([{folio}])||cap===null||held!==cap||cap<=0)throw Error('Deposit balance changed. Reopen checkout before recording a return.');
  if(amount===null||amount<=0||amount>cap||!['Cash','UPI','Card','Bank Transfer'].includes(values?.method)||reference.length>100||(values.method!=='Cash'&&!reference))throw Error('Enter the actual amount returned, valid method and online reference.');
  return {folio_id:folio.id,amount:amount/100,method:values.method,reference:values.method==='Cash'?'':reference,description:'Security deposit returned at checkout'};
 }
 function creditReceiptEditor(id,balance){
  const cents=checkoutAmountCents(balance);if(!manager()||cents===null||cents<=0)throw Error('Verified outstanding balance required.');
  H().editor('<form class="bh-form" data-bill-form="credit-receipt" data-id="'+esc(id)+'"><h2>Collect guest due</h2><p>Record only money actually received. Outstanding '+money(cents/100)+'.</p>'+field('amount','Amount received (₹)',cents/100,'type="number" min="0.01" max="'+cents/100+'" step="0.01" required inputmode="decimal"')+methods+field('reference','Bank / UPI reference','','maxlength="100"')+field('account_note','Account note','','maxlength="80"')+'<label class="bh-check"><input type="checkbox" name="received" required> I have actually received this money and verified the bank receipt if online.</label>'+note()+'<div class="bh-actions">'+button('credit-list','Back to Khata')+'<button type="submit" class="btn">Record receipt</button></div></form>');
  const form=document.querySelector('[data-bill-form=credit-receipt]'),update=()=>{const online=form.elements.method.value!=='Cash';form.elements.reference.required=online;form.elements.reference.closest('label').hidden=!online;form.elements.account_note.closest('label').hidden=!online};
  form.elements.method.addEventListener('change',()=>{form.elements.received.checked=false;update()});
  for(const name of ['amount','reference','account_note'])form.elements[name].addEventListener('input',()=>{form.elements.received.checked=false});
  update();
 }
 function issuedInvoice(id){const f=getFolio(id);if(f?.status!=='settled'||!f.invoice_snapshot?.number||String(f.invoice_snapshot.number).startsWith('DRAFT'))throw Error('Final issued invoice unavailable. Refresh the bill.');return H().statement(id)}
 function shareNumber(raw){const text=String(raw||'').trim();if(!/^\+?[\d\s()-]+$/.test(text))throw Error('Enter a valid WhatsApp number.');const digits=text.replace(/\D/g,'');if(!text.startsWith('+')&&/^[6-9]\d{9}$/.test(digits))return '91'+digits;if(!/^[1-9]\d{9,14}$/.test(digits))throw Error('Enter country code and valid WhatsApp number.');return digits}
 function invoiceShareForm(id){
  const s=issuedInvoice(id),f=getFolio(id),stay=(db().stays||[]).find(r=>r.id===f.stay_id),g=(db().guests||[]).find(r=>r.id===stay?.guest_id),outlets=p()?.outlets||[],outlet=outlets.length===1&&typeof outlets[0]==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outlets[0])?outlets[0]:null;
  const menu=outlet?new URL('menu-qr.html?restaurant='+encodeURIComponent(outlet),root.location.href).href:'';
  H().editor('<form class="bh-form" data-bill-form="invoice-share" data-id="'+esc(id)+'"><h2>WhatsApp issued bill</h2><p>Review the authorized guest number and share only with that guest.</p>'+field('phone','WhatsApp number',g?.phone||'','type="tel" required')+'<label class="bh-field"><span>Message · includes menu link when available</span><textarea name="message" readonly>'+esc(s.property?.name+'\nInvoice '+s.number+'\nBill total '+money(s.totals.charges)+'\nReceived at issue '+money(s.totals.paid)+'\nDue at issue '+money(s.totals.balance)+(menu?'\nMenu: '+menu:''))+'</textarea></label><label class="bh-check"><input name="reviewed" type="checkbox" required> I reviewed the guest number and have permission to share this bill.</label><p>Choose the reviewed contact in the device share sheet. If file sharing is unavailable, download and attach the invoice manually in WhatsApp.</p>'+note()+'<div class="bh-actions">'+button('invoice-download','Download PDF',id)+button('invoice-whatsapp','Open WhatsApp message',id)+'<button class="btn" type="submit">Share PDF + message</button></div></form>');
  const form=document.querySelector('[data-bill-form=invoice-share]');form.elements.phone.addEventListener('input',()=>{form.elements.reviewed.checked=false});
 }
 function decorateFolio(target,folio,stay){
  if(!stay)return;const entries=(db().entries||[]).filter(e=>e.folio_id===folio.id&&e.status==='confirmed'),gst=entries.reduce((n,e)=>n+(['charge'].includes(e.kind)?1:['reversal','discount'].includes(e.kind)?-1:0)*Number(e.tax_amount||0),0),profile=folio.bill_tax_profile||p().tax_profile||{},registered=!!profile.gstin;
  const groups=A().billTaxGroups(entries.filter(e=>['charge','reversal','discount'].includes(e.kind))),cgst=groups.reduce((n,g)=>n+g.cgst,0),sgst=groups.reduce((n,g)=>n+g.sgst,0);
  const card=document.createElement('section');card.className='bh-bill-tax-card';card.innerHTML='<div><strong>'+(registered?'GST invoice':'Guest bill · No GST')+'</strong><p>'+(registered?'CGST '+money(cgst)+' + SGST '+money(sgst):'GST is off for this hotel.')+'</p></div>'+(folio.status==='open'&&p().can_configure?button('tax-settings','Billing & GST',folio.id):'');
  target.querySelector('.bh-guest-bill-summary')?.after(card);const guest=(db().guests||[]).find(g=>g.id===stay.guest_id);if(guest){const contact=document.createElement('p');contact.className='bh-room-guest-contact';contact.textContent=[guest.phone,guest.address].filter(Boolean).join(' · ');target.querySelector('.bh-stay-dates')?.after(contact)}
  if(folio.status==='open'&&['owner','manager','receptionist'].includes(p().role))target.querySelector('.bh-guest-bill-buttons')?.insertAdjacentHTML('beforeend','<button type="button" class="btn secondary" data-hotel-action="add-guest-room" data-id="'+esc(stay.id)+'">＋ Another room for this guest</button>');
  const rows=rowsFor(stay);if(rows.length>1){const box=document.createElement('section');box.className='bh-panel bh-linked-booking';box.innerHTML='<h2>'+(stay.group_id?'One booking':'This guest')+' · '+rows.length+' rooms</h2>'+rows.map(r=>'<div class="bh-room-line"><span>Room '+esc(r.room?.number)+' · '+esc(r.stay.status==='in_house'?'Staying':r.stay.status==='checked_out'?'Checked out':'Reserved')+' · '+esc(linkedBalanceLabel(r.folio))+'</span>'+button('open-room','Open',r.folio.id)+(stay.group_id&&r.stay.status==='in_house'&&r.folio.status==='open'&&H().has('charge_to_room')?button('food-room','＋ Food',r.folio.id):'')+'</div>').join('')+'<div class="bh-actions">'+button('booking-bill','Combined bill',stay.id)+(stay.group_id&&rows.filter(r=>r.stay.status==='in_house'&&r.folio.status==='open').length>1?button('booking-select-checkout','Choose rooms to checkout',stay.id)+button('booking-checkout','Checkout all rooms',stay.id):'')+'</div>';target.querySelector('.bh-guest-bill-top')?.after(box)}
  const family=familyBillMarkup(familyBillSummary(stay,db()));if(family)target.querySelector('.bh-guest-bill-summary')?.insertAdjacentHTML('afterend',family);
  if(manager())target.querySelector('.bh-guest-bill-buttons')?.insertAdjacentHTML('beforeend',creditNav()+(creditEligible(folio,stay)?button('credit-checkout','Checkout on credit',folio.id):''));
  if(stay.status==='checked_out'&&folio.invoice_snapshot?.number)target.querySelector('.bh-guest-bill-buttons')?.insertAdjacentHTML('beforeend',button('invoice-download','Download PDF',folio.id)+button('invoice-share','WhatsApp PDF + menu',folio.id));
  if(stay.status==='checked_out'){const done=document.createElement('p');done.className='bh-note';done.innerHTML='Checkout complete. '+(!H().housekeepingVisible()?'Room is available again. ':'')+'<button type="button" class="ha-text-button" data-bill-action="rooms">Back to rooms</button>';target.querySelector('.bh-guest-bill-top')?.after(done)}
 }
 function splitTender(total,cash,upi){
  const t=checkoutAmountCents(total),c=checkoutAmountCents(cash),u=checkoutAmountCents(upi);
  if(t===null||c===null||u===null||c<=0||u<=0||c+u!==t)throw Error('Cash and UPI must equal the amount due, with both amounts positive.');
  return{cash_amount:c/100,upi_amount:u/100};
 }
 function paymentFields(){return (manager()?methods.replace('</select>','<option value="Split">Cash + UPI</option></select>'):methods)+(manager()?'<section data-split-tender hidden>'+field('cash_amount','Cash received','','type="number" min="0.01" step="0.01" inputmode="decimal"')+field('upi_amount','UPI received','','type="number" min="0.01" step="0.01" inputmode="decimal"')+'<p role="status" data-split-status></p></section>':'')+field('account_note','Online account · Short note',p().tax_profile?.primary_account||'','maxlength="80"')+field('reference','Online transaction reference','','maxlength="100"')+'<label class="bh-check" data-online-verify><input type="checkbox" name="verified"> I verified this online receipt in the selected account.</label>'}
 function wireMoney(form){
  const section=form.querySelector('[data-split-tender]');
  const submit=form.querySelector('[type=submit]'),blocked=submit.disabled;
  const update=()=>{
   const online=form.elements.method.value!=='Cash',split=form.elements.method.value==='Split';
   for(const name of ['account_note','reference','verified']){const el=form.elements[name];el.closest('label').hidden=!online;if(name==='reference')el.required=online;if(!online&&name==='verified')el.checked=false}
   if(section){section.hidden=!split;for(const name of ['cash_amount','upi_amount']){form.elements[name].disabled=!split;form.elements[name].required=split}
    let valid=true;
    if(split){const status=section.querySelector('[data-split-status]');try{splitTender(form.elements.amount.value,form.elements.cash_amount.value,form.elements.upi_amount.value);status.textContent='Total matches '+money(form.elements.amount.value)+'. Verify the actual UPI receipt.'}catch(e){valid=false;status.textContent=e.message}}
    submit.disabled=blocked||(split&&(!valid||!form.elements.verified.checked||!form.elements.reference.value.trim()));
   }
  };
  form.elements.method.addEventListener('change',()=>{form.elements.verified.checked=false;update()});
  form.addEventListener('input',update);form.elements.verified.addEventListener('change',update);update();
 }
 async function checkout(id,group=false,selection=null){
  const scope=key(),version=generation;
  let f=getFolio(id),s=(db().stays||[]).find(s=>s.id===f?.stay_id);if(!f||!s)return;
  let rows=group?(selection?selectedCheckoutRows(s,db(),selection):availableCheckoutRooms(s,db())):[{folio:f,stay:s,room:(db().rooms||[]).find(r=>r.id===s.room_id)}];
  for(const r of rows){await ensureTax(r.folio.id);assertScope(scope,version)}
  await H().reload();assertScope(scope,version);f=getFolio(id);if(!f)throw Error('This guest bill changed. Reopen the stay before checkout.');s=(db().stays||[]).find(s=>s.id===f.stay_id);if(!s)throw Error('This stay is no longer available. Reopen the Hotel Register.');rows=group?(selection?selectedCheckoutRows(s,db(),selection):availableCheckoutRooms(s,db())):[{folio:f,stay:s,room:(db().rooms||[]).find(r=>r.id===s.room_id)}];
  if(!checkoutTotalsReady(rows)){H().editor('<section class="bh-form"><h2>Checkout needs bill review</h2><p class="bh-note">One or more room bill totals are unavailable. Reopen the Guest Bill and review each linked room before checkout. No payment or checkout was recorded.</p><div class="bh-actions">'+button('close','Close')+'</div></section>');return;}
  const ids=rows.map(r=>r.folio.id),entries=(db().entries||[]).filter(e=>ids.includes(e.folio_id)),pending=entries.filter(e=>e.status==='pending'),sum=k=>rows.reduce((n,r)=>n+checkoutAmountCents(r.folio.totals[k]),0)/100,balance=sum('balance'),held=sum('deposit_held'),pendingTotal=sum('pending'),credit=rows.some(r=>Number(r.folio.totals?.balance)<0),blocked=pending.length||pendingTotal>0||held||credit;
  const selectionAttr=selection?' data-selection="'+esc(JSON.stringify(selection))+'"':'';
  H().editor('<form class="bh-form" data-bill-form="checkout" data-id="'+esc(id)+'" data-group="'+(group?'true':'false')+'"'+selectionAttr+'><h2>'+(group?'Checkout '+rows.length+' rooms':'Checkout')+'</h2><div class="ha-checkout-summary"><span>Total room + food bill <strong>'+money(sum('charges'))+'</strong></span><span>Received & verified <strong>'+money(sum('paid'))+'</strong></span><span>'+ (balance<0?'Credit / refund due':'To collect')+' <strong>'+money(Math.abs(balance))+'</strong></span></div>'+
   '<section class="bh-panel"><h3>Rooms included</h3>'+rows.map(r=>'<p>Room '+esc(r.room?.number||'—')+' · '+esc(linkedBalanceLabel(r.folio))+'</p>').join('')+(selection?'<p>Other rooms remain active.</p>':'')+'</section>'+
   '<p class="bh-note">'+(mode()==='gst'?'GST is included in this total.':'Guest bill without GST.')+(p().can_configure?' '+button('tax-settings','Change billing / GST',id):'')+'</p>'+
   (pendingTotal>0&&!pending.length?'<p class="bh-note">Pending receipt totals still need verification. Refresh the guest bill and review its receipts before checkout.</p>':'')+
   pending.map(e=>'<section class="bh-checkout-blocker"><strong>'+money(e.amount)+' '+esc(e.method)+' · Not yet verified</strong><p>Choose what actually happened to this receipt.</p>'+(manager()?'<div class="bh-actions">'+button('receipt-yes','Received',e.id,'data-return="'+esc(id)+'" data-group="'+group+'"'+selectionAttr)+button('receipt-no','Not received',e.id,'data-return="'+esc(id)+'" data-group="'+group+'"'+selectionAttr)+'</div>':'<p>Ask the owner or manager to verify it.</p>')+'</section>').join('')+
   rows.filter(r=>Number(r.folio.totals?.deposit_held)>0).map(r=>'<section class="bh-checkout-blocker"><strong>Room '+esc(r.room?.number)+' · Deposit held '+money(r.folio.totals.deposit_held)+'</strong><div class="bh-actions">'+(Number(r.folio.totals.balance)>0?button('deposit-apply','Use deposit for bill',r.folio.id,'data-return="'+esc(id)+'" data-group="'+group+'"'+selectionAttr):'')+button('deposit-return','Record deposit returned',r.folio.id,'data-return="'+esc(id)+'" data-group="'+group+'"'+selectionAttr)+'</div></section>').join('')+
   (credit?'<p class="bh-note">A room has an overpayment. Record its actual refund under Bill adjustments before closing this booking.</p>':'')+
   '<input type="hidden" name="amount" value="'+balance+'"><input type="hidden" name="folio_ids" value="'+esc(JSON.stringify(ids.sort()))+'">'+(balance>0?paymentFields():'')+(balance>0?'<p class="bh-note">Never record an unpaid amount as received or discount. '+(!group&&!blocked&&creditEligible(f,s)?'Owner or manager may authorize this room’s remaining balance as credit. '+button('credit-checkout','Checkout on credit',id):'For credit, open an individual room bill.')+'</p>':'')+note()+'<div class="bh-actions">'+button('checkout-preview','Preview selected invoice',id)+button('close','Cancel')+'<button type="submit" class="btn" '+(blocked?'disabled':'')+'>Confirm checkout & bill</button></div></form>');
  const form=document.querySelector('[data-bill-form=checkout]');if(form.elements.method)wireMoney(form);
 }
 function taxEditor(id){const tax=p().tax_profile||{};H().editor('<form class="bh-form" data-bill-form="tax" data-id="'+esc(id)+'"><h2>Hotel bill & GST</h2><label class="bh-field"><span>Billing type</span><select name="mode"><option value="plain" '+(!tax.gstin?'selected':'')+'>Guest bill · Hotel has no GST registration</option><option value="gst" '+(tax.gstin?'selected':'')+'>GST invoice · Registered hotel</option></select></label><div data-gst-fields>'+field('gstin','Hotel GSTIN',tax.gstin||'','maxlength="15" autocomplete="off"')+'<p class="bh-note">Room GST is 5% up to ₹7,500 per room / day and 18% above it. Each bill shows equal CGST and SGST components.</p><label class="bh-field"><span>Food GST · Total</span><select name="food_rate"><option value="5" '+(Number(tax.food_rate)!==18?'selected':'')+'>5% · 2.5% CGST + 2.5% SGST</option><option value="18" '+(Number(tax.food_rate)===18?'selected':'')+'>18% · 9% CGST + 9% SGST</option></select></label><label class="bh-field"><span>Extra charges GST · Total</span><select name="incidental_rate">'+[0,5,18].map(rate=>'<option value="'+rate+'" '+(rate===(tax.gstin?Number(tax.incidental_rate||0):5)?'selected':'')+'>'+rate+'%</option>').join('')+'</select></label></div><label class="bh-check"><input type="checkbox" name="reviewed" required> I confirm this hotel’s GST registration and applicable food rate.</label>'+note()+'<div class="bh-actions">'+button('close','Cancel')+'<button class="btn" type="submit">Save & update this bill</button></div></form>');const form=document.querySelector('[data-bill-form=tax]'),update=()=>{const on=form.elements.mode.value==='gst';form.querySelector('[data-gst-fields]').hidden=!on;form.elements.gstin.required=on};form.elements.mode.addEventListener('change',update);update()}
 async function preview(id){const win=root.open('','_blank');if(!win)throw Error('Allow pop-ups to view the bill.');win.opener=null;const scope=key(),version=generation;try{await ensureTax(id);await H().reload();assertScope(scope,version);win.document.write(A().billHTML(H().statement(id)));win.document.close();H().redraw()}catch(e){win.close();throw e}}
 async function previewCheckout(form){
  if(!form||form.dataset.billForm!=='checkout')throw Error('Reopen checkout before preview.');
  const ids=selectedIds(form.elements.folio_ids.value),id=form.dataset.id,group=form.dataset.group==='true',scope=key(),version=generation;
  const win=root.open('','_blank');if(!win)throw Error('Allow pop-ups to preview the selected invoice.');win.opener=null;
  try{
   const fresh=await H().reload(false);assertScope(scope,version);
   if(!fresh||!form.isConnected)throw Error('Checkout changed. Open the current bill.');
   const f=getFolio(id),stay=(db().stays||[]).find(s=>s.id===f?.stay_id);
   const rows=group?selectedCheckoutRows(stay,db(),ids):f&&stay&&f.status==='open'&&stay.status==='in_house'&&ids.length===1&&ids[0]===f.id?[{folio:f,stay}]:[];
   if(!checkoutTotalsReady(rows)||!ids.includes(id)||rows.some(r=>needsTax(r.folio)))throw Error('Review current room bills and GST before preview.');
   const snapshots=rows.map(r=>H().statement(r.folio.id));
   if(snapshots.some(s=>s.number!=='DRAFT — not issued'))throw Error('A bill has already been issued; reopen the booking.');
   win.document.write(group?A().combinedBillHTML(snapshots):A().billHTML(snapshots[0]));win.document.close();
  }catch(e){win.close();throw e}
 }
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
   if(a==='invoice-download'){A().downloadInvoice(issuedInvoice(id));return}
   if(a==='invoice-share'){invoiceShareForm(id);return}
   if(a==='invoice-whatsapp'){const form=b.closest('form');if(!form?.elements.reviewed.checked)throw Error('Review and confirm the guest number first.');const number=shareNumber(form.elements.phone.value);const url='https://wa.me/'+number+'?text='+encodeURIComponent(form.elements.message.value+'\nPlease find the separately attached bill PDF.');const win=root.open(url,'_blank','noopener');const msg=form.querySelector('.bh-message');msg.textContent='WhatsApp message requested. Attach the downloaded PDF manually; delivery is not verified.';return}
   if(a==='credit-list'){active++;await creditList();return}
   if(a==='credit-checkout'){creditEditor(id);return}
   if(a==='credit-collect'){creditReceiptEditor(id,b.dataset.balance);return}
   if(a==='checkout-preview'){active++;await previewCheckout(b.closest('form'));return}
   if(a==='booking-bill'){active++;await combined(id);return}
   if(a==='booking-select-checkout'){showRoomSelection(id);return}
   if(a==='booking-checkout'){active++;const row=rowsFor((db().stays||[]).find(s=>s.id===id)).find(r=>r.stay.status==='in_house'&&r.folio.status==='open');if(row)await checkout(row.folio.id,true);return}
   const entry=(db().entries||[]).find(x=>x.id===id);
   if(a==='receipt-yes'&&entry){H().editor('<form class="bh-form" data-bill-form="receipt" data-id="'+esc(id)+'" data-return="'+esc(b.dataset.return)+'" data-group="'+esc(b.dataset.group)+'" data-selection="'+esc(b.dataset.selection||'')+'"><h2>Verify '+money(entry.amount)+' '+esc(entry.method)+'</h2>'+field('reference','Bank / UPI reference',entry.reference||'','required maxlength="100"')+field('account_note','Received in account',entry.account_note||p().tax_profile?.primary_account||'','maxlength="80"')+'<label class="bh-check"><input type="checkbox" name="received" required> I checked that this amount was actually received.</label>'+note()+'<button class="btn" type="submit">Confirm receipt</button></form>');return}
   if(a==='receipt-no'&&entry){active++;b.disabled=true;await H().command('payment_void',{id,folio_id:entry.folio_id,description:'Pending receipt was not received'});assertScope(scope,version);await H().reload();await checkout(b.dataset.return,b.dataset.group==='true',selectedIds(b.dataset.selection));return}
   if(a==='deposit-apply'){active++;b.disabled=true;const f=getFolio(id);await H().command('deposit_apply',{folio_id:id,amount:Math.min(Number(f.totals.deposit_held),Number(f.totals.balance)),description:'Deposit applied to guest bill'});assertScope(scope,version);await H().reload();await checkout(b.dataset.return,b.dataset.group==='true',selectedIds(b.dataset.selection));return}
   if(a==='deposit-return'){const f=getFolio(id);if(f?.status!=='open'||!checkoutTotalsReady([{folio:f}])||checkoutAmountCents(f.totals.deposit_held)<=0)throw Error('Verified held deposit required.');H().editor('<form class="bh-form" data-bill-form="deposit" data-id="'+esc(id)+'" data-return="'+esc(b.dataset.return)+'" data-group="'+esc(b.dataset.group)+'" data-selection="'+esc(b.dataset.selection||'')+'"><h2>Record deposit returned</h2>'+field('amount','Amount already returned',f.totals.deposit_held,'type="number" min="0.01" max="'+f.totals.deposit_held+'" step="0.01" required')+methods+field('reference','Reference · For online return','','maxlength="100"')+'<label class="bh-check"><input type="checkbox" name="returned" required> I have returned this money to the guest.</label>'+note()+'<button class="btn" type="submit">Record returned deposit</button></form>');
    const form=document.querySelector('[data-bill-form=deposit]');if(!form)throw Error('Deposit form unavailable.');
    const reset=()=>{form.elements.returned.checked=false;form.elements.reference.required=form.elements.method.value!=='Cash';};
    for(const name of ['amount','reference','method']){form.elements[name].addEventListener('input',reset);form.elements[name].addEventListener('change',reset);}reset();return}
  }catch(err){const msg=document.querySelector('.page.active .bh-message');if(msg)msg.textContent=err.message;else root.alert(err.message)}finally{active=Math.max(0,active-1);if(b.isConnected)b.disabled=false}
 }
 async function submit(e){
  const form=e.target.closest('[data-bill-form]');if(!form)return;e.preventDefault();e.stopImmediatePropagation();if(active)return;const values=Object.fromEntries(new FormData(form)),type=form.dataset.billForm,id=form.dataset.id,msg=form.querySelector('.bh-message'),b=form.querySelector('[type=submit]'),scope=key(),version=generation;active++;b.disabled=true;
  try{
   if(type==='invoice-share'){
    if(!form.elements.reviewed.checked)throw Error('Review and confirm guest number.');shareNumber(values.phone);const file=A().invoicePDF(issuedInvoice(id)),data={files:[file],title:'Guest invoice',text:values.message};
    if(!navigator.share||!navigator.canShare?.({files:[file]})){msg.textContent='File sharing is unavailable. Download PDF and use Open WhatsApp message to attach it manually.';return}
    try{await navigator.share(data);assertScope(scope,version);if(form.isConnected)msg.textContent='Share sheet completed. Guest delivery is not verified.'}catch(err){if(form.isConnected)msg.textContent=err.name==='AbortError'?'Share cancelled. Retry or download the PDF.':'Share failed. Download PDF and attach manually.'}return;
   }
   if(type==='credit-checkout'){
    if(!manager()||!form.elements.approved.checked||checkoutAmountCents(values.balance)<=0||!values.due_date||values.reason.trim().length<10)throw Error('Confirm outstanding balance, due date and approval reason.');
    await H().command('hotel_credit_checkout',{folio_id:id,balance:Number(values.balance),due_date:values.due_date,reason:values.reason.trim()});assertScope(scope,version);await H().reload();assertScope(scope,version);H().redraw();return;
   }
   if(type==='credit-receipt'){
    const cents=checkoutAmountCents(values.amount),cap=checkoutAmountCents(form.elements.amount.max),online=values.method!=='Cash';
    if(!manager()||!form.elements.received.checked||cents===null||cap===null||cents<=0||cents>cap||(online&&!values.reference.trim()))throw Error('Enter the actual verified receipt within the outstanding balance.');
    if(!['Cash','UPI','Card','Bank Transfer'].includes(values.method))throw Error('Choose a valid payment method.');
    const fresh=verifiedCreditAccounts(await H().command('hotel_credit_list',{}));assertScope(scope,version);
    const current=fresh.rows.find(row=>row.folio_id===id);
    if(!form.isConnected||!form.elements.received.checked||!current||checkoutAmountCents(current.balance)!==cap)throw Error('Outstanding balance or receipt review changed. Reopen Guest Khata before collecting.');
    await H().command('hotel_credit_receipt',{folio_id:id,amount:cents/100,method:values.method,reference:online?values.reference.trim():'',account_note:online?values.account_note.trim():'',verified:online});assertScope(scope,version);await H().reload();assertScope(scope,version);H().redraw();await creditList();return;
   }
   if(type==='select-rooms'){
    const ids=new FormData(form).getAll('selection').map(String).sort();
    if(!ids.length)throw Error('Choose at least one room to review.');
    const fresh=await H().reload(false);assertScope(scope,version);if(!fresh||!form.isConnected)throw Error('Room list changed. Reopen family checkout.');
    const stay=(db().stays||[]).find(s=>s.id===id),rows=selectedCheckoutRows(stay,db(),ids);
    await checkout(rows[0].folio.id,rows.length>1,rows.length>1?ids:null);return;
   }
   if(type==='tax'){if(!form.elements.reviewed.checked)throw Error('Review the registration first.');const gst=values.mode==='gst',series=db().invoice_series||{};await H().command('billing_settings',{prefix:series.prefix||'H',next_number:Number(series.next_number||1),primary_account:p().tax_profile?.primary_account||'',tax_profile:{reviewed:true,gstin:gst?values.gstin.trim().toUpperCase():'',room_rate:gst?5:0,food_rate:gst?Number(values.food_rate):0,incidental_rate:gst?Number(values.incidental_rate):0}});assertScope(scope,version);await H().refreshContext();await H().command('folio_tax',{folio_id:id,mode:values.mode});await H().reload();H().redraw();return}
   if(type==='receipt'){if(!form.elements.received.checked)throw Error('Confirm the actual receipt.');const entry=(db().entries||[]).find(x=>x.id===id);await H().command('payment_confirm',{id,folio_id:entry.folio_id,reference:values.reference,account_note:values.account_note,description:'Receipt verified at checkout'});assertScope(scope,version);await H().reload();await checkout(form.dataset.return,form.dataset.group==='true',selectedIds(form.dataset.selection));return}
   if(type==='deposit'){
    if(!form.elements.returned.checked)throw Error('Record only money already returned.');
    const cap=form.elements.amount.max;
    depositReturnPayload(getFolio(id),cap,values);
    const fresh=await H().reload(false);assertScope(scope,version);
    if(!fresh||!form.isConnected||!form.elements.returned.checked||['amount','method','reference'].some(name=>form.elements[name].value!==values[name]))throw Error('Deposit return review changed. Reopen checkout.');
    const payload=depositReturnPayload(getFolio(id),cap,values);
    await H().command('deposit_return',payload);assertScope(scope,version);await H().reload();assertScope(scope,version);await checkout(form.dataset.return,form.dataset.group==='true',selectedIds(form.dataset.selection));return;
   }
   if(type==='checkout'){if(values.method&&values.method!=='Cash'&&!form.elements.verified.checked)throw Error('Verify the online receipt first.');const tender=values.method==='Split'?(manager()?splitTender(values.amount,values.cash_amount,values.upi_amount):(()=>{throw Error('Owner or manager verification required.')})()):{};const f=getFolio(id),stay=(db().stays||[]).find(s=>s.id===f.stay_id);await H().command(form.dataset.group==='true'?'booking_checkout_collect':'checkout_collect',{folio_id:id,...(form.dataset.group==='true'?{group_id:stay.group_id,folio_ids:JSON.parse(values.folio_ids),...(form.dataset.selection?{selected_only:true}:{})}:{}),amount:Number(values.amount),...tender,method:values.method||'Cash',reference:values.reference||'',account_note:values.account_note||'',verified:values.verified==='on'});assertScope(scope,version);await H().reload();H().redraw();return}
  }catch(err){if(form.isConnected)msg.textContent=err.message||String(err)}finally{active=Math.max(0,active-1);if(b.isConnected)b.disabled=false}
 }
 const api={init,clear,linkedBalanceLabel,familyBillSummary,familyBillMarkup,availableCheckoutRooms,selectedCheckoutRows,splitTender,checkoutTotalsReady,verifiedCreditAccounts,depositReturnPayload,creditNav,busy:()=>active>0,decorateRegister,decorateFolio,linkRoom,checkout:async(id,group=false)=>{if(active)return;active++;try{return await checkout(id,group)}finally{active--}},preview:async id=>{if(active)return;active++;try{return await preview(id)}finally{active--}}};root.BiteHotelBilling=api;
})(typeof window!=='undefined'?window:globalThis);
