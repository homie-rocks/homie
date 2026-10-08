/**
 * Cloudflare's own figures for a studio's rooms, read from its GraphQL Analytics API: what the rooms of one Worker
 * (or one room object) were billed for over a stretch of time. It is how the real-Cloudflare measurement of a
 * server-hosted room (T1 in rooms-milestone-1-design.md, section 12) is checked against the arithmetic the deploy
 * plan states (lib/cloudflare.mjs `hostedUse`), and how "a room everyone has left stops being billed" is seen on
 * Cloudflare's side and not only in the room's own log.
 *
 * It reads; it changes nothing. It needs an API token that may read Account Analytics, which the caller supplies
 * (never stored, never logged, never in a result).
 *
 * NOT YET RUN AGAINST CLOUDFLARE. The two datasets and their fields are Cloudflare's published ones
 * (`durableObjectsInvocationsAdaptiveGroups`, `durableObjectsPeriodicGroups`), but this file has only been run
 * against a stand-in for the API (test/rules-usage.test.mjs). Its first real run must confirm the field names and
 * the units before any number from it is quoted.
 */
import { hostedUse } from './cloudflare.mjs';

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const QUERY = `query RoomUsage($account: String!, $filter: AccountDurableObjectsInvocationsAdaptiveGroupsFilter_InputObject!, $periodic: AccountDurableObjectsPeriodicGroupsFilter_InputObject!) {
  viewer { accounts(filter: { accountTag: $account }) {
    invocations: durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: $filter) { sum { requests errors responseBodySize wallTime } }
    periodic: durableObjectsPeriodicGroups(limit: 10000, filter: $periodic) { sum { activeTime cpuTime duration inboundWebsocketMsgCount outboundWebsocketMsgCount rowsRead rowsWritten subrequests exceededCpuErrors exceededMemoryErrors fatalInternalErrors } }
  } }
}`;

/** Cloudflare bills twenty incoming socket messages as one request. */
export const SOCKET_MESSAGES_PER_REQUEST = 20;

const total = (groups, key) => (Array.isArray(groups) ? groups : []).reduce((n, g) => n + (Number(g?.sum?.[key]) || 0), 0);

/**
 * What Cloudflare counted between `since` and `until` (ISO times) for the Durable Objects of one Worker script,
 * or for one object of it (`objectId`).
 * Returns { ok, requests, socketMessagesIn, socketMessagesOut, billedRequests, gbSeconds, cpuMs, activeMs, rowsWritten,
 * rowsRead, errors, exceeded } or { ok: false, why }.
 */
export async function cfUsage({ accountId, token, script, since, until, objectId = null, fetchFn = globalThis.fetch }) {
  if (!accountId || !token || !script) return { ok: false, why: 'needs the account id, an API token that may read Account Analytics, and the Worker\'s name' };
  if (Number.isNaN(Date.parse(since)) || Number.isNaN(Date.parse(until)) || Date.parse(until) <= Date.parse(since)) return { ok: false, why: 'needs a stretch of time: since and until, as ISO times' };
  const filter = { datetime_geq: new Date(since).toISOString(), datetime_leq: new Date(until).toISOString(), scriptName: script, ...(objectId ? { objectId } : {}) };
  let body;
  try {
    const res = await fetchFn(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query: QUERY, variables: { account: accountId, filter, periodic: filter } }), signal: AbortSignal.timeout(30_000) });
    body = await res.json();
    if (!res.ok || body?.errors?.length) return { ok: false, why: `Cloudflare's analytics answered ${res.status}${body?.errors?.length ? `: ${String(body.errors[0]?.message ?? '').slice(0, 200)}` : ''}` };
  } catch (error) {
    return { ok: false, why: `Cloudflare's analytics could not be reached: ${String(error?.message ?? error).slice(0, 120)}` };
  }
  const acct = body?.data?.viewer?.accounts?.[0];
  if (!acct) return { ok: false, why: 'Cloudflare\'s analytics has nothing for that account' };
  const requests = total(acct.invocations, 'requests');
  const messagesIn = total(acct.periodic, 'inboundWebsocketMsgCount');
  return {
    ok: true, script, ...(objectId ? { objectId } : {}), since: filter.datetime_geq, until: filter.datetime_leq, hours: (Date.parse(until) - Date.parse(since)) / 3_600_000,
    requests, socketMessagesIn: messagesIn, socketMessagesOut: total(acct.periodic, 'outboundWebsocketMsgCount'),
    billedRequests: requests + Math.ceil(messagesIn / SOCKET_MESSAGES_PER_REQUEST),
    gbSeconds: total(acct.periodic, 'duration'),
    // Cloudflare reports processor and active time in microseconds.
    cpuMs: total(acct.periodic, 'cpuTime') / 1000, activeMs: total(acct.periodic, 'activeTime') / 1000,
    rowsWritten: total(acct.periodic, 'rowsWritten'), rowsRead: total(acct.periodic, 'rowsRead'),
    errors: total(acct.invocations, 'errors'),
    exceeded: { cpu: total(acct.periodic, 'exceededCpuErrors'), memory: total(acct.periodic, 'exceededMemoryErrors'), internal: total(acct.periodic, 'fatalInternalErrors') },
  };
}

/**
 * Cloudflare's figures for one room beside what the deploy plan says such a room uses: per room-hour, with how far
 * each is from the estimate. T1's line is 10% for requests and GB-seconds.
 */
export function compareUse(use, { seats = 8, inputHz = 20, roomHours = use?.hours ?? 1 } = {}) {
  if (!use?.ok || !(roomHours > 0)) return null;
  const plan = hostedUse({ seats, inputHz });
  const row = (measured, estimate) => ({ measured: Math.round(measured * 10) / 10, estimate, off: estimate ? Math.round(((measured - estimate) / estimate) * 1000) / 10 : null });
  const out = { roomHours, requests: row(use.billedRequests / roomHours, plan.requests), gbSeconds: row(use.gbSeconds / roomHours, plan.gbSeconds), rowsWritten: row(use.rowsWritten / roomHours, plan.rows) };
  return { ...out, within10: Math.abs(out.requests.off) <= 10 && Math.abs(out.gbSeconds.off) <= 10 };
}
