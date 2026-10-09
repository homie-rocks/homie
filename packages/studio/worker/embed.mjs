/**
 * Player cards. X's reference: developer.x.com, "Cards: player card" (archived)
 * (redirects to docs.x.com/overview as checked 2026-10-08). Surviving official sample:
 * https://github.com/xdevplatform/cards-player-samples/blob/main/player/page.html
 * https://devcommunity.x.com/t/player-cards-improved-security-and-faster-approval-times/50033
 * https://devcommunity.x.com/t/fullscreen-for-player-cards/70717
 * The archived reference reserves cards for linear audio/video and excludes games. Phone apps
 * open twitter:player top-level in their in-app browser. The 2026-10-08 public X web bundle
 * https://abs.twimg.com/x-web/x-web/assets/article-card-DEH89WAV.js (function Ts) only frames
 * YouTube/SoundCloud/Periscope; other hosts link to card_url in a new tab. Not a signed-in test.
 * X documents HTTPS media players and sandboxing, NOT a supported game API, a current exhaustive
 * ancestor list, or guaranteed fullscreen. The X domain families and the sandbox below are observed
 * (the frame-ancestors header of the live game page https://snekarena.com/r/main, read 2026-10-08, and
 * the bundle above), not a promise from X.
 * No og:video/stream tag: an HTML game is not a video. Consumers of Twitter player tags can use the
 * same metadata; other platforms keep the OG image (https://ogp.me/). No universal game-card standard.
 */
export const PLAYER_ANCESTORS = ['https://x.com', 'https://*.x.com', 'https://twitter.com', 'https://*.twitter.com'];
export const PLAYER_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';
/**
 * The size the tags advertise: 480×480.
 * - The two game pages whose posts showed a play button the week of 2026-10-08 both advertise 480×480
 *   (tags read as Twitterbot from https://snekarena.com/r/main and from a game page on https://www.spawn.co),
 *   with pictures of 1200×628 and 1200×800: X accepts a picture whose shape is not the player's.
 * - X's reference says the player is scaled to the post's width at this width:height ratio. A phone's post is
 *   about 358 px wide: a 16:9 player there is 201 px tall, too short for a game's own dialogs and this
 *   shell's room sheet; a square one is 358 px tall.
 * - X's web bundle (above) clamps the ratio to max(width/height, 1), so square is the tallest it shows.
 * X's phone apps open the player address full screen, where this size only shapes the picture in the post.
 */
export const PLAYER_SIZE = { width: 480, height: 480 };
/**
 * What X's reference says a card picture must be for the card to render: JPG, PNG, WEBP or GIF, at least 68,600
 * pixels (262×262, or 350×196), under 5 MB. It also says the picture "should" have the player's dimensions:
 * advice, which the build passes on as a warning and never as a refusal (lib/player-image.mjs).
 */
export const PLAYER_IMAGE = { formats: ['jpeg', 'png', 'webp', 'gif'], minPixels: 68600, maxBytes: 5000000 };
export const playerImageRule = (m) => (!m || !PLAYER_IMAGE.formats.includes(m.format) ? 'format'
  : !(m.width * m.height >= PLAYER_IMAGE.minPixels) ? 'pixels' : !(m.bytes < PLAYER_IMAGE.maxBytes) ? 'bytes' : null);

/** These are switches, not plan limits. TV-only games must declare their lack of a single-screen view. */
export function playerEnabled(cat, game) {
  return cat?.studio?.site?.playerCard !== false && game?.playerCard !== false &&
    game?.screen?.singleScreen !== false && !['private', 'invite'].includes(game?.launch);
}

/** Exact HTTPS origins, or an HTTPS DNS wildcard, never arbitrary CSP text. An explicit [] denies all. */
export function playerOrigins(value) {
  if (!Array.isArray(value)) return [...PLAYER_ANCESTORS];
  const origins = [];
  for (const v of value) {
    if (typeof v !== 'string' || !/^https:\/\/(?:\*\.)?[a-z0-9.-]+(?::[0-9]+)?$/i.test(v)) continue;
    try {
      const wildcard = v.includes('*.');
      const u = new URL(v.replace('*.', ''));
      const labels = u.hostname.split('.');
      if (labels.length < 2 || labels.some(l => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(l))) continue;
      // A wildcard must name a domain, never a top-level suffix.
      if (wildcard && (labels.length < 2 || /^(?:co|com|net|org)\.[a-z]{2}$/.test(u.hostname))) continue;
      const origin = 'https://' + (wildcard ? '*.' : '') + u.host;
      if (!origins.includes(origin)) origins.push(origin);
      if (origins.length === 8) break;
    } catch {}
  }
  return origins;
}
export function playerAncestors(cat) {
  return playerOrigins(cat?.studio?.site?.playerCardOrigins).join(' ') || "'none'";
}
export function httpsAddress(value, origin) {
  try { const u = new URL(value, origin); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function playerProperties(cat, game, { origin = '', title = game?.name, description = game?.blurb } = {}) {
  const player = httpsAddress(`/${game?.id}/play/embed`, origin);
  const measured = game?.playerImage;
  const picture = measured && httpsAddress(measured.src, origin);
  // twitter:site goes out when the studio has set its handle; a card is never withheld for the lack of one
  // (neither live game page above carries it).
  const handle = /^@[A-Za-z0-9_]{1,15}$/.test(cat?.studio?.site?.twitterSite || '') ? cat.studio.site.twitterSite : null;
  if (!playerEnabled(cat, game) || !player || !picture || playerImageRule(measured)) return {};
  return { ...(handle ? { 'twitter:site': handle } : {}), 'twitter:card': 'player', 'twitter:player': player, 'twitter:player:width': PLAYER_SIZE.width,
    'twitter:player:height': PLAYER_SIZE.height, 'twitter:image': picture, 'twitter:title': title,
    'twitter:description': String(description || `Play ${game.name} in your browser.`).slice(0, 200) };
}

/** Browser restrictions belong to the outer host; failures must not kill a game's input loop.
 * MDN, "iframe: sandbox"
 * MDN, "Permissions Policy"
 * Used only for the embedded instance, ahead of the game's scripts. Existing port/early provides
 * storage/cookie shims for imported games; netplay and the shell already guard their own storage.
 */
export const EMBED_GAME_JS = String.raw`(function () {
  function unavailable(feature) { parent.postMessage({t:'homie-net',what:'embed-unavailable',feature:feature}, '*'); }
  function guarded(proto, name, feature) {
    var real = proto && proto[name];
    if (typeof real !== 'function') return;
    try { proto[name] = function () {
      try { var result = real.apply(this, arguments); return result && typeof result.catch === 'function' ? result.catch(function () { unavailable(feature); }) : result; }
      catch (e) { unavailable(feature); return Promise.resolve(); }
    }; } catch (e) {}
  }
  guarded(Element.prototype, 'requestPointerLock', 'pointer lock');
  guarded(Element.prototype, 'requestFullscreen', 'fullscreen');
  document.addEventListener('pointerlockerror', function () { unavailable('pointer lock'); });
  document.addEventListener('fullscreenerror', function () { unavailable('fullscreen'); });
  var pads = navigator.getGamepads;
  if (pads) try { Object.defineProperty(navigator, 'getGamepads', { configurable:true, value:function () {
    try { return pads.call(navigator); } catch (e) { if (!pads.warned) { pads.warned = true; unavailable('gamepad'); } return []; }
  }}); } catch (e) {}
  // Keep early requests pending and replay them on the first real press. A game that asks only once
  // must start too; resolving a no-op resume/play loses that request.
  var pressed = false, pending = [];
  function afterPress(run) {
    if (pressed) return run();
    return new Promise(function (resolve, reject) { pending.push(function () { run().then(resolve, reject); }); });
  }
  ['AudioContext','webkitAudioContext'].forEach(function (name) {
    var AC = window[name]; if (!AC) return;
    try { window[name] = new Proxy(AC, { construct:function (ctor,args) {
      var ctx = Reflect.construct(ctor,args), resume = ctx.resume.bind(ctx);
      if (!pressed) ctx.suspend().catch(function () {});
      ctx.resume = function () { return afterPress(resume); };
      return ctx;
    }}); } catch (e) {}
  });
  ['pointerdown','keydown','touchstart'].forEach(function (name) { addEventListener(name,function () {
    if (pressed) return;
    pressed = true; var queued = pending; pending = []; queued.forEach(function (run) { run(); });
  },{capture:true,once:true}); });
  var play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    var media = this;
    return afterPress(function () { return play.call(media); });
  };
}());`;
