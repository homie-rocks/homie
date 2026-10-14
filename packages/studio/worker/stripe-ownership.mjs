/** Subscription metadata takes precedence over invoice-level metadata. */
export function stripeEventOwner(object) {
  const metadata = object.parent?.subscription_details?.metadata ?? object.subscription_details?.metadata ?? object.metadata;
  if (['shop-links-v1', 'shop-v1'].includes(metadata?.homie)) return 'shop';
  if (['purchase-links-v1', 'purchase-v1'].includes(metadata?.homie)) return 'parts';
  return null;
}
