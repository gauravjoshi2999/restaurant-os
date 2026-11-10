/* Shared Owner behavior. No credentials or privileged access live in this file. */
(function (root) {
  'use strict';
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const round = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
  function day(value = new Date()) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key).value).join('-');
  }
  function range(from, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      throw new Error('Sahi date range select karein.');
    }
    const start = new Date(from + 'T00:00:00+05:30');
    const end = new Date(to + 'T00:00:00+05:30');
    end.setUTCDate(end.getUTCDate() + 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  function activatePage(doc, id) {
    doc.querySelectorAll('#mainApp .page').forEach(page => {
      const active = page.id === id;
      page.classList.toggle('active', active);
      page.hidden = !active;
      // Old mobile recovery wrote inline !important styles on every page.
      page.style.removeProperty('display');
      page.style.removeProperty('visibility');
      page.setAttribute('aria-hidden', String(!active));
    });
    doc.querySelectorAll('.nav button[data-page]').forEach(button => {
      const active = button.dataset.page === id;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
  function financialSummary(orders, financials) {
    const byOrder = new Map(financials.filter(f => !f.is_demo).map(f => [f.order_id, f]));
    const paid = orders.filter(o => !o.is_demo && !o.isDemo &&
      ['paid','partially_refunded','refunded'].includes(String(byOrder.get(o.id)?.payment_status).toLowerCase()));
    const sum = key => round(paid.reduce((total, o) => total + number(byOrder.get(o.id)[key]), 0));
    const gross = sum('customer_payable_amount');
    const refunds = sum('refund_amount_actual');
    const commission = sum('commission_amount');
    const platformDiscount = sum('platform_discount');
    const feesKnown = paid.every(o => byOrder.get(o.id).provider_fee_actual != null);
    const fees = feesKnown ? sum('provider_fee_actual') : null;
    return { paid, gross, refunds, net: round(gross - refunds), commission, platformDiscount, fees,
      payable: feesKnown ? round(gross - refunds + platformDiscount - commission - fees) : null };
  }
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  const api = { number, round, day, range, activatePage, financialSummary, csvCell };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BiteOwner = api;
})(typeof window !== 'undefined' ? window : globalThis);
