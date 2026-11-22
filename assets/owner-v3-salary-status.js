/* Owner V3 A13 — read-only source-verified monthly salary status board.
 * No wages are estimated for months without an approved A10 closing.
 * No cashbook/payment/closing writes. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const monthOK=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
 const dayOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
    !Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 const nextMonth=m=>{if(!monthOK(m))throw Error('Invalid salary month');
   const [y,mo]=m.split('-').map(Number);
   return mo===12?(y+1)+'-01-01':y+'-'+String(mo+1).padStart(2,'0')+'-01';};
 const cents=n=>{if(!(typeof n==='number'||typeof n==='string'&&/^\d+(?:\.\d{1,2})?$/.test(n.trim()))||!Number.isFinite(Number(n)))return null;
   const v=Number(n);if(v<0||v>99999999.99||Math.abs(v*100-Math.round(v*100))>1e-6)return null;
   return Math.round(v*100);};
 const money=c=>'₹'+(c/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const statusLabel={
  paid:'Paid',partial:'Partially paid',unpaid:'Unpaid',
  adjusted:'Settled by adjustments',open:'Not closed',review:'Needs review'
 };
 async function pageAll({client,table,fields,restaurantId,filters=[],isCurrent,pageSize=250,maxRows=10000}){
  if(!client?.from||!restaurantId||!Number.isInteger(pageSize)||pageSize<1||pageSize>500||
     !Number.isInteger(maxRows)||maxRows<pageSize||maxRows%pageSize)throw Error('Invalid salary status query');
  const rows=[];let expected=null;
  for(let offset=0;offset<maxRows;offset+=pageSize){
   if(isCurrent?.()===false)throw Error('Salary status scope changed');
   let q=client.from(table).select(fields,{count:'exact'}).eq('restaurant_id',restaurantId);
   for(const [method,...args] of filters)q=q[method](...args);
   const {data,error,count}=await q.order('id',{ascending:true}).range(offset,offset+pageSize-1);
   if(isCurrent?.()===false)throw Error('Salary status scope changed');
   if(error)throw error;
   if(!Number.isSafeInteger(count)||count<0)throw Error('Salary source count unavailable');
   if(expected===null)expected=count;
   if(count!==expected)throw Error('Salary source changed during load. Refresh and review.');
   if(expected>maxRows)throw Error('Salary status source limit reached; no partial totals shown');
   if(!Array.isArray(data)||data.length!==Math.min(pageSize,expected-offset))throw Error('Incomplete salary source data');
   rows.push(...data);
   if(rows.length===expected)return rows;
  }
  throw Error('Salary status source limit reached; no partial totals shown');
 }
 function summarize({restaurantId,month,today,employees,closings,payments,unassigned=[]}){
  if(!restaurantId||!monthOK(month)||!dayOK(today)||month>today.slice(0,7)||
   ![employees,closings,payments,unassigned].every(Array.isArray))
   throw Error('Invalid salary status source scope');
  const end=nextMonth(month),first=month+'-01';
  const employeeMap=new Map(),closingMap=new Map(),amounts=new Map(),unassignedMap=new Map();
  const sets=[new Set(),new Set(),new Set(),new Set()];
  function validSource(row,arr,table){
   if(!row?.id||arr.has(row.id)||row.restaurant_id!==restaurantId)
     throw Error('Duplicate or cross-restaurant '+table+' record');
   arr.add(row.id);
  }
  for(const row of employees){
   validSource(row,sets[0],'employee');
   if(!dayOK(row.joining_date)||typeof row.full_name!=='string')
     throw Error('Incomplete employee joining date or name');
   employeeMap.set(row.id,row);
  }
  for(const row of closings){
   validSource(row,sets[1],'salary closing');
   if(row.period_month!==first||!employeeMap.has(row.employee_id)||closingMap.has(row.employee_id))
     throw Error('Invalid salary closing period, employee, or duplicate approval');
   const gross=cents(row.approved_gross),bonus=cents(row.approved_bonus),
    deduction=cents(row.approved_deduction),advance=cents(row.advance_applied);
   if([gross,bonus,deduction,advance].some(x=>x===null)||deduction+advance>gross+bonus)
     throw Error('Invalid approved salary figures');
   closingMap.set(row.employee_id,{row,entitlement:gross+bonus-deduction-advance});
  }
  for(const row of payments){
   validSource(row,sets[2],'payment');
   if(row.period_month!==first||!employeeMap.has(row.employee_id)||
     !['Salary','Bonus'].includes(row.payment_type)||!dayOK(row.payment_date))
     throw Error('Invalid salary payment source');
   const n=cents(row.amount);if(n===null||n===0)throw Error('Invalid paid amount');
   const current=amounts.get(row.employee_id)||{total:0,count:0,lastDate:'',future:false};
   current.total+=n;current.count++;
   if(!Number.isSafeInteger(current.total))throw Error('Salary paid total exceeds safe bounds');
   if(row.payment_date>current.lastDate)current.lastDate=row.payment_date;
   if(row.payment_date>today)current.future=true;
   amounts.set(row.employee_id,current);
  }
  for(const row of unassigned){
   validSource(row,sets[3],'unassigned payment');
   if(row.period_month!==null||row.payment_date<first||row.payment_date>=end||
      !dayOK(row.payment_date)||!employeeMap.has(row.employee_id)||
      !['Salary','Bonus'].includes(row.payment_type))
     throw Error('Invalid unassigned salary payment');
   const n=cents(row.amount);if(n===null||n===0)throw Error('Invalid unassigned amount');
   unassignedMap.set(row.employee_id,(unassignedMap.get(row.employee_id)||0)+1);
  }
  const entries=[],stats={paid:0,partial:0,unpaid:0,adjusted:0,open:0,review:0};
  let approvedCents=0,paidCents=0,remainingCents=0,approvedCount=0,uncertainCount=0;
  const sorted=[...employeeMap.values()].filter(x=>x.joining_date<end)
    .sort((a,b)=>a.full_name.localeCompare(b.full_name,'en')||a.id.localeCompare(b.id));
  for(const employee of sorted){
   const c=closingMap.get(employee.id),p=amounts.get(employee.id)||{total:0,count:0,lastDate:'',future:false};
   const unassignedCount=unassignedMap.get(employee.id)||0;
   let status='open',remaining=null,approved=null;
   if(c){
    approvedCount++;approved=c.entitlement;remaining=approved-p.total;
    if(p.future||remaining<0||unassignedCount)status='review';
    else if(approved===0&&p.total===0)status='adjusted';
    else if(p.total===approved)status='paid';
    else if(p.total===0)status='unpaid';
    else status='partial';
    if(status!=='review'){
     approvedCents+=approved;paidCents+=p.total;remainingCents+=remaining;
    }else uncertainCount++;
   }else if(unassignedCount||p.future){
    status='review';uncertainCount++;
   }
   if(status!=='review'&&!c&&p.total>0)status='open'; // recorded payment alone is not an approved closing.
   stats[status]++;
   entries.push({employee,status,approved,paid:p.total,remaining,closeId:c?.row.id||null,
     latestPayment:p.lastDate,count:p.count,unassignedCount});
  }
  if([approvedCents,paidCents,remainingCents].some(x=>!Number.isSafeInteger(x)))
   throw Error('Approved salary totals exceed safe bounds');
  return {month,entries,stats,approvedCents,paidCents,remainingCents,
   approvedCount,uncertainCount,staffCount:entries.length,unassignedCount:unassigned.length};
 }
 async function load({client,restaurantId,month,today,isCurrent}){
  if(!monthOK(month)||!dayOK(today)||month>today.slice(0,7)||!restaurantId)
    throw Error('Choose a valid present or past salary month');
  const first=month+'-01',after=nextMonth(month),r=restaurantId;
  const [employees,closings,payments,unassigned]=await Promise.all([
   pageAll({client,table:'restaurant_employees',fields:'id,restaurant_id,full_name,employee_code,status,joining_date',
    restaurantId:r,isCurrent}),
   pageAll({client,table:'restaurant_employee_salary_closings',
    fields:'id,restaurant_id,employee_id,period_month,approved_gross,approved_bonus,approved_deduction,advance_applied,approved_at',
    restaurantId:r,filters:[['eq','period_month',first]],isCurrent}),
   pageAll({client,table:'restaurant_employee_payments',
    fields:'id,restaurant_id,employee_id,period_month,payment_date,payment_type,amount',
    restaurantId:r,filters:[['eq','period_month',first],['in','payment_type',['Salary','Bonus']]],isCurrent}),
   pageAll({client,table:'restaurant_employee_payments',
    fields:'id,restaurant_id,employee_id,period_month,payment_date,payment_type,amount',
    restaurantId:r,filters:[['is','period_month',null],['gte','payment_date',first],
       ['lt','payment_date',after],['in','payment_type',['Salary','Bonus']]],isCurrent})
  ]);
  if(isCurrent?.()===false)throw Error('Salary status scope changed');
  return summarize({restaurantId:r,month,today,employees,closings,payments,unassigned});
 }
 function render(report){
  if(!report)return '<p>No verified salary statement available.</p>';
  const metric=(label,value)=>'<div class="a13-metric"><span>'+esc(label)+'</span><strong>'+esc(String(value))+'</strong></div>';
  const st=report.stats;
  let html='<div class="a13-overview">'+
   metric('Paid',st.paid)+metric('Partially paid',st.partial)+metric('Unpaid',st.unpaid)+
   metric('Settled by adjustment',st.adjusted)+metric('Not closed',st.open)+metric('Needs review',st.review)+'</div>'+
   '<p class="a13-accounted">Verified remaining due from approved, consistent closings only: <strong>'+money(report.remainingCents)+'</strong></p>'+
   '<p class="a13-help">Only saved Salary/Bonus payments linked to this salary month count as paid. Approved advances and deductions were already applied in the closing, never paid again. Unapproved months have <b>no calculated due</b>. Records needing review are excluded from the total.</p>'+
   (report.unassignedCount?'<p class="a13-alert" role="alert">'+report.unassignedCount+' salary/bonus payment(s) have no salary month assigned. Check their period before relying on the status.</p>':'');
  if(!report.entries.length)return html+'<p class="a13-empty">No staff had joined by this selected month.</p>';
  html+='<div class="a13-list">'+report.entries.map(x=>{
   const detail=x.status==='review'?'Review unexpected or unassigned payments':
     !x.closeId?'No approved closing. Amount due is not calculated.':
     'Approved '+money(x.approved)+' · Recorded salary/bonus '+money(x.paid);
   return '<article class="a13-person"><div class="a13-person-head"><div><strong>'+esc(x.employee.full_name)+'</strong>'+
    '<small>'+esc(x.employee.employee_code||'Staff')+' · '+esc(x.employee.status||'Status unavailable')+'</small></div>'+
    '<span class="a13-state a13-'+x.status+'">'+esc(statusLabel[x.status])+'</span></div>'+
    '<div class="a13-detail">'+detail+'</div>'+
    '<div class="a13-person-footer"><span>Remaining: <strong>'+(x.remaining===null||x.status==='review'?'Not verified':money(Math.max(0,x.remaining)))+'</strong></span>'+
    '<span>'+x.count+' salary/bonus record(s)'+(x.latestPayment?' · Last '+esc(x.latestPayment):'')+'</span></div></article>';
  }).join('')+'</div>';
  return html;
 }
 const api={monthOK,dayOK,nextMonth,cents,money,pageAll,summarize,load,render,statusLabel};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BiteV3SalaryStatus=api;
})(typeof window!=='undefined'?window:globalThis);
