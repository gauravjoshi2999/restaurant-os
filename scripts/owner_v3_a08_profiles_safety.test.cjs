'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const p=require('../assets/owner-v3-employee-profiles.js');
const html=fs.readFileSync('index.html','utf8'),css=fs.readFileSync('assets/owner-v3-employee-profiles.css','utf8');
const a='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const one='33333333-3333-4333-8333-333333333333',two='44444444-4444-4444-8444-444444444444';
const rows=[
 {id:one,restaurant_id:a,full_name:'Asha Kumar',employee_code:'ST-01',position:'Reception',phone:'9876543210',status:'Active'},
 {id:two,restaurant_id:a,full_name:'Ravi Singh',employee_code:'ST-02',position:'Cook',status:'Inactive'},
 {id:'55555555-5555-4555-8555-555555555555',restaurant_id:other,full_name:'Foreign tenant',status:'Active'}];
test('A08 profiles: duplicate code, normalized name and phone require owner review',()=>{
 assert.equal(p.duplicates(rows,{employee_code:' st-01 '}).length,1);
 assert.equal(p.duplicates(rows,{full_name:' ASHA   KUMAR '}).length,1);
 assert.equal(p.duplicates(rows,{phone:'+91 98765 43210'}).length,1);
 assert.equal(p.duplicates(rows,{phone:'9876543210'},one).length,0);
});
test('A08 profiles: active/inactive status, tenant and search are canonical',()=>{
 assert.deepEqual(p.filter(rows,a,'asha','active').map(x=>x.id),[one]);
 assert.deepEqual(p.filter(rows,a,'ravi','inactive').map(x=>x.id),[two]);
 assert.equal(p.filter(rows,a,'foreign','all').length,0);
 assert.equal(p.filter(rows,a,'cook','active').length,0);
});
test('A08 profiles: attendance state comes only from verified date report; no invented absence',()=>{
 const opt={restaurantId:a,visibility:'active',day:'2026-10-01'};
 assert.match(p.html(rows,{...opt,verifiedDay:null}),/Attendance not verified/);
 assert.match(p.html(rows,{...opt,verifiedDay:{date:'2026-10-02',rows:[{id:one,status:'Absent'}]}}),/Attendance not verified/);
 const verified=p.html(rows,{...opt,verifiedDay:{date:opt.day,rows:[{id:one,status:'Half Day'}]}});
 assert.match(verified,/Half Day/);assert.doesNotMatch(verified,/Foreign tenant/);
});
test('A08 profiles: escaped user fields and no backend writes in presentation module',()=>{
 const content=p.html([{...rows[0],full_name:'<img onerror=alert(1)>',position:'<script>'}],{restaurantId:a});
 assert.doesNotMatch(content,/<script>|<img/);assert.match(content,/&lt;script&gt;/);
 assert.doesNotMatch(fs.readFileSync('assets/owner-v3-employee-profiles.js','utf8'),/\.\s*(?:insert|update|upsert|delete|rpc)\s*\(/);
});
test('A08 safety: use original attendance engine, deactivate instead of delete and protect corrections',()=>{
 assert.match(html,/owner-v3-attendance\.js\?v=20261119-a08-1/);
 assert.match(html,/id="hrAttendanceRegister"/);
 assert.match(html,/id="hrProfileSearch"/);
 assert.match(html,/owner-v3-employee-profiles\.js\?v=20261119-a08p-1/);
 const d=html.slice(html.indexOf('async function deleteHREmployee(id){'),html.indexOf('async function saveHRAttendance(){'));
 assert.match(d,/update\(\{status:'Inactive'\}\)/);assert.match(d,/\.eq\('restaurant_id',rid\)/);
 assert.doesNotMatch(d,/\.delete\s*\(/);
 const att=html.slice(html.indexOf('async function saveHRAttendance(){'),html.indexOf('async function saveHRLeave(){'));
 assert.match(att,/prompt\('Attendance correction/);assert.match(att,/\.eq\('updated_at',old.updated_at\)/);
 assert.match(att,/Correction/);assert.match(att,/\.eq\('restaurant_id',rid\)/);
 const leave=html.slice(html.indexOf('async function reviewHRLeave(id,status){'),html.indexOf('async function saveHREmployeePayment(){'));
 assert.match(leave,/\.eq\('status','Pending'\)/);
 assert.ok(leave.includes("approved_by:status==='Approved'?userId:null"));
 assert.match(leave,/prompt\('Leave '/);
});
test('A08 profile card buttons are accessible at mobile widths while employee form remains visible',()=>{
 assert.match(css,/@media\(max-width:430px\)/);
 assert.match(css,/min-height:44px/);
 assert.match(html,/id="hrEmployeeName"/);
 assert.match(html,/id="hrEmployeeSaveBtn"/);
 assert.doesNotMatch(css,/#hrEmployeePanel:not\(\.v3-a08-editing\)/);
});
