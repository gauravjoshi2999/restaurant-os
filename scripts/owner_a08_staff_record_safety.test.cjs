'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const section=(a,b)=>{const start=html.indexOf(a),end=html.indexOf(b,start+1);assert.ok(start>0&&end>start);return html.slice(start,end)};
test('A08 employee deactivation keeps prior attendance, leave, payroll and khata records untouched',()=>{
 const code=section('async function deleteHREmployee(id){','async function saveHRAttendance(){');
 assert.match(code,/update\(\{status:'Inactive'\}\)/);
 assert.match(code,/\.eq\('restaurant_id',rid\)\.eq\('status','Active'\)/);
 assert.match(code,/data\?\.length!==1/);
 assert.doesNotMatch(code,/\.delete\(/);
 assert.match(html,/>Deactivate<\/button>/);
});
test('A08 correction validates selected business date and preserves previous snapshot and reason',()=>{
 const code=section('async function saveHRAttendance(){','async function saveHRLeave(){');
 assert.match(code,/date>localDateInput\(\)/);
 assert.match(code,/getElementById\('hrAttendanceDate'\)/);
 assert.match(code,/reason\.length<5/);
 assert.match(code,/Previously/);
 assert.match(code,/\.eq\('updated_at',before.updated_at\)/);
 assert.match(code,/\.eq\('attendance_date',date\)/);
 assert.match(code,/currentUser\?\.id!==userId/);
 assert.match(code,/message\.dataset\.saving/);
 assert.doesNotMatch(code,/\.upsert\(/);
});
test('A08 leave reviewer cannot overwrite a completed decision or treat rejection as approval',()=>{
 const code=section('async function reviewHRLeave(id,status){','async function saveHREmployeePayment(){');
 assert.match(code,/row=hrLeaves\.find\(/);
 assert.match(code,/reason \(required\)/);
 assert.match(code,/\.eq\('status','Pending'\)/);
 assert.match(code,/approved_by:status==='Approved'\?userId:null/);
 assert.match(code,/if\(data\?\.length!==1\)/);
});
test('A08 compensation and payment flows are unchanged in the existing Owner app',()=>{
 assert.match(html,/async function saveHREmployeePayment\(\)/);
 assert.match(html,/restaurant_employee_payments/);
 assert.match(html,/restaurant_employee_attendance/);
 assert.match(html,/restaurant_employee_leaves/);
});
