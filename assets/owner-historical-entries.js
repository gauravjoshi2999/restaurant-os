/* Bite Owner: backdated guest / POS entry in the existing forms.
   Past entries are immutable register snapshots, NEVER live stays, POS orders,
   cash movements, refunds, inventory or payment-gateway transactions. */
(function(root){
 'use strict';
 let ctx=null,observer=null,scheduled=false;
 const historyRequests=new WeakMap(),historyLimit=200;
 function historyListSummary(rows){
  if(!Array.isArray(rows))throw Error('Saved records unavailable. Retry.');
  if(rows.length>historyLimit)return {complete:false,count:historyLimit,rows:rows.slice(0,historyLimit)};
  const ids=new Set();let cents=0;
  for(const r of rows){const validMoney=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))&&Number(v)>=0&&Number.isSafeInteger(Math.round(Number(v)*100))&&Math.abs(Number(v)*100-Math.round(Number(v)*100))<0.00001;
   if(!r?.id||ids.has(r.id)||!validMoney(r.amount)||!validMoney(r.received_amount)||Number(r.received_amount)>Number(r.amount))throw Error('Saved record amounts unavailable. Retry.');
   ids.add(r.id);cents+=Math.round(Number(r.amount)*100);if(!Number.isSafeInteger(cents))throw Error('Saved record total unavailable. Retry.');
  }
  return {complete:true,count:rows.length,total:cents/100,rows};
 }
 const today=()=>root.BiteOwner?.day?.()||new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
 const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const currency=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))&&!Number.isNaN(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 const plusDay=d=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10)};
 const scope=kind=>kind==='room'?root.BiteHospitality?.prop?.()?.id:ctx?.getAccess?.()?.restaurantId;
 const getField=(form,name)=>form.elements.namedItem(name);
 const currentDate=form=>getField(form,'history_date')?.value||today();
 const isHistorical=form=>!!form?.querySelector('[data-bhe-calendar]')&&validDate(currentDate(form))&&currentDate(form)<today();
 const line=(text)=>'<p class="bhe-muted">'+safe(text)+'</p>';
 function status(form,text,error=false){const el=form.querySelector('[data-bhe-status]');if(el){el.textContent=text;el.classList.toggle('bhe-error',!!error)}}
 function renderState(form,kind,sync=false){
  const date=currentDate(form),historical=validDate(date)&&date<today();
  form.noValidate=historical||form.dataset.bheOriginalNoValidate==='true';
  form.dataset.historicalEntry=String(historical);
  const box=form.querySelector('[data-bhe-calendar]'),extra=form.querySelector('[data-bhe-extra]');
  if(!box)return;
  box.classList.toggle('bhe-is-past',historical);
  if(extra)extra.hidden=!historical;
  const note=box.querySelector('[data-bhe-hint]');
  if(note)note.textContent=historical?'Old register mode · online record only, no live billing or occupancy changes.':'Aaj ki entry normal live flow se save hogi.';
  const submit=form.querySelector('button[type=submit]');
  if(submit&&form.dataset.bheOriginalSubmit)submit.textContent=historical?'Save old '+(kind==='room'?'room':'POS')+' record':form.dataset.bheOriginalSubmit;
  if(kind==='room'){
   if(sync&&historical){
    const arrival=getField(form,'arrival'),departure=getField(form,'departure');
    if(arrival)arrival.value=date;
    if(departure)departure.value=plusDay(date);
    form.dataset.reviewed='';
    form.querySelector('.bh-review')?.remove();
   }
   if(sync&&!historical&&getField(form,'arrival')?.value<today()&&!form.dataset.stayId){
    getField(form,'arrival').value=today();
    if(getField(form,'departure'))getField(form,'departure').value=plusDay(today());
   }
   const room=getField(form,'room_id');
   if(room)room.required=!historical;
   if(sync)form.dispatchEvent(new Event('input',{bubbles:true}));
  }
  box.querySelector('[data-bhe-day]')?.setAttribute('max',today());
  if(!historical){
   historyRequests.delete(form);
   const list=form.querySelector('[data-bhe-list]');
   if(list)list.textContent='';
   status(form,'');
  }else void loadRows(form,kind);
 }
 function decorate(form,kind){
  if(!ctx||!form||form.dataset.bheDecorated==='true'||kind==='room'&&form.dataset.stayId)return;
  form.dataset.bheOriginalNoValidate=String(form.noValidate);
  form.dataset.bheDecorated='true';
  const submit=form.querySelector('button[type=submit]');
  form.dataset.bheOriginalSubmit=submit?.textContent||'Save';
  const holder=document.createElement('section');
  holder.className='bhe-calendar';
  holder.dataset.bheCalendar='true';
  holder.innerHTML='<div class="bhe-calendar-top"><label><strong>📅 Entry date</strong><input data-bhe-day name="history_date" type="date" max="'+today()+'" value="'+today()+'" aria-label="Select old entry date"></label><button type="button" data-bhe-today>Today</button></div>'+
   '<p class="bhe-hint" data-bhe-hint>Aaj ki entry normal live flow se save hogi.</p>'+
   '<div class="bhe-extra" data-bhe-extra hidden>'+(kind==='room'?
     '<p class="bhe-muted"><strong>Old register mode:</strong> guest details aur old room bill save honge. Live room change, payment collection, aur photo ID upload nahi hoga. ID photos yahan select karne par bhi save nahi hongi.</p><div class="bhe-fields"><label>Old register room number<input name="history_room_number" maxlength="60" placeholder="e.g. 101"></label><label>Old room bill (₹)<input name="history_room_amount" type="number" min="0" step=".01" value="0"></label><label>Amount already received (₹)<input name="history_room_received" type="number" min="0" step=".01" value="0"></label><label>Payment method<select name="history_room_method"><option value="">Not recorded</option><option>Cash</option><option>UPI</option><option>Card</option><option>Bank Transfer</option><option>Other</option></select></label></div>':
     '<p class="bhe-muted"><strong>Old bill date is the Entry date selected above.</strong> Items aur received amount isi POS form mein bharein. Sirf Payment date badalne se bill ki date nahi badalti. Old bill register mein save hoga; naya payment request nahi jayega.</p>')+
   '<div class="bhe-actions"><strong>Saved old records</strong><button type="button" data-bhe-month aria-pressed="false">View whole month</button></div>'+
   '<div data-bhe-list aria-live="polite"></div></div>'+
   '<p class="bhe-status" data-bhe-status role="status" aria-live="polite"></p>';
  form.prepend(holder);
  const date=holder.querySelector('[data-bhe-day]');
  date.addEventListener('change',()=>{holder.querySelector('[data-bhe-month]').setAttribute('aria-pressed','false');renderState(form,kind,true)});
  holder.querySelector('[data-bhe-today]').addEventListener('click',()=>{date.value=today();renderState(form,kind,true)});
  holder.querySelector('[data-bhe-month]').addEventListener('click',e=>{const isOn=e.currentTarget.getAttribute('aria-pressed')==='true';e.currentTarget.setAttribute('aria-pressed',String(!isOn));void loadRows(form,kind)});
  form.addEventListener('reset',()=>{delete form.dataset.bheSavedSignature;const resetValue=date.defaultValue;setTimeout(()=>{if(!form.isConnected)return;if(!date.value||date.value===resetValue)date.value=today();renderState(form,kind,false)},0)});
  renderState(form,kind);
 }
 function scan(){
  const guest=document.querySelector('#bhCheckinForm');
  if(guest)decorate(guest,'room');
  const pos=document.querySelector('#orderForm');
  if(pos)decorate(pos,'pos');
 }
 function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;scan()})}
 async function loadRows(form,kind){
  const token={};historyRequests.set(form,token);
  if(!isHistorical(form)||!ctx?.sb||!scope(kind)||!ctx.getUser?.()?.id)return;
  const list=form.querySelector('[data-bhe-list]'),date=currentDate(form),id=scope(kind);
  if(!list)return;
  const monthSelected=()=>form.querySelector('[data-bhe-month]')?.getAttribute('aria-pressed')==='true';
  const month=monthSelected(),session=ctx,user=ctx.getUser().id;
  const current=()=>historyRequests.get(form)===token&&ctx===session&&ctx.getUser?.()?.id===user&&form.isConnected&&currentDate(form)===date&&scope(kind)===id&&isHistorical(form)&&monthSelected()===month;
  const first=date.slice(0,7)+'-01',last=plusDay(new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0,12)).toISOString().slice(0,10));
  const key=kind==='room'?'property_id':'restaurant_id';
  list.textContent='Reading saved records…';
  const q=ctx.sb.from('bite_owner_historical_entries')
   .select('id,record_date,customer_name,room_number,amount,received_amount,guest_count,visit_type,recorded_at')
   .eq('entry_kind',kind).eq(key,id).gte('record_date',month?first:date).lt('record_date',month?last:plusDay(date))
   .order('record_date',{ascending:false}).order('recorded_at',{ascending:false}).order('id',{ascending:false}).limit(historyLimit+1);
  try{
   const {data,error}=await q;
   if(!current())return;
   if(error)throw error;
   const summary=historyListSummary(data);
   if(!summary.complete){list.innerHTML=line('More than '+historyLimit+' records for this period. Use a shorter period or the full POS / Guest Register report. No partial total shown.');return;}
   const rows=summary.rows,total=summary.total;
   list.innerHTML='<p class="bhe-totals">'+(month?'Month':'Date')+': '+rows.length+' record(s) · '+currency(total)+' billed</p>'+
    (rows.length?rows.map(x=>'<div class="bhe-record"><span><strong>'+safe(x.customer_name)+'</strong><small>'+safe(x.record_date)+' · '+safe(kind==='room'?'Room '+x.room_number:x.visit_type==='takeaway'?'Takeaway':(x.guest_count||'?')+' dine-in guests')+'</small></span><span><strong>'+currency(x.amount)+'</strong><small>Received '+currency(x.received_amount)+'</small></span></div>').join(''):
      line('Is date ka koi purana record abhi save nahi hai.'));
  }catch(error){if(current())list.innerHTML=line('Purane records load nahi hue: '+(error.message||'Network error'));}
 }
 function number(value,label){
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>100000000)throw new Error(label+' sahi rakhein.');
  return Math.round(n*100)/100;
 }
 async function save(form,kind){
  const id=scope(kind),date=currentDate(form),user=ctx?.getUser?.()?.id;
  if(!ctx?.sb||!id||!user)throw new Error('Owner login ya property selection missing.');
  if(!validDate(date)||date>=today())throw new Error('Purani date chunein. Aaj ki entry normal mode mein banegi.');
  const name=String(getField(form,kind==='room'?'full_name':'customer_name')?.value||'').trim()|| (kind==='pos'?'Walk-in guest':'');
  const phone=String(getField(form,kind==='room'?'phone':'customer_phone')?.value||'').trim();
  if(!name||name.length>120||phone.length>24)throw new Error('Guest name / phone check karein.');
  const values={request_id:null,entry_kind:kind,property_id:kind==='room'?id:null,restaurant_id:kind==='pos'?id:null,
   record_date:date,customer_name:name,customer_phone:phone,created_by:user};
  if(kind==='room'){
   const departure=getField(form,'departure')?.value;
   if(!validDate(departure)||departure<=date)throw new Error('Checkout date arrival ke baad rakhein.');
   const rId=getField(form,'room_id')?.value;
   const room=root.BiteHospitality?.getWorkspace?.()?.rooms?.find(r=>r.id===rId);
   const roomNumber=String(getField(form,'history_room_number')?.value||room?.number||'').trim();
   if(!roomNumber)throw new Error('Old register ka room number likhein.');
   const amount=number(getField(form,'history_room_amount')?.value,'Room bill'),
    received=number(getField(form,'history_room_received')?.value,'Received amount');
   if(received>amount)throw new Error('Received amount bill se zyada nahi ho sakta.');
   values.departure_date=departure;values.room_number=roomNumber;values.amount=amount;values.received_amount=received;
   values.guest_count=Number(getField(form,'adults')?.value||1)+Number(getField(form,'children')?.value||0);
   if(values.guest_count<1||values.guest_count>200)throw new Error('Guest count check karein.');
   values.payment_method=received?getField(form,'history_room_method')?.value||null:null;
   values.guest_details=Object.fromEntries(['country','address','email','id_type','id_last4','arrived_from','next_destination','transport','vehicle_number','booking_reference','booking_source','compliance_note','male','female','children','arrival_time'].map(key=>[key,String(getField(form,key)?.value||'').slice(0,500)]));
   values.notes=String(getField(form,'compliance_note')?.value||'').slice(0,500);
   // Identity files from the live form are never silently copied into historical storage.
   values.items=[];
  }else{
   if(root.BiteHospitality?.roomPOSSelected?.())throw new Error('Old POS bill ko live room khata mein transfer nahi kar sakte. Room charge ko hata kar save karein.');
   if(getField(form,'channel')?.value&&!String(getField(form,'channel').value).startsWith('POS - '))throw new Error('Old date is only for restaurant POS billing.');
   if(root.document.getElementById('posReplaceOrderId')?.value)throw new Error('An existing live bill cannot be replaced as a historical record.');
   const rows=[...form.querySelectorAll('#orderItemRows .order-item-row')];
   const items=rows.map(row=>({name:String(row.querySelector('.item-name')?.value||'').trim(),
    quantity:Number(row.querySelector('.item-quantity')?.value),unit_price:Number(row.querySelector('.item-price')?.value)}));
   if(!items.length||items.length>150||items.some(x=>!x.name||x.name.length>120||!Number.isFinite(x.quantity)||x.quantity<=0||!Number.isFinite(x.unit_price)||x.unit_price<0))throw new Error('Old POS bill ke items aur rates check karein.');
   const amount=number(items.reduce((n,x)=>n+Math.round(x.quantity*x.unit_price*100)/100,0),'Bill total'),
     paid=number(getField(form,'paid_amount')?.value||0,'Received amount');
   if(paid>amount)throw new Error('Received amount bill total se zyada nahi ho sakta.');
   const visit=root.BitePOSVisits?.selected?.()||{visitType:'dine_in',guestCount:1};
   if(!['dine_in','takeaway'].includes(visit.visitType))throw new Error('Dine-in ya takeaway select karein.');
   values.visit_type=visit.visitType;values.guest_count=visit.visitType==='dine_in'?Number(visit.guestCount)||1:null;
   values.amount=amount;values.received_amount=paid;
   values.payment_method=paid?getField(form,'payment_method')?.value||'Cash':null;
   values.items=items;
   values.notes='Historical POS record only; no live receipt or settlement';
  }
  const pendingKey='bite_historical_request:'+kind+':'+user+':'+id,signature=JSON.stringify(values);
  if(form.dataset.bheSavedSignature===signature)throw new Error('Yeh old record already save ho chuka hai. Next record ke liye details badlein.');
  let pending=null;try{pending=JSON.parse(localStorage.getItem(pendingKey)||'null')}catch{}
  if(pending&&pending.signature!==signature)throw new Error('Pichhli old entry ka response pending hai. Pehle wahi details dobara Save karke verify karein.');
  if(!pending){pending={request_id:root.crypto.randomUUID(),signature};localStorage.setItem(pendingKey,JSON.stringify(pending))}
  values.request_id=pending.request_id;
  let {data,error}=await ctx.sb.from('bite_owner_historical_entries').insert(values).select('id').single();
  if(error){
   // A response lost after commit must never produce a second historical entry.
   const check=await ctx.sb.from('bite_owner_historical_entries').select('id').eq('request_id',pending.request_id).maybeSingle();
   if(check.data?.id){data=check.data;error=null;}
  }
  if(error)throw error;
  if(!data?.id)throw new Error('Record confirmation unavailable. Retry unchanged details.');
  localStorage.removeItem(pendingKey);
  form.dataset.bheSavedSignature=signature;
  // The historical bill is confirmed: do not leave it as an unsubmitted live POS draft.
  if(kind==='pos')try{await root.BitePOS?.finishOrder?.()}catch(e){console.warn('Historical POS saved; draft cleanup needs retry',e)}
  await loadRows(form,kind);
  return data.id;
 }
 function onSubmit(e){
  const form=e.target;
  const kind=form?.id==='bhCheckinForm'?'room':form?.id==='orderForm'?'pos':null;
  if(!kind)return;
  // A past PAYMENT date is not the record/bill date. Prevent silent creation
  // of today's POS order when staff intended to import an old POS bill.
  if(kind==='pos'&&!isHistorical(form)){
   const paymentDate=getField(form,'payment_date')?.value||'';
   if(validDate(paymentDate)&&paymentDate<today()){
    e.preventDefault();e.stopImmediatePropagation();
    const dateField=getField(form,'history_date');
    if(dateField){
     dateField.value=paymentDate;
     dateField.dispatchEvent(new Event('change',{bubbles:true}));
     status(form,'Bill date was Today but payment date was '+paymentDate+'. Old register mode selected. Review the date and press Save old POS record to confirm; no live sale was created.',true);
     dateField.scrollIntoView?.({behavior:'smooth',block:'center'});
     dateField.focus?.({preventScroll:true});
    }else root.alert?.('Purane bill ke liye Entry date chunein; payment date alag hai.');
    return;
   }
  }
  if(!isHistorical(form))return;
  e.preventDefault();e.stopImmediatePropagation();
  const btn=form.querySelector('button[type=submit]');
  if(btn?.disabled)return;
  if(btn)btn.disabled=true;
  status(form,'Saving old record online…');
  const recordDate=currentDate(form);
  void save(form,kind).then(()=>{
   status(form,'✓ Old '+(kind==='room'?'room':'POS')+' record saved online for '+recordDate+'. Live status/payment unchanged.');
   if(kind==='pos'){
    root.closeModal?.('orderModal');
    void root.BitePOSReports?.refresh?.(true);
    root.alert?.('✓ '+recordDate+' ka purana POS bill online register mein save ho gaya. Reports > Calendar mein dekh sakte hain.');
   }
  }).catch(error=>status(form,'Save failed: '+(error.message||String(error)),true))
    .finally(()=>{if(btn)btn.disabled=false;});
 }
 function init(options){
  ctx=options;
  if(!ctx?.sb||observer)return;
  document.addEventListener('submit',onSubmit,true);
  document.addEventListener('change',e=>{if(e.target?.id==='orderChannel')schedule()},true);
  observer=new MutationObserver(schedule);
  observer.observe(document.body,{childList:true,subtree:true});
  scan();
 }
 root.BiteOwnerHistory={init,scan,isHistorical,validDate,plusDay,historyListSummary,loadRows};
})(window);
