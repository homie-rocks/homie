import { currencyScale } from './shop-rules.mjs';
export function priceWords(s, quantity = 1) {
  if (!s) return 'Free';
  const currency = String(s.currency).toUpperCase();
  const digits = Math.log10(currencyScale(s.currency));
  const shown = new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'code' }).format(s.amount * quantity / 10 ** digits);
  return `${shown}${s.billing === 'one-time' ? ' once' : ` per ${s.billing}`} ${s.taxBehavior === 'inclusive' ? 'including tax' : (s.automaticTax || s.taxBehavior === 'exclusive') ? 'before final tax calculation' : 'total'} · per ${s.scope}${quantity > 1 ? ` · ${quantity} units` : ''}`;
}
