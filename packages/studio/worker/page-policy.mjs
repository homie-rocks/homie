import {STUDIO_VERSION_TAG} from './version.mjs';
import {playerAncestors} from './embed.mjs';
export function shellKey(g) {
  // Never what names a build (the rules' build and state hashes, the bundle's version): those change with every
  // edit, and a newer build of the same game inside the same page is exactly what the frame's own reload is for.
  const { build: _build, stateHash: _state, ...room } = g?.room ?? {};
  const { version: _version, ...netplay } = g?.netplay ?? {};
  const text = JSON.stringify([g?.kind ?? null, g?.players ?? null, room, g?.saves ?? null, g?.agents ?? null, g?.screen ?? null, netplay, g?.launch ?? null]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${STUDIO_VERSION_TAG}-${(h >>> 0).toString(36)}`;
}
export function shellStandIn(room, key) {
  const message = key ? { t: 'homie-net', what: 'shell', key } : { t: 'homie-net', what: 'rematch', room };
  return `<!doctype html><meta charset="utf-8"><title>Updating</title><body style="margin:0;background:#0b0d14;color:#cfd6e6;font:15px system-ui;display:grid;place-items:center;height:100vh"><p>This game was updated. Loading it again…</p><script>try{parent.postMessage(${JSON.stringify(message).replace(/</g, '\\u003c')},'*');}catch(e){}</script>`;
}
export const ROOM_ID = /^[A-Za-z0-9_-]{1,32}$/;
export function frameAncestors(cat) {
  const extra = (Array.isArray(cat?.studio?.site?.frameAncestors) ? cat.studio.site.frameAncestors : [])
    .map((o) => { try { const u = new URL(String(o)); return u.protocol === 'https:' && u.origin === String(o).replace(/\/+$/, '') ? u.origin : null; } catch { return null; } })
    .filter(Boolean).slice(0, 8);
  return ["'self'", ...extra].join(' ');
}
export function embedAncestors(cat, origin, preview = false) {
  const normal = playerAncestors(cat);
  if (!preview || !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) return normal;
  const port = new URL(origin).port;
  return `${normal === "'none'" ? '' : normal} http://localhost${port ? ':' + port : ''} http://127.0.0.1${port ? ':' + port : ''}`.trim();
}
