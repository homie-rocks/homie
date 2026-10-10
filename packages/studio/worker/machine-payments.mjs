import { journalFacilitator, rpcFor } from './settlement-journal.mjs';
import { machineCapabilities } from './payment-capabilities.mjs';
/** Standards adapters: the libraries own challenges, credentials and settlement. */
import Stripe from "stripe";
import { Mppx, stripe, Transport } from "mppx/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { paymentStore } from "./purchase-core.mjs";
import { digest } from "./purchase-crypto.mjs";

import { modeOf, apiBase } from "./stripe.mjs";

export function stripeClient(env) {
  const base = new URL(apiBase(env));
  return new Stripe(env.STRIPE_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    host: base.hostname,
    port: base.port ? Number(base.port) : undefined,
    protocol: base.protocol.slice(0, -1),
  });
}

export async function paymentProtocol(
  env,
  order,
  { mcp = false, client, facilitator, realm, capabilities, chainRpc } = {},
) {
  const mode = modeOf(env.STRIPE_KEY);
  const config = JSON.parse(env.PURCHASE_MACHINE_PAYMENTS ?? "{}")[mode];
  if (!config?.profile)
    throw new Error("Configure the studio Stripe profile for machine payments");
  client ??= stripeClient(env);
  const payments = stripe.create({
    client,
    networkId: config.profile,
    livemode: mode === "live",
    metadata: { homie: "purchase-v1", order: order.id },
    store: paymentStore(env.DB, mode),
  });
  capabilities ??= await machineCapabilities(env);
  let methods = capabilities.machine.card ? [payments.spt.charge()] : [];
  if (order.resource_kind !== 'service' && config.base && capabilities.machine.base && !mcp) {
    facilitator ??= new HTTPFacilitatorClient(
      mode === "live"
        ? createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET)
        : { url: "https://x402.org/facilitator" },
    );
    methods = [
      ...methods,
      payments.base.charge({
        recipient: config.base,
        x402: { facilitator: journalFacilitator(env, order, facilitator, chainRpc ?? rpcFor(env, 'base', mode)), routeBinding: "resource" },
      }),
    ];
  }
  methods = methods.map((method) => {
    // mppx's two-phase methods call broadcast after validate; card methods use
    // verify. Capture the bound challenge before either terminal operation.
    const operation = method.broadcast ? 'broadcast' : 'verify';
    return { ...method, async [operation](context) {
      order.challengeId = context.credential.challenge.id;
      return method[operation](context);
    } };
  });
  const protocol = Mppx.create({
    methods,
    realm,
    secretKey: await digest(`${env.STRIPE_KEY}:purchase-payment-challenges`),
    ...(mcp ? { transport: Transport.mcpSdk() } : {}),
  });
  return protocol;
}
