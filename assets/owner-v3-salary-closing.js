/* Bite Owner V3 A10 — month close from verified source records only.
 * No client-calculated money is written: PostgreSQL recomputes with owner authorization. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const monthOk=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
 const dayOk=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
   !Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 const cents=value=>{
   if(!(typeof value==='number'||typeof value==='string'&&/^\d+(?:\.\d{1,2})?$/.test(value.trim()))||!Number.isFinite(Number(value)))return null;
   const n=Number(value);
   if(n<0||n>99999999.99||Math.abs(n*100-Math.round(n*100))>1e-6)return null;
   return Math.round(n*100);
 };
 const money=cent=>'₹'+(cent/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 function lastMonth(today){
  if(!dayOk(today))throw Error('Invalid local day');
  const [y,m]=today.slice(0,7).split('-').map(Number);
  return m===1?(y-1)+'-12':y+'-'+String(m-1).padStart(2,'0');
 }
 function validCompleted(month,today){return monthOk(month)&&dayOk(today)&&month<today.slice(0,7);}
 function next(month){
  if(!monthOk(month))throw Error('Invalid salary month');
  const [y,m]=month.split('-').map(Number);
  return m===12?(y+1)+'-01-01':y+'-'+String(m+1).padStart(2,'0')+'-01';
 }
 function summarize({restaurantId,employeeId,month,today,payments,closings,employee}){
  if(!restaurantId||!employeeId||!validCompleted(month,today)||
      !Array.isArray(payments)||!Array.isArray(closings)||employee?.id!==employeeId||
      employee?.restaurant_id!==restaurantId)throw Error('Employee, restaurant or past salary month mismatch');
  const end=next(month),monthDay=month+'-01',paidIds=new Set(),closeIds=new Set();
  let advances=0,taggedPaid=0,used=0,unassigned=0,selected=null;
  for(const p of payments){
   if(!p?.id||paidIds.has(p.id)||p.employee_id!==employeeId||p.restaurant_id!==restaurantId||
     !dayOk(p.payment_date)||!['Salary','Advance','Bonus','Deduction'].includes(p.payment_type))
    throw Error('Payment source mismatch or duplicate');
   paidIds.add(p.id);
   const value=cents(p.amount);
   if(value===null||value===0)throw Error('Invalid payment source amount');
   if(p.payment_type==='Advance'&&p.payment_date<end&&p.payment_date<=today)advances+=value;
   if(['Salary','Bonus'].includes(p.payment_type)){
    if(p.period_month===null||p.period_month===undefined){
     if(p.payment_date>=monthDay&&p.payment_date<end)unassigned++;
    }else if(!dayOk(p.period_month)||p.period_month.slice(8)!=='01')throw Error('Payment source has malformed salary month');
    if(p.period_month===monthDay&&p.payment_date<=today)taggedPaid+=value;
   }
  }
  for(const c of closings){
   if(!c?.id||closeIds.has(c.id)||c.employee_id!==employeeId||c.restaurant_id!==restaurantId||
      !dayOk(c.period_month)||c.period_month.slice(8)!=='01')throw Error('Closing source mismatch or duplicate');
   closeIds.add(c.id);
   const val=cents(c.advance_applied);
   if(val===null)throw Error('Invalid prior advance adjustment');
   used+=val;
   if(c.period_month===monthDay){
    if(selected)throw Error('Duplicate salary closing for the month');
    selected=c;
   }
  }
  if([advances,taggedPaid,used].some(x=>!Number.isSafeInteger(x)))throw Error('Source total exceeds safe limits');
  const available=Math.max(0,advances-used),beforeSelected=available+(selected?cents(selected.advance_applied):0);
  let due=null,overpaid=0;
  if(selected){
   const gross=cents(selected.approved_gross),bonus=cents(selected.approved_bonus),
     deduction=cents(selected.approved_deduction),adjusted=cents(selected.advance_applied);
   if([gross,bonus,deduction,adjusted].some(x=>x===null))throw Error('Corrupted approved salary snapshot');
   due=gross+bonus-deduction-adjusted-taggedPaid;
   overpaid=Math.max(0,-due);
   due=Math.max(0,due);
  }
  return {employee,month,today,advances,used,available,beforeSelected,taggedPaid,unassigned,
    closing:selected,due,overpaid,sourceCount:payments.length};
 }
 async function fullTable(client,table,restaurantId,employeeId,sortField,isCurrent,pageSize=250,maxRows=10000){
  if(!client?.from||!restaurantId||!employeeId||maxRows%pageSize!==0||pageSize<1||pageSize>500)
   throw Error('Invalid salary closing query scope');
  const all=[];let expected=null;
  for(let offset=0;offset<maxRows;offset+=pageSize){
   if(isCurrent?.()===false)throw Error('Closing view changed while loading sources');
   const {data,error,count}=await client.from(table).select('*',{count:'exact'}).eq('restaurant_id',restaurantId)
     .eq('employee_id',employeeId).order(sortField,{ascending:true}).order('id',{ascending:true})
     .range(offset,offset+pageSize-1);
   if(isCurrent?.()===false)throw Error('Closing view changed while loading sources');
   if(error)throw error;
   if(!Number.isSafeInteger(count)||count<0)throw Error('Salary source count unavailable');
   if(expected===null)expected=count;
   if(count!==expected)throw Error('Salary source changed during load. Refresh and review.');
   if(expected>maxRows)throw Error('Too many source records; no partial totals shown');
   if(!Array.isArray(data)||data.length!==Math.min(pageSize,expected-offset))throw Error('Incomplete salary source data');
   all.push(...data);
   if(all.length===expected)return all;
  }
  throw Error('Too many source records: salary preview hidden until full data can be verified');
 }
 async function load({client,restaurantId,employeeId,month,today,employee,isCurrent}){
  if(!validCompleted(month,today))throw Error('Only a completed month can be closed');
  const [payments,closings]=await Promise.all([
   fullTable(client,'restaurant_employee_payments',restaurantId,employeeId,'payment_date',isCurrent),
   fullTable(client,'restaurant_employee_salary_closings',restaurantId,employeeId,'period_month',isCurrent)
  ]);
  if(isCurrent?.()===false)throw Error('Closing scope changed');
  return summarize({restaurantId,employeeId,month,today,payments,closings,employee});
 }
 function proposal(report,{gross,bonus,deduction,advance,note}={}){
  if(!report||report.closing)throw Error('This month already has an approved salary closing');
  if(report.unassigned)throw Error('Unassigned salary/bonus payments need review before closing');
  const numbers=[gross,bonus,deduction,advance].map(cents);
  if(numbers.some(x=>x===null))throw Error('Enter valid amounts with up to two decimal places');
  const [g,b,d,a]=numbers;
  if(d>g+b)throw Error('Deductions cannot exceed approved gross salary and bonus');
  if(a>report.available)throw Error('Advance applied exceeds verified unused advances');
  if(d>0&&String(note||'').trim().length<8)throw Error('Explain the deduction in at least eight characters');
  const net=g+b-d-a-report.taggedPaid;
  if(net<0)throw Error('Approved earnings are lower than already recorded salary/bonus payments');
  return {grossCents:g,bonusCents:b,deductionCents:d,advanceCents:a,
   taggedPaidCents:report.taggedPaid,dueCents:net,note:String(note||'').trim()};
 }
 function summaryHtml(report){
  if(!report)return '<p role="status">Choose an employee and completed salary month.</p>';
  const cards=(label,c)=>'<div class="a10-metric"><small>'+esc(label)+'</small><strong>'+money(c)+'</strong></div>';
  let out='<div class="a10-metrics">'+
   cards('Verified advances to month end',report.advances)+
   cards('Already adjusted in closings',report.used)+
   cards('Unallocated advances now',report.available)+
   cards('Salary + bonus paid for month',report.taggedPaid)+'</div>'+
   '<p class="a10-help">Salary-month payments are matched by their recorded period. Advances are cash already given, not extra income or another payment. Only Owner approval applies an adjustment. No automated attendance deduction.</p>';
  if(report.unassigned)out+='<p class="a10-warning" role="alert">'+report.unassigned+' unassigned salary/bonus payment(s) need review. Closing is blocked.</p>';
  if(report.closing){
   const x=report.closing;
   out+='<div class="a10-closed"><strong>Approved salary closing · '+esc(report.month)+'</strong>'+
    '<p>Gross '+money(cents(x.approved_gross))+' · Earned bonus '+money(cents(x.approved_bonus))+
    ' · Approved deduction '+money(cents(x.approved_deduction))+
    ' · Advance applied '+money(cents(x.advance_applied))+'</p>'+
    '<p><strong>Currently recorded amount due: '+money(report.due)+'</strong>'+
    (report.overpaid?' · Additional recorded overpayment '+money(report.overpaid):'')+'</p>'+
    '<small>Approved '+esc(x.approved_at||'')+'. New payments recorded afterward change the displayed due, not the original approval.</small></div>';
  }else out+='<p class="a10-ready">No salary closing approved for '+esc(report.month)+'. Check the gross and advance balance, then preview and approve.</p>';
  return out;
 }
 const api={cents,money,dayOk,monthOk,lastMonth,validCompleted,next,summarize,fullTable,load,proposal,summaryHtml};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteV3SalaryClosing=api;
})(typeof window!=='undefined'?window:globalThis);
