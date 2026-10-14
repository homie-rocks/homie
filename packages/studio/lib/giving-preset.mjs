/** Defaults shared by shop init and the upgrade of an untouched earlier preset. */
export function givingItems(amounts = [1000, 2000, 2500, 5000]) {
  return amounts.flatMap(amount => [false, true].map(monthly => ({
    id: `gift-${amount}${monthly ? '-monthly' : ''}`, kind: 'donation',
    name: monthly ? 'Monthly gift' : 'One-time gift', price: amount,
    ...(monthly ? { interval: 'month' } : {}), gives: [],
    blurb: monthly ? 'Give this amount each month. Manage your gift through Stripe.' : 'A gift to support our work.',
  })));
}
