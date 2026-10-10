/** Review 4: an unmodified MCP SDK client (Streamable HTTP) and mppx's own MCP payment wrapper against the Worker. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpClient } from 'mppx/mcp/client';
import { stripe } from 'mppx/client';
import { seller } from './paid-parts-review4-seller.mjs';
import { sale$ } from './paid-parts-review4-harness.mjs';
const say = (...a) => console.log('#', ...a);
const MCP = 'https://seller.example/api/purchases/mcp';

test('P1 MCP SDK client: initialize, tools/list, unpaid call, paid call through mppx McpClient.wrap', async () => {
  const w = await seller('p1'); let client; try {
    const part = await (await fetch('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const args = { kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'e'.repeat(64), claim: 'f'.repeat(64), quote: await sale$.quoteHash(part) };
    client = new Client({ name: 'review-agent', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(MCP), { fetch: (u, i) => fetch(u, i) });
    let connected = 'ok'; try { await client.connect(transport); } catch (e) { connected = `THREW ${e.message}`; }
    say('P1 connect:', connected, '| negotiated', client.getServerVersion?.() && JSON.stringify(client.getServerVersion()), '| capabilities', JSON.stringify(client.getServerCapabilities?.()));
    assert.equal(connected, 'ok');
    const tools = await client.listTools().catch((e) => ({ error: e.message }));
    say('P1 tools/list:', JSON.stringify(tools).slice(0, 500));
    const unknown = await client.callTool({ name: 'nope', arguments: {} }).catch((e) => `THREW ${e.constructor.name} code=${e.code} ${e.message.slice(0, 120)}`);
    say('P1 unknown tool:', typeof unknown === 'string' ? unknown : JSON.stringify(unknown).slice(0, 200));
    const other = await client.listResources().catch((e) => `THREW ${e.constructor.name} code=${e.code} ${e.message.slice(0, 120)}`);
    say('P1 resources/list (a method the server does not have):', typeof other === 'string' ? other : JSON.stringify(other).slice(0, 100));
    const unpaid = await client.callTool({ name: 'purchase', arguments: args }).catch((e) => e);
    say('P1 unpaid tools/call ->', unpaid?.constructor?.name, 'code', unpaid?.code, '| data keys', Object.keys(unpaid?.data ?? {}), '| methods', (unpaid?.data?.challenges ?? []).map((c) => `${c.method}/${c.intent} request-is-object=${typeof c.request === 'object'}`).join(','));
    assert.equal(unpaid.code, -32042);
    let approved = 0; w.st.spts.set('spt_mcp_1', { max: 1000, currency: 'usd' });
    McpClient.wrap(client, { methods: [stripe.charge({ paymentMethod: 'pm_card', createToken: async ({ amount, currency }) => { approved++; say('P1 wallet asked for', amount, currency); return 'spt_mcp_1'; } })] });
    const paid = await client.callTool({ name: 'purchase', arguments: args }).catch((e) => e);
    if (paid instanceof Error) say('P1 paid call THREW', paid.code, paid.message.slice(0, 300));
    else { const first = JSON.parse(paid.content[0].text); say('P1 paid: receipt', JSON.stringify(paid.receipt), '| content items', paid.content.length, paid.content.slice(1).map((c) => c.type + ':' + c.resource?.uri?.slice(0, 22)).join(' '), '| proof', Boolean(first.proof), '| files named in text', first.manifest.files.length, '| isError', paid.isError); }
    assert.ok(!(paid instanceof Error));
    const again = await client.callTool({ name: 'purchase', arguments: args }).catch((e) => e);
    say('P1 same claim again: receipt', JSON.stringify(again.receipt ?? again?.message), '| wallet approvals', approved, '| charges', [...w.st.pis.values()].length);
    assert.ok(!(again instanceof Error), again.message);
    assert.equal(again.receipt.challengeId, paid.receipt.challengeId);
    assert.equal(again.content.length, paid.content.length);
    assert.equal(approved, 1);
    const paths = JSON.parse(paid.content[0].text).manifest.files.map((f) => f.path);
    say('P1 do the resource blobs say which file they are?', JSON.stringify(paid.content.slice(1, 3).map((c) => Object.keys(c.resource))), 'manifest paths', paths.length);
  } finally { try { await client?.close(); } finally { await w.close(); } }
});

test('P2 MCP: recurring, non-USD and missing settings answer inside the protocol', async () => {
  const w = await seller('p2', { saleOpts: { billing: 'month' } }); let client; try {
    const part = await (await fetch('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const args = { kind: 'part', resource: 'camera', version: '0.1.0', buyer: 'e'.repeat(64), claim: 'f'.repeat(64), quote: await sale$.quoteHash(part) };
    client = new Client({ name: 'review-agent', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP), { fetch: (u, i) => fetch(u, i) }));
    const r = await client.callTool({ name: 'purchase', arguments: args }).catch((e) => `THREW ${e.constructor.name} code=${e.code} ${e.message.slice(0, 200)}`);
    say('P2 recurring part over MCP:', typeof r === 'string' ? r : JSON.stringify(r).slice(0, 200));
    const raw = await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'purchase', arguments: args } }) });
    say('P2 raw HTTP:', raw.status, raw.headers.get('content-type'), (await raw.text()).slice(0, 160));
    const get = await fetch(MCP, { headers: { accept: 'text/event-stream' } }); say('P2 GET (SSE stream request):', get.status, get.headers.get('allow'));
    const init = await (await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }) })).json();
    assert.deepEqual(init.result.capabilities.experimental.payment.methods.stripe, { intents: ['charge'] });
    assert.equal(init.result.protocolVersion, '2025-03-26');
    say('P2 initialize asking for 2025-03-26 ->', init.result.protocolVersion, '| capabilities', JSON.stringify(init.result.capabilities));
  } finally { try { await client?.close(); } finally { await w.close(); } }
});
