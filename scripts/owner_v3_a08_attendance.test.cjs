'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const api=require('../assets/owner-v3-attendance.js');
const html=fs.readFileSync('index.html','utf8'),css=fs.readFileSync('assets/owner-v3-attendance.css','utf8');
const rid='262aaba7-f48b-4fa5-9ff6-b334ededca84',day='2026-10-01';
const employees=[
 {id:'p1',restaurant_id:rid,status:'Active',full_name:'Rani',position:'Waiter'},
 {id:'p2',restaurant_id:rid,status:'Active',full_name:'Bala',position:'Cook'},
 {id:'p3',restaurant_id:rid,status:'Active',full_name:'Aman',position:'Manager'},
 {id:'p4',restaurant_id:rid,status:'Inactive',full_name:'Earlier staff'}
];
const rows=[{id:'a1',restaurant_id:rid,attendance_date:day,employee_id:'p1',status:'Present',check_in:'10:00',check_out:'17:00'},
 {id:'a2',restaurant_id:rid,attendance_date:day,employee_id:'p2',status:'Half Day',check_in:'10:00'}];
test('October day is counted from saved status and leaves Not marked distinct from Absent',()=>{
 const s=api.summarize({employees,records:rows,date:day,restaurantId:rid});
 assert.equal(s.total,3);assert.equal(s.present,1);assert.equal(s.half,1);assert.equal(s.absent,0);
 assert.equal(s.notMarked,1);assert.equal(s.recorded,2);
 assert.equal(s.rows.find(x=>x.id==='p3').status,'Not marked');
 assert.match(api.html(s),/Not marked ka matlab absent nahi hai/);
});
test('Existing inactive employee attendance is not miscounted in active staff totals',()=>{
 const s=api.summarize({employees,records:[...rows,{id:'old',restaurant_id:rid,attendance_date:day,employee_id:'p4',status:'Present'}],date:day,restaurantId:rid});
 assert.equal(s.total,3);assert.equal(s.present,1);
});
test('Reject mismatched tenant, date, invalid status, repeated employee or unknown staff',()=>{
 for(const invalid of [
  [{...rows[0],restaurant_id:'other'}],
  [{...rows[0],attendance_date:'2026-10-02'}],
  [{...rows[0],status:'Overtime'}],
  [rows[0],{...rows[0],id:'different'}],
  [{...rows[0],employee_id:'unknown'}]
 ])assert.throws(()=>api.summarize({employees,records:invalid,date:day,restaurantId:rid}));
 assert.equal(api.iso('2026-02-30'),false);assert.equal(api.iso(day),true);
});
test('Use restaurant/date exact query with paginated verified results and stale guard',async()=>{
 const calls=[];
 const client={from(table){calls.push(['from',table]);return builder}};
 const builder={
  select(...a){calls.push(['select',...a]);return this},
  eq(...a){calls.push(['eq',...a]);return this},
  order(...a){calls.push(['order',...a]);return this},
  range(a,b){calls.push(['range',a,b]);return Promise.resolve({data:rows.slice(a,b+1),error:null})}
 };
 const result=await api.load({client,restaurantId:rid,date:day,pageSize:2,maxRows:4,isCurrent:()=>true});
 assert.equal(result.length,2);
 assert.ok(calls.some(x=>x[0]==='eq'&&x[1]==='restaurant_id'&&x[2]===rid));
 assert.ok(calls.some(x=>x[0]==='eq'&&x[1]==='attendance_date'&&x[2]===day));
 assert.ok(calls.some(x=>x[0]==='range'&&x[1]===2));
 await assert.rejects(()=>api.load({client,restaurantId:rid,date:day,isCurrent:()=>false}));
 await assert.rejects(()=>api.load({client,restaurantId:rid,date:day,pageSize:1,maxRows:2}));
});
test('Escape employee names and position before rendering employee buttons',()=>{
 const malicious={...employees[0],full_name:'<img src=x onerror=evil()>',position:'<b>Boss</b>'};
 const s=api.summarize({employees:[malicious],records:[],restaurantId:rid,date:day});
 const markup=api.html(s);
 assert.ok(markup.includes('&lt;img'));assert.ok(markup.includes('&lt;b&gt;'));
 assert.ok(!markup.includes('<img'));assert.ok(!markup.includes('<b>'));
});
test('Existing employee/leave/payroll functions remain available, but selected day is fully server scoped',()=>{
 for(const word of ["id=\"hrAttendanceRegister\"",'BiteV3Attendance.load','loadHRAttendanceDay','hrLoadVersion',
  'restaurant_employee_payments',"data-v3-attendance-employee","owner-v3-attendance.js?v="])
  assert.ok(html.includes(word),word);
 assert.match(html,/\.eq\('restaurant_id',rid\)\s*\.eq\('employee_id',eid\)\s*\.eq\('attendance_date',date\)/);
 assert.match(css,/@media\(max-width:430px\)/);
 const source=fs.readFileSync('assets/owner-v3-attendance.js','utf8');
 assert.doesNotMatch(source,/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
});
