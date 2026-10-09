/** The subset used by the shop, not a general Stripe emulator. Checked against Stripe's docs 2026-10-08:
 * https://docs.stripe.com/api/products/create
 * https://docs.stripe.com/api/prices/create?query=custom_unit_amount
 * https://docs.stripe.com/api/payment_links/payment_links/create?query=line_items
 * https://docs.stripe.com/api/webhook_endpoints/create
 * https://docs.stripe.com/api/checkout/sessions/create?query=line_items
 * https://docs.stripe.com/payments/checkout/pay-what-you-want?payment-ui=stripe-hosted
 * https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
 * The stand-in settles USD: its custom-amount floor is 50 minor units. Real floors depend on settlement currency.
 */
export function stripeValidation(path, form, catalog) {
  const invalid = (param, message) => { throw { type: 'invalid_request_error', param, message }; };
  const required = (key) => { if (!form.get(key)) invalid(key, `Missing required param: ${key}.`); };
  const integer = (key, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    const value = form.get(key);
    if (value === null || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) invalid(key, `Invalid integer for ${key}.`);
    return Number(value);
  };
  const choice = (key, values) => { if (form.has(key) && !values.includes(form.get(key))) invalid(key, `Invalid ${key}: must be one of ${values.join(', ')}.`); };
  const currency = (key) => { required(key); if (!/^[a-z]{3}$/.test(form.get(key))) invalid(key, 'Invalid currency.'); };
  const url = (key) => {
    required(key);
    try { if (!['https:', 'http:'].includes(new URL(form.get(key)).protocol)) throw new Error(); } catch { invalid(key, 'Invalid URL.'); }
  };
  for (const [key] of form) if (/(?:^|\[)(active|enabled|disabled)\]?$/.test(key)) choice(key, ['true', 'false']);
  if (path === '/v1/products') required('name');
  if (path === '/v1/prices') {
    currency('currency'); required('product');
    if (!catalog.products.some((p) => p.id === form.get('product'))) invalid('product', 'No such product.');
    choice('tax_behavior', ['exclusive', 'inclusive', 'unspecified']);
    if (form.has('custom_unit_amount[enabled]')) {
      choice('custom_unit_amount[enabled]', ['true']);
      if (form.has('unit_amount')) invalid('unit_amount', 'You may only specify one amount type.');
      const min = form.has('custom_unit_amount[minimum]') ? integer('custom_unit_amount[minimum]') : 50;
      if (min < 50) invalid('custom_unit_amount[minimum]', '`custom_unit_amount.minimum` must convert to at least 50 cents.');
      if (form.has('custom_unit_amount[maximum]')) integer('custom_unit_amount[maximum]', min);
    } else integer('unit_amount'); // Stripe explicitly permits zero for a free fixed price.
  }
  if (path === '/v1/payment_links') {
    const indices = [...new Set([...form.keys()].map((k) => /^line_items\[(\d+)\]/.exec(k)?.[1]).filter(Boolean))];
    if (!indices.length || indices.length > 20) invalid('line_items', 'Specify between 1 and 20 line items.');
    for (const i of indices) {
      const prefix = `line_items[${i}]`;
      required(`${prefix}[price]`);
      const price = catalog.prices.find((p) => p.id === form.get(`${prefix}[price]`));
      if (!price || !price.active) invalid(`${prefix}[price]`, 'No such active price.');
      const quantity = integer(`${prefix}[quantity]`, 1);
      if (price.custom_unit_amount && (indices.length !== 1 || quantity !== 1 || form.has(`${prefix}[adjustable_quantity][enabled]`))) invalid('line_items', 'Custom amount prices require one item with quantity 1 and no adjustable quantity.');
      const adjustable = `${prefix}[adjustable_quantity]`;
      if (form.has(`${adjustable}[minimum]`)) integer(`${adjustable}[minimum]`);
      if (form.has(`${adjustable}[maximum]`)) integer(`${adjustable}[maximum]`, Number(form.get(`${adjustable}[minimum]`) ?? 0), 999999);
    }
    choice('after_completion[type]', ['redirect', 'hosted_confirmation']);
    if (form.get('after_completion[type]') === 'redirect') url('after_completion[redirect][url]');
  }
  if (path === '/v1/webhook_endpoints') {
    url('url');
    const events = [...form].filter(([k]) => /^enabled_events\[\d+\]$/.test(k)).map(([, v]) => v);
    // The events the shop uses, plus '*'; extend this documented subset when the shop subscribes to more.
    const supported = ['*', 'payment_intent.succeeded', 'invoice.paid', 'invoice_payment.paid', 'invoice.payment_failed', 'customer.subscription.updated', 'customer.subscription.deleted', 'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed', 'charge.dispute.created', 'charge.dispute.closed'];
    if (!events.length || events.some((e) => !supported.includes(e))) invalid('enabled_events', 'Specify valid enabled_events.');
  }
  if (path === '/v1/checkout/sessions') {
    required('mode'); choice('mode', ['payment', 'subscription', 'setup']);
    for (const [key] of form) {
      if (key.includes('[custom_unit_amount]')) invalid(key, 'Received unknown parameter: custom_unit_amount');
      if (key.endsWith('[price_data][currency]')) currency(key);
      if (key.endsWith('[price_data][currency]')) integer(key.replace('[currency]', '[unit_amount]'));
    }
  }
}
