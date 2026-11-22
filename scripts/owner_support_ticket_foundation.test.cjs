'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/owner_support_ticket_foundation.sql','utf8');
test('owner support does not reuse customer tickets and denies public access',()=>{
 assert.match(sql,/alter table public\.owner_support_tickets enable row level security/i);
 assert.match(sql,/revoke all on public\.owner_support_tickets from public, anon, authenticated/i);
 assert.doesNotMatch(sql,/customer_support_tickets|security definer/i);
});
test('owner support is limited to current requester and current restaurant owner role',()=>{
 assert.equal((sql.match(/owner_id=\(select auth\.uid\(\)\) and public\.has_restaurant_role\(restaurant_id,array\['owner'\]::text\[\]\)/g)||[]).length,2);
 assert.match(sql,/owner_id uuid not null references auth\.users\(id\) on delete restrict default auth\.uid\(\)/i);
 assert.match(sql,/and status='Open' and admin_response is null/);
});
test('only platform admins may update status and response; no identity or timestamp edits',()=>{
 assert.match(sql,/grant insert \(id,restaurant_id,category,subject,message\)/i);
 assert.match(sql,/grant update \(status,admin_response\)/i);
 assert.match(sql,/using \(\(select public\.is_platform_admin\(\)\)\) with check \(\(select public\.is_platform_admin\(\)\)\)/i);
 assert.doesNotMatch(sql,/grant delete/i);
});
test('support request limits and stable request id are enforced in schema',()=>{
 assert.match(sql,/id uuid primary key/i);
 assert.match(sql,/char_length\(btrim\(subject\)\) between 3 and 120/i);
 assert.match(sql,/char_length\(btrim\(message\)\) between 5 and 2000/i);
 assert.match(sql,/new\.updated_at := clock_timestamp\(\)/i);
});
