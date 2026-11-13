const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../assets/owner-core.js');
const exportsApi = require('../assets/owner-exports.js');

function element(id, page = false) {
  const names = new Set(page ? ['page'] : []), attributes = {}, styles = {display:'none!important'};
  return { id, hidden:false, dataset:{page:id}, attributes, styles,
    classList:{contains:n=>names.has(n),toggle(n,on){on?names.add(n):names.delete(n);}},
    style:{removeProperty:n=>delete styles[n]},
    setAttribute:(k,v)=>attributes[k]=v,removeAttribute:k=>delete attributes[k] };
}
function workspace(role = 'owner') {
  const ids = ['overview','orders','pos','menu','tables','khata','cashbook','expenses','purchases','inventory','hr','reports','settings','restaurants','financials','audit','support','moderation','refunds'];
  const pages = ids.map(id=>element(id,true)), buttons=ids.map(id=>element(id));
  const title={textContent:''}, calls=[], errors=[];
  const doc={querySelectorAll(selector){
    if(selector==='#mainApp .page')return pages;
    if(selector==='.nav button[data-page]')return buttons;
    return [];
  },getElementById:id=>id==='pageTitle'?title:pages.find(p=>p.id===id)};
  const context={document:doc,BiteOwner:core,access:{role},window:{scrollTo:()=>{}},console:{...console,error:(...args)=>errors.push(args.map(String).join(' '))},
    toggleSidebar:()=>{},render:()=>calls.push('overview'),renderFinancials:()=>calls.push('financials'),
    setOrderChannel:()=>{},Promise};
  for(const name of ['loadPOSWorkspace','loadMenuWorkspace','loadTablesWorkspace','loadKhataWorkspace','loadCashbookWorkspace','loadExpenseWorkspace','loadPurchaseWorkspace','loadInventoryWorkspace','loadHRWorkspace','loadReportsWorkspace','loadOwnerSettings','loadDeliveryZonesWorkspace','loadCustomerOrderRequestsWorkspace','loadRestaurantReviewsWorkspace','loadSandboxPaidOrders','loadVerifiedLiveInbox','loadOwnerMappingWorkspace','loadRestaurantChangeRequestsWorkspace','loadAuditLogWorkspace','loadSupportWorkspace','loadReviewReportsWorkspace'])context[name]=async()=>calls.push(name);
  const source=fs.readFileSync('index.html','utf8');
  const start=source.indexOf('async function showPage(id){');
  const end=source.indexOf("document.querySelectorAll('.nav button[data-page]')",start);
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  return {context,pages,buttons,calls,title,errors};
}
test('all thirteen Owner pages can open, including guarded POS and legacy inline-hidden pages',async()=>{
  const w=workspace();
  for(const id of ['overview','orders','pos','menu','tables','khata','cashbook','expenses','purchases','inventory','hr','reports','settings']){
    await w.context.showPage(id);
    const active=w.pages.filter(p=>!p.hidden);
    assert.deepEqual(active.map(p=>p.id),[id]);
    assert.equal(active[0].styles.display,undefined);
    assert.equal(active[0].attributes['aria-hidden'],'false');
    assert.equal(w.buttons.find(b=>b.id===id).attributes['aria-current'],'page');
  }
  assert.equal(w.calls.filter(x=>x==='loadPOSWorkspace').length,1);
  assert.equal(w.calls.filter(x=>x==='loadExpenseWorkspace').length,1);
  assert.equal(w.calls.filter(x=>x==='loadDeliveryZonesWorkspace').length,1);
  assert.deepEqual(w.errors,[],'Every route loader should complete without a swallowed error');
});
test('Owner cannot open Admin or disabled refund routes',async()=>{
  const w=workspace();
  for(const id of ['restaurants','financials','audit','support','moderation','refunds']){
    await w.context.showPage(id);
    assert.deepEqual(w.pages.filter(p=>!p.hidden).map(p=>p.id),['overview']);
  }
  assert(!w.calls.includes('loadOwnerMappingWorkspace'));
});
test('Admin cannot open Owner operational pages',async()=>{
  const w=workspace('super_admin');await w.context.showPage('pos');
  assert.deepEqual(w.pages.filter(p=>!p.hidden).map(p=>p.id),['overview']);
  await w.context.showPage('settings');
  assert.deepEqual(w.pages.filter(p=>!p.hidden).map(p=>p.id),['overview']);
  await w.context.showPage('restaurants');
  assert(w.calls.includes('loadOwnerMappingWorkspace'));
  assert(!w.calls.includes('loadOwnerSettings'));
});
test('India business dates and inclusive report ranges do not use host timezone',()=>{
  assert.equal(core.day('2026-11-08T20:00:00Z'),'2026-11-09');
  assert.equal(core.day('2026-11-08T18:29:59Z'),'2026-11-08');
  assert.deepEqual(core.range('2026-11-09','2026-11-09'),{start:'2026-11-08T18:30:00.000Z',end:'2026-11-09T18:30:00.000Z'});
  assert.throws(()=>core.range('2026-11-10','2026-11-09'));
});
test('unpaid and demo orders cannot inflate reports; missing provider fee stays unknown',()=>{
  const orders=[{id:'paid'},{id:'pending'},{id:'demo',is_demo:true}];
  const financials=[{order_id:'paid',payment_status:'paid',customer_payable_amount:500,refund_amount_actual:50,commission_amount:50,provider_fee_actual:null},
    {order_id:'pending',payment_status:'pending',customer_payable_amount:900},
    {order_id:'demo',payment_status:'paid',is_demo:true,customer_payable_amount:9999}];
  const result=core.financialSummary(orders,financials);
  assert.equal(result.paid.length,1);assert.equal(result.gross,500);assert.equal(result.net,450);
  assert.equal(result.payable,null);assert.equal(result.fees,null);
  financials[0].provider_fee_actual=11.51;
  assert.equal(core.financialSummary(orders,financials).payable,388.49);
});
test('CSV formulas are neutralized while Excel exports contain literal strings',()=>{
  assert.equal(core.csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');
  assert.equal(core.csvCell('normal, text'),'"normal, text"');
  const bytes=exportsApi.workbook([['Name','Amount'],['=1+1',123.45],['हिसाब',0]]);
  assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
  fs.writeFileSync('/tmp/bite-owner-export-test.xlsx',bytes);
});

test('POS item editor uses a distinct but accessible visual hierarchy without changing billing fields',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const style=html.match(/<style id="bite-pos-item-visual-contrast">([\s\S]*?)<\/style>/)?.[1]||'';
 assert.match(style,/#orderModal #posItemEntry\{/);
 assert.match(style,/background:linear-gradient\(135deg,#f0f8fd/);
 assert.match(style,/border-left:4px solid #3989ad/);
 assert.match(style,/button\[onclick="confirmPosItemInline\(\)"\]/);
 assert.match(style,/background:#d92d3a!important/);
 assert.match(style,/button\[onclick="togglePosItemEntry\(false\)"\]/);
 assert.match(html,/id="posPickerItemName"/);
 assert.match(html,/id="posPickerQuantity"/);
 assert.match(html,/id="posPickerPrice"/);
 assert.match(html,/id="posPaymentSection"/);
});

test('POS received amount begins blank; zero is only a visual hint',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/id="posPaidAmount" type="number" min="0" step="0.01" inputmode="decimal" autocomplete="off" placeholder="0.00"/);
 assert.doesNotMatch(html,/id="posPaidAmount"[^>]*value="0"/);
 assert.match(html,/form\.reset\(\);document\.getElementById\('posPaidAmount'\)\.value=''/);
 const calc=html.slice(html.indexOf('function updateOrderTotal(){'),html.indexOf('function closeModal(',html.indexOf('function updateOrderTotal(){')));
 assert.match(calc,/received=Number\(receivedEl\?\.value\|\|0\)/);
 assert.doesNotMatch(calc,/receivedEl\.value\s*=/);
});
