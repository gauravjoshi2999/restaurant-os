const {test}=require('node:test');const assert=require('node:assert/strict');
require('../assets/owner-hospitality.js');
const rows=globalThis.BiteHospitality.reservationRows;
const fs=require('node:fs');const html=fs.readFileSync('index.html','utf8');
const stays=[
 {id:'old',status:'checked_out',arrival:'2026-10-01',departure:'2026-10-02'},
 {id:'late',status:'reserved',arrival:'2026-11-17',departure:'2026-11-18'},
 {id:'today',status:'reserved',arrival:'2026-11-19',departure:'2026-11-21'},
 {id:'future',status:'reserved',arrival:'2026-11-22',departure:'2026-11-23'},
 {id:'cancel',status:'cancelled',arrival:'2026-11-20'},
 {id:'no-show',status:'no_show',arrival:'2026-11-17'}
];
test('H11 reservation tabs include only intended status/date groups without data mutation',()=>{
 const original=JSON.stringify(stays),ids=view=>rows(stays,view,'2026-11-19').map(s=>s.id);
 assert.deepEqual(ids('upcoming'),['today','future']);
 assert.deepEqual(ids('arrivals'),['late','today']);
 assert.deepEqual(ids('cancelled'),['no-show','cancel']);
 assert.deepEqual(ids('all'),['old','late','no-show','today','cancel','future']);
 assert.deepEqual(ids('bogus'),[]);
 assert.equal(JSON.stringify(stays),original);
});
test('H11 empty status views are safe',()=>{assert.deepEqual(rows([], 'upcoming','2026-11-19'),[]);assert.deepEqual(rows(null,'all','2026-11-19'),[])});

test('H11 serves updated hotel code rather than a stale cache URL',()=>assert.match(html,/owner-hospitality\.js\?v=20261119-h11-reservation-filter1/));
