/**
 * /account/ — a player's account on this studio: make one with a passkey, sign in on another device, add a
 * passkey, a name, a recovery email (when the studio has a mail sender), download everything, delete everything.
 * Drawn in the studio's own look (worker/site.mjs layout); the page's one script is /_homie/account.js (the
 * site's CSP allows no inline script). PASSKEY_JS is shared with the play shell's sign-in sheet.
 */
import { esc, layout } from './site.mjs';

/**
 * The browser half of a passkey ceremony, as plain ES2017 (the account page and the play shell both carry it):
 * homiePasskey.create(options) / .get(options) turn the server's JSON options into WebAuthn calls and the
 * credential back into JSON; homiePasskey.api(method, path, body) talks to /api/player/.
 */
export const PASSKEY_JS = String.raw`var homiePasskey = (function () {
  function toBuf(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }
  function toB64u(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function supported() { return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create); }
  function api(method, path, body) {
    var init = { method: method, credentials: 'same-origin', cache: 'no-store', headers: {} };
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'http', message: 'the site answered ' + r.status }; }).then(function (j) { j.status = r.status; return j; }); });
  }
  function create(o) {
    var pk = { challenge: toBuf(o.challenge), rp: o.rp, user: { id: toBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.pubKeyCredParams, authenticatorSelection: o.authenticatorSelection, attestation: o.attestation, timeout: o.timeout,
      excludeCredentials: (o.excludeCredentials || []).map(function (c) { return { type: 'public-key', id: toBuf(c.id) }; }) };
    return navigator.credentials.create({ publicKey: pk }).then(function (c) {
      return { id: c.id, rawId: toB64u(c.rawId), type: c.type, response: { clientDataJSON: toB64u(c.response.clientDataJSON), attestationObject: toB64u(c.response.attestationObject),
        transports: c.response.getTransports ? c.response.getTransports() : [] } };
    });
  }
  function get(o) {
    var pk = { challenge: toBuf(o.challenge), rpId: o.rpId, userVerification: o.userVerification, timeout: o.timeout, allowCredentials: [] };
    return navigator.credentials.get({ publicKey: pk }).then(function (c) {
      return { id: c.id, rawId: toB64u(c.rawId), type: c.type, response: { clientDataJSON: toB64u(c.response.clientDataJSON), authenticatorData: toB64u(c.response.authenticatorData),
        signature: toB64u(c.response.signature), userHandle: c.response.userHandle ? toB64u(c.response.userHandle) : null } };
    });
  }
  /** Options fetched ahead (a click must reach the passkey prompt at once: Safari wants the user's tap). */
  var held = {};
  function prime(kind, path, body) { held[kind] = { at: Date.now(), p: api('POST', path, body || {}) }; return held[kind].p; }
  function options(kind, path, body) { var h = held[kind]; delete held[kind]; return h && Date.now() - h.at < 240000 ? h.p : api('POST', path, body || {}); }
  function said(e) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'AbortError') return 'No passkey was used. Try again when you are ready.';
    if (n === 'InvalidStateError') return 'This device already has a passkey for this account.';
    if (n === 'SecurityError') return /^[0-9.]+$|^\[/.test(location.hostname) ? 'Passkeys need a name, not a number: open http://localhost:' + location.port + location.pathname + ' instead.' : 'Passkeys need this site on https (or http://localhost while developing).';
    return (e && e.message) || 'That did not work.';
  }
  function remember(p) { try { if (p) localStorage.setItem('homie.player', JSON.stringify({ id: p.id, name: p.name, guest: p.guest, owner: p.owner })); else localStorage.removeItem('homie.player'); } catch (e) {} }
  /** Make an account (or add a passkey to the guest or account this browser has): the player, or an error. */
  function signUp(name) {
    return options('up', '/api/player/signup/options').then(function (r) {
      if (!r.ok) throw new Error(r.message || r.error);
      return create(r.options);
    }).then(function (cred) { return api('POST', '/api/player/signup', { credential: cred, name: name || undefined, label: '' }); })
      .then(function (r) { if (!r.ok) throw new Error(r.message || r.error); remember(r.player); return r; });
  }
  function signIn() {
    return options('in', '/api/player/signin/options').then(function (r) {
      if (!r.ok) throw new Error(r.message || r.error);
      return get(r.options);
    }).then(function (cred) {
      return api('POST', '/api/player/signin', { credential: cred }).then(function (r) {
        if (!r.ok && r.error === 'unknown' && window.PublicKeyCredential && PublicKeyCredential.signalUnknownCredential) {
          // Tell the device this site no longer knows that passkey, so it stops offering it.
          try { PublicKeyCredential.signalUnknownCredential({ rpId: location.hostname, credentialId: cred.id }).catch(function () {}); } catch (e) {}
        }
        if (!r.ok) throw new Error(r.message || r.error);
        remember(r.player); return r;
      });
    });
  }
  return { api: api, create: create, get: get, prime: prime, options: options, said: said, remember: remember, signUp: signUp, signIn: signIn, supported: supported };
}());`;

const ACCOUNT_CSS = `
.acct{max-width:760px;margin:0 auto;padding:clamp(28px,6vw,72px) max(var(--gutter),16px) 24px}
.acct h1{margin:0;font:800 clamp(34px,6vw,60px)/1 var(--display);letter-spacing:-.03em}
.acct .lead{margin-top:14px}
.acct .card{margin-top:22px;padding:clamp(18px,3vw,26px);border-radius:var(--r);background:var(--panel);border:1px solid var(--line)}
.acct .card h2{margin:0 0 6px;font:800 22px/1.2 var(--display)}
.acct .card p{margin:6px 0 0;color:var(--soft)}
.acct .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:16px}
.acct label{display:block;font:600 13px/1.4 var(--text);color:var(--dim);margin-top:14px}
.acct input{box-sizing:border-box;width:100%;max-width:340px;min-height:48px;margin-top:6px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:500 17px/1 var(--text)}
.acct input:focus{outline:2px solid var(--hot);outline-offset:1px}
.acct button.btn,.acct button.ghost{cursor:pointer;border:0}
.acct button.ghost{border:1px solid color-mix(in srgb,var(--fg) 30%,transparent)}
.acct .who{display:flex;align-items:center;gap:14px;margin-top:8px}
.acct .who b{font:800 26px/1.1 var(--display)}
.acct .badge{display:inline-block;padding:3px 9px;border-radius:999px;font:700 12px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;background:color-mix(in srgb,var(--hot) 22%,transparent);color:var(--fg)}
.acct ul.keys-list{list-style:none;margin:12px 0 0;padding:0}
.acct ul.keys-list li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);color:var(--soft)}
.acct ul.keys-list li button{min-height:36px;padding:0 12px;font-size:14px}
.acct .msg{min-height:1.5em;margin-top:16px;font-weight:600}
.acct .msg.bad{color:#ff8a80}
.acct .msg.good{color:#8fe3a8}
.acct .danger{color:#ff8a80;border-color:color-mix(in srgb,#ff8a80 50%,transparent)!important}
.acct details{margin-top:22px;color:var(--soft)}
.acct details summary{cursor:pointer;font-weight:700;color:var(--fg)}
.acct details li{margin:6px 0}
.acct .back{margin-top:18px}
`;

/** The page. `next` is where "Back to the game" goes; `owner` an owner-claim key; `link` + `mode` a mailed link. */
export function accountPage(cat, { origin = '', next = '/account/', owner = null, link = null, mode = null, features = {} } = {}) {
  const studio = cat?.studio?.name ?? 'Studio';
  const boot = { next, owner, link, mode, features, studio };
  const games = (cat?.games ?? []).filter((g) => g.saves).map((g) => g.name);
  const back = next !== '/account/' ? `<p class="back"><a class="ghost" href="${esc(next)}" data-back>Back to the game</a></p>` : '';
  const main = `<section class="acct" data-account>
<p class="kicker">${esc(studio)}</p>
<h1>Your player account</h1>
<p class="lead">Keep your characters and progress on every device you play on. It is an account on ${esc(studio)} only, made with a passkey: Face ID, a fingerprint or your device's PIN. No password, and no email needed.</p>
<noscript><p class="lead">This page needs JavaScript for passkeys.</p></noscript>
<div class="card" data-view="loading"><p>Looking for your account…</p></div>

<div class="card" data-view="out" hidden>
  <h2>Make an account</h2>
  <p>Your device makes a passkey for this site and keeps it in its own keychain, so it signs you in on your other devices too.</p>
  <label for="acct-name">A name other players see (you can change it later)</label>
  <input id="acct-name" data-name maxlength="24" autocomplete="nickname" placeholder="Leave empty for a random one">
  <div class="row"><button class="btn" type="button" data-make>Make an account</button><button class="ghost" type="button" data-signin>I have one: sign in</button></div>
  ${features.email ? '<p class="small"><a href="#recover" data-show-recover>Lost your passkeys?</a></p><div data-recover hidden><label for="acct-recover">The recovery email on your account</label><input id="acct-recover" data-recover-email type="email" autocomplete="email"><div class="row"><button class="ghost" type="button" data-recover-send>Email me a link</button></div></div>' : ''}
</div>

<div class="card" data-view="guest" hidden>
  <h2>You are playing as a guest</h2>
  <div class="who"><b data-me-name></b></div>
  <p>Your progress is kept in this browser only. Make an account and it stays yours on every device; nothing you have is lost.</p>
  <label for="acct-gname">Your name (optional)</label>
  <input id="acct-gname" data-gname maxlength="24" autocomplete="nickname">
  <div class="row"><button class="btn" type="button" data-upgrade>Make an account</button><button class="ghost" type="button" data-signin>Sign in to my account</button></div>
  <p class="small">Signing in to an account you already have keeps that account's saves, and brings over anything only this guest had.</p>
</div>

<div data-view="in" hidden>
  <div class="card">
    <h2>Signed in</h2>
    <div class="who"><b data-me-name></b><span class="badge" data-owner-badge hidden>Owner</span></div>
    <label for="acct-rename">Name other players see</label>
    <input id="acct-rename" data-rename maxlength="24" autocomplete="nickname">
    <div class="row"><button class="ghost" type="button" data-save-name>Save name</button><button class="ghost" type="button" data-signout>Sign out</button></div>
  </div>
  <div class="card" data-owner-claim hidden>
    <h2>Is this the studio owner's account?</h2>
    <p>Your AI made a one-time link to mark your own account as the owner's, so your games and this studio's back office know it is you.</p>
    <div class="row"><button class="btn" type="button" data-claim>Yes, this account is mine</button></div>
  </div>
  <div class="card">
    <h2>Passkeys</h2>
    <p>Each one signs you in. Your device's own sync (iCloud Keychain, Google Password Manager, your password manager) carries a passkey to your other devices. Add one here on a device that does not have it, or a security key, so you can always get back in.</p>
    <ul class="keys-list" data-keys></ul>
    <div class="row"><button class="ghost" type="button" data-add>Add a passkey on this device</button></div>
  </div>
  ${features.email ? `<div class="card" data-email-card>
    <h2>Recovery email</h2>
    <p data-email-state>If you lose every passkey, a link to this address lets you make a new one. Optional.</p>
    <label for="acct-email">Email</label><input id="acct-email" data-email type="email" autocomplete="email">
    <div class="row"><button class="ghost" type="button" data-email-save>Send a confirmation</button><button class="ghost" type="button" data-email-remove hidden>Remove it</button></div>
  </div>` : ''}
  <div class="card">
    <h2>Your data</h2>
    <p>Download everything this studio keeps about you (your saves in every game, your stats, your memorials), or delete it all.</p>
    <div class="row"><a class="ghost" href="/api/player/export" download>Download my data</a><button class="ghost danger" type="button" data-delete>Delete my account</button></div>
  </div>
</div>

<div class="card" data-view="link" hidden>
  <h2 data-link-title></h2>
  <p data-link-text></p>
  <div class="row"><button class="btn" type="button" data-link-go></button></div>
</div>

<p class="msg" data-msg role="status" aria-live="polite"></p>
${back}
<details>
  <summary>What ${esc(studio)} keeps, and what it never does</summary>
  <ul>
    <li>A random player id and the name you choose (or a two-word one made for you).</li>
    <li>Each passkey's <em>public</em> key and when it was last used. The private key never leaves your device.</li>
    <li>Your saves, stats and memorials in ${games.length ? esc(games.join(', ')) : 'this studio\'s games'}.</li>
    <li>A recovery email only if you add one. No password. No IP address. No tracking cookies, and nothing is sent to anyone else.</li>
    <li>The studio's owner can see how many players there are and their names, never your passkeys or email.</li>
    <li>A guest that nobody plays for 180 days is forgotten with everything it kept.</li>
  </ul>
</details>
</section>
<script type="application/json" id="account-boot">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
<script src="/_homie/account.js" defer></script>`;
  return layout(cat, { title: `Your account · ${studio}`, description: `Your player account on ${studio}.`, origin, path: '/account/', page: 'account', head: `<style>${ACCOUNT_CSS}</style><meta name="robots" content="noindex">`, main });
}

/** /_homie/account.js */
export const ACCOUNT_JS = `${PASSKEY_JS}
(function () {
  'use strict';
  var boot = JSON.parse(document.getElementById('account-boot').textContent);
  var P = homiePasskey;
  var root = document.querySelector('[data-account]');
  var msg = root.querySelector('[data-msg]');
  var me = null;
  function $(s) { return root.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(root.querySelectorAll(s)); }
  function say(text, kind) { msg.textContent = text || ''; msg.className = 'msg' + (kind ? ' ' + kind : ''); }
  function view(name) { $$('[data-view]').forEach(function (el) { el.hidden = el.getAttribute('data-view') !== name; }); }
  function busy(btn, on) { if (btn) { btn.disabled = on; btn.style.opacity = on ? '.6' : ''; } }
  function done(r, words) {
    say(words, 'good');
    me = r.player; render();
    var back = $('[data-back]');
    if (back && boot.next && boot.next !== '/account/') setTimeout(function () { location.href = boot.next; }, 1400);
  }
  function fail(e) { say(e && e.name ? P.said(e) : (e && e.message) || 'That did not work.', 'bad'); }

  function render() {
    $$('[data-me-name]').forEach(function (el) { el.textContent = me ? me.name : ''; });
    if (boot.mode && boot.link) return linkView();
    if (!me) { view('out'); P.prime('up', '/api/player/signup/options'); P.prime('in', '/api/player/signin/options'); return; }
    if (me.guest) { view('guest'); $('[data-gname]').value = me.named ? me.name : ''; P.prime('up', '/api/player/signup/options'); P.prime('in', '/api/player/signin/options'); return; }
    view('in');
    $('[data-rename]').value = me.name;
    $('[data-owner-badge]').hidden = !me.owner;
    $('[data-owner-claim]').hidden = !(boot.owner && !me.owner);
    var ec = $('[data-email-card]');
    if (ec) {
      $('[data-email]').value = me.email ? me.email.address : '';
      $('[data-email-state]').textContent = me.email ? (me.email.verified ? 'Confirmed: a link to this address can bring your account back.' : 'Waiting for you to open the confirmation link we sent.') : 'If you lose every passkey, a link to this address lets you make a new one. Optional.';
      $('[data-email-remove]').hidden = !me.email;
    }
    keys();
  }

  function keys() {
    P.api('GET', '/api/player/passkeys').then(function (r) {
      var ul = $('[data-keys]'); ul.textContent = '';
      (r.passkeys || []).forEach(function (k) {
        var li = document.createElement('li');
        var span = document.createElement('span');
        span.textContent = k.label + (k.synced ? ' · synced' : '') + ' · last used ' + new Date(k.usedAt).toLocaleDateString();
        li.appendChild(span);
        if ((r.passkeys || []).length > 1) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = 'Remove';
          b.addEventListener('click', function () {
            if (!confirm('Remove this passkey? It will no longer sign you in here.')) return;
            P.api('POST', '/api/player/passkeys/remove', { id: k.id }).then(function (x) { if (!x.ok) throw new Error(x.message); say('Passkey removed.', 'good'); keys(); }).catch(fail);
          });
          li.appendChild(b);
        }
        ul.appendChild(li);
      });
    });
  }

  function linkView() {
    view('link');
    var verify = boot.mode === 'verify';
    $('[data-link-title]').textContent = verify ? 'Confirm your recovery email' : 'Get back into your account';
    $('[data-link-text]').textContent = verify ? 'One press confirms this address for your account.' : 'Make a new passkey on this device. Your account, saves and stats stay as they are.';
    var go = $('[data-link-go]');
    go.textContent = verify ? 'Confirm' : 'Make a new passkey';
    go.onclick = function () {
      busy(go, true);
      var k = boot.link; boot.link = null; boot.mode = null;
      if (verify) {
        P.api('POST', '/api/player/email/verify', { k: k }).then(function (r) { if (!r.ok) throw new Error(r.message); say('Confirmed. That address can now bring your account back.', 'good'); return load(); }).catch(fail);
        return;
      }
      P.api('POST', '/api/player/recover/options', { k: k }).then(function (r) {
        if (!r.ok) throw new Error(r.message);
        return P.create(r.options);
      }).then(function (cred) { return P.api('POST', '/api/player/signup', { credential: cred }); })
        .then(function (r) { if (!r.ok) throw new Error(r.message); P.remember(r.player); done(r, 'You are back in. This device has its own passkey now.'); })
        .catch(function (e) { fail(e); busy(go, false); });
    };
  }

  function load() {
    return P.api('GET', '/api/player/me').then(function (r) {
      if (!r.ok) { view('out'); say(r.message || 'Accounts are not available here.', 'bad'); return; }
      me = r.player; P.remember(me); render();
    }).catch(function () { say('Could not reach the site. Check your connection.', 'bad'); });
  }

  if (!P.supported()) say('This browser has no passkeys. Use a current Safari, Chrome, Edge or Firefox.', 'bad');

  $$('[data-make],[data-upgrade]').forEach(function (b) {
    b.addEventListener('click', function () {
      var input = b.hasAttribute('data-upgrade') ? $('[data-gname]') : $('[data-name]');
      busy(b, true); say('Follow your device…');
      P.signUp((input && input.value.trim()) || '').then(function (r) {
        done(r, r.made === 'upgraded' ? 'Done: you have an account now, and everything you had is in it.' : 'Welcome, ' + r.player.name + '. Your account is ready.');
      }).catch(fail).then(function () { busy(b, false); });
    });
  });
  $$('[data-signin]').forEach(function (b) {
    b.addEventListener('click', function () {
      busy(b, true); say('Follow your device…');
      P.signIn().then(function (r) { done(r, 'Signed in as ' + r.player.name + '.'); }).catch(fail).then(function () { busy(b, false); });
    });
  });
  $('[data-add]').addEventListener('click', function () {
    var b = $('[data-add]'); busy(b, true); say('Follow your device…');
    P.signUp('').then(function (r) { done(r, 'This device has a passkey for your account now.'); }).catch(fail).then(function () { busy(b, false); });
  });
  $('[data-save-name]').addEventListener('click', function () {
    P.api('POST', '/api/player/name', { name: $('[data-rename]').value }).then(function (r) {
      if (!r.ok) throw new Error(r.message);
      me = r.player; P.remember(me); render(); say(r.cut ? 'Saved (cut to 24 characters).' : 'Saved.', 'good');
    }).catch(fail);
  });
  $('[data-signout]').addEventListener('click', function () {
    P.api('POST', '/api/player/signout', {}).then(function () { me = null; P.remember(null); render(); say('Signed out on this browser.', 'good'); });
  });
  $('[data-delete]').addEventListener('click', function () {
    var typed = prompt('This deletes your account and everything it kept on ' + boot.studio + ', in every game. It cannot be undone. Type DELETE to go ahead.');
    if (!typed || typed.trim().toUpperCase() !== 'DELETE') { say('Nothing was deleted.'); return; }
    P.api('POST', '/api/player/delete', { confirm: 'delete' }).then(function (r) {
      if (!r.ok) throw new Error(r.message);
      me = null; P.remember(null); render();
      say('Your account and everything it kept are deleted. You can also remove the passkey from your device\\'s passwords.', 'good');
    }).catch(fail);
  });
  var claim = $('[data-claim]');
  if (claim) claim.addEventListener('click', function () {
    P.api('POST', '/api/player/owner', { k: boot.owner }).then(function (r) {
      if (!r.ok) throw new Error(r.message);
      boot.owner = null; me = r.player; render(); say('This account is the studio owner\\'s now.', 'good');
    }).catch(fail);
  });
  var es = $('[data-email-save]');
  if (es) es.addEventListener('click', function () {
    P.api('POST', '/api/player/email', { email: $('[data-email]').value }).then(function (r) {
      if (!r.ok) throw new Error(r.message);
      me = r.player; render(); say('Sent. Open the link in that email to confirm it.', 'good');
    }).catch(fail);
  });
  var er = $('[data-email-remove]');
  if (er) er.addEventListener('click', function () {
    P.api('POST', '/api/player/email/remove', {}).then(function (r) { if (!r.ok) throw new Error(r.message); me = r.player; render(); say('Removed.', 'good'); }).catch(fail);
  });
  var sr = $('[data-show-recover]');
  if (sr) sr.addEventListener('click', function (e) { e.preventDefault(); $('[data-recover]').hidden = false; $('[data-recover-email]').focus(); });
  var rs = $('[data-recover-send]');
  if (rs) rs.addEventListener('click', function () {
    P.api('POST', '/api/player/recover', { email: $('[data-recover-email]').value }).then(function (r) { if (!r.ok) throw new Error(r.message); say(r.message, 'good'); }).catch(fail);
  });
  load();
}());`;
