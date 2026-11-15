'use strict';
// Isolated integration harness for the exact versioned Deno Edge source.
// No network requests, production credentials, Supabase database changes or live feedback rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {stripTypeScriptTypes} = require('node:module');

const file = path.join(__dirname, '..', 'supabase', 'functions', 'bite-owner-feedback', 'index.ts');
const ts = fs.readFileSync(file, 'utf8');
assert.match(ts, /Deno\.serve\(/, 'Test must execute the actual versioned handler');
const js = stripTypeScriptTypes(ts.replace(/^import\s+["']jsr:[^\n]+;\s*/m, ''));

function fixture({insertFailure = false} = {}) {
  const rows = [];
  const calls = [];
  let handler;
  const secret = 'sb_secret_isolated_fake_key_do_not_use_outside_ci';
  async function fakeFetch(url, opts = {}) {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, 'https://wedbgpybbgsszcmffoha.supabase.co', 'No external network allowed');
    assert.equal(parsed.pathname, '/rest/v1/bite_owner_feedback');
    const method = (opts.method || 'GET').toUpperCase();
    calls.push(method);
    if (method === 'GET') {
      const f = parsed.searchParams.get('request_fingerprint')?.replace(/^eq\./, '');
      const since = parsed.searchParams.get('created_at')?.replace(/^gte\./, '');
      const limit = Number(parsed.searchParams.get('limit') || '9');
      const matches = rows.filter(row => row.request_fingerprint === f && (!since || row.created_at >= since))
        .slice(0, limit).map(row => ({id: row.id}));
      return new Response(JSON.stringify(matches), {status: 200, headers: {'content-type':'application/json'}});
    }
    assert.equal(method, 'POST');
    if (insertFailure) return new Response('{}', {status: 503});
    const record = JSON.parse(opts.body);
    const row = {id: 'isolated-'+(rows.length+1), created_at: new Date().toISOString(), ...record};
    rows.push(row);
    return new Response('', {status: 201});
  }
  const sandbox = {
    Deno: {env: {get(name) {return name === 'SUPABASE_SECRET_KEYS' ? JSON.stringify({default: secret}) : '';}},
      serve(fn) {handler = fn;}},
    Request, Response, AbortSignal, TextEncoder, crypto: webcrypto, URL,
    fetch: fakeFetch, console: {error() {}},
  };
  vm.runInNewContext(js, sandbox, {timeout: 2000, filename: file});
  assert.equal(typeof handler, 'function');
  async function submit(payload, origin = 'https://gauravjoshi2999.github.io', ip = '192.0.2.7') {
    const req = new Request('https://wedbgpybbgsszcmffoha.supabase.co/functions/v1/bite-owner-feedback', {
      method: 'POST', headers: {
        origin, 'content-type': 'application/json', 'cf-connecting-ip': ip
      }, body: JSON.stringify(payload)
    });
    const response = await handler(req);
    return {status: response.status, body: await response.json()};
  }
  return {submit, rows, calls};
}
function valid(overrides = {}) {
  return {
    city: 'Rajsamand',
    restaurant_name: 'Isolated QA fixture',
    biggest_problems: ['orders', 'billing'],
    real_story: 'At lunch rush multiple customers ask for separate item changes.',
    one_change: 'Make order changes simple and safe.',
    marketplace_platforms: ['zomato'],
    marketplace_opportunities: ['reports'],
    privacy_agreed: true,
    pilot_interest: false,
    contact_consent: false,
    owner_phone: '9999999999',
    elapsed_ms: 25000,
    website: '',
    ...overrides,
  };
}

test('isolated POST returns 201 + ok true and data can be read back from mock storage', async () => {
  const f = fixture();
  const response = await f.submit(valid());
  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(f.rows.length, 1);
  const saved = f.rows[0];
  assert.equal(saved.city, 'Rajsamand');
  assert.equal(saved.restaurant_name, 'Isolated QA fixture');
  assert.deepEqual(Array.from(saved.biggest_problems), ['orders','billing']);
  assert.equal(saved.survey_version, 2);
  assert.equal(saved.owner_phone, null, 'No phone persisted without contact consent');
  assert.ok(saved.request_fingerprint && saved.request_fingerprint.length === 64);
  assert.deepEqual(f.calls, ['GET','POST']);
});

test('invalid input and missing privacy consent cannot be saved', async () => {
  const f = fixture();
  for (const payload of [
    valid({city: 'A'}), valid({biggest_problems: []}),
    valid({real_story: 'too short'}), valid({one_change: 'no'}),
    valid({privacy_agreed: false}), valid({marketplace_platforms: []}),
    valid({marketplace_platforms: ['none','zomato']}),
    valid({pilot_interest: true, contact_consent: false}),
  ]) {
    const response = await f.submit(payload);
    assert.equal(response.status, 400);
    assert.notEqual(response.body.ok, true);
  }
  assert.equal(f.rows.length, 0);
});

test('disallowed origin cannot submit feedback', async () => {
  const f = fixture();
  const response = await f.submit(valid(), 'https://evil.invalid');
  assert.equal(response.status, 403);
  assert.equal(f.rows.length, 0);
});

test('honeypot silently discards bot response without persisting a row', async () => {
  const f = fixture();
  const response = await f.submit(valid({website: 'https://bot.invalid'}));
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(f.rows.length, 0);
});

test('storage failure is not acknowledged as successful', async () => {
  const f = fixture({insertFailure:true});
  const response = await f.submit(valid());
  assert.equal(response.status, 503);
  assert.notEqual(response.body.ok, true);
  assert.equal(f.rows.length, 0);
});

test('per-hour limit blocks the ninth attempt from the same simulated source', async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) assert.equal((await f.submit(valid())).status, 201);
  const blocked = await f.submit(valid());
  assert.equal(blocked.status, 429);
  assert.equal(f.rows.length, 8);
});

test('normal client completion must require the explicit backend save acknowledgement', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'owner-feedback.html'), 'utf8');
  assert.match(page, /if\(!response\.ok \|\| result\.ok!==true\)throw new Error/);
});
