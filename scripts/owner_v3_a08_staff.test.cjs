'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const api=require('../assets/owner-v3-staff.js');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('assets/owner-v3-staff.css','utf8');
const tabs=fs.readFileSync('assets/owner-hr-mobile-tabs.js','utf8');
const rid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const a='33333333-3333-4333-8333-333333333333',b='44444444-4444-4444-8444-444444444444';
const rows=[{id:a,restaurant_id:rid,full_name:'Asha Kumari',employee_code:'EMP-01',phone:'9876543210',position:'Reception',status:'Active',salary_amount:10000},
 {id:b,restaurant_id:rid,full_name:'Ravi Singh',employee_code:'EMP-02',phone:'9999999999',position:'Cook',status:'Inactive',salary_amount:12000},
 {id:'55555555-5555-4555-8555-555555555555',restaurant_id:other,full_name:'Other owner',employee_code:'EMP-03',status:'Active'}];
const attendance=[{employee_id:a,restaurant_id:rid,attendance_date:'2026-10-01',status:'Half Day'},
 {employee_id:b,restaurant_id:rid,attendance_date:'2026-10-01',status:'Present'},
 {employee_id:a,restaurant_id:other,attendance_date:'2026-10-01',status:'Absent'}];
test('A08: normalized duplicate code, 10-digit phone and name trigger review; editing self excluded',()=>{
 assert.equal(api.duplicates(rows,{employee_code:' emp-01 ',full_name:'Different'},null).length,1);
 assert.equal(api.duplicates(rows,{phone:'+91 98765 43210'},null).length,1);
 assert.equal(api.duplicates(rows,{full_name:'  ASHA   kumari '},null).length,1);
 assert.equal(api.duplicates(rows,{full_name:'Asha Kumari',employee_code:'EMP-01'},a).length,0);
});
test('A08: selected business date shows actual saved status, no other tenant or false month count',()=>{
 assert.equal(api.dayOK('2026-10-01'),true);
 assert.equal(api.dayOK('2026-02-30'),false);
 const d=api.attendanceDay(rows,attendance,'2026-10-01',rid);
 assert.deepEqual(d.map(x=>x.employee.id),[a,b]);
 assert.equal(d[0].entry.status,'Half Day');
 assert.equal(d[1].entry.status,'Present');
 const next=api.attendanceDay(rows,attendance,'2026-10-02',rid);
 assert.equal(next.length,1);assert.equal(next[0].entry,null);
});
test('A08: active/inactive search and source-backed card actions',()=>{
 const active=api.filteredEmployees(rows,rid,'asha','active');
 assert.equal(active.length,1);assert.equal(active[0].id,a);
 assert.equal(api.filteredEmployees(rows,rid,'ravi','active').length,0);
 assert.equal(api.filteredEmployees(rows,rid,'ravi','inactive')[0].id,b);
 const card=api.employeeHTML(rows,attendance,{restaurantId:rid,day:'2026-10-01',query:'',filter:'active',owner:true});
 assert.match(card,/Half Day/);assert.match(card,/Deactivate/);assert.doesNotMatch(card,/Other owner/);
 const manager=api.employeeHTML(rows,attendance,{restaurantId:rid,day:'2026-10-01',filter:'active',owner:false});
 assert.doesNotMatch(manager,/Deactivate/);
});
test('A08: escapes dangerous employee data and never creates a new HR/payment ledger',()=>{
 const inj=[{...rows[0],full_name:'<img src=x onerror=alert(1)>',position:'<b>Cook</b>'}];
 const content=api.employeeHTML(inj,[],{restaurantId:rid,day:'2026-10-01',owner:true});
 assert.doesNotMatch(content,/<img|<b>/);assert.match(content,/&lt;img/);
 const source=fs.readFileSync('assets/owner-v3-staff.js','utf8');
 assert.doesNotMatch(source,/\.\s*(?:insert|update|upsert|delete|rpc)\s*\(/);
});
test('A08: original Owner HR backend retained, hard-delete removed, attendance update scoped and reviewed',()=>{
 assert.match(html,/function deleteHREmployee\(id\)/);
 const start=html.indexOf('async function deleteHREmployee(id){'),end=html.indexOf('async function saveHRAttendance(){',start);
 assert.ok(start>0&&end>start);
 const deactivate=html.slice(start,end);
 assert.match(deactivate,/update\(\{status:'Inactive'\}\)/);
 assert.match(deactivate,/\.eq\('restaurant_id',rid\)/);
 assert.match(deactivate,/\.eq\('status','Active'\)/);
 assert.doesNotMatch(deactivate,/\.delete\s*\(/);
 const att=html.slice(end,html.indexOf('async function saveHRLeave(){',end));
 assert.match(att,/\.eq\('restaurant_id',rid\)/);
 assert.match(att,/\.eq\('updated_at',before.updated_at\)/);
 assert.match(att,/Correction/);assert.match(att,/prompt\('Existing attendance correction/);
 const leave=html.slice(html.indexOf('async function reviewHRLeave(id,status){'),html.indexOf('async function saveHREmployeePayment(){'));
 assert.match(leave,/\.eq\('status','Pending'\)/);
 assert.ok(leave.includes("approved_by:status==='Approved'?userId:null"));
 assert.match(leave,/prompt\('Leave '/);
});
test('A08: existing history and payroll kept; selected date query reads real server rows',()=>{
 assert.match(html,/id="hrV3EmployeeCards"/);
 assert.match(html,/id="hrV3AttendanceDay"/);
 assert.match(html,/id="hrV3Search"/);
 assert.match(html,/restaurant_employee_attendance'\)\.select\('\*'\)\.eq\('restaurant_id',rid\)\.eq\('attendance_date',day\)/);
 assert.match(html,/restaurant_employee_payments/);
 assert.match(html,/data-a08-history="payment"/);
 assert.match(tabs,/page\.dataset\.v3HrTask=name/);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.match(html,/owner-v3-staff\.js\?v=20261119-a08-hr1/);
});
