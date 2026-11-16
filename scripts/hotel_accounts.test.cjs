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
test('GST export has bill-wise separate taxable values and the two state taxes',()=>{
 const rows=A.gstRows({gst_invoices:[{number:invoice.number,date:'2026-11-17',guest:'Synthetic Guest',gstin:invoice.tax_profile.gstin,total:1575,tax_lines:invoice.gst}]});
 assert.equal(rows.length,3);assert.equal(rows[1][6],1200);assert.equal(rows[1][7],2.5);assert.equal(rows[2][8],7.5);assert.equal(rows[2][10],7.5);
});
