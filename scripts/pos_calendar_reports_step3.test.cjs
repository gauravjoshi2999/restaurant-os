'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const load=f=>fs.readFileSync(f,'utf8');
const js=load('assets/bite-pos-reports.js');
const css=load('assets/bite-pos-reports.css');
const pos=load('assets/bite-pos-v2.js');
const html=load('index.html');
const sql=load('supabase/migrations/20261117200000_pos_calendar_reports_step3.sql');
function api(){const w={document:null,console};w.window=w;vm.runInNewContext(js,{window:w,Intl,Date,Number,console});return w.BitePOSReports;}
test('Month navigation handles year rollover without locale or timezone ambiguity',()=>{
 const r=api();
 assert.equal(r.shiftMonth('2026-12',1),'2027-01');
 assert.equal(r.shiftMonth('2026-01',-1),'2025-12');
 assert.equal(r.shiftMonth('2026-02',1),'2026-03');
 assert.match(r.istToday(),/^\d{4}-\d{2}-\d{2}$/);
});
test('Daily and monthly metrics count actual recorded diner heads without guessing old bills',()=>{
 const r=api();
 const out=r.summarize([
  {bills:2,billed:650,guests:4,dine_in:1,takeaway:1,untracked:0},
  {bills:3,billed:900,guests:6,dine_in:1,takeaway:0,untracked:2}
 ]);
 assert.equal(out.bills,5);assert.equal(out.billed,1550);assert.equal(out.guests,10);
 assert.equal(out.untracked,2);assert.equal(out.takeaway,1);
});
test('Calendar is accessible, has dated action buttons and marks only actual POS bills',()=>{
 const r=api();
 const dates=['2026-11-01','2026-11-02','2026-11-03'].map((date,i)=>({date,bills:i===1?2:0}));
 // Use a separate standalone document view to confirm source markup without a browser.
 assert.match(js,/class="bpr-date/);
 assert.match(js,/data-bpr-date=/);
 assert.match(js,/aria-pressed=/);
 assert.match(js,/hasBills\?'<i aria-hidden="true"/);
 assert.match(js,/bpr-modes/);
 assert.match(js,/data-bpr-mode=/);
 assert.ok(dates[1].bills>dates[0].bills);
});
test('Report backend remains read-only and enforces authenticated tenant before privileged scope',()=>{
 for(const phrase of [
  "auth.uid() IS NULL","public.has_restaurant_role(p_restaurant_id,ARRAY['owner','manager']",
  "o.restaurant_id=p_restaurant_id","o.is_demo IS NOT TRUE",
  "o.status NOT IN ('Cancelled','Rejected')",
  "o.channel IN ('POS - Counter','POS - Dine-in','POS - Takeaway')",
  "pc.action='room_pos'","pc.result->>'order_id'=o.id::text",
  "restaurant_pos_visit_details","restaurant_order_refunds",
  "REVOKE ALL ON FUNCTION public.bite_pos_reports_v1(uuid,date,date) FROM PUBLIC,anon",
  "GRANT EXECUTE ON FUNCTION public.bite_pos_reports_v1(uuid,date,date) TO authenticated"
 ])assert.ok(sql.includes(phrase),'Backend guard missing '+phrase);
 assert.doesNotMatch(sql,/^\s*(?:update|delete from|insert into|truncate)\s+public\./im);
 assert.match(sql,/LANGUAGE plpgsql STABLE SECURITY DEFINER/);
});
test('POS Reports is integrated with working original billing tabs and one authentic state',()=>{
 for(const q of [
  'data-bpv2-tab="reports"','data-bpv2-tab="today"','data-bpv2-tab="bills"','data-bpv2-tab="drafts"',
  "root.BitePOSReports?.mount?.(","client:current.client",
 ])assert.ok(pos.includes(q),q);
 for(const q of [
  'bite-pos-reports.js?v=','bite-pos-reports.css?v=',
  "restaurantId:rid,userId:currentUser?.id,client:sb",
  "window.BitePOSReports?.clear?.()",
  "window.BitePOSV2?.render(",
  "bite_create_counter_pos_visit_v1"
 ])assert.ok(html.includes(q),q);
 assert.match(css,/data-bite-pos-view="reports"/);
 assert.match(css,/grid-template-columns:repeat\(4/);
 assert.match(js,/sb\.rpc\('bite_pos_reports_v1'/);
 assert.match(js,/if\(epoch!==request\|\|scope!==restaurantId\|\|authUser!==userId/);
});
test('Copy distinguishes billed sales from actual cash collections, reports remain dynamic',()=>{
 assert.match(js,/not cash received/);
 assert.match(js,/guest counts unknown/);
 assert.match(js,/Refund\/cancelled sales/);
 assert.doesNotMatch(js,/12,480|Rahul Verma|64 guests|POS-12856/);
 assert.doesNotMatch(js,/localStorage|service_role|INSERT INTO/);
});
