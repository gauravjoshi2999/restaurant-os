/* Owner V3 A09: tenant-scoped, read-only monthly HR payment statement.
 * Never posts payroll, expenses, Cashbook entries or salary liabilities. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=c=>'₹'+(c/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 const validMonth=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
 const types=['Salary','Advance','Bonus','Deduction'];
 function cents(v){
  const n=Number(v);
  if(v===null||v===undefined||v===''||!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>1e-6)return null;
  return Math.round(n*100);
 }
 function nextMonth(month){
  if(!validMonth(month))throw Error('Invalid month');
  const [year,mo]=month.split('-').map(Number);
  return mo===12?(year+1)+'-01-01':year+'-'+String(mo+1).padStart(2,'0')+'-01';
 }
 async function load({client,restaurantId,month,mode='salary',isCurrent,pageSize=250,maxRows=10000}){
  if(!client?.from||!restaurantId||!validMonth(month)||!['salary','paid'].includes(mode)||
   !Number.isInteger(pageSize)||pageSize<1||pageSize>500||!Number.isInteger(maxRows)||maxRows<pageSize||maxRows%pageSize)
   throw Error('Invalid payment report scope or date');
  const rows=[],first=month+'-01',after=nextMonth(month);
  for(let offset=0;offset<maxRows;offset+=pageSize){
   if(isCurrent?.()===false)throw Error('HR payment report scope changed');
   let query=client.from('restaurant_employee_payments')
    .select('id,restaurant_id,employee_id,payment_date,period_month,payment_type,amount,payment_method,reference,notes,created_at')
    .eq('restaurant_id',restaurantId);
   query=mode==='salary'?query.eq('period_month',first):
    query.gte('payment_date',first).lt('payment_date',after);
   const {data,error}=await query.order('payment_date',{ascending:false}).order('id',{ascending:true}).range(offset,offset+pageSize-1);
   if(isCurrent?.()===false)throw Error('HR payment report scope changed');
   if(error)throw error;
   if(!Array.isArray(data))throw Error('Incomplete HR payment data');
   rows.push(...data);
   if(data.length<pageSize)return summarize(rows,{restaurantId,month,mode});
  }
  throw Error('Over 10,000 HR records: cannot verify full report. Narrow the date before using totals.');
 }
 function summarize(rows,{restaurantId,month,mode}){
  if(!Array.isArray(rows)||!restaurantId||!validMonth(month)||!['salary','paid'].includes(mode))
   throw Error('Invalid HR statement');
  const ids=new Set(),totals=Object.fromEntries(types.map(t=>[t,0])),byEmployee=new Map();
  const clean=rows.map(row=>{
   if(!row?.id||ids.has(row.id)||row.restaurant_id!==restaurantId||!row.employee_id||
    !types.includes(row.payment_type)||!validDay(row.payment_date)||
    (row.period_month!==null&&row.period_month!==undefined&&!validDay(row.period_month))||
    (mode==='salary'?row.period_month!==month+'-01':row.payment_date.slice(0,7)!==month))
    throw Error('Invalid HR payment source or mixed restaurant data');
   const amount=cents(row.amount);
   if(amount===null||amount<=0)throw Error('Invalid recorded employee payment amount');
   ids.add(row.id);totals[row.payment_type]+=amount;
   const item=byEmployee.get(row.employee_id)||{employeeId:row.employee_id,count:0,totals:Object.fromEntries(types.map(t=>[t,0]))};
   item.count++;item.totals[row.payment_type]+=amount;byEmployee.set(row.employee_id,item);
   return {...row,amountCents:amount};
  }).sort((a,b)=>b.payment_date.localeCompare(a.payment_date)||String(a.id).localeCompare(String(b.id)));
  if(Object.values(totals).some(n=>!Number.isSafeInteger(n)))throw Error('Totals exceed safe bounds');
  return {month,mode,count:clean.length,totals,rows:clean,employees:[...byEmployee.values()]};
 }
 function html(report,employees=[]){
  if(!report?.rows)return '<p role="alert">Staff payment statement unavailable.</p>';
  const names=new Map((Array.isArray(employees)?employees:[]).map(x=>[x.id,x.full_name]));
  const metric=(title,amount)=>'<div><small>'+title+'</small><strong>'+money(amount)+'</strong></div>';
  return '<div class="v3-pay-head"><h3>Staff payment statement</h3><small>'+esc(report.month)+' · '+(report.mode==='salary'?'Salary month':'Actual payment month')+'</small></div>'+
   '<div class="v3-pay-metrics">'+types.map(t=>metric(t,report.totals[t])).join('')+'</div>'+
   '<p class="v3-pay-help">These are saved HR records, not an automatic payroll calculation. Salary month and actual payment date may differ. Deduction is a recorded adjustment, not money paid. Do not add these figures again to Cashbook or mark salary due from them.</p>'+
   (report.count?'<div class="v3-pay-list">'+report.rows.map(r=>
    '<article class="v3-pay-row"><div><strong>'+esc(names.get(r.employee_id)||'Employee record unavailable')+'</strong><small>Paid date: '+esc(r.payment_date)+' · For month: '+esc(r.period_month?.slice(0,7)||'Not assigned')+'</small></div>'+
    '<div><span>'+esc(r.payment_type)+'</span><strong>'+money(r.amountCents)+'</strong><small>'+esc(r.payment_method||'Method not recorded')+'</small></div>'+
    '<small>'+esc(r.reference||'No reference')+'</small></article>').join('')+'</div>':'<p class="v3-pay-empty">No saved HR payment records for this selection.</p>')+
   '<p class="v3-pay-count">'+report.count+' verified record(s). Historical employees are kept in the statement.</p>';
 }
 const api={validDay,validMonth,nextMonth,cents,load,summarize,html};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteV3StaffPayments=api;
})(typeof window!=='undefined'?window:globalThis);
