import '../customer-resources.mjs';
import { customerTools, paidTool } from '../customer-mcp.mjs';
import { productDescription, entryDescription, discoveryRoutes } from '../parts-purchase-catalogue.mjs';
import { officeScript } from '../purchase-office-script.mjs';
import { officeRoutes } from '../purchase-office-routes.mjs';
import { refundOrder, extendOffice } from '../purchase-office.mjs';
import worker from '../index.mjs';
export * from '../index.mjs';
import { useSelling } from '../extensions.mjs';
import { jobsSQL } from '../payment-policy.mjs';
import { manualRefundDetails } from '../payment-manual-refund.mjs';
import { confirmManualRefund } from '../payment-manual-refund.mjs';
import { listOffers } from '../resource-kinds.mjs';
import { orderFact } from '../purchase-core.mjs';
import { byId as resourceOrder } from '../purchase-store.mjs';
import { currentPurchaseOrder } from '../purchases.mjs';
import { purchasePaymentEvent } from '../purchases.mjs';
import { refundPurchasePayment } from '../purchases.mjs';
import { purchaseReadiness } from '../purchases.mjs';
import { purchaseRoutes } from '../purchase-routes.mjs';
import { recordOrderState } from '../purchase-core.mjs';
import { authorizePurchaseTest } from '../purchases.mjs';
import { expirePurchaseCheckouts } from '../purchases.mjs';
import { reissuePurchaseClaim } from '../purchases.mjs';
import { retireResource } from '../purchases.mjs';
import { reconcileRecordings } from '../payment-recovery.mjs';
import { machineCapabilities } from '../payment-capabilities.mjs';
import { paidFile } from '../parts-protected.mjs';
import { priceWords } from '../purchase-pricing.mjs';
import { purchaseDiscovery } from '../purchase-discovery.mjs';
import { testPaymentExchange } from '../payment-test-exchange.mjs';
useSelling({ enabled: true, customerTools, paidTool, productDescription, entryDescription, discoveryRoutes, officeScript, officeRoutes, refundOrder, extendOffice, testPaymentExchange, jobsSQL, manualRefundDetails, confirmManualRefund, listOffers, orderFact, resourceOrder, currentPurchaseOrder, purchasePaymentEvent, refundPurchasePayment, purchaseReadiness, purchaseRoutes, recordOrderState, authorizePurchaseTest, expirePurchaseCheckouts, reissuePurchaseClaim, retireResource, reconcileRecordings, machineCapabilities, paidFile, priceWords, purchaseDiscovery });
export default { ...worker,
  async scheduled(controller, env, ctx) {
    await worker.scheduled(controller, env, ctx);
    if (!env.PURCHASE_MACHINE_PAYMENTS || !env.DB) return;
    const { refreshMachineCapabilities } = await import('../payment-capabilities.mjs');
    const errors = [];
    for (const step of [reconcileRecordings, refreshMachineCapabilities, expirePurchaseCheckouts]) {
      try { await step(env); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Selling maintenance needs retry');
  },
};
