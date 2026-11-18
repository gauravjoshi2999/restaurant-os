'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync(require('node:path').resolve(__dirname,'../index.html'),'utf8');
function section(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing Owner V3 receipt-link boundary: '+start);
 return html.slice(a,b);
}
test('Cashbook POS source link is read-only and receipt/tenant scoped',()=>{
 const source=section('async function openCashbookPOSReceipt(', 'async function showPOSReceiptInCashbook(');
 assert.match(source,/access\.role!=='owner'/);
 assert.match(source,/x\.source_type==='order_payment'/);
 assert.match(source,/x\.restaurant_id===rid&&x\.entry_date===day/);
 assert.match(source,/\.from\('restaurant_order_payments'\)/);
 assert.match(source,/\.eq\('id',paymentId\)\.eq\('restaurant_id',rid\)/);
 assert.match(source,/payment\.payment_date!==day/);
 assert.match(source,/cashbookSameSession\(session\)/);
 assert.match(source,/printOwnerInvoice\(order\.id\)/);
 assert.doesNotMatch(source,/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
});
test('POS bill jumps to receipt date, never to bill service date',()=>{
 const source=section('async function showPOSReceiptInCashbook(', 'function renderCashbook(');
 assert.match(source,/p\.order_id===orderId&&p\.restaurant_id===rid/);
 assert.match(source,/const day=String\(payment\?\.payment_date\|\|''\)/);
 assert.match(source,/await showPage\('cashbook'\)/);
 assert.match(source,/getElementById\('cashbookDate'\)\.value=day/);
 assert.match(source,/await loadCashbook\(\)/);
 assert.match(source,/cashbookDataReadyKey!==rid\+'\|'\+day/);
 assert.match(source,/x\.source_type==='order_payment'&&x\.source_id===paymentId/);
 assert.doesNotMatch(source,/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
});
test('Only actual saved POS payment records get a receipt link',()=>{
 const source=section('function renderPOSWorkspace(){', 'let activeOrderChannel=');
 assert.match(source,/state\.orderPayments\.filter\(x=>x\.restaurant_id===rid&&x\.order_id===o\.id/);
 assert.match(source,/const receiptLink=!roomLinked&&!isVoid&&latestReceipt&&access\.role==='owner'/);
 assert.match(source,/onclick="showPOSReceiptInCashbook/);
 assert.match(source,/\+invoice\+receiptLink\+share\+correction\+/);
 assert.match(html,/data-cashbook-source-id/);
 assert.match(html,/id="cashbookReceiptJumpMessage" role="status"/);
 assert.match(html,/window\.showPOSReceiptInCashbook=showPOSReceiptInCashbook/);
 assert.match(html,/receipt:latest\?\{id:latest\.id,date:latest\.payment_date\}/);
});
test('Mobile Recent bills show the payment-date receipt link without extra sales',()=>{
 const js=fs.readFileSync(require('node:path').resolve(__dirname,'../assets/bite-pos-v2.js'),'utf8');
 const css=fs.readFileSync(require('node:path').resolve(__dirname,'../assets/bite-pos-v2.css'),'utf8');
 assert.match(js,/data-bpv2-payment/);
 assert.match(js,/showPOSReceiptInCashbook\(found\.id,found\.receipt\.id\)/);
 assert.match(css,/\.bpv2-receipt-link/);
 assert.match(html,/bite-pos-v2\.js\?v=20261118-v3-receipts/);
});
