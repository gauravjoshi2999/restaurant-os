/* Hotel register, clean guest bills and the shared Daily Book. Financial writes use scoped RPCs. */
(function(root){
 'use strict';
 let ctx,active=0,generation=0,report=null,reportScope='',reportVersion=0,month='';
 const H=()=>root.BiteHospitality,p=()=>H()?.prop(),db=()=>H()?.getWorkspace()||{};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const field=(n,label,type='text',value='',extra='')=>'<label class="bh-field"><span>'+esc(label)+'</span><input name="'+n+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';
 const option=(v,label,selected=false)=>'<option value="'+esc(v)+'" '+(selected?'selected':'')+'>'+esc(label)+'</option>';
 const select=(n,label,values,extra='')=>'<label class="bh-field"><span>'+esc(label)+'</span><select name="'+n+'" '+extra+'>'+values+'</select></label>';
 const button=(a,label,id='',extra='')=>'<button type="button" class="btn secondary" data-ha-action="'+a+'" data-id="'+esc(id)+'" '+extra+'>'+esc(label)+'</button>';
 const check=(n,label,extra='')=>'<label class="bh-check"><input name="'+n+'" type="checkbox" '+extra+'> '+esc(label)+'</label>';
 const message=()=>'<p class="bh-message" role="status" aria-live="polite"></p>';
 const today=()=>root.BiteOwner.day(),scope=()=>ctx?.getUser()?.id+':'+p()?.id;
 const enabled=()=>db().register_version===1;
 const manager=()=>['owner','manager'].includes(p()?.role);
 const methods=()=>['Cash','UPI','Bank Transfer','Card'].map(x=>option(x,x)).join('');
 function assertScope(key,version){if(key!==scope()||version!==generation)throw Error('Account or property changed. Reopen this action.')}
 function clear(){generation++;reportVersion++;report=null;reportScope='';month=''}
 function init(context){ctx=context;document.querySelector('#mainApp .content')?.addEventListener('click',click);document.querySelector('#mainApp .content')?.addEventListener('submit',submit)}
 function validateRegistration(f){
  const male=Number(f.male),female=Number(f.female),children=Number(f.children);
  if(![male,female,children].every(n=>Number.isInteger(n)&&n>=0&&n<=20)||male+female<1||male+female>20)throw Error('Enter valid male, female and child counts; at least one adult is required.');
  if(!String(f.full_name||'').trim()||!String(f.address||'').trim()||!String(f.arrived_from||'').trim()||!String(f.next_destination||'').trim())throw Error('Enter guest name, permanent address, arrival place and destination.');
  if(!/^[+\d][\d ()-]{6,19}$/.test(String(f.phone||'').trim()))throw Error('Enter a valid mobile number.');
  if(!['Car','Bike','Bus','Train','Other'].includes(f.transport))throw Error('Choose how the guest arrived.');
  if(['Car','Bike'].includes(f.transport)&&String(f.vehicle_number||'').trim().length<4)throw Error('Vehicle registration number is required for a car or bike.');
  const rate=Number(f.nightly_rate);if(!Number.isFinite(rate)||rate<0||rate>9999999999.99||Math.abs(Math.round(rate*100)-rate*100)>0.000001)throw Error('Enter the agreed room rent with at most two decimals.');
  return {male,female,adults:male+female,children,arrived_from:String(f.arrived_from).trim(),next_destination:String(f.next_destination).trim(),transport:f.transport,vehicle_number:['Car','Bike'].includes(f.transport)?String(f.vehicle_number).trim().toUpperCase():''};
 }
 function wireMoneyFields(form,methodName='method',noteName='account_note',verifyName='verified',refName='reference'){
  const method=form?.elements[methodName];if(!method)return;
  const update=()=>{const online=['UPI','Card','Bank Transfer'].includes(method.value);
   for(const name of [noteName,verifyName,refName]){const input=form.elements[name];if(input)input.closest('label')?.toggleAttribute('hidden',!online)}
   if(!online&&form.elements[verifyName])form.elements[verifyName].checked=false;
  };method.addEventListener('change',update);update();
 }
 function decorateRegister(form,draft={},guest){
  if(!enabled())return;
  const booking=form.querySelector('#biteRegistrationOperations');booking?.remove();
  form.dataset.enhanced='true';
  const rooms=db().rooms||[],guests=db().guests||[];
  const roomId=draft.room_id||'',room=rooms.find(r=>r.id===roomId),saved=!!draft.id_front_id;
  form.innerHTML='<div class="ha-register-meta">'+field('serial_number','Serial no. · Auto','text',db().next_register_number||1,'readonly')+field('register_date','Entry date · Auto','date',today(),'readonly')+'</div>'+
   '<h2>1 · Guest details</h2><div class="bh-form-grid ha-guest-counts">'+field('male','Male','number',draft.male??1,'required min="0" max="20" step="1"')+field('female','Female','number',draft.female??0,'required min="0" max="20" step="1"')+field('children','Children','number',draft.children??0,'required min="0" max="20" step="1"')+'</div><input type="hidden" name="adults" value="1">'+
   '<details class="ha-returning"><summary>Returning guest</summary>'+field('guest_search','Find by name or mobile','search','','data-guest-search autocomplete="off"')+select('guest_id','Use saved guest',option('','New guest')+guests.map(g=>option(g.id,g.full_name+' · '+g.phone,g.id===(guest?.id||draft.guest_id))).join(''),'data-guest-picker')+'</details>'+
   '<div class="bh-form-grid">'+field('full_name','Guest name *','text',guest?.full_name||draft.full_name||'','required maxlength="120" autocomplete="name"')+field('phone','Mobile number *','tel',guest?.phone||draft.phone||'','required minlength="7" maxlength="20" autocomplete="tel"')+
   field('address','Permanent address *','text',guest?.address||draft.address||'','required maxlength="500" autocomplete="street-address"')+field('arrived_from','Arriving from *','text',draft.arrived_from||'','required maxlength="120"')+field('next_destination','Next destination *','text',draft.next_destination||'','required maxlength="120"')+
   select('transport','Arrived by *',['Car','Bike','Bus','Train','Other'].map(x=>option(x,x,x===(draft.transport||'Bus'))).join(''),'required')+
   field('vehicle_number','Vehicle registration number *','text',draft.vehicle_number||'','maxlength="30" data-ha-vehicle')+'</div>'+
   '<div class="ha-id-section"><h3>Guest ID</h3><div class="bh-form-grid"><label class="bh-field"><span>ID front — Required</span><input type="file" name="id_front" accept="image/jpeg,image/png,application/pdf" '+(saved?'':'required')+'><small data-front-status>'+esc(saved?'Previously saved front will be checked again.':'Take a clear photo or choose a file · Up to 4 MB')+'</small></label><label class="bh-field"><span>ID back — Optional, if available</span><input type="file" name="id_back" accept="image/jpeg,image/png,application/pdf"><small>JPEG, PNG or PDF · Up to 4 MB</small></label></div>'+
   '<input type="hidden" name="id_front_id" value="'+esc(draft.id_front_id||'')+'"><input type="hidden" name="id_back_id" value="'+esc(draft.id_back_id||'')+'">'+
   check('id_checked','I checked that the ID copy is necessary and masked where required.','required')+'<p class="bh-note">ID copies are private to authorized property staff and are excluded from bills.</p></div>'+
   '<details><summary>Additional guest details</summary><div class="bh-form-grid">'+field('country','Nationality / country','text',guest?.country||draft.country||'India','required maxlength="60"')+field('email','Email · Optional','email',guest?.email||draft.email||'','maxlength="120"')+field('id_type','ID type','text',guest?.id_type||draft.id_type||'','maxlength="40"')+field('id_last4','Last 4 ID characters only','text',guest?.id_last4||draft.id_last4||'','maxlength="4" autocomplete="off"')+field('compliance_note','Arrival note · Optional','text',draft.compliance_note||'','maxlength="250"')+'</div></details>'+
   '<h2>2 · Room allocation</h2><div class="bh-form-grid">'+field('arrival','Check-in date *','date',draft.arrival||today(),'required')+field('departure','Expected checkout *','date',draft.departure||root.BiteOwner.day(new Date(Date.now()+86400000)),'required')+
   select('room_id','Room number *',option('','Select a room')+rooms.filter(r=>r.active&&r.housekeeping!=='blocked').map(r=>option(r.id,r.number+' · '+r.room_type,r.id===roomId)).join(''),'required')+
   field('nightly_rate','Agreed room rent / night (₹) *','number',draft.nightly_rate??room?.nightly_rate??'','required min="0" step="0.01" '+(manager()?'':'readonly'))+'</div>'+
   select('mode','Arrival',option('checkin','Check in now',draft.mode!=='reserve')+option('reserve','Reserve for later',draft.mode==='reserve'))+
   '<div data-ha-booking></div>'+message()+'<div class="bh-form-actions">'+button('draft','Save draft')+'<button type="submit" class="btn">Review check-in</button></div>';
  if(booking){
   booking.querySelector('h3').textContent='3 · Advance payment · Optional';
   booking.insertAdjacentHTML('beforeend',field('advance_account','Online account · Short note','text',draft.advance_account||p().tax_profile?.primary_account||'','maxlength="80" placeholder="Owner account / second account"'));
   form.querySelector('[data-ha-booking]').append(booking);
   wireMoneyFields(form,'advance_method','advance_account','advance_verified','advance_reference');
  }
  function counts(){form.elements.adults.value=Number(form.elements.male.value||0)+Number(form.elements.female.value||0)}
  function vehicle(){const yes=['Car','Bike'].includes(form.elements.transport.value);const input=form.elements.vehicle_number;input.required=yes;input.closest('label').hidden=!yes}
  counts();vehicle();
  form.addEventListener('input',counts);
  form.elements.transport.addEventListener('change',vehicle);
  form.elements.room_id.addEventListener('change',()=>{form.elements.nightly_rate.value=rooms.find(r=>r.id===form.elements.room_id.value)?.nightly_rate??''});
  form.elements.guest_id.addEventListener('change',()=>{
   for(const side of ['front','back']){form.elements['id_'+side].value='';form.elements['id_'+side+'_id'].value=''}
   form.elements.id_front.required=true;form.querySelector('[data-front-status]').textContent='Choose this guest’s ID front.';
  });
  if(draft.stay_id){for(const key of ['male','female','transport','vehicle_number','arrived_from','next_destination','id_front','id_back','nightly_rate'])form.elements[key].disabled=true;form.elements.id_checked.required=false}
 }
 function prepareRegister(form,f){
  if(form.dataset.enhanced!=='true')return;
  if(!form.dataset.stayId){
   const r=validateRegistration(f);f.adults=r.adults;form.elements.adults.value=r.adults;
   if(!form.elements.id_front.files[0]&&!form.elements.id_front_id.value)throw Error('Upload the ID front to continue.');
   if(!form.elements.id_checked.checked)throw Error('Check the guest ID before continuing.');
  }
 }
 async function saveDocuments(guest,form){
  if(form.dataset.enhanced!=='true')return null;
  const key=scope(),version=generation,out={};active++;
  try{
   for(const side of ['front','back']){
    const input=form.elements['id_'+side],hidden=form.elements['id_'+side+'_id'],file=input.files[0];
    if(!file){out['id_'+side]=hidden.value||null;continue}
    await root.BiteGuestDocuments.validate(file);assertScope(key,version);
    const sig=[guest,side,file.name,file.size,file.lastModified].join(':');
    form.__haUploads??={};const id=form.__haUploads[sig]??=root.crypto.randomUUID();
    async function doc(action,details={}){
     const r=await ctx.sb.rpc('bite_guest_document_command',{p_property:p().id,p_guest:guest,p_document:id,p_action:action,p_details:details});assertScope(key,version);if(r.error)throw r.error;return r.data;
    }
    const record=await doc('begin',{kind:'masked_id',mime_type:file.type,byte_size:file.size,redacted_confirmed:form.elements.id_checked.checked});
    if(record.status!=='ready'){
     const upload=await ctx.sb.storage.from('bite-guest-documents').upload(record.object_path,file,{contentType:file.type,cacheControl:'0',upsert:false});
     assertScope(key,version);
     try{await doc('finish')}catch(e){throw upload.error||e}
    }
    hidden.value=id;out['id_'+side]=id;
   }
   if(!out.id_front)throw Error('The required ID front is missing.');return out;
  }finally{active--}
 }
 function registration(form,f,docs){
  if(form.dataset.enhanced!=='true'||form.dataset.stayId)return {};
  const r=validateRegistration(f);return {nightly_rate:Number(f.nightly_rate),advance_account:f.advance_account||'',registration:{...r,...docs}};
 }
 function decorateFolio(target,folio,stay){
  if(!enabled())return;
  target.querySelector('h1').textContent='Guest Khata';
  const actions=target.querySelector('.bh-guest-bill-buttons');
  if(folio.status==='open'&&['owner','manager','receptionist'].includes(p()?.role)){
   if(H().has('hotel_incidentals'))actions?.insertAdjacentHTML('beforeend',button('extra','＋ Add extra charge',folio.id));
   const old=target.querySelector('[data-hotel-action="checkout"]');
   if(old){old.remove();actions?.insertAdjacentHTML('beforeend',button('checkout','Checkout & collect balance',folio.id))}
  }
  if(stay?.register_number)target.querySelector('.bh-stay-dates')?.insertAdjacentHTML('beforeend',' · Register #'+esc(stay.register_number));
 }
 function decoratePayment(form){
  if(!enabled()||!form||(!form.elements.method&&form.dataset.action!=='payment_confirm')||form.elements.account_note)return;
  form.querySelector('.bh-actions')?.insertAdjacentHTML('beforebegin',field('account_note','Online account · Short note','text',p()?.tax_profile?.primary_account||'','maxlength="80" placeholder="Owner account / second account"'));
  wireMoneyFields(form);
 }
 function billHTML(s){
  const entries=(s.entries||[]).filter(e=>e.status==='confirmed'&&['charge','discount','reversal'].includes(e.kind));
  const lines=cat=>entries.filter(e=>(cat==='extras'?!['room','food'].includes(e.category):e.category===cat)).map(e=>{
   const sign=['discount','reversal'].includes(e.kind)?-1:1;
   return '<tr><td>'+esc(e.description)+(e.source_items||[]).map(i=>'<br><small>'+esc(i.quantity)+' × '+esc(i.name)+' @ '+money(i.unit_price)+'</small>').join('')+'</td><td>'+money(sign*Number(e.amount))+'</td></tr>';
  }).join('');
  const groups=s.gst||[];
  const tax=groups.length?groups.reduce((n,g)=>n+Number(g.cgst)+Number(g.sgst),0):entries.reduce((n,e)=>n+(['discount','reversal'].includes(e.kind)?-1:1)*Number(e.tax_amount||0),0);
  const draft=String(s.number||'').startsWith('DRAFT'),registered=!!s.tax_profile?.gstin&&s.tax_profile?.reviewed;
  const section=(title,body)=>body?'<h3>'+title+'</h3><table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>'+body+'</tbody></table>':'';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+esc(s.number)+'</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:800px;margin:32px auto;padding:0 20px;color:#202020}h1{margin-bottom:4px}h2,h3{margin-top:22px}table{width:100%;border-collapse:collapse;margin:10px 0 18px}th,td{padding:9px 2px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top}th:last-child,td:last-child{text-align:right;white-space:nowrap}small{color:#555}.totals{margin-left:auto;max-width:360px}.sign{margin-top:45px;text-align:right}button{padding:12px 20px}@media print{button{display:none}body{margin:0;max-width:none}tr{break-inside:avoid}}@page{size:A4;margin:16mm}</style></head><body><h1>'+esc(s.property?.name)+'</h1><div>'+esc(s.property?.address||'')+'<br>'+esc(s.property?.phone||'')+(registered?'<br>GSTIN: '+esc(s.tax_profile.gstin):'')+'</div><h2>'+(draft?'Bill estimate':registered?'Tax invoice':'Guest bill')+'</h2><p>Bill no. '+esc(s.number)+' · Date '+esc(s.issued_at?root.BiteOwner.day(s.issued_at):today())+'</p><p>'+esc(s.guest?.name)+'<br>'+esc(s.guest?.address||'')+'</p><p>Room '+esc(s.room?.number)+' · '+esc(s.stay?.arrival)+' to '+esc(s.stay?.departure)+'</p>'+
   section('Room rent',lines('room'))+section('Food bill',lines('food'))+section('Extra charges',lines('extras'))+
   '<table class="totals"><tbody><tr><td>Subtotal</td><td>'+money(Number(s.totals?.charges||0)-tax)+'</td></tr>'+
   (registered?'<tr><td>CGST'+(groups.length===1?' '+Number(groups[0].rate)/2+'%':'')+'</td><td>'+money(groups.length?groups.reduce((n,g)=>n+Number(g.cgst),0):Math.round(tax*50)/100)+'</td></tr><tr><td>SGST'+(groups.length===1?' '+Number(groups[0].rate)/2+'%':'')+'</td><td>'+money(groups.length?groups.reduce((n,g)=>n+Number(g.sgst),0):tax-Math.round(tax*50)/100)+'</td></tr>':'')+
   '<tr><td><strong>Bill total</strong></td><td><strong>'+money(s.totals?.charges)+'</strong></td></tr><tr><td>Payments received</td><td>'+money(s.totals?.paid)+'</td></tr><tr><td><strong>Balance due</strong></td><td><strong>'+money(s.totals?.balance)+'</strong></td></tr></tbody></table>'+
   (registered&&groups.length?'<table><thead><tr><th>Service / SAC</th><th>Taxable</th><th>CGST rate</th><th>CGST</th><th>SGST rate</th><th>SGST</th></tr></thead><tbody>'+groups.map(g=>'<tr><td>'+esc(g.category)+' '+esc(g.sac)+'</td><td>'+money(g.taxable)+'</td><td>'+Number(g.rate)/2+'%</td><td>'+money(g.cgst)+'</td><td>'+Number(g.rate)/2+'%</td><td>'+money(g.sgst)+'</td></tr>').join('')+'</tbody></table><small>Place of supply: '+esc(s.place_of_supply||String(s.tax_profile.gstin).slice(0,2))+' · Reverse charge: No</small>':'')+
   '<p class="sign">For '+esc(s.property?.name)+'<br><br>Authorized signatory</p><button onclick="window.print()">Print / Save PDF</button></body></html>';
 }
 function printStatement(s){const win=root.open('','_blank');if(!win)throw Error('Allow pop-ups to print the bill.');win.opener=null;win.document.write(billHTML(s));win.document.close();return true}

 function reportRows(v){
  const heading=['Date','POS sales','Room + food bills','Other income','Total billed sales','Output GST','Net sales','Expenses / salary cost','Staff advance paid','Cash received','Cash paid','Cash closing','Online received','Online paid','Online closing','Recorded profit / loss'];
  return [heading,...(v.days||[]).map(d=>[d.day,d.pos_sales,d.hotel_sales,d.other_income,d.gross_sales,d.tax,d.net_sales,d.expenses,d.staff_advance,d.cash_in,d.cash_out,d.cash_balance,d.online_in,d.online_out,d.online_balance,d.profit])];
 }
 function gstRows(v){
  const rows=[['Bill date','Bill number','Guest','Hotel GSTIN','Category','SAC','Taxable value','CGST %','CGST amount','SGST %','SGST amount','Bill total']];
  for(const bill of v.gst_invoices||[]){
   const lines=bill.tax_lines?.length?bill.tax_lines:[{category:'Unconfigured / no GST',sac:'',taxable:bill.total,rate:0,cgst:0,sgst:0}];
   for(const g of lines)rows.push([bill.date,bill.number,bill.guest,bill.gstin||'',g.category,g.sac,Number(g.taxable),Number(g.rate)/2,Number(g.cgst),Number(g.rate)/2,Number(g.sgst),Number(bill.total)]);
  }return rows;
 }
 async function renderDailyBook(target){
  if(!target||!p())return;
  const key=scope(),version=++reportVersion;
  month=month||today().slice(0,7);
  const from=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)),to=root.BiteOwner.day(new Date(end.getTime()+6*3600000));
  target.innerHTML='<div class="bh-heading"><div><p class="bh-eyebrow">'+esc(p().name)+'</p><h1>Daily Book</h1><p>Sales, expenses, staff advances and cash / online balances.</p></div></div>'+
   '<form class="bh-form ha-month-form" data-ha-form="month">'+field('month','Month','month',month,'required')+'<button class="btn" type="submit">View month</button></form><div id="haBookBody" role="status">Loading recorded accounts…</div>';
  const r=await ctx.sb.rpc('bite_daily_book',{p_property:p().id,p_from:from,p_to:to});
  if(key!==scope()||version!==reportVersion||!target.isConnected)return;
  const body=target.querySelector('#haBookBody');if(r.error){body.textContent='Daily Book unavailable: '+r.error.message;return}
  report=r.data;reportScope=key;
  const sum=k=>(report.days||[]).reduce((n,d)=>n+Number(d[k]||0),0),last=report.days?.at(-1)||{};
  body.innerHTML='<div class="ha-book-actions">'+(manager()?button('income','＋ Other income')+button('expense','＋ Expense')+button('staff_advance','＋ Staff advance')+button('salary','Staff salary')+button('accounts','Opening / transfer'):'')+'</div>'+
   '<div class="bh-metrics">'+[['Billed sales',sum('gross_sales')],['Recorded expenses',sum('expenses')],['Staff advances paid',sum('staff_advance')],['Cash balance',last.cash_balance],['Online balance',last.online_balance],['Recorded profit / loss',sum('profit')]].map(([label,value])=>'<div class="bh-metric"><span>'+esc(label)+'</span><strong>'+money(value)+'</strong></div>').join('')+'</div>'+
   '<p class="bh-note">Existing POS, room receipts and expenses appear automatically; add only missing entries. Sales follow issued bills. Advances and partial receipts change money balances; they do not create another sale. Add the starting balance for each account. Record earned salary once, then its payout after advances. Profit uses recorded sales less output GST and recorded costs.</p>'+
   '<section class="bh-panel"><div class="bh-heading"><h2>Daily totals</h2><div class="bh-actions">'+button('excel','Monthly Excel')+button('gst','Bill-wise GST Excel')+'</div></div><div class="ha-table-wrap"><table class="ha-book-table"><thead><tr><th>Date</th><th>Sale</th><th>Expense</th><th>Staff advance</th><th>Cash balance</th><th>Online balance</th><th>Profit / loss</th></tr></thead><tbody>'+
   (report.days||[]).map(d=>'<tr><td>'+esc(d.day)+'</td><td>'+money(d.gross_sales)+'</td><td>'+money(d.expenses)+'</td><td>'+money(d.staff_advance)+'</td><td>'+money(d.cash_balance)+'</td><td>'+money(d.online_balance)+'</td><td>'+money(d.profit)+'</td></tr>').join('')+'</tbody></table></div></section>'+
   '<section class="bh-panel"><h2>Cash & online accounts</h2>'+((report.accounts||[]).map(a=>'<div class="bh-room-line"><span>'+esc(a.account)+' · '+esc(a.method)+'</span><strong>'+money(a.balance)+'</strong></div>').join('')||'<p>No money recorded yet.</p>')+'</section>'+
   '<details class="bh-panel"><summary>Staff salary & advances</summary><p class="bh-note">Earned salary is the expense. An advance and the remaining salary payout are money movements.</p>'+((report.staff||[]).map(s=>'<article class="bh-record"><div><strong>'+esc(s.staff_name)+'</strong><p>Earned salary '+money(s.earned_salary)+' · Advances '+money(s.advances)+' · Salary paid '+money(s.salary_paid)+'</p><p>Recorded balance: '+money(Number(s.earned_salary||0)-Number(s.advances||0)-Number(s.salary_paid||0))+'</p></div></article>').join('')||'<p>No staff salary entries yet.</p>')+'</details>'+
   '<section class="bh-panel"><h2>Transactions</h2>'+((report.journal||[]).map(j=>'<article class="bh-record"><div><strong>'+esc(j.description)+'</strong><p>'+esc(j.day)+' · '+esc(j.category)+' · '+esc(j.method)+(j.method!=='Cash'&&j.account_note?' · '+esc(j.account_note):'')+'</p></div><strong>'+(j.direction==='out'?'−':j.direction==='noncash'?'':'+')+money(j.amount)+'</strong>'+(manager()&&['UPI','Card','Bank Transfer'].includes(j.method)&&j.source_type!=='property_expense'?button('note','Account note',j.id,'data-source="'+esc(j.source_type)+'"'):'')+'</article>').join('')||'<p>No transactions for this month.</p>')+'</section>';
 }

 function settings(target){
  target?.querySelector('#haBillingSettings')?.remove();if(!target||!enabled()||!p()?.can_configure)return;
  const tax=p().tax_profile||{},s=db().invoice_series||{},box=document.createElement('section');box.id='haBillingSettings';box.className='bh-panel';
  box.innerHTML='<form class="bh-form" data-ha-form="billing"><h2>Hotel bills & GST</h2><p>Continue your current bill sequence by setting the next number. Issued bills keep their original number.</p><div class="bh-form-grid">'+
   field('gstin','Hotel GSTIN · Leave blank if unregistered','text',tax.gstin||'','maxlength="15" autocomplete="off"')+
   field('prefix','Bill prefix','text',s.prefix||'B','required pattern="[A-Za-z0-9]{1,3}" maxlength="3"')+
   field('next_number','Next bill number','number',s.next_number||1,'required min="'+(Number(s.last_number||0)+1)+'" max="999999" step="1"')+
   select('room_rate','Room GST · Total %',[0,5,18].map(x=>option(x,x+'%',Number(tax.room_rate||0)===x)).join(''))+
   select('food_rate','Restaurant GST · Total %',[0,5,18].map(x=>option(x,x+'%',Number(tax.food_rate||0)===x)).join(''))+
   field('incidental_rate','Extra charges GST · Total %','number',tax.incidental_rate||0,'required min="0" max="100" step="0.01"')+
   field('primary_account','Usual online account · Short label','text',tax.primary_account||'','maxlength="80" placeholder="Owner account"')+'</div>'+
   '<p class="bh-note">5% is shown as 2.5% CGST + 2.5% SGST. Confirm applicable room, restaurant and extra-charge rates with your CA. New rates apply to new charges. Existing bills stay unchanged.</p>'+
   check('reviewed','I reviewed this property’s GST registration, rates and invoice series.','required')+message()+'<button class="btn" type="submit">Save billing settings</button></form>';
  target.append(box);
 }
 function entryEditor(kind){
  const headings={income:'Other income',expense:'Record expense',staff_advance:'Staff advance',salary_expense:'Earned monthly salary',salary_payment:'Pay remaining salary',opening:'Opening balance',transfer_in:'Money transferred in',transfer_out:'Money transferred out'};
  const staff=['staff_advance','salary_expense','salary_payment'].includes(kind);
  H().editor('<form class="bh-form" data-ha-form="book" data-kind="'+kind+'"><h2>'+headings[kind]+'</h2><div class="bh-form-grid">'+
   field('entry_date','Date','date',today(),'required max="'+today()+'"')+
   field('category','Category','text',kind==='expense'?'':headings[kind],'required maxlength="80" list="haExpenseTypes"')+
   '<datalist id="haExpenseTypes">'+['Kirana','Flour / Atta','Vegetables','Gas','Electricity','Milk','Newspaper','Repairs','Internet','Rent','Laundry'].map(x=>'<option value="'+esc(x)+'">').join('')+'</datalist>'+
   (staff?field('staff_name','Staff name','text','','required maxlength="120"'):'')+
   field('amount','Amount (₹)','number','','required min="0.01" step="0.01"')+
   (kind==='salary_expense'?'<input type="hidden" name="method" value="Non-cash">':select('method','Cash / Online',methods()))+
   field('account_note','Online account · Short note','text',p().tax_profile?.primary_account||'','maxlength="80"')+
   field('description','Reason / detail','text','','required maxlength="250"')+'</div>'+
   (kind==='salary_expense'?'<p class="bh-note">Enter the full earned salary for this month, including advances already paid. This records the expense; it does not pay money again.</p>':kind==='salary_payment'?'<p class="bh-note">Record earned salary first. Pay only the remaining amount after advances; this payout does not add salary expense again.</p>':'')+
   (kind!=='salary_expense'?check('verified','For online entries, I verified this movement in the account.'):'')+message()+'<div class="bh-actions">'+button('close','Cancel')+'<button class="btn" type="submit">Save entry</button></div></form>');
  wireMoneyFields(document.querySelector('#bhActionEditor form'));
 }

 async function click(e){
  const b=e.target.closest('[data-ha-action]');if(!b||active)return;
  const a=b.dataset.haAction,id=b.dataset.id;
  try{
   if(a==='draft'){
    const form=document.getElementById('bhCheckinForm'),fields=Object.fromEntries(Array.from(new FormData(form)).filter(([,v])=>typeof v==='string'));fields.stay_id=form.dataset.stayId||'';
    localStorage.setItem('bite_register_draft:'+scope(),JSON.stringify({savedAt:Date.now(),fields}));form.querySelector('.bh-message').textContent='Draft saved. Unuploaded ID files must be selected again.';return;
   }
   if(a==='close'){document.getElementById('bhActionEditor')?.remove();return}
   if(['income','expense','staff_advance','salary_expense','salary_payment','opening','transfer_in','transfer_out'].includes(a)){entryEditor(a);return}
   if(a==='salary'){H().editor('<h2>Staff salary</h2><div class="bh-actions">'+button('salary_expense','Record earned monthly salary')+button('salary_payment','Pay remaining salary')+'</div><p class="bh-note">Record salary cost once, then its remaining payout after advances.</p>');return}
   if(a==='accounts'){H().editor('<h2>Opening balance & transfers</h2><div class="bh-actions">'+button('opening','Add opening balance')+button('transfer_in','Transfer in / settlement')+button('transfer_out','Transfer out / withdrawal')+'</div><p class="bh-note">These change money balances and do not create sales or expenses. Record both sides when moving between your own accounts.</p>');return}
   if(a==='excel'||a==='gst'){
    if(!report||reportScope!==scope())throw Error('Reload this property’s report.');
    root.BiteExports.download(root.BiteExports.workbook(a==='excel'?reportRows(report):gstRows(report)),'Bite-'+(a==='excel'?'Monthly-Accounts-':'GST-Bills-')+month+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return;
   }
   if(a==='note'){
    const row=report?.journal.find(x=>x.id===id);if(!row)return;
    H().editor('<form class="bh-form" data-ha-form="note" data-id="'+esc(id)+'" data-source="'+esc(b.dataset.source)+'"><h2>Online account note</h2>'+field('account_note','Received / paid through','text',row.account_note||'','required maxlength="80" placeholder="Owner account / second account"')+message()+'<button class="btn" type="submit">Save account note</button></form>');return;
   }
   if(a==='extra'){document.querySelector('#folios [data-hotel-action="entry"][data-id="charge"]')?.click();return}
   if(a==='checkout'){
    const f=db().folios.find(x=>x.id===id),t=f?.totals;if(!f||!t)return;
    H().editor('<form class="bh-form" data-ha-form="checkout" data-id="'+esc(id)+'"><h2>Checkout</h2><div class="ha-checkout-summary"><span>Total bill <strong>'+money(t.charges)+'</strong></span><span>Already received <strong>'+money(t.paid)+'</strong></span><span>To collect <strong>'+money(t.balance)+'</strong></span></div>'+
     '<input name="amount" type="hidden" value="'+Number(t.balance)+'">'+(Number(t.balance)>0?select('method','Receive payment by',methods())+field('account_note','Online account · Short note','text',p().tax_profile?.primary_account||'','maxlength="80"')+field('reference','Online transaction reference','text','','maxlength="100"')+check('verified','I verified the online payment in the selected account.'):'')+
     (Number(t.pending)||Number(t.deposit_held)?'<p class="bh-note">Verify pending receipts and resolve the security deposit before checkout.</p>':'')+message()+'<div class="bh-actions">'+button('close','Cancel')+'<button class="btn" type="submit" '+(Number(t.pending)||Number(t.deposit_held)||Number(t.balance)<0?'disabled':'')+'>Confirm checkout & bill</button></div></form>');wireMoneyFields(document.querySelector('[data-ha-form=checkout]'));return;
   }
  }catch(err){const m=document.querySelector('.page.active .bh-message');if(m)m.textContent=err.message;else root.alert(err.message)}
 }
 async function submit(e){
  const form=e.target.closest('[data-ha-form]');if(!form)return;e.preventDefault();e.stopPropagation();
  const type=form.dataset.haForm,f=Object.fromEntries(new FormData(form)),b=form.querySelector('button[type="submit"]'),msg=form.querySelector('.bh-message');
  if(b?.disabled)return;if(b)b.disabled=true;
  try{
   if(type==='month'){if(!/^\d{4}-\d{2}$/.test(f.month))throw Error('Choose a month.');month=f.month;await renderDailyBook(document.getElementById('daily-book'));return}
   if(msg)msg.textContent='Saving…';
   if(type==='billing'){
    if(!form.elements.reviewed.checked)throw Error('Review billing settings first.');
    await H().command('billing_settings',{prefix:f.prefix,next_number:Number(f.next_number),primary_account:f.primary_account,tax_profile:{gstin:f.gstin.trim().toUpperCase(),reviewed:true,room_rate:Number(f.room_rate),food_rate:Number(f.food_rate),incidental_rate:Number(f.incidental_rate)}});
    await H().refreshContext();await H().reload();settings(document.getElementById('settings'));return;
   }
   if(type==='book')await H().command('daybook_entry',{...f,kind:form.dataset.kind,amount:Number(f.amount),verified:f.verified==='on'});
   if(type==='note')await H().command('account_note',{id:form.dataset.id,source_type:form.dataset.source,account_note:f.account_note});
   if(type==='checkout'){
    await H().command('checkout_collect',{...f,folio_id:form.dataset.id,amount:Number(f.amount),verified:f.verified==='on'});
    await H().reload();H().redraw();return;
   }
   await renderDailyBook(document.getElementById('daily-book'));
  }catch(err){if(msg)msg.textContent=err.message||String(err)}
  finally{if(b)b.disabled=false}
 }
 const api={init,clear,enabled,busy:()=>active>0,decorateRegister,prepareRegister,saveDocuments,registration,decorateFolio,decoratePayment,renderDailyBook,settings,printStatement,validateRegistration,reportRows,gstRows,billHTML};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.BiteHotelAccounts=api;
})(typeof window!=='undefined'?window:globalThis);
