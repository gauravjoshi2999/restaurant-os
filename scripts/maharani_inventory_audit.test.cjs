'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');

const sql=fs.readFileSync('docs/sql/maharani_inventory_readonly_20261125.sql','utf8');
const script=fs.readFileSync('scripts/maharani_image_network_audit.py','utf8');
const report=fs.readFileSync('docs/launch/MAHARANI_INVENTORY_RECONCILIATION_B005_20261125.md','utf8');
const restaurant='262aaba7-f48b-4fa5-9ff6-b334ededca84';

test('B005 production audit queries are SELECT only and tenant scoped',()=>{
 assert.match(sql,/READ-ONLY/);
 const uncommented=sql.split('\n').filter(line=>!/^\s*--/.test(line)).join('\n');
 const statements=uncommented.split(';').map(x=>x.trim()).filter(Boolean);
 assert.ok(statements.length>=5);
 for(const statement of statements)assert.match(statement,/^(WITH|SELECT)\b/i);
 assert.doesNotMatch(uncommented,/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT|REVOKE|CREATE|DO|CALL)\b/i);
 assert.ok(sql.split(restaurant).length>=4,'all business reports are property-scoped');
 assert.match(sql,/p\.origin_restaurant_id=/);
 assert.doesNotMatch(sql,/auth\.users|bite_guest_documents|order_financials|cashfree/i);
});
test('photo audit defaults to serial bounded checks and does not write production data',()=>{
 assert.match(script,/parser\.add_argument\("--concurrency",type=int,default=1/);
 assert.match(script,/parser\.add_argument\("--delay-ms",type=int,default=900/);
 assert.match(script,/if not 1<=args\.concurrency<=2/);
 assert.match(script,/if not 250<=args\.delay_ms<=5000/);
 assert.match(script,/partial_bounded/);
 assert.match(script,/snapshot_verified_against_live_db_on/);
 assert.doesNotMatch(script,/\bsupabase\b.*\b(insert|update|delete|upsert)\b/i);
 const py=spawnSync('python3',['-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:script,encoding:'utf8'});
 assert.equal(py.status,0,py.stderr||'Python image audit must be syntactically valid');
});
test('source parity is distinguished from missing owner approval',()=>{
 assert.match(report,/PDF rows parsed: \*\*92\*\*/);
 assert.match(report,/Price mismatches: \*\*0\*\*/);
 assert.match(report,/Availability mismatches: \*\*0\*\*/);
 assert.match(report,/21\*\* historic photo-credit names/);
 assert.match(report,/cannot authorize restoration/);
 assert.match(report,/7 configured and 7 active/);
 assert.match(report,/No menu\/room\/publication\/price/);
});
