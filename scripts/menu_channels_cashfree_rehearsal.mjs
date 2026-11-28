// Run only against the disposable Supabase fixture. Never deploy this runner.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

export async function rehearseCashfree({ api, anon, service, customer, intent, setOnline, getStamp, request }) {
  const mode = process.env.BITE_REHEARSAL_CASHFREE ?? 'synthetic';
  assert.ok(['synthetic', 'sandbox'].includes(mode), 'Only synthetic and sandbox rehearsal modes are allowed');
  const sandbox = mode === 'sandbox';
  const appId = sandbox ? process.env.CASHFREE_TEST_APP_ID : 'synthetic-app-id';
  const secret = sandbox ? process.env.CASHFREE_TEST_SECRET_KEY : 'synthetic-secret';
  assert.ok(appId && secret, 'Cashfree sandbox credentials are missing');
  const { createClient } = createRequire(resolve(process.env.BITE_REHEARSAL_DEPENDENCIES, 'package.json'))('@supabase/supabase-js');
  const providerId = 'bite_live_' + intent.replaceAll('-', '');
  let order;
  let createCalls = 0;
  const providerFetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.cashfree.com');
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    assert.equal(headers.get('x-api-version'), '2023-08-01');
    let body;
    if (method === 'POST') {
      assert.equal(url.pathname, '/pg/orders');
      assert.equal(headers.get('x-idempotency-key'), intent);
      body = JSON.parse(init.body);
      assert.equal(body.order_id, providerId);
      assert.equal(body.order_amount, 1);
      assert.equal(body.order_currency, 'INR');
      assert.ok(await getStamp(), 'Commit the attempt before requesting Cashfree');
      // The rehearsal never returns a shopper to the production site.
      delete body.order_meta;
      createCalls++;
    } else {
      assert.equal(method, 'GET');
      assert.equal(url.pathname, '/pg/orders/' + providerId);
    }
    if (sandbox) {
      return fetch(new URL(url.pathname, 'https://sandbox.cashfree.com'), {
        ...init, body: body && JSON.stringify(body), redirect: 'error'
      });
    }
    order ??= body && {
      order_id: body.order_id, order_amount: body.order_amount, order_currency: body.order_currency,
      order_status: 'ACTIVE', payment_session_id: 'synthetic-session',
      created_at: new Date().toISOString(), order_expiry_time: body.order_expiry_time
    };
    return order ? Response.json(order) : Response.json({}, { status: 404 });
  };

  const clientFetch = (input, init) => {
    assert.equal(new URL(input instanceof Request ? input.url : input).origin, api.origin);
    return fetch(input, { ...init, redirect: 'error' });
  };
  const env = {
    SUPABASE_URL: api.origin, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service,
    BITE_LIVE_CHECKOUT_ENABLED: 'true', CASHFREE_APP_ID: appId, CASHFREE_SECRET_KEY: secret
  };
  async function handler(name) {
    const file = await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
    const code = stripTypeScriptTypes(file.replace(/^import .*;\s*$/gm, ''), { mode: 'strip' });
    let entry;
    runInNewContext(code, {
      Deno: { serve: fn => { entry = fn; }, env: { get: key => env[key] } },
      createClient: (url, key, options) => createClient(url, key, {
        ...options, global: { ...options?.global, fetch: clientFetch },
        auth: { persistSession: false, autoRefreshToken: false }
      }),
      Request, Response, AbortSignal, fetch: providerFetch,
      console: { warn() {} }
    });
    assert.equal(typeof entry, 'function');
    return () => entry(new Request(api, {
      method: 'POST', headers: { Authorization: `Bearer ${customer.token}` },
      body: JSON.stringify({ intent_id: intent })
    }));
  }

  const create = await handler('bite-live-create-session');
  const verify = await handler('bite-live-verify-checkout');
  let response = await create();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).status, 'confirmation_required');
  assert.equal(createCalls, 0);
  await request('/rest/v1/bite_order_confirmations', {
    key: service, body: { intent_id: intent, state: 'approved', reviewed_at: new Date().toISOString() }, status: 201
  });

  await setOnline(false);
  response = await create();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).status, 'menu_changed');
  assert.equal(createCalls, 0);
  assert.equal(await getStamp(), null);

  await setOnline(true);
  const session = async () => {
    const result = await create();
    const data = await result.json();
    assert.equal(result.status, 200, `Checkout session failed (${data.provider_status ?? result.status})`);
    assert.equal(data.order_id, providerId);
    assert.equal(data.amount, 1);
    assert.ok(data.payment_session_id);
    return data.payment_session_id;
  };
  const originalSession = await session();
  const start = await getStamp();
  await setOnline(false);
  assert.equal(await session(), originalSession);
  assert.equal(await getStamp(), start);
  assert.equal(createCalls, 2);
  response = await verify();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'awaiting_payment');
  console.log(`PASS: candidate checkout kept one ${sandbox ? 'Cashfree sandbox' : 'synthetic Cashfree'} order across retries and verified its unpaid status`);
}
