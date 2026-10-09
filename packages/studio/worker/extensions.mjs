/** Optional selling integration. Only the selling entry installs provider adapters. */
export const selling = {
  enabled: false,
  machineCapabilities: () => ({ machine: {} }),
  priceWords: () => 'Free',
  purchaseRoutes: () => null,
  purchasePaymentEvent: () => null,
  resourceOrder: () => null,
  listOffers: () => [],
  paidFile: () => new Response('not found', { status: 404 }),
  jobsSQL: () => '0',
};
export function useSelling(adapters) { Object.assign(selling, adapters); }
