'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const ui=fs.readFileSync('assets/owner-v3-salary-closing-ui.js','utf8');
const payroll=fs.readFileSync('assets/owner-v3-salary-closing.js','utf8');
test('A11: remaining due shortcut belongs to existing HR Payments tab and uses A10 approval only',()=>{
 for(const token of ['id="hrA10PreparePayment" hidden disabled','id="hrPaymentAmount"',
   'id="hrPaymentMethod"','id="hrPaymentEmployee"','id="hrPaymentMonth"','owner-v3-salary-closing-ui.js?v=20261119-a11-1'])
  assert.ok(html.includes(token),token);
 assert.match(ui,/function prepareSalaryDue\(\)/);
 assert.match(ui,/report\?\.closing/);
 assert.match(ui,/updated\.due!==report\.due/);
 assert.match(ui,/engine\(\)\.load/);
 assert.match(ui,/active\(n,restaurant,user,employeeId,month\)/);
 assert.match(ui,/Employee is unavailable in the existing payment form/);
});
test('A11: prefill cannot send or record money and requires explicit method and existing save action',()=>{
 const fn=ui.slice(ui.indexOf('async function prepareSalaryDue(){'),ui.indexOf('async function approve(){'));
 assert.match(fn,/hrPaymentType/);
 assert.match(fn,/hrPaymentAmount/);
 assert.match(fn,/hrPaymentMonth/);
 assert.match(fn,/hrPaymentMethod/);
 assert.match(fn,/mode\.value=''/);
 assert.match(fn,/No payment or Cashbook entry will be created/);
 const safeSave=fs.readFileSync('assets/owner-v3-staff-payment-safe-save.js','utf8');
 assert.match(safeSave,/methods\.includes\(data\.payment_method\)/);
 assert.match(html,/BiteOwnerSafeStaffPayment\.save/);
 assert.doesNotMatch(fn,/\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.rpc\s*\(/);
 assert.match(html,/onclick="saveHREmployeePayment\(\)"/);
 assert.match(payroll,/currently recorded amount due|Currently recorded amount due/);
});
