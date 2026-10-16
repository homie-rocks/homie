import {isOwner, hasRole, requireSameOrigin} from '@homie-rocks/studio/worker';
/** Mount at one exact route. Storage adapter must atomically compare revision, authorize,
 * consume a proposal and deduplicate key across workers. Never accept a client tool name. */
export function createChecklistHandler({app, list, load, act, auth = {isOwner, hasRole, requireSameOrigin}}) {
  if (typeof load !== 'function') throw new Error('A server-side proposal loader is required');
  return async (request, env) => {
    const headers = {'Cache-Control': 'no-store'};
    if (!['GET', 'POST'].includes(request.method)) return new Response('Method not allowed', {status:405, headers:{...headers, Allow:'GET, POST'}});
    if (request.method === 'POST') { const refusal = auth.requireSameOrigin(request); if (refusal) return refusal; }
    const owner = await auth.isOwner(request, env);
    const staff = !owner && await auth.hasRole(request, env, app, 'staff');
    if (!owner && !staff) return new Response('Forbidden', {status:403, headers});
    const context = {request, env, owner, staff};
    if (request.method === 'GET') return Response.json(await list(context), {headers});
    let input;
    try {
      const reader = request.body?.getReader();
      if (!reader) throw new Error();
      const chunks = []; let bytes = 0;
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 4096) { await reader.cancel(); return new Response('Too large', {status:413, headers}); }
        chunks.push(value);
      }
      const body = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) {body.set(chunk,offset);offset += chunk.length;}
      const text = new TextDecoder().decode(body);
      input = JSON.parse(text);
      if (!input || !['confirm','undo'].includes(input.operation) || ['id','revision','key'].some(k => typeof input[k] !== 'string' || !input[k] || input[k].length > 200) || ((input.operation === 'undo' || input.token !== undefined) && (typeof input.token !== 'string' || !/^[A-Za-z0-9._~-]{1,1000}$/.test(input.token)))) throw new Error();
    } catch { return new Response('Invalid action', {status:400, headers}); }
    const proposal = await load(context, input.id);
    if (!proposal || proposal.id !== input.id) return new Response('Unknown proposal', {status:404, headers});
    if (!owner && proposal.allowStaff !== true) return new Response('Forbidden', {status:403, headers});
    if (input.operation === 'undo') {
      const undo = proposal.undo;
      if (proposal.irreversible || !undo || undo.used !== false || !Number.isFinite(undo.expiresAt) || Date.now() >= undo.expiresAt || undo.revision === proposal.revision || input.revision !== undo.revision || input.token !== undo.token)
        return new Response('Undo unavailable', {status:409, headers});
    }
    // Adapter must repeat these checks atomically with consumption to prevent races.
    // Adapter returns an authoritative result only after durable commit. Errors remain unknown to UI.
    return Response.json(await act(context, {id:input.id, revision:input.revision, key:input.key, operation:input.operation, token:input.token}), {headers});
  };
}
