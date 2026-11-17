'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const files={
 migration:fs.readFileSync('supabase/migrations/20261117151000_pos_service_guest_count.sql','utf8'),
 service:fs.readFileSync('assets/bite-pos-service.js','utf8'),
 report:fs.readFileSync('assets/bite-pos-reports.js','utf8'),
 pos:fs.readFileSync('assets/bite-pos-v2.js','utf8'),
 draft:fs.readFileSync('assets/bite-pos-drafts.js','utf8'),
 html:fs.readFileSync('index.html','utf8'),
 hospitality:fs.readFileSync('assets/owner-hospitality.js','utf8')
};
function runtime(){
 const elements={
  bpv2Stats:{innerHTML:''},
  bpv2Recent:{innerHTML:''},
  bitePosV2Desk:{addEventListener(){}}
 };
 const root={document:{getElementById:id=>elements[id]||null},Intl,Date,console};root.window=root;
 vm.runInNewContext(files.pos,{window:root,Date,Intl,console});
 vm.runInNewContext(files.report,{window:root,Date,Intl,console});
 return {root,elements,api:root.BitePOSReports};
}
function row(id,date,amount,fields={}){
 return {
  id,restaurant:'r-1',channel:'POS - Dine-in',createdAt:date,status:'Completed',
  isDemo:false,roomLinked:false,code:'POS-'+id,amount,waivedOffAmount:0,
  receivedAmount:amount,guestCount:2,serviceType:'dine_in',customerName:'Guest',...fields
 };
}
test('All 3 mobile POS report modes, calendar dots and monthly trend use real bill data',()=>{
 const {api,elements,root}=runtime();
 const today=root.BitePOSV2.dateKey(new Date());
 const bills=[
  row('1',today+'T11:00:00+05:30',450,{guestCount:4}),
  row('2',today+'T12:00:00+05:30',300,{serviceType:'takeaway',channel:'POS - Takeaway',guestCount:null}),
  row('3',today+'T12:20:00+05:30',70,{guestCount:null}),
  row('4',today+'T13:00:00+05:30',999,{status:'Cancelled'}),
  row('5',today+'T13:00:00+05:30',100,{restaurant:'r-2'}),
  row('6',today+'T13:00:00+05:30',1000,{roomLinked:true}),
  row('7',today+'T13:00:00+05:30',600,{isDemo:true}),
 ];
 api.render({restaurantId:'r-1',orders:bills});
 const s=api.summary({date:today});
 assert.equal(s.bills,3);assert.equal(s.sales,820);
 assert.equal(s.guests,4);assert.equal(s.counted,1);assert.equal(s.dineInUnknown,1);
 assert.equal(s.average,820/3);
 assert.match(elements.bpv2Stats.innerHTML,/POS Reports/);
 assert.match(elements.bpv2Stats.innerHTML,/Calendar/);
 assert.match(elements.bpv2Stats.innerHTML,/Monthly/);
 assert.match(elements.bpv2Stats.innerHTML,/earlier|old dine-in bill/);
 const cal=api.calendar(today.slice(0,7));
 assert.match(cal,/data-bpv3-date=/);
 assert.match(cal,/has-bill/);
 assert.ok(api.dayTotals(today.slice(0,7))[today].bills===3);
 assert.equal(api.adjacent('2026-12',1),'2027-01');
 assert.equal(api.adjacent('2026-01',-1),'2025-12');
});
test('POS bill service migration requires same-transaction write, RLS and no historical guest guesses',()=>{
 const s=files.migration;
 for(const c of [
  'CREATE TABLE IF NOT EXISTS public.bite_pos_bill_service',
  'CHECK (service_type IN',
  'ALTER TABLE public.bite_pos_bill_service ENABLE ROW LEVEL SECURITY',
  'REVOKE ALL ON public.bite_pos_bill_service',
  'FOR SELECT TO authenticated',
  'has_restaurant_role(restaurant_id',
  'auth.uid() IS NULL',
  'p_guest_count NOT BETWEEN 1 AND 100',
  'p_service_type=',
  'public.create_pos_order_with_payment',
  'public.replace_unpaid_pos_order',
  'private.bite_pos_service_from_property_command',
  'AFTER INSERT ON public.bite_property_commands'
 ])assert.ok(s.includes(c),'Missing SQL safety '+c);
 assert.doesNotMatch(s,/UPDATE public\.orders SET guest_count|UPDATE public\.orders SET amount|TRUNCATE|DELETE FROM public\.orders/i);
 assert.match(s,/GRANT EXECUTE ON FUNCTION public\.bite_create_pos_bill_with_service_v1/);
 assert.doesNotMatch(s,/GRANT INSERT ON public\.bite_pos_bill_service TO authenticated/);
});
test('Owner POS form continues one canonical bill, preserves drafts & room bills',()=>{
 for(const c of [
  'window.BitePOSService?.prepare(',
  'window.BitePOSService?.read()',
  "sb.rpc('bite_create_pos_bill_with_service_v1'",
  "window.BiteHospitality?.roomPOSSelected()",
  'BitePOS?.finishOrder()',
  'window.BiteHospitality.createRoomPOS(items)',
  'state.posServices=',
  'BitePOSReports?.render(current)',
  "printOwnerInvoice(id)",
  'Service: '
 ]) assert.ok((files.html+files.pos).includes(c),'Missing POS integration '+c);
 assert.match(files.draft,/serviceType:\$\('biteServiceType'\)/);
 assert.match(files.draft,/window\.BitePOSService\?\.restore\(data\)/);
 assert.match(files.hospitality,/service_type:fields\.get\('bite_service_type'\)/);
 assert.match(files.service,/data-bps-type="dine_in"/);
 assert.match(files.service,/data-bps-type="takeaway"/);
 assert.match(files.service,/data-bps-step="-1"/);
 assert.match(files.service,/data-bps-step="1"/);
 assert.match(files.service,/option value="">No table assigned/);
 assert.match(files.service,/Dine-in: enter 1–100 people/);
});
test('No screenshot-only metrics or mandatory fictitious GST rate',()=>{
 const src=files.service+files.report+files.pos;
 assert.doesNotMatch(src,/Rahul Verma|12,480|POS-12856|GST \(5%\)|grandTotal \* 0\.05/);
 assert.doesNotMatch(src,/cashfree|create_payment_session|service_role/i);
});
