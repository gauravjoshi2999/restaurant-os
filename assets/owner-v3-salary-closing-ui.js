/* Owner A10 controller: UI only; RPC is the sole money-adjustment approval path. */
(function(root){
 'use strict';
 let ctx=null,version=0,report=null,proposal=null,requestId='',bound=false,loading=false,submitting=false;
 const E=id=>root.document?.getElementById(id);
 const engine=()=>root.BiteV3SalaryClosing;
 const display=(id,text)=>{const el=E(id);if(el)el.textContent=text};
 const amount=id=>E(id)?.value??'';
 function scope(){
  return ctx&&ctx.getRole?.()==='owner'&&ctx.getUserId?.()&&
   ctx.getMemberships?.().some(m=>m.restaurant_id===ctx.getRestaurantId?.()&&m.role==='owner')&&
   ctx.getRestaurantId?.()&&engine();
 }
 function active(n,restaurant,user,employee,month){
  return n===version&&!!scope()&&ctx.getRestaurantId()===restaurant&&ctx.getUserId()===user&&
   E('hrA10Employee')?.value===employee&&E('hrA10Month')?.value===month;
 }
 function resetReview(){
  proposal=null;requestId='';
  E('hrA10Approval').checked=false;
  E('hrA10Review').hidden=true;
  E('hrA10Save').disabled=true;
 }
 function toggle(){
  E('hrA10Save').disabled=!proposal||!E('hrA10Approval').checked||!scope()||submitting;
 }
 function dates(){return {month:E('hrA10Month')?.value,employeeId:E('hrA10Employee')?.value}}
 function bind(){
  if(bound||!E('hrA10Section'))return;
  bound=true;
  for(const id of ['hrA10Month','hrA10Employee'])E(id).addEventListener('change',()=>{resetReview();void load();});
  for(const id of ['hrA10Gross','hrA10Bonus','hrA10Deduction','hrA10Advance','hrA10Note'])
   E(id).addEventListener('input',()=>{resetReview();display('hrA10Message','Figures changed. Preview again before approval.');});
  E('hrA10Approval').addEventListener('change',toggle);
  E('hrA10Refresh').addEventListener('click',()=>void load());
  E('hrA10Preview').addEventListener('click',()=>preview());
  E('hrA10Save').addEventListener('click',()=>void approve());
  E('hrA10PreparePayment').addEventListener('click',()=>void prepareSalaryDue());
 }
 function mount(nextCtx){
  ctx=nextCtx;
  bind();
  version++;loading=false;submitting=false;report=null;resetReview();
  E('hrA10PreparePayment').hidden=true;E('hrA10PreparePayment').disabled=true;
  const el=E('hrA10Section');
  if(!el)return;
  el.hidden=!scope();
  if(el.hidden){E('hrA10Result').replaceChildren();display('hrA10Message','');return}
  const today=ctx.getToday();
  const month=E('hrA10Month');
  if(!engine().validCompleted(month.value,today))month.value=engine().lastMonth(today);
  const select=E('hrA10Employee'),existing=select.value;
  const people=(ctx.getEmployees?.()||[]).filter(e=>e.restaurant_id===ctx.getRestaurantId());
  select.replaceChildren();
  const defaultOption=new Option('Select an employee','');select.add(defaultOption);
  for(const p of people){
   const opt=new Option(p.full_name+(p.status==='Inactive'?' (inactive)':''),p.id);
   select.add(opt);
  }
  if(people.some(x=>x.id===existing))select.value=existing;
  if(!select.value&&people.length===1)select.value=people[0].id;
  if(select.value)void load();
  else{display('hrA10Message','Select an employee and a completed month.');E('hrA10Result').replaceChildren();}
 }
 function clear(){
  version++;report=null;proposal=null;requestId='';loading=false;submitting=false;
  if(E('hrA10Section')){E('hrA10PreparePayment').hidden=true;E('hrA10PreparePayment').disabled=true;E('hrA10Section').hidden=true;E('hrA10Result').replaceChildren();resetReview();display('hrA10Message','')}
 }
 async function load(){
  const n=++version,{employeeId,month}=dates(),restaurant=ctx?.getRestaurantId?.(),user=ctx?.getUserId?.();
  resetReview();report=null;loading=true;
  const t=E('hrA10Result');t.replaceChildren();
  E('hrA10PreparePayment').hidden=true;E('hrA10PreparePayment').disabled=true;
  E('hrA10Preview').disabled=true;
  if(!scope()||!employeeId||!engine().validCompleted(month,ctx.getToday())){
   display('hrA10Message','Select an employee and an already completed salary month.');
   loading=false;return;
  }
  const employee=ctx.getEmployees().find(e=>e.id===employeeId&&e.restaurant_id===restaurant);
  if(!employee){display('hrA10Message','Employee is not available for this restaurant.');loading=false;return}
  display('hrA10Rate','Current profile rate: '+engine().money(engine().cents(employee.salary_amount)||0)+
   ' / '+(employee.salary_period||'Not set')+'. Check the historical agreed amount; it is not auto-filled.');
  t.textContent='Verifying saved advances and salary payments…';
  try{
   const result=await engine().load({client:ctx.client,restaurantId:restaurant,employeeId,month,today:ctx.getToday(),
    employee,isCurrent:()=>active(n,restaurant,user,employeeId,month)});
   if(!active(n,restaurant,user,employeeId,month))return;
   report=result;t.innerHTML=engine().summaryHtml(result);
   const closed=!!result.closing;
   E('hrA10PreparePayment').hidden=!(closed&&result.due>0&&!result.overpaid);
   E('hrA10PreparePayment').disabled=!(closed&&result.due>0&&!result.overpaid);
   for(const id of ['hrA10Gross','hrA10Bonus','hrA10Deduction','hrA10Advance','hrA10Note'])
    E(id).disabled=closed;
   E('hrA10Preview').disabled=closed||result.unassigned>0;
   E('hrA10Approval').disabled=closed;
   display('hrA10Message',closed?'This month is already approved; approval cannot be changed.':'Source records verified. Enter agreed figures and preview.');
  }catch(error){
   if(!active(n,restaurant,user,employeeId,month))return;
   t.replaceChildren();
   const x=root.document.createElement('p');x.className='a10-warning';x.setAttribute('role','alert');
   x.textContent='Closing is unavailable: '+(error?.message||'Source check failed')+'. No amount was approved.';
   t.append(x);
   display('hrA10Message','Review failed; no closing saved.');
  }finally{if(active(n,restaurant,user,employeeId,month))loading=false}
 }
 function preview(){
  resetReview();
  if(loading||!scope()||!report||report.closing){
   display('hrA10Message','Verified source preview is required.');return;
  }
  try{
   proposal=engine().proposal(report,{gross:amount('hrA10Gross'),bonus:amount('hrA10Bonus'),
    deduction:amount('hrA10Deduction'),advance:amount('hrA10Advance'),note:amount('hrA10Note')});
   E('hrA10Review').hidden=false;
   display('hrA10Review','Closing preview for '+report.month+': approved earnings '+engine().money(proposal.grossCents+proposal.bonusCents)+
    ' − deduction '+engine().money(proposal.deductionCents)+' − advance adjustment '+
    engine().money(proposal.advanceCents)+' − previously paid salary/bonus '+engine().money(proposal.taggedPaidCents)+
    ' = salary still due '+engine().money(proposal.dueCents)+'. Approval does NOT transfer money or create a Cashbook entry.');
   display('hrA10Message','Check the figures, tick the approval checkbox and confirm. No payment will be made.');
  }catch(e){proposal=null;display('hrA10Message','Preview blocked: '+e.message)}
 }
 async function prepareSalaryDue(){
  if(!scope()||loading||submitting||!report?.closing||!(report.due>0)||report.overpaid)return;
  const {employeeId,month}=dates(),restaurant=ctx.getRestaurantId(),user=ctx.getUserId(),n=version;
  const btn=E('hrA10PreparePayment');btn.disabled=true;
  try{
   const employee=ctx.getEmployees().find(e=>e.id===employeeId&&e.restaurant_id===restaurant);
   if(!employee)throw Error('Selected employee does not belong to this restaurant');
   // Re-read canonical payment/closing sources; never fill a stale amount.
   const updated=await engine().load({client:ctx.client,restaurantId:restaurant,employeeId,month,
     today:ctx.getToday(),employee,isCurrent:()=>active(n,restaurant,user,employeeId,month)});
   if(!active(n,restaurant,user,employeeId,month))return;
   if(!updated.closing||updated.overpaid||updated.due!==report.due||updated.due<=0){
    display('hrA10Message','Recorded salary balance changed. Review the refreshed closing before preparing a payment.');
    await load();return;
   }
   const select=E('hrPaymentEmployee');
   if(!select||!Array.from(select.options).some(o=>o.value===employeeId))
    throw Error('Employee is unavailable in the existing payment form');
   const confirmed=typeof root.confirm!=='function'||root.confirm(
    'Prepare '+engine().money(updated.due)+' as the remaining salary for '+month+
    '? This only fills the existing payment form. No payment or Cashbook entry will be created.'
   );
   if(!confirmed)return;
   E('hrPaymentEmployee').value=employeeId;
   E('hrPaymentType').value='Salary';
   E('hrPaymentMonth').value=month;
   E('hrPaymentAmount').value=(updated.due/100).toFixed(2);
   E('hrPaymentDate').value=ctx.getToday();
   E('hrPaymentReference').value='';
   E('hrPaymentNotes').value=('Salary due after approved '+month+' closing').slice(0,250);
   const mode=E('hrPaymentMethod');
   if(!Array.from(mode.options).some(o=>o.value===''))
    mode.add(new Option('Choose actual payment mode',''),0);
   mode.value='';
   display('hrPaymentMessage','Only the payment form was filled. Choose the actual method and verify the amount before saving an already-made payment. No money was sent.');
   display('hrA10Message','Remaining salary details prepared in the existing payment form; nothing has been saved.');
   root.BiteOwnerHRTabs?.activate?.(root.document,'payment');
   E('hrPaymentAmount').scrollIntoView?.({block:'center',behavior:'smooth'});
   mode.focus?.();
  }catch(error){
   if(active(n,restaurant,user,employeeId,month))
    display('hrA10Message','Cannot prepare salary payment: '+(error?.message||'Source refresh failed')+'. No payment was recorded.');
  }finally{
   if(active(n,restaurant,user,employeeId,month))
    btn.disabled=!(report?.closing&&report.due>0&&!report.overpaid);
  }
 }
 async function approve(){
  if(!scope()||!report||report.closing||!proposal||!E('hrA10Approval').checked||submitting)return;
  const restaurant=ctx.getRestaurantId(),user=ctx.getUserId(),{employeeId,month}=dates(),n=version;
  if(!active(n,restaurant,user,employeeId,month))return;
  const confirmFn=root.confirm;
  if(typeof confirmFn==='function'&&!confirmFn('Approve this monthly salary closing? This approval is permanent. It will NOT send salary or create a cash transaction.'))return;
  submitting=true;toggle();
  if(!requestId){
   if(!root.crypto?.randomUUID){display('hrA10Message','Secure request ID unavailable. Refresh in a supported browser.');submitting=false;toggle();return}
   requestId=root.crypto.randomUUID();
  }
  display('hrA10Message','Saving this approved month…');
  const args={
   p_restaurant_id:restaurant,p_employee_id:employeeId,p_period_month:month+'-01',
   p_approved_gross:proposal.grossCents/100,p_approved_bonus:proposal.bonusCents/100,
   p_approved_deduction:proposal.deductionCents/100,p_advance_applied:proposal.advanceCents/100,
   p_expected_paid:proposal.taggedPaidCents/100,p_expected_available:report.available/100,
   p_request_id:requestId,p_note:proposal.note
  };
  try{
   const {data,error}=await ctx.client.rpc('owner_close_employee_salary_month',args);
   if(error)throw error;
   if(!data)throw Error('Closing receipt ID not returned');
   if(!active(n,restaurant,user,employeeId,month))return;
   display('hrA10Message','Monthly salary closing saved. This is an approval, NOT a salary payment.');
   await load();
  }catch(e){
   if(active(n,restaurant,user,employeeId,month))
    display('hrA10Message','Closing not confirmed: '+(e?.message||'Retry failed')+'. Retry with unchanged details or refresh. Do not record a duplicate payment.');
  }finally{submitting=false;if(active(n,restaurant,user,employeeId,month))toggle()}
 }
 root.BiteV3SalaryClosingUI={mount,clear,load,preview,approve,prepareSalaryDue};
})(typeof window!=='undefined'?window:globalThis);
