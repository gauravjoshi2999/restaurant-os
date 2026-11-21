const {test}=require('node:test');
const assert=require('node:assert/strict');
global.BiteOwner=require('../assets/owner-core.js');
const A=require('../assets/owner-hotel-accounts.js');
const guest={male:'1',female:'1',children:'1',full_name:'Synthetic Guest',address:'Test address',arrived_from:'Udaipur',next_destination:'Jaipur',phone:'9999999999',transport:'Car',vehicle_number:'RJ01AB1234',nightly_rate:'1200'};
test('register keeps male/female/child counts and normalizes the vehicle',()=>{
 const v=A.validateRegistration({...guest,vehicle_number:'rj01ab1234'});assert.equal(v.adults,2);assert.equal(v.children,1);assert.equal(v.vehicle_number,'RJ01AB1234');
});
test('children do not replace the required adult and counts are whole numbers',()=>{
 assert.throws(()=>A.validateRegistration({...guest,male:0,female:0}),/adult/);
 assert.throws(()=>A.validateRegistration({...guest,male:1.5}),/counts/);
});
test('bike/car require a number while bus does not retain a vehicle number',()=>{
 assert.throws(()=>A.validateRegistration({...guest,vehicle_number:''}),/registration number/);
 assert.equal(A.validateRegistration({...guest,transport:'Bus',vehicle_number:'SECRET'}).vehicle_number,'');
});
test('register validates address, destinations, phone and decimal rent',()=>{
 for(const field of ['address','arrived_from','next_destination','phone'])assert.throws(()=>A.validateRegistration({...guest,[field]:''}));
 assert.throws(()=>A.validateRegistration({...guest,nightly_rate:'1200.001'}),/rent/);
 assert.equal(A.validateRegistration({...guest,nightly_rate:'1.10'}).adults,2);
});
test('arrival clock uses the property timezone even when the browser is in another zone',()=>{
 assert.equal(A.currentArrivalTime(new Date('2026-11-16T18:45:00Z'),'Asia/Kolkata'),'00:15');
 assert.equal(A.currentArrivalTime(new Date('2026-11-17T01:47:00Z'),'Asia/Kolkata'),'07:17');
});
test('arrival times require an exact, valid 24-hour clock value',()=>{
 for(const v of ['00:00','07:17','23:59'])assert.ok(A.validArrivalTime(v),v);
 for(const v of ['',null,717,'24:00','7:17','07:60','07:17:30'])assert.equal(A.validArrivalTime(v),false,String(v));
});
test('registration errors identify the actual field that needs correction',()=>{
 for(const [name,value] of [['full_name','  '],['address',''],['phone','badphone'],['vehicle_number','RJ'],['nightly_rate','']]){
  assert.throws(()=>A.validateRegistration({...guest,[name]:value}),e=>e.field===name&&!!e.message,name);
 }
 assert.throws(()=>A.validateRegistration({...guest,male:0,female:0}),e=>e.field==='male');
});
test('monthly sheet keeps sales, advances and balances in separate numeric columns',()=>{
 const row={day:'2026-11-17',pos_sales:100,hotel_sales:1575,other_income:50,gross_sales:1725,tax:75,net_sales:1650,expenses:100,staff_advance:200,cash_in:300,cash_out:100,cash_balance:1200,online_in:250,online_out:50,online_balance:200,profit:1550};
 const out=A.reportRows({days:[row]});assert.equal(out[1][4],1725);assert.equal(out[1][8],200);assert.equal(out[1][11],1200);assert.equal(out[1][15],1550);assert.equal(out[0].length,out[1].length);
});
const invoice={number:'B/26-27/000042',issued_at:'2026-11-17T04:00:00Z',property:{name:'Synthetic Hotel',address:'Test Road',phone:'9999999999'},guest:{name:'Synthetic Guest'},stay:{arrival:'2026-11-17',departure:'2026-11-18',registration:{id_front:'PRIVATE-ID'}},room:{number:'104'},tax_profile:{reviewed:true,gstin:'08ABCDE1234F1Z5'},totals:{charges:1575,paid:600,balance:975},gst:[{category:'room',sac:'996311',taxable:1200,rate:5,cgst:30,sgst:30},{category:'food',sac:'996331',taxable:300,rate:5,cgst:7.5,sgst:7.5}],entries:[{kind:'charge',category:'room',description:'Room rent',amount:1200,tax_amount:60,status:'confirmed'},{kind:'charge',category:'food',description:'Food',amount:300,tax_amount:15,status:'confirmed',source_items:[{name:'Thali',quantity:1,unit_price:300}]},{kind:'payment',description:'INTERNAL_PAYMENT_NOTE',account_note:'SECRET_ACCOUNT',amount:600,status:'confirmed'}]};
test('clean bill shows room and food, CGST/SGST, payments and remaining balance',()=>{
 const html=A.billHTML(invoice);for(const label of ['Room rent','Food bill','CGST','SGST','1,575.00','975.00','Thali'])assert.ok(html.includes(label),label);
 for(const secret of ['INTERNAL_PAYMENT_NOTE','SECRET_ACCOUNT','PRIVATE-ID'])assert.ok(!html.includes(secret),secret);
});
test('bill escapes guest/property data and unregistered bills omit tax-invoice claims',()=>{
 const html=A.billHTML({...invoice,property:{name:'<script>bad()</script>'},tax_profile:{},gst:[]});
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>bad'));assert.ok(!html.includes('Tax invoice'));
});
test('GST export keeps one bill row with separate taxable services and state taxes',()=>{
 const rows=A.gstRows({gst_invoices:[{number:invoice.number,date:'2026-11-17',guest:'Synthetic Guest',gstin:invoice.tax_profile.gstin,total:1575,tax_lines:invoice.gst}]});
 assert.equal(rows.length,3);assert.equal(rows[1][4],1200);assert.equal(rows[1][5],300);assert.equal(rows[1][7],1500);assert.equal(rows[1][10],37.5);assert.equal(rows[1][12],37.5);assert.equal(rows[2][13],1575);
});
test('monthly totals sum sales and movements but carry the last closing balance',()=>{
 const rows=A.reportRows({days:[{day:'2026-11-17',gross_sales:100,cash_balance:500,online_balance:200},{day:'2026-11-18',gross_sales:150,cash_balance:600,online_balance:250}]});
 assert.equal(rows.at(-1)[4],250);assert.equal(rows.at(-1)[11],600);assert.equal(rows.at(-1)[14],250);
});

test('draft bill returns to Partner and hides internal POS references',()=>{
 const html=A.billHTML({number:'DRAFT',property:{name:'Test hotel'},guest:{name:'Test guest'},room:{number:'104'},stay:{},tax_profile:{gstin:'08ABCDE1234F1Z5',reviewed:true},entries:[{kind:'charge',category:'room',status:'confirmed',amount:1400,tax_rate:5,tax_amount:70},{kind:'charge',category:'food',status:'confirmed',description:'POS-ROOM-INTERNAL',amount:650,tax_rate:5,tax_amount:32.5,source_items:[{name:'Meal',quantity:1,unit_price:650}]}],totals:{charges:2152.5,paid:0,balance:2152.5}});
 assert.match(html,/Back to Partner/);assert.match(html,/2,152.50/);assert.match(html,/CGST 2.5%/);assert.match(html,/SGST 2.5%/);assert(!html.includes('POS-ROOM-INTERNAL'));
});

test('H14: missing invoice totals cannot become a false zero on print or share',()=>{
 const good={...invoice,room:{number:'101'}};
 assert.equal(A.billTotalsReady(good),true);
 assert.equal(A.billTotalsReady({totals:{charges:0,paid:0,balance:0}}),true);
 assert.equal(A.billTotalsReady({}),false);
 for(const field of ['charges','paid','balance'])for(const missing of [null,undefined,'','  ','bad',Infinity,-Infinity]){
  const broken={...good,totals:{...good.totals,[field]:missing}};
  assert.equal(A.billTotalsReady(broken),false,field+' unavailable');
  assert.throws(()=>A.billHTML(broken),/totals unavailable/);
  assert.throws(()=>A.printStatement(broken),/totals unavailable/);
  assert.throws(()=>A.combinedBillHTML([good,broken]),/totals unavailable/);
 }
 assert.throws(()=>A.combinedBillHTML([]),/totals unavailable/);
 const combined=A.combinedBillHTML([good,{...good,room:{number:'102'}}]);
 assert.match(combined,/Booking statement/);
 assert.match(combined,/Combined total/);
});

test('H10 changing advance amount or payment method requires fresh verification',()=>{
 const input=value=>({value,checked:false,listeners:{},addEventListener(event,fn){(this.listeners[event]??=[]).push(fn)},fire(event){for(const fn of this.listeners[event]||[])fn()}});
 const elements={advance_amount:input('100'),advance_method:input('UPI'),advance_verified:input('on'),advance_reference:input('SYNTHETIC-REF'),advance_account:input('Test account')};
 const {advance_amount:a,advance_method:m,advance_verified:v,advance_reference:r,advance_account:n}=elements;
 v.checked=true;A.wireAdvanceVerification({elements});
 assert.equal(v.checked,true,'Existing restored details are not modified just by rendering');
 a.fire('change');assert.equal(v.checked,true,'Unchanged amount remains verified');
 a.value='200';a.fire('input');assert.equal(v.checked,false,'New amount requires verification');
 v.checked=true;a.fire('change');assert.equal(v.checked,true,'Duplicate event does not invalidate a fresh verification');
 m.value='Card';m.fire('change');assert.equal(v.checked,false,'Switching between online methods invalidates verification');
 assert.equal(r.value,'');assert.equal(n.value,'');
 v.checked=true;r.value='NEW-REF';m.fire('change');assert.equal(v.checked,true);assert.equal(r.value,'NEW-REF');
});
