import { purchaseResponse } from './purchase-response.mjs';
import { machineCapabilities } from './payment-capabilities.mjs';
/** The SDK owns protocol negotiation, JSON-RPC errors and stateless HTTP transport. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { machineResource } from './purchase-machine.mjs';
export const purchaseSchema = {
  type: 'object', required: ['kind', 'resource', 'version', 'buyer', 'claim', 'offerVersion'],
  properties: {
    kind: { type: 'string' }, resource: { type: 'string' }, version: { type: 'string' },
    buyer: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'A random private buyer identifier.' },
    claim: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'A new private random 32-byte hex secret for this purchase. Keep it to retrieve this order.' },
    offerVersion: { type: 'string', description: 'The published immutable offer version.' },
    quantity: { type: 'integer', minimum: 1, default: 1 }, game: { type: 'string' },
  },
};
export async function purchaseMcp(request, env, url, cat) {
  let delivery;
  const capability = await machineCapabilities(env);
  const methods = Object.fromEntries([...(capability.machine.card ? ['stripe'] : []), ...(capability.machine.tempo ? ['tempo'] : [])].map((method) => [method, { intents: ['charge'] }]));
  const server = new Server({ name: 'Studio purchases', version: '1' }, {
    capabilities: { tools: {}, experimental: { payment: { methods } } },
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
    name: 'purchase', description: 'Pay for the published offer and receive files, receipt and proof. Unpaid challenges expire after five minutes.', inputSchema: purchaseSchema,
  }] }));
  server.setRequestHandler(CallToolRequestSchema, async (input, extra) => {
    if (input.params.name !== 'purchase') return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
    const result = await machineResource(new Request(request.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input.params.arguments) }), env, url, cat, {
      mcpInput: input.params.arguments, setDelivery: (data) => { delivery = data; }, extra: { ...extra, _meta: input.params._meta },
    });
    if (result instanceof Response) return { isError: true, content: [{ type: 'text', text: await result.text() }] };
    return result;
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  if (!delivery) return response;
  const envelope = await response.json();
  return purchaseResponse(delivery, env, { mcp: true, envelope });
}
