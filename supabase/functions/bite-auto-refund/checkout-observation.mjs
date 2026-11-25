// Read-only investigation of stale checkout intents. No ledger writes, order
// activation, Cashfree POST, refund, settlement or bank-credit inference here.
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const cents = v => {
  if (!((typeof v === 'number' && Number.isFinite(v)) ||
      (typeof v === 'string' && /^\d+(\.\d{1,2})?$/.test(v)))) return null;
  const n = Number(v), c = Math.round(n * 100);
  return n > 0 && Number.isSafeInteger(c) && Math.abs(n - c / 100) < 1e-9 ? c : null;
};
const orderStatuses = ['ACTIVE', 'PAID', 'EXPIRED', 'TERMINATED', 'TERMINATION_REQUESTED'];
const paymentStatuses = ['SUCCESS', 'NOT_ATTEMPTED', 'FAILED', 'USER_DROPPED', 'VOID', 'CANCELLED', 'PENDING'];
const fields = 'id,customer_id,restaurant_id,amount,currency,status,provider_order_id,activated_order_id,created_at';

export async function observePendingCheckouts({db, providerFetch, appId, secret, offset = 0, now = Date.now()}) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw Error('Invalid observation offset');
  if (!appId || !secret) throw Error('Provider unavailable');
  // Recent active checkouts stay outside this diagnostic. Oldest-first paging
  // is stable while this observer leaves every source record unchanged.
  const {data, error} = await db.from('bite_live_checkout_intents').select(fields)
    .eq('status', 'awaiting_payment').lt('created_at', new Date(now - 30 * 60000).toISOString())
    .order('created_at', {ascending:true}).order('id', {ascending:true}).range(offset, offset + 5);
  if (error || !Array.isArray(data) || data.length > 6) throw Error('Checkout observation unavailable');
  const stats = {
    status:'checkout_observation', offset, examined:data.length,
    reference_missing:0, invalid_intent:0, changed_during_check:0, checkout_recheck_unavailable:0,
    provider_not_found:0, provider_unavailable:0, provider_mismatch:0,
    order_statuses:Object.fromEntries(orderStatuses.map(s => [s, 0])),
    payment_lookup_unavailable:0, payment_response_mismatch:0,
    payment_attempts:0, orders_with_no_payment_attempts:0,
    payment_statuses:Object.fromEntries(paymentStatuses.map(s => [s, 0])),
    paid_without_matching_success:0, success_without_paid_order:0, multiple_successes:0,
    no_action_taken:true, order_activated:false, charge_sent:false, refund_sent:false,
    bank_credit_independently_verified:false, observed_at:new Date(now).toISOString()
  };
  const get = async path => {
    try {
      const r = await providerFetch('https://api.cashfree.com/pg' + path, {
        method:'GET', redirect:'error', signal:AbortSignal.timeout(8000),
        headers:{'x-api-version':'2023-08-01', 'x-client-id':appId, 'x-client-secret':secret}
      });
      return {status:r.status, ok:r.ok, data:r.ok ? await r.json() : null};
    } catch { return {status:0, ok:false, data:null}; }
  };
  async function inspect(intent) {
    if (!uuid(intent?.id) || !uuid(intent?.customer_id) || !uuid(intent?.restaurant_id) ||
        intent.status !== 'awaiting_payment' || intent.activated_order_id !== null ||
        intent.currency !== 'INR' || cents(intent.amount) === null ||
        !Number.isFinite(Date.parse(intent.created_at)) ||
        Date.parse(intent.created_at) >= now - 30 * 60000) {
      stats.invalid_intent++; return;
    }
    const canonicalId = 'bite_live_' + intent.id.replaceAll('-', '');
    if (intent.provider_order_id !== null && intent.provider_order_id !== '' &&
        intent.provider_order_id !== canonicalId) { stats.invalid_intent++; return; }
    if (!intent.provider_order_id) stats.reference_missing++;
    // A missing stored reference is not proof that a timed-out create failed.
    // Probe only the deterministic reference already used by checkout verify.
    const order = await get('/orders/' + encodeURIComponent(canonicalId));
    if (order.status === 404) { stats.provider_not_found++; return; }
    if (!order.ok) { stats.provider_unavailable++; return; }
    const cf = order.data;
    if (!cf || cf.order_id !== canonicalId || cf.order_currency !== 'INR' ||
        cents(cf.order_amount) !== cents(intent.amount) ||
        cf.customer_details?.customer_id !== intent.customer_id ||
        !orderStatuses.includes(cf.order_status)) { stats.provider_mismatch++; return; }
    const payments = await get('/orders/' + encodeURIComponent(canonicalId) + '/payments');
    // Do not attach a completed observation to a changed customer/restaurant,
    // amount, provider reference or order state after an in-flight request.
    const fresh = await db.from('bite_live_checkout_intents').select(fields).eq('id', intent.id).maybeSingle();
    const current = fresh.data;
    if (fresh.error) { stats.checkout_recheck_unavailable++; return; }
    if (!current || ['id','customer_id','restaurant_id','currency','status',
        'provider_order_id','activated_order_id','created_at'].some(k => current[k] !== intent[k]) ||
        cents(current.amount) !== cents(intent.amount)) { stats.changed_during_check++; return; }
    stats.order_statuses[cf.order_status]++;
    if (!payments.ok) { stats.payment_lookup_unavailable++; return; }
    const rows = payments.data;
    const ids = new Set();
    if (!Array.isArray(rows) || rows.length > 100 || rows.some(p => {
      const id = String(p?.cf_payment_id ?? '');
      if (!/^[0-9]{1,40}$/.test(id) ||
          (typeof p.cf_payment_id === 'number' && !Number.isSafeInteger(p.cf_payment_id)) ||
          ids.has(id) || p.order_id !== canonicalId ||
          p.payment_currency !== 'INR' || cents(p.payment_amount) !== cents(intent.amount) ||
          !paymentStatuses.includes(p.payment_status)) return true;
      ids.add(id); return false;
    })) { stats.payment_response_mismatch++; return; }
    stats.payment_attempts += rows.length;
    if (!rows.length) stats.orders_with_no_payment_attempts++;
    for (const p of rows) stats.payment_statuses[p.payment_status]++;
    const successes = rows.filter(p => p.payment_status === 'SUCCESS').length;
    if (cf.order_status === 'PAID' && successes !== 1) stats.paid_without_matching_success++;
    if (cf.order_status !== 'PAID' && successes > 0) stats.success_without_paid_order++;
    if (successes > 1) stats.multiple_successes++;
  }
  // Six intents, at most twelve GETs, two intents concurrently. Bounded even
  // during provider timeouts; one failing lookup cannot become a paid label.
  for (let i = 0; i < data.length; i += 2) {
    await Promise.all(data.slice(i, i + 2).map(async intent => {
      try { await inspect(intent); } catch { stats.provider_unavailable++; }
    }));
  }
  // Aggregate-only output: no IDs, amounts, contact/bank data, payment session
  // IDs, provider payloads or credentials escape this signed service branch.
  return stats;
}
