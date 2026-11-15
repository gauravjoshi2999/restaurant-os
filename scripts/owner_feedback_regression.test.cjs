'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'owner-feedback.html'), 'utf8');

test('owner survey has four navigable steps and a matching first progress counter', () => {
  assert.equal((html.match(/<section class="step" data-step="[0-3]"/g) || []).length, 4);
  assert.match(html, /id="stepCounter">1 \/ 4<\/span>/);
  assert.match(html, /function update\(scrollToForm\)/);
  assert.match(html, /next\.onclick=function\(\)\{if\(validate\(\)\)\{current=Math\.min\(steps\.length-1,current\+1\);update\(true\);\}\}/);
  assert.match(html, /back\.onclick=function\(\)\{current=Math\.max\(0,current-1\);update\(true\);\}/);
  assert.match(html, /\n  update\(\);\n\}\)\(\);/);
});

test('owner survey shows thank-you only after backend confirms save', () => {
  assert.match(html, /if\(!response\.ok \|\| result\.ok!==true\)throw new Error/);
  const confirmation = html.indexOf('result.ok!==true');
  const success = html.indexOf("document.getElementById('success').style.display='block'");
  assert.ok(confirmation >= 0 && success > confirmation, 'confirmation must come before success UI');
  assert.match(html, /method:'POST'/);
  assert.match(html, /\/functions\/v1\/bite-owner-feedback/);
});

test('survey preserves consent and prohibits asking for bank credentials', () => {
  assert.match(html, /id="privacy_agreed" required/);
  assert.match(html, /id="contact_consent"/);
  assert.match(html, /pilot_interest/);
  assert.doesNotMatch(html, /type="password"|name="bank_account"/);
});
