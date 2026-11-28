import { rehearseCashfree } from './menu_channels_cashfree_rehearsal.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const api = new URL(process.env.BITE_REHEARSAL_API ?? 'http://127.0.0.1:54321');
assert.equal(api.origin, 'http://127.0.0.1:54321', 'Fixtures must never target a hosted project');

const { anon, service } = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.ok(anon && service, 'Local Supabase credentials required');

async function request(path, { key = anon, token = key, body, method = body ? 'POST' : 'GET', status = 200 } = {}) {
  const response = await fetch(new URL(path, api), {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12_000)
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  assert.equal(response.status, status, `${method} ${path.split('?')[0]} returned ${response.status} (${data?.code ?? data?.error_code ?? 'no error code'})`);
  return data;
}

async function signIn(label) {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = randomUUID();
  const admin = await request('/auth/v1/admin/users', {
    key: service, body: { email, password, email_confirm: true }
  });
  const session = await request('/auth/v1/token?grant_type=password', { body: { email, password } });
  assert.equal(session.user.id, admin.id);
  assert.ok(session.access_token);
  return { id: session.user.id, token: session.access_token };
}

const owner = await signIn('owner');
const customer = await signIn('customer');
const outlet = '10000000-0000-0000-0000-000000000001';
const onlineDish = '20000000-0000-0000-0000-000000000001';
const roomDish = '20000000-0000-0000-0000-000000000002';
const roomExtra = '40000000-0000-0000-0000-000000000001';
await request('/rest/v1/restaurant_members', {
  key: service, body: { restaurant_id: outlet, user_id: owner.id, role: 'owner' }, status: 201
});

const menu = `/rest/v1/menu_items?select=name&restaurant_id=eq.${outlet}`;
assert.deepEqual(await request(menu + '&available_qr=eq.true'), [{ name: 'QR dish' }]);
assert.deepEqual(await request(menu + '&available_online=eq.true', customer), [{ name: 'Online dish' }]);
assert.deepEqual(await request(menu + '&available_room=eq.true', customer), []);
assert.deepEqual(await request(menu + '&available_room=eq.true&is_available=eq.true', owner), [{ name: 'Room dish' }]);
assert.deepEqual(await request('/rest/v1/menu_option_choices?select=name', customer), []);
assert.deepEqual(await request('/rest/v1/menu_option_choices?select=name', owner), [{ name: 'Room extra' }]);
console.log('PASS: real Supabase Auth sessions and REST apply public and Owner catalog visibility');

const roomLine = { menu_item_id: roomDish, quantity: 1, option_choice_ids: [roomExtra] };
const quoteBody = { p_restaurant_id: outlet, p_lines: [roomLine] };
const previewBody = { ...quoteBody, p_owner_preview: true };
const preview = '/rest/v1/rpc/bite_quote_menu_options_v2_for_channel';
const ordinaryQuote = '/rest/v1/rpc/bite_quote_menu_options_v2';
const ownerQuote = await request(preview, { ...owner, body: previewBody });
assert.equal(Number(ownerQuote.food_subtotal), 125);
assert.equal(ownerQuote.authorizes_payment, false);
assert.equal(ownerQuote.quote_only, true);
assert.equal((await request(preview, { ...customer, body: previewBody, status: 403 })).code, '42501');
assert.equal((await request(ordinaryQuote, { ...owner, body: quoteBody, status: 400 })).code, '22023');
console.log('PASS: Owner room-only quote is correct and the online quote still rejects the item');

const intent = randomUUID();
const intents = '/rest/v1/bite_live_checkout_intents';
await request(intents, {
  key: service, status: 201,
  body: { id: intent, customer_id: customer.id, restaurant_id: outlet, status: 'awaiting_payment',
    priced_items: [{ menu_item_id: onlineDish, quantity: 1 }] }
});
const dish = `/rest/v1/menu_items?id=eq.${onlineDish}`;
const setOnline = value => request(dish, { key: service, method: 'PATCH', status: 204, body: { available_online: value } });
const claimPath = '/rest/v1/rpc/bite_claim_channel_payment_attempt';
const claimArgs = { p_intent_id: intent, p_customer_id: customer.id };
const claim = () => request(claimPath, { key: service, body: claimArgs });
await setOnline(false);
assert.equal(await claim(), 'menu_changed');
const getStamp = async () => (await request(`${intents}?id=eq.${intent}&select=provider_attempted_at`, { key: service }))[0].provider_attempted_at;
assert.equal(await getStamp(), null);
await setOnline(true);
assert.equal(await claim(), 'claimed');
const firstAttempt = await getStamp();
assert.ok(firstAttempt);
await setOnline(false);
assert.equal(await claim(), 'retry');
assert.equal(await getStamp(), firstAttempt);
console.log('PASS: service payment claim blocks stale baskets and preserves the first-attempt timestamp on retry');

const edgeIntent = randomUUID();
await request(intents, {
  key: service, status: 201,
  body: { id: edgeIntent, customer_id: customer.id, restaurant_id: outlet, status: 'awaiting_payment',
    priced_items: [{ menu_item_id: onlineDish, quantity: 1, unit_price: 1 }],
    confirmation_required: true, customer_snapshot: { full_name: 'BITE sandbox QA', phone: '9999999999' } }
});
const edgeStamp = async () => (await request(`${intents}?id=eq.${edgeIntent}&select=provider_attempted_at`, { key: service }))[0].provider_attempted_at;
await rehearseCashfree({ api, anon, service, customer, intent: edgeIntent, setOnline, getStamp: edgeStamp, request });
