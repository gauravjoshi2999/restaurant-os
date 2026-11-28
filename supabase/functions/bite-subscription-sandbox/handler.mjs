const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const sandboxOrders = 'https://sandbox.cashfree.com/pg/orders';

function reply(status, data) {
 return Response.json(data, {status, headers: {'cache-control': 'no-store'}});
}

async function verifyPayment({scope, receipt, fetchProvider, headers}) {
 let stored;
 try { stored = await receipt(scope); }
 catch { return reply(503, {error: 'Could not load sandbox attempt'}); }
 if (stored.error?.code === '42501') return reply(403, {error: 'Active property Owner required'});
 const attempt = stored.data;
 if (stored.error || attempt?.attempt_id !== scope.p_attempt || attempt.currency !== 'INR'
     || !Number.isSafeInteger(attempt.amount_paise) || attempt.amount_paise <= 0) {
  return reply(503, {error: 'Could not load sandbox attempt'});
 }
 const verified = record => reply(200, {environment: 'sandbox', status: 'verified', receipt: record});
 if (attempt.receipt) return verified(attempt.receipt);

 const orderId = 'bite_st_' + attempt.attempt_id.replaceAll('-', '');
 const orderUrl = sandboxOrders + '/' + orderId;
 async function getProviderData(url) {
  const response = await fetchProvider(url, {headers, redirect: 'error', signal: AbortSignal.timeout(12_000)});
  if (!response.ok) throw Error('Provider GET failed');
  return await response.json();
 }

 let paymentId;
 try {
  const order = await getProviderData(orderUrl);
  const amount = attempt.amount_paise / 100;
  if (order?.order_id !== orderId || order.order_currency !== 'INR' || Number(order.order_amount) !== amount) {
   return reply(409, {error: 'Sandbox order does not match the checkout'});
  }
  if (order.order_status === 'ACTIVE') {
   return reply(200, {environment: 'sandbox', status: 'awaiting_payment'});
  }
  if (['EXPIRED','TERMINATED'].includes(order.order_status)) {
   const payments=await getProviderData(orderUrl+'/payments');
   const closed=['FAILED','USER_DROPPED','NOT_ATTEMPTED','VOID','CANCELLED'];
   if (Array.isArray(payments)&&payments.every(payment=>closed.includes(payment?.payment_status))) {
    return reply(200, {environment:'sandbox',status:'expired'});
   }
   return reply(200, {environment:'sandbox',status:'awaiting_payment'});
  }
  if (order.order_status !== 'PAID') {
   return reply(409, {error: 'Sandbox order is not confirmed paid'});
  }
  const payments = await getProviderData(orderUrl + '/payments');
  if (!Array.isArray(payments)) throw Error('Invalid payment list');
  const successful = payments.filter(payment => payment?.payment_status === 'SUCCESS');
  const payment = successful[0];
  const id = payment?.cf_payment_id;
  if (successful.length !== 1 || payment.order_id !== orderId || payment.payment_currency !== 'INR'
      || Number(payment.payment_amount) !== amount
      || !(typeof id === 'string' || Number.isSafeInteger(id))
      || !/^[0-9]{1,32}$/.test(String(id))) {
   return reply(409, {error: 'A unique matching sandbox payment was not confirmed'});
  }
  paymentId = String(id);
 } catch { return reply(503, {error: 'Sandbox payment verification unavailable'}); }

 try {
  const recorded = await receipt({
   ...scope, p_payment_id: paymentId, p_amount_paise: attempt.amount_paise, p_currency: attempt.currency
  });
  if (recorded.error?.code === '42501') return reply(403, {error: 'Active property Owner required'});
  if (recorded.error?.code === '22023') return reply(409, {error: 'Sandbox payment evidence conflicts with an existing receipt'});
  if (!recorded.error && recorded.data?.receipt) return verified(recorded.data.receipt);
 } catch { /* The Owner can retry the same attempt. */ }
 return reply(503, {error: 'Could not record sandbox payment. Retry verification.'});
}

export function createSandboxHandler({env, authenticate, prepare, receipt, subscription, fetchProvider = fetch, now = Date.now}) {
 return async function handle(request) {
  if (request.method !== 'POST') return reply(405, {error: 'Use POST'});
  const app = env('BITE_SUBSCRIPTION_CASHFREE_TEST_APP_ID');
  const secret = env('BITE_SUBSCRIPTION_CASHFREE_TEST_SECRET_KEY');
  if (env('BITE_SUBSCRIPTION_SANDBOX_ENABLED') !== 'true' || !app || !secret) {
   return reply(503, {error: 'Subscription sandbox is disabled'});
  }
  const token = request.headers.get('authorization') ?? '';
  if (!token.startsWith('Bearer ')) return reply(401, {error: 'Owner login required'});

  let body;
  try { body = await request.json(); } catch { return reply(400, {error: 'Invalid checkout request'}); }
  const checking = body?.action === 'verify', reading = body?.action === 'status';
  if ((checking || reading) && (!isUuid(body?.property_id) || (checking && !isUuid(body?.attempt_id)))) {
   return reply(400, {error: 'Choose a property and checkout attempt'});
  }
  if (!checking && !reading && (!isUuid(body?.property_id) || !isUuid(body?.request_id)
      || !Number.isInteger(body?.catalog_version) || body.catalog_version < 1 || body.catalog_version > 2147483647
      || typeof body?.offer_code !== 'string' || !/^[a-z_0-9]{1,40}$/.test(body.offer_code))) {
   return reply(400, {error: 'Choose a property and a valid subscription offer'});
  }

  const headers = {
   'content-type': 'application/json', 'x-api-version': '2023-08-01',
   'x-client-id': app, 'x-client-secret': secret
  };
  let actor, result;
  try {
   actor = await authenticate(token);
   if (!actor) return reply(401, {error: 'Owner login required'});
   if (reading) {
    const state = await subscription({p_property:body.property_id,p_actor:actor});
    if (state.error?.code === '42501') return reply(403, {error: 'Active property Owner required'});
    if (state.error || !state.data) return reply(503, {error: 'Sandbox subscription usage unavailable'});
    return reply(200, {environment:'sandbox',subscription:state.data});
   }
   if (checking) return verifyPayment({
    scope: {p_property: body.property_id, p_actor: actor, p_attempt: body.attempt_id.toLowerCase()},
    receipt, fetchProvider, headers
   });
   result = await prepare({
    p_property: body.property_id, p_actor: actor, p_request: body.request_id,
    p_catalog_version: body.catalog_version, p_offer_code: body.offer_code
   });
  } catch { return reply(503, {error: 'Could not prepare sandbox checkout'}); }
  if (result.error) {
   if (result.error.code === '42501') return reply(403, {error: 'Active property Owner required'});
   if (result.error.code === '22023') return reply(409, {error: 'Subscription offer or request ID is invalid'});
   return reply(503, {error: 'Could not prepare sandbox checkout'});
  }

  const attempt = result.data;
  const expiryMs = Date.parse(attempt?.expires_at);
  if (!isUuid(attempt?.attempt_id) || !Number.isSafeInteger(attempt.amount_paise)
      || attempt.amount_paise < 100 || attempt.currency !== 'INR'
      || !Number.isFinite(expiryMs)) {
   return reply(409, {error: 'Sandbox attempt unavailable'});
  }
  const checkPayment = () => reply(200, {
   environment: 'sandbox', status: 'check_payment', attempt_id: attempt.attempt_id
  });
  if (expiryMs <= now() + 5 * 60_000) return checkPayment();

  const orderId = 'bite_st_' + attempt.attempt_id.replaceAll('-', '');
  const amount = attempt.amount_paise / 100;
  const paymentRequest = {
   order_id: orderId, order_amount: amount, order_currency: 'INR',
   order_expiry_time: new Date(expiryMs).toISOString(),
   customer_details: {customer_id: orderId, customer_name: 'BITE Sandbox', customer_phone: '9999999999'}
  };
  let response, order;
  try {
   response = await fetchProvider(sandboxOrders, {
    method: 'POST', headers: {...headers, 'x-idempotency-key': attempt.attempt_id},
    body: JSON.stringify(paymentRequest), redirect: 'error', signal: AbortSignal.timeout(12_000)
   });
   if (response.status === 409) {
    response = await fetchProvider(sandboxOrders + '/' + orderId, {
     headers, redirect: 'error', signal: AbortSignal.timeout(12_000)
    });
   }
   order = await response.json();
  } catch { return reply(503, {error: 'Sandbox provider unavailable. Retry the same request.'}); }
  if (!response.ok || order?.order_id !== orderId || order.order_currency !== 'INR'
      || Number(order.order_amount) !== amount) {
   return reply(503, {error: 'Sandbox provider order could not be confirmed'});
  }
  if (['PAID', 'EXPIRED', 'TERMINATED'].includes(order.order_status)) return checkPayment();
  const orderExpiry = Date.parse(order.order_expiry_time);
  if (order.order_status !== 'ACTIVE' || typeof order.payment_session_id !== 'string' || !order.payment_session_id
      || !Number.isFinite(orderExpiry) || orderExpiry <= now() + 5 * 60_000 || orderExpiry > expiryMs) {
   return reply(409, {error: 'Sandbox order is no longer payable. Check its status.'});
  }
  return reply(200, {
   environment: 'sandbox', attempt_id: attempt.attempt_id, order_id: orderId,
   amount, currency: 'INR', payment_session_id: order.payment_session_id, expires_at: order.order_expiry_time
  });
 };
}
