/**
 * The shop's pages (@homie-rocks/studio 0.24.0; worker/shop.mjs has the rules):
 *
 *   /shop/                 the studio's shop on a phone or a computer: the items in real money, sign in, the one
 *                          neutral age question, Buy (Stripe's own page), or "ask a grown-up" for 13-17
 *   /shop/thanks           back from Stripe: "it's yours" once the webhook says paid
 *   /shop/refunds/         the studio refund settings
 *   /shop/parent/<token>   the page a parent opens on their own device: what, for whom, the price, pay on Stripe
 *   /_homie/shop.js        the one script of /shop/ and of the account page's purchases card
 *   the play shell's store sheet (SHOP_SHELL_*): a game's `shop.open()`; on a television only a code to scan
 *   the office's shop page (/_studio/office/shop)
 *
 * Studio-authored text is escaped or set as text. Checkout follows the studio's chosen settings.
 */
import { esc, layout } from './site.mjs';
import { money, ZERO_DECIMAL, ITEM_ID, currencyScale, amountStep, parseAmount } from './shop-rules.mjs';
import { PRIVATE, shell } from './office-page.mjs';

const refundWords = (shop) => shop.refundDays === null ? 'Ask the studio about refunds.' : `The studio offers self-service refunds for ${shop.policy?.refundUsedItems ? 'items, including used items,' : 'unused items'} within ${shop.refundDays} days from your account page. Tips are refunded only by the studio.`;

const NOINDEX = { 'x-robots-tag': 'noindex', 'cache-control': 'no-store, private' };

export const SHOP_CSS = `
.shop{max-width:720px;margin:0 auto;padding:28px 16px 64px}
.shop .lead{max-width:60ch}
.shop .items{display:grid;gap:12px;margin:20px 0}
.shop .item{display:grid;grid-template-columns:1fr auto;gap:6px 14px;align-items:center;padding:16px;border-radius:16px;border:1px solid rgba(127,127,127,.28);background:rgba(127,127,127,.06)}
.shop .item h2{margin:0;font-size:18px}
.shop .item p{margin:0;grid-column:1/-1;opacity:.82;font-size:14.5px}
.shop .item .price{font:800 18px/1 var(--display,ui-sans-serif)}
.shop .item .act{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.shop .item .act button,.shop .item .act a{min-height:44px;padding:0 18px;border-radius:12px;font:700 15px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.shop .item .act .buy{background:var(--hot,#ffcf5a);color:var(--hot-ink,#0b0b10);border:0}
.shop .item .act .plain{background:transparent;color:inherit;border:1px solid rgba(127,127,127,.4)}
.shop .item .owned{font-weight:700;opacity:.9}
.shop .item .why{opacity:.75;font-size:14px}
.shop .age{padding:16px;border-radius:16px;border:1px solid rgba(127,127,127,.28);margin:16px 0}
.shop .age select{min-height:44px;font:16px ui-sans-serif,system-ui,sans-serif;padding:0 10px;border-radius:10px;margin-right:8px}
.shop .note{font-size:13.5px;opacity:.75;max-width:62ch}
.shop .test{display:inline-block;padding:4px 10px;border-radius:999px;border:1px dashed currentColor;font:700 12px/1.2 ui-monospace,Menlo,monospace;margin-bottom:10px}
.shop .msg{min-height:1.4em;font-weight:600}
.shop .link{word-break:break-all;font:13px/1.4 ui-monospace,Menlo,monospace;padding:10px;border-radius:10px;background:rgba(127,127,127,.12);margin:8px 0}
.shop-card ul{margin:8px 0 0;padding-left:18px}
.shop-card .badge,.shop .badge{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--hot,#ffcf5a);color:var(--hot-ink,#0b0b10);font:800 12px/1.3 ui-sans-serif,system-ui,sans-serif;margin-right:6px}
`;

/** The words for each way an item may be got (shop-rules.mjs wayFor). Plain, never pressing. */
export const WAY_LINES = Object.freeze({
  'make-an-account': 'This studio requires an account (a passkey), so purchases stay yours on every device.',
  'age-question': 'One question first.',
  no: 'Not available on this account.',
  'ask-a-parent': 'This studio asks a parent or guardian to buy this on their own phone.',
  cap: 'This account has reached the studio monthly spending limit.',
  'not-yet': 'Not on sale yet.',
  over: 'No longer on sale.',
  closed: 'The shop is not open yet.',
});

/** /shop/: the page; the list is drawn by /_homie/shop.js from /api/shop. */
export function shopPage(cat, shop, { origin = '', game = null, item = null, open = false, mode = null } = {}) {
  const studio = cat.studio?.name ?? 'Studio';
  const g = game ? (cat.games ?? []).find((x) => x.id === game) : null;
  const boot = { game: g ? g.id : null, item: ITEM_ID.test(String(item ?? '')) ? item : null, studio };
  const main = `<section class="shop" data-shop>
<p class="kicker">${esc(studio)}</p>
<h1>${g ? `${esc(g.name)}: shop` : 'Shop'}</h1>
${mode === 'test' ? '<p class="test">TEST MODE: no real money moves (Stripe test cards only)</p>' : ''}
<p class="lead">Things you can buy here, in real money, from ${esc(studio)} itself. Paid purchases open Stripe's checkout page. Guest purchases stay in this browser; keep its cookies or sign in to keep access. ${g ? `<a href="/${esc(g.id)}/">Back to ${esc(g.name)}</a>` : ''}</p>
<noscript><p class="lead">This page needs JavaScript.</p></noscript>
<div data-shop-age hidden></div>
<div class="items" data-shop-items><p>${open ? 'Reading the shop…' : 'The shop is not open yet.'}</p></div>
<p class="msg" data-shop-msg role="status" aria-live="polite"></p>
<p class="note">${esc(studio)} is the seller: it sets these prices, answers for refunds and receives the money through its own Stripe account. Homie takes nothing. ${refundWords(shop)} <a href="/shop/refunds/">refunds</a>. Stripe keeps your card and email and sends your receipt; ${esc(studio)} never sees them.</p>
</section>
<script type="application/json" id="shop-boot">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
<script src="/_homie/shop.js" defer></script>`;
  return layout(cat, { title: `Shop · ${studio}`, description: `Things to buy from ${studio}, in real money.`, origin, path: '/shop/', page: 'shop', head: `<style>${SHOP_CSS}</style><meta name="robots" content="noindex">`, main, extraHeaders: NOINDEX });
}

export function thanksPage(cat, shop, { session = null, game = null } = {}) {
  const studio = cat.studio?.name ?? 'Studio';
  const g = game ? (cat.games ?? []).find((x) => x.id === game) : null;
  const boot = { thanks: session, game: g ? g.id : null, studio };
  const main = `<section class="shop" data-shop-thanks>
<p class="kicker">${esc(studio)}</p>
<h1 data-thanks-title>Thank you</h1>
<p class="lead" data-thanks-line>Stripe is confirming the payment. This page says when it is yours (a few seconds).</p>
<p>${g ? `<a class="btn" href="/${esc(g.id)}/play">Back to ${esc(g.name)}</a>` : '<a class="btn" href="/">Back to the studio</a>'} <a href="/account/">Your account</a></p>
<p class="note">Your receipt comes from Stripe by email. ${refundWords(shop)}</p>
</section>
<script type="application/json" id="shop-boot">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
<script src="/_homie/shop.js" defer></script>`;
  return layout(cat, { title: `Thank you · ${studio}`, page: 'shop', head: `<style>${SHOP_CSS}</style><meta name="robots" content="noindex">`, main, extraHeaders: NOINDEX });
}

/** The refund policy (Stripe asks every seller for one; the kit's is generous by default). */
export function refundsPage(cat, shop) {
  const studio = cat.studio?.name ?? 'Studio';
  const main = `<section class="shop">
<p class="kicker">${esc(studio)}</p>
<h1>Refunds</h1>
<p class="lead">${esc(studio)} sells digital items for its games through its own Stripe account. ${esc(studio)} is the seller${shop.till === 'stripe-managed' ? ' (Stripe\'s Link, LLC is the seller of record and handles sales tax; your statement reads LINK.COM*)' : ''}.</p>
<ul>
<li>${refundWords(shop)} <a href="/account/">Your account</a>.</li>
<li><b>Anything else</b> (an item you used, a problem, a purchase you did not make): ask ${esc(studio)}. The studio's owner can refund any order with one tap.</li>
<li><b>A parent who paid for a teenager's item</b> can ask the same way.</li>
<li><b>Disputes:</b> a card dispute never deletes or locks your account. While it is open nothing changes; if the bank decides it for you, that one item is taken back as a refund would.</li>
<li>${shop.policy.withdrawalAcknowledgement ? 'Items are delivered to your account at once. Buying one says you want it now, which ends the EU and UK 14-day right to withdraw; the refunds above still apply.' : 'Entitlements are delivered to your account at once. The studio sets its refund terms; your statutory rights still apply.'}</li>
</ul>
<p class="note">Prices are in ${esc(shop.currency.toUpperCase())}. Tax is added at checkout where it applies.</p>
</section>`;
  return layout(cat, { title: `Refunds · ${studio}`, page: 'shop', head: `<style>${SHOP_CSS}</style>`, main });
}

/** The page a parent opens: no sign-in, no script; one checkbox and one button to Stripe's page. */
export function parentPage(cat, shop, { gone = false, item = null, lines = null, name = '', token = null, open = true, paid = false, said = '' } = {}) {
  const studio = cat.studio?.name ?? 'Studio';
  lines ??= item ? [{ item, quantity: 1 }] : [];
  let body;
  if (gone || !item) body = '<h1>This link has ended</h1><p class="lead">Links like this last a week and work for one purchase. Ask for a new one if you still want to buy it.</p>';
  else if (paid) body = `<h1>Done</h1><p class="lead">${esc(item.name)} is on ${esc(name)}'s account. Stripe sent your receipt by email.</p>`;
  else {
    body = `<h1>${esc(name)} asked you for ${esc(item.name)}</h1>
<p class="lead">${esc(item.name)} costs <b>${esc(money(item.price === 'choose' ? item.min : item.price, shop.currency))}</b>${item.days ? ` and lasts ${item.days} days` : ''}, from ${esc(studio)}${item.game ? ` (${esc((cat.games ?? []).find((g) => g.id === item.game)?.name ?? item.game)})` : ''}. ${item.blurb ? esc(item.blurb) : ''}</p>
<p>It goes to the player account named <b>${esc(name)}</b> on ${esc(studio)}. You pay in your own name on Stripe's page; ${esc(studio)} never sees your card. Saying no is fine: nothing happens.</p>
${said ? `<p class="msg" role="alert">${esc(said)}</p>` : ''}
${open ? `<form method="post" style="margin-top:16px"><label style="display:flex;gap:10px;align-items:flex-start;margin:0 0 14px"><input type="checkbox" name="grownup" value="yes" style="width:22px;height:22px;margin:2px 0 0"> <span>I am ${esc(name)}'s parent or guardian, and an adult.</span></label>
${lines.map((line, index) => `<p>${esc(line.item.name)} × ${line.quantity}: ${esc(money((line.item.price === 'choose' ? line.item.min : line.item.price) * line.quantity, shop.currency))}</p>${line.item.price === 'choose' ? `<label>Amount per item in ${esc(shop.currency.toUpperCase())} <input name="${lines.length === 1 ? 'amount' : `amount_${index}`}" type="number" min="${line.item.min / currencyScale(shop.currency)}" step="${amountStep(shop.currency) / currencyScale(shop.currency)}" value="${line.item.min / currencyScale(shop.currency)}"${line.item.max === null ? '' : ` max="${line.item.max / currencyScale(shop.currency)}"`}></label>` : ''}`).join('')}

<button class="btn" type="submit">Pay cart on Stripe</button></form>` : '<p>The shop is not open just now. Try this link again later.</p>'}
<p class="note">${refundWords(shop)} <a href="/shop/refunds/">refunds</a>.</p>`;
  }
  const main = `<section class="shop"><p class="kicker">${esc(studio)}</p>${body}</section>`;
  return layout(cat, { title: `For ${name || 'a player'} · ${studio}`, page: 'shop', head: `<style>${SHOP_CSS}</style><meta name="robots" content="noindex">`, main, status: gone ? 410 : 200, extraHeaders: { ...NOINDEX, 'referrer-policy': 'no-referrer' } });
}

/**
 * /_homie/shop.js: /shop/ (the list, sign in, the age question, Buy, ask a grown-up), /shop/thanks (waits for paid),
 * and the account page's purchases card (badges, orders, the self-serve refund).
 */
export const SHOP_JS = String.raw`(function () {
  'use strict';
  var bootEl = document.getElementById('shop-boot');
  var boot = {};
  try { boot = bootEl ? JSON.parse(bootEl.textContent) : {}; } catch (e) { boot = {}; }
  var WAY = ${JSON.stringify(WAY_LINES)};
  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, attrs, text) { var n = document.createElement(tag); if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (text !== undefined) n.textContent = text; return n; }
  function api(method, path, body) {
    if (path === '/api/shop/buy') {
      // A guest's purchase is tied to this browser. Check persistence before taking money.
      document.cookie = 'shop_cookie_check=1; Path=/; SameSite=Lax';
      var cookiesWork = /(?:^|; )shop_cookie_check=1(?:;|$)/.test(document.cookie);
      document.cookie = 'shop_cookie_check=; Path=/; Max-Age=0; SameSite=Lax';
      if (!cookiesWork) return Promise.resolve({ ok: false, error: 'cookies', message: 'Allow cookies for this site before buying so you can keep access to your purchases.' });
    }
    var init = { method: method, credentials: 'same-origin', cache: 'no-store', headers: {} };
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (r) { return r.json().catch(function () { return { ok: false, message: 'the site answered ' + r.status }; }); });
  }
  var units = ${parseAmount.toString()};
  function say(text, bad) { var m = $('[data-shop-msg]'); if (m) { m.textContent = text || ''; m.style.color = bad ? '#ff8a80' : ''; } }
  var q = boot.game ? '?game=' + encodeURIComponent(boot.game) : '';
  if (boot.item) q += (q ? '&' : '?') + 'item=' + encodeURIComponent(boot.item);

  /* ---------------- /shop/ */
  var list = $('[data-shop-items]');
  var cart = [];
  var cartBox = list ? el('div') : null;
  if (cartBox) list.after(cartBox);
  function drawCart() {
    cartBox.textContent = '';
    cart.forEach(function (line, index) {
      var row = el('p', null, line.name + ' × ' + line.quantity + ' ');
      var remove = el('button', { type: 'button' }, 'Remove'); remove.onclick = function () { cart.splice(index, 1); drawCart(); };
      row.appendChild(remove); cartBox.appendChild(row);
    });
    if (!cart.length) return;
    var checkout = el('button', { type: 'button', class: 'btn' }, 'Checkout cart');
    checkout.onclick = function () { checkout.disabled = true; api('POST', '/api/shop/buy', { lines: cart, game: boot.game }).then(function (r) { if (!r.ok) throw new Error(r.message); location.href = r.url; }).catch(function (e) { checkout.disabled = false; say(e.message, true); }); };
    cartBox.appendChild(checkout);
  }
  function draw(s) {
    list.textContent = '';
    if (!s.ok) { list.appendChild(el('p', null, s.message || 'The shop did not answer.')); return; }
    if (!s.open) { list.appendChild(el('p', null, s.kids ? 'Nothing is sold here.' : 'The shop is not open yet.')); return; }
    var age = $('[data-shop-age]');
    var needsAge = s.items.some(function (i) { return i.way === 'age-question'; });
    if (age) {
      age.hidden = !needsAge; age.textContent = '';
      if (needsAge) {
        age.className = 'age';
        age.appendChild(el('p', null, 'What year were you born? (Asked once, for this account.)'));
        var sel = el('input', { type: 'number', min: '0', step: '1', 'aria-label': 'Year you were born' });
        var ok = el('button', { type: 'button', class: 'btn' }, 'Done');
        ok.addEventListener('click', function () {
          if (!sel.value) { say('Pick a year.', true); return; }
          api('POST', '/api/shop/age', { year: Number(sel.value) }).then(function (r) { if (!r.ok) throw new Error(r.message); say(''); load(); }).catch(function (e) { say(e.message, true); });
        });
        age.appendChild(sel); age.appendChild(ok);
      }
    }
    s.items.forEach(function (i) {
      var card = el('article', { class: 'item', id: 'item-' + i.id });
      card.appendChild(el('h2', null, i.name));
      card.appendChild(el('span', { class: 'price' }, i.shown));
      if (i.blurb) card.appendChild(el('p', null, i.blurb));
      if (i.days) card.appendChild(el('p', null, 'Lasts ' + i.days + ' days.'));
      if (i.ends) card.appendChild(el('p', null, 'On sale until ' + new Date(i.ends).toISOString().slice(0, 10) + '.'));
      var act = el('div', { class: 'act' });
      if (i.way === 'cap' && i.retryWay) { act.appendChild(el('span', { class: 'why' }, WAY.cap)); i.way = i.retryWay; }
      if (i.way === 'checkout') {
        var amount = null;
        if (i.price === 'choose') {
          amount = el('input', { type: 'number', 'aria-label': 'How much in ' + s.currency.toUpperCase(), min: String(i.min / s.currencyScale), step: String(s.amountStep / s.currencyScale), value: String(i.min / s.currencyScale) });
          if (i.max !== null) amount.setAttribute('max', String(i.max / s.currencyScale));
          act.appendChild(amount);
        }
        var b = el('button', { type: 'button', class: 'buy' }, i.price === 'choose' ? 'Give on Stripe' : 'Buy on Stripe');
        b.addEventListener('click', function () {
          b.disabled = true; say('Opening Stripe…');
          api('POST', '/api/shop/buy', { item: i.id, game: boot.game || undefined, amount: amount ? units(amount.value, s.currencyScale) : undefined }).then(function (r) {
            if (!r.ok || !r.url) throw new Error(r.message || 'That did not work.');
            location.href = r.url;
          }).catch(function (e) { b.disabled = false; say(e.message, true); });
        });
        act.appendChild(b);
        var quantity = el('input', { type: 'number', min: '1', step: '1', value: '1', 'aria-label': 'Quantity' });
        var add = el('button', { type: 'button', class: 'plain' }, 'Add to cart');
        add.onclick = function () { cart.push({ item: i.id, name: i.name, quantity: Number(quantity.value), amount: amount ? units(amount.value, s.currencyScale) : undefined }); drawCart(); };
        act.appendChild(quantity); act.appendChild(add);
      } else if (i.way === 'owned') {
        act.appendChild(el('span', { class: 'owned' }, 'Yours ✓'));
      } else if (i.way === 'make-an-account') {
        var a = el('a', { class: 'plain', href: '/account/?next=' + encodeURIComponent('/shop/' + q) }, 'Make an account');
        act.appendChild(a); act.appendChild(el('span', { class: 'why' }, WAY[i.way]));
      } else if (i.way === 'ask-a-parent') {
        var p = el('button', { type: 'button', class: 'plain' }, 'Get a link for a parent');
        p.addEventListener('click', function () {
          api('POST', '/api/shop/parent', { item: i.id, game: boot.game || undefined }).then(function (r) {
            if (!r.ok) throw new Error(r.message);
            var box = el('div', { class: 'link' }, r.link);
            act.appendChild(box);
            if (navigator.share) navigator.share({ title: i.name, url: r.link }).catch(function () {});
            else if (navigator.clipboard) navigator.clipboard.writeText(r.link).then(function () { say('Copied. Send it to a parent or guardian; it works for a week.'); }).catch(function () {});
          }).catch(function (e) { say(e.message, true); });
        });
        act.appendChild(p); act.appendChild(el('span', { class: 'why' }, WAY[i.way]));
      } else if (i.way !== 'age-question') {
        act.appendChild(el('span', { class: 'why' }, WAY[i.way] || ''));
      }
      card.appendChild(act);
      list.appendChild(card);
    });
    if (s.nextCursor) { var next = el('button', { type: 'button' }, 'Next items'); next.onclick = function () { load(s.nextCursor); }; list.appendChild(next); }
    if (!s.items.length) list.appendChild(el('p', null, 'Nothing for sale here right now.'));
    if (boot.item) { var at = document.getElementById('item-' + boot.item); if (at && at.scrollIntoView) at.scrollIntoView({ block: 'center' }); }
  }
  function load(cursor) { api('GET', '/api/shop' + q + (q ? '&' : '?') + 'cursor=' + encodeURIComponent(cursor || '')).then(draw).catch(function () { draw({ ok: false }); }); }
  if (list) { if (/[?&]cancelled=1/.test(location.search)) say('Checkout cancelled. Any open reservation is released once Stripe confirms it.'); load(); }

  function returnToPage(cancelled) {
    try {
      var saved = JSON.parse(sessionStorage.getItem('shop-return') || 'null');
      if (!saved || typeof saved.path !== 'string' || saved.path[0] !== '/' || new URL(saved.path, location.origin).origin !== location.origin) return;
      if (cancelled && new URLSearchParams(location.search).get('order') !== saved.order) return;
      sessionStorage.removeItem('shop-return'); location.href = saved.path;
    } catch (e) {}
  }
  if (/[?&]cancelled=1/.test(location.search)) returnToPage(true);
  /* ---------------- /shop/thanks */
  if (boot.thanks) {
    var tries = 0;
    (function poll() {
      tries += 1;
      api('GET', '/api/shop/order?session=' + encodeURIComponent(boot.thanks)).then(function (r) {
        if (r.status === 'paid') { returnToPage(false); $('[data-thanks-title]').textContent = 'It\'s yours'; $('[data-thanks-line]').textContent = 'Paid. It is on your account now, in every game of ' + boot.studio + ' that uses it.'; return; }
        if (tries < 40) setTimeout(poll, 1500);
        else $('[data-thanks-line]').textContent = 'Stripe has not confirmed it yet. It will be on your account as soon as it does; your receipt comes by email.';
      }).catch(function () { if (tries < 40) setTimeout(poll, 3000); });
    })();
  }

  /* ---------------- the account page's purchases card */
  var card = $('[data-shop-card]');
  if (card) {
    api('GET', '/api/shop/mine').then(function (r) {
      if (!r.ok || (!r.orders.length && !r.owns.length)) return;
      card.hidden = false;
      var body = $('[data-shop-body]', card);
      if (r.badges && r.badges.length) { var bl = el('p'); r.badges.forEach(function (b) { bl.appendChild(el('span', { class: 'badge' }, b)); }); body.appendChild(bl); }
      var ul = el('ul');
      r.orders.flatMap(function (order) { return order.lines.map(function (line) { return Object.assign({}, order, line, { order: order.id }); }); }).forEach(function (o) {
        var li = el('li', null, o.name + ' · ' + o.shown + ' · ' + new Date(o.createdAt).toISOString().slice(0, 10) + ' · ' + o.status + ' ');
        if (o.refundable) {
          var b = el('button', { type: 'button', class: 'ghost small' }, 'Refund');
          b.addEventListener('click', function () {
            if (!confirm('Refund ' + o.name + ' (' + o.shown + ')? It leaves your account and the money goes back to your card in 5 to 10 days.')) return;
            b.disabled = true;
            api('POST', '/api/shop/refund', { order: o.order, line: o.id }).then(function (x) { if (!x.ok) throw new Error(x.message); li.textContent = o.name + ' · refunded'; }).catch(function (e) { b.disabled = false; alert(e.message); });
          });
          li.appendChild(b);
        }
        ul.appendChild(li);
      });
      body.appendChild(ul);
      body.appendChild(el('p', { class: 'note' }, (r.refundDays === null ? 'Ask the studio about refunds.' : 'The studio offers refunds for ' + (r.refundUsedItems ? 'items' : 'unused items') + ' within ' + r.refundDays + ' days.') + ' Receipts come from Stripe by email.'));
    }).catch(function () {});
  }
})();
`;

/* ------------------------------------------------------------------ the play shell's store sheet */

export const SHOP_SHELL_CSS = `
.shopsheet { position: fixed; inset: 0; z-index: 21; display: grid; place-items: end center; padding: 12px; background: rgba(2,4,10,.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); touch-action: manipulation; -webkit-user-select: text; user-select: text; }
.shopsheet .box { box-sizing: border-box; width: min(440px, 100%); max-height: min(78vh, 640px); overflow: auto; padding: 18px; border-radius: 20px; background: rgba(10,14,24,.98); border: 1px solid rgba(255,255,255,.16); color: #eef1f8; font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif; box-shadow: 0 24px 70px rgba(0,0,0,.6); }
@media (min-width: 700px) { .shopsheet { place-items: center; } }
.shopsheet h2 { margin: 0 0 4px; font-size: 19px; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.shopsheet h2 button { background: none; border: 0; color: #aab3c7; font: 600 22px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; width: 40px; height: 40px; }
.shopsheet .sub { margin: 0 0 12px; color: #aab3c7; font-size: 13px; }
.shopsheet a.buy { display: inline-flex; align-items: center; min-height: 44px; color: inherit; font-weight: 700; }
.shopsheet .it { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center; padding: 12px 0; border-top: 1px solid rgba(255,255,255,.1); }
.shopsheet .it b { font-size: 15.5px; }
.shopsheet .it .pr { font-weight: 800; }
.shopsheet .it small { grid-column: 1 / -1; color: #b9c2d6; }
.shopsheet .it .go { grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.shopsheet .it .go button, .shopsheet .it .go a { min-height: 42px; padding: 0 14px; border-radius: 11px; border: 1px solid rgba(255,255,255,.2); background: transparent; color: inherit; font: 700 14px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
.shopsheet .it .go .buy { background: var(--hot); color: #0b0b10; border-color: transparent; }
.shopsheet .it .go span { color: #b9c2d6; font-size: 13px; }
.shopsheet .qr { width: min(260px, 60vmin); margin: 8px auto; border-radius: 12px; overflow: hidden; background: #fff; }
.shopsheet .qr svg { display: block; width: 100%; height: 100%; }
.shopsheet .said { min-height: 1.3em; margin: 8px 0 0; font-weight: 600; }
.shopsheet .foot { margin: 12px 0 0; font-size: 12.5px; color: #8f99b0; }
.shopsheet .foot a { color: #c9d1e3; }
`;

/**
 * The play shell's half of `@homie-rocks/studio/shop` (shop/SHOP.md): answers the game's `homie-shop` messages, only
 * from its own frame and only for THIS game, and shows the store sheet when the game (or the room button) asks. On a
 * television or kids server, visibility and checkout follow the studio policy.
 */
export const SHOP_SHELL_JS = String.raw`(function () {
  'use strict';
  var boot = window.__HOMIE_PLAY || {};
  var cfg = boot.shop;
  var frame = document.querySelector('iframe.game');
  if (!frame) return;
  var GAME = boot.game;
  var SERVER = boot.server ? boot.server.id : 'public';
  var kids = !!(boot.server && boot.server.kids && (!cfg || !cfg.policy.kidsServer));
  var screen = !!(boot.screen && (!cfg || !cfg.policy.televisionCheckout));
  var WAY = ${JSON.stringify(WAY_LINES)};
  var owns = [];
  var lastSeen = '';
  function api(method, path, body) {
    if (path === '/api/shop/buy') {
      // A guest's purchase is tied to this browser. Check persistence before taking money.
      document.cookie = 'shop_cookie_check=1; Path=/; SameSite=Lax';
      var cookiesWork = /(?:^|; )shop_cookie_check=1(?:;|$)/.test(document.cookie);
      document.cookie = 'shop_cookie_check=; Path=/; Max-Age=0; SameSite=Lax';
      if (!cookiesWork) return Promise.resolve({ ok: false, error: 'cookies', message: 'Allow cookies for this site before buying so you can keep access to your purchases.' });
    }
    var init = { method: method, credentials: 'same-origin', cache: 'no-store', headers: {} };
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (r) { return r.json().catch(function () { return { ok: false, message: 'the site answered ' + r.status }; }); });
  }
  function post(m) { try { frame.contentWindow.postMessage(Object.assign({ t: 'homie-shop' }, m), '*'); } catch (e) {} }
  function el(tag, attrs, text) { var n = document.createElement(tag); if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (text !== undefined) n.textContent = text; return n; }
  var q = '?game=' + encodeURIComponent(GAME) + '&server=' + encodeURIComponent(SERVER);
  function refresh() {
    if (!cfg || kids || screen) return Promise.resolve(owns);
    return api('GET', '/api/player/owns' + q).then(function (r) {
      var next = (r && r.owns) || [];
      var key = JSON.stringify(next.slice().sort());
      if (key !== lastSeen) { var fresh = lastSeen !== '' || owns.length === 0; lastSeen = key; owns = next; post({ ev: 'owns', owns: owns, fresh: fresh }); }
      return owns;
    }).catch(function () { return owns; });
  }
  function leaveForCheckout(tab, result) {
    if (tab) { tab.location.href = result.url; return; }
    try { sessionStorage.setItem('shop-return', JSON.stringify({ order: result.order, path: location.pathname + location.search + location.hash })); } catch (e) {}
    location.href = result.url;
  }
  var watching = 0;
  /** After a checkout opens in a new tab: look again when this tab comes back, and every few seconds for two minutes. */
  function watch() {
    watching = Date.now();
    (function tick() { if (Date.now() - watching > 120000) return; refresh().then(function () { setTimeout(tick, 3000); }); })();
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && watching) refresh(); });

  var sheet = null;
  function close() { if (sheet) { sheet.remove(); sheet = null; post({ ev: 'closed' }); } }
  function open(want) {
    close();
    sheet = el('div', { class: 'shopsheet', role: 'dialog', 'aria-label': 'Shop' });
    var box = el('div', { class: 'box' });
    var h = el('h2', null, ''); h.appendChild(el('span', null, (boot.name || 'Game') + ': shop'));
    var x = el('button', { type: 'button', 'aria-label': 'Close' }, '×'); x.addEventListener('click', close); h.appendChild(x);
    box.appendChild(h);
    sheet.appendChild(box);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    document.body.appendChild(sheet);
    if (kids || !cfg) { box.appendChild(el('p', { class: 'sub' }, 'Nothing is sold here.')); return; }
    // The player address, and any page shown inside another site's frame, never starts a purchase: it links to the shop.
    var inFrame = false;
    try { inFrame = Boolean(window.top) && window.top !== window; } catch (e) { inFrame = true; }
    if (boot.embed || inFrame) {
      box.appendChild(el('p', { class: 'sub' }, inFrame ? 'Purchases open on the studio’s site, outside this post.' : 'Purchases are made in the studio’s shop.'));
      box.appendChild(el('a', { class: 'buy', href: '/shop/?game=' + encodeURIComponent(GAME), target: '_blank', rel: 'noopener noreferrer' }, inFrame ? 'Buy on the studio’s site ↗' : 'Go to the shop'));
      return;
    }
    if (screen) {
      // The studio's protective TV policy: a code to scan and buy on a phone, in the phone's own browser.
      box.appendChild(el('p', { class: 'sub' }, 'Buy on your phone: scan this code. Nothing is sold on this screen.'));
      if (cfg.qr) { var qr = el('div', { class: 'qr' }); qr.innerHTML = cfg.qr; box.appendChild(qr); }
      if (cfg.url) box.appendChild(el('p', { class: 'foot' }, cfg.url.replace(/^https?:\/\//, '')));
      return;
    }
    box.appendChild(el('p', { class: 'sub' }, 'Real money, from the studio itself. Stripe opens in a new tab when available. Otherwise checkout leaves this page and returns here after payment.'));
    var said = el('p', { class: 'said', role: 'status' });
    var listBox = el('div'); box.appendChild(listBox); box.appendChild(said);
    var foot = el('p', { class: 'foot' }); var all = el('a', { href: '/shop/?game=' + encodeURIComponent(GAME), target: '_blank', rel: 'noopener' }, 'The whole shop'); foot.appendChild(all); foot.appendChild(document.createTextNode(' · see the studio refund terms in the whole shop.')); box.appendChild(foot);
    function loadItems(cursor) {
    listBox.textContent = '';
    api('GET', '/api/shop' + q + '&cursor=' + encodeURIComponent(cursor || '')).then(function (s) {
      if (!s.ok || !s.open) { listBox.appendChild(el('p', { class: 'sub' }, s.kids ? 'Nothing is sold here.' : 'The shop is not open yet.')); return; }
      s.items.forEach(function (i) {
        var row = el('div', { class: 'it' });
        row.appendChild(el('b', null, i.name)); row.appendChild(el('span', { class: 'pr' }, i.shown));
        if (i.blurb) row.appendChild(el('small', null, i.blurb));
        var go = el('div', { class: 'go' });
        if (i.way === 'cap' && i.retryWay) { go.appendChild(el('span', null, WAY.cap)); i.way = i.retryWay; }
        if (i.way === 'checkout' && i.price !== 'choose') {
          var b = el('button', { type: 'button', class: 'buy' }, 'Buy on Stripe');
          b.addEventListener('click', function () {
            // The new tab opens on the tap (a browser allows that), then goes to Stripe's page once it is made.
            var tab = window.open('', '_blank');
            b.disabled = true; said.textContent = 'Opening Stripe…';
            api('POST', '/api/shop/buy', { item: i.id, game: GAME, server: SERVER }).then(function (r) {
              if (!r.ok || !r.url) throw new Error(r.message || 'That did not work.');
              leaveForCheckout(tab, r);
              said.textContent = 'Finish on Stripe\'s page. It shows up here once it is paid.';
              watch();
            }).catch(function (e) { if (tab) tab.close(); b.disabled = false; said.textContent = e.message; });
          });
          go.appendChild(b);
        } else if (i.way === 'owned') go.appendChild(el('span', null, 'Yours ✓'));
        else {
          var a = el('a', { href: '/shop/?game=' + encodeURIComponent(GAME) + '&item=' + encodeURIComponent(i.id), target: '_blank', rel: 'noopener' }, i.way === 'make-an-account' ? 'Make an account' : i.way === 'age-question' ? 'One question first' : i.way === 'ask-a-parent' ? 'Ask a parent' : 'More');
          if (i.way === 'make-an-account' || i.way === 'age-question' || i.way === 'ask-a-parent' || i.price === 'choose') { go.appendChild(a); a.addEventListener('click', watch); }
          go.appendChild(el('span', null, WAY[i.way] || ''));
        }
        row.appendChild(go);
        if (want && want === i.id) setTimeout(function () { row.scrollIntoView && row.scrollIntoView({ block: 'center' }); }, 0);
        listBox.appendChild(row);
      });
      if (s.nextCursor) { var next = el('button', { type: 'button' }, 'Next items'); next.onclick = function () { loadItems(s.nextCursor); }; listBox.appendChild(next); }
      if (!s.items.length) listBox.appendChild(el('p', { class: 'sub' }, 'Nothing for sale here right now.'));
    }).catch(function () { listBox.appendChild(el('p', { class: 'sub' }, 'The shop did not answer.')); });
    }
    loadItems('');
  }
  var opener = document.querySelector('[data-shop-open]');
  if (opener) opener.addEventListener('click', function () { open(null); });
  var state = window.__shell || (window.__shell = {});
  state.shop = { open: open, close: close, refresh: refresh, get owns() { return owns.slice(); } };

  window.addEventListener('message', function (ev) {
    if (ev.source !== frame.contentWindow) return;
    var m = ev.data;
    if (!m || typeof m !== 'object' || m.t !== 'homie-shop') return;
    var reply = function (body) { post(Object.assign({ q: m.q }, body)); };
    if (m.op === 'hello') {
      if (!cfg || kids) return reply({ ok: true, open: false, kids: kids, screen: screen, owns: [] });
      return refresh().then(function () { reply({ ok: true, open: true, kids: false, screen: screen, owns: owns }); });
    }
    if (m.op === 'owns') return refresh().then(function () { reply({ ok: true, owns: owns }); });
    if (m.op === 'open') { open(typeof m.item === 'string' ? m.item : null); return reply({ ok: true, shown: true }); }
    if (m.op === 'close') { close(); return reply({ ok: true }); }
    if (m.op === 'checkout') {
      if (!cfg || kids || screen) return reply({ ok: false, error: 'policy' });
      var checkoutTab = window.open('', '_blank');
      return api('POST', '/api/shop/buy', { lines: m.lines, game: GAME, server: SERVER }).then(function (r) {
        if (r.ok && r.url) { leaveForCheckout(checkoutTab, r); watch(); } else if (checkoutTab) checkoutTab.close();
        reply(r);
      }).catch(function () { if (checkoutTab) checkoutTab.close(); reply({ ok: false }); });
    }
    if (m.op === 'used') {
      var key = String(m.key || '');
      if (!/^[^\u0000-\u001f\u007f]+$/.test(key) || owns.indexOf(key) < 0) return reply({ ok: false, error: 'key' });
      return api('POST', '/api/shop/used', { key: key }).then(function (r) { reply({ ok: !!r.ok }); }).catch(function () { reply({ ok: false }); });
    }
    reply({ ok: false, error: 'op' });
  });
  if (cfg && !kids && !screen) refresh();
})();
`;

/* ------------------------------------------------------------------ the office's shop page */

export const OFFICE_SHOP_SCRIPT = String.raw`(function () {
  'use strict';
  function $(s) { return document.querySelector(s); }
  function el(tag, attrs, text) { var n = document.createElement(tag); if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (text !== undefined) n.textContent = text; return n; }
  function api(method, path, body) {
    var init = { method: method, credentials: 'same-origin', cache: 'no-store', headers: {} };
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (r) { return r.json().catch(function () { return { ok: false, message: 'the site answered ' + r.status }; }); });
  }
  var zeroDecimal = ${JSON.stringify([...ZERO_DECIMAL])};
  function cents(n, c) { var scale = zeroDecimal.indexOf(String(c || 'usd').toLowerCase()) >= 0 ? 1 : ['bhd', 'jod', 'kwd', 'omr', 'tnd'].indexOf(String(c).toLowerCase()) >= 0 ? 1000 : 100; try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(c || 'usd').toUpperCase(), minimumFractionDigits: scale === 1 || ['isk', 'ugx'].indexOf(c) >= 0 ? 0 : Math.log10(scale), maximumFractionDigits: scale === 1 || ['isk', 'ugx'].indexOf(c) >= 0 ? 0 : Math.log10(scale) }).format(n / scale); } catch (e) { return (n / scale).toFixed(scale === 1 ? 0 : Math.log10(scale)); } }
  function toast(t) { var x = $('#toast'); x.textContent = t; x.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { x.hidden = true; }, 4000); }
  function link(href, text) { var a = el('a', { href: href, target: '_blank', rel: 'noopener' }, text); return a; }
  function load(cursor, orderCursor) {
    api('GET', '/_studio/api/shop?cursor=' + encodeURIComponent(cursor || '') + '&orderCursor=' + encodeURIComponent(orderCursor || '')).then(function (s) {
      var top = $('#state'); top.textContent = '';
      if (!s.ok) { top.appendChild(el('p', { class: 'empty' }, s.message || 'The shop did not answer.')); return; }
      top.appendChild(el('p', null, s.ready ? ('Open' + (s.mode === 'test' ? ' in TEST MODE (no real money)' : ', live') + (s.shop ? ', till: ' + s.shop.till : '')) : 'Not selling yet.'));
      if (s.missing.length) { var ul = el('ul'); s.missing.forEach(function (m) { ul.appendChild(el('li', null, m.words)); }); top.appendChild(ul); }
      if (s.shop && s.shop.policy) top.appendChild(el('p', { class: 'dim' }, 'Studio policy: ' + s.shop.policy.preset + '. Edit policy and optional amounts in shop.json.'));
      var links = el('p', { class: 'links' });
      [['Payments', s.stripe.payments], ['Refunds', s.stripe.refunds], ['Disputes', s.stripe.disputes], ['Payouts', s.stripe.payouts], ['Balance', s.stripe.balance], ['Tax', s.stripe.tax]].concat(s.stripe.managedPayments ? [['Managed Payments', s.stripe.managedPayments]] : []).forEach(function (l) { links.appendChild(link(l[1], l[0])); });
      links.appendChild(link('/_studio/api/shop/orders.csv', 'CSV for your accountant'));
      top.appendChild(links);
      if (s.totals) top.appendChild(el('p', { class: 'dim' }, 'Last 30 days: ' + s.totals.sales + ' sales, ' + cents(s.totals.paid, s.totals.currency) + ' before tax and fees; ' + s.totals.refunds + ' refunded (' + cents(s.totals.refunded, s.totals.currency) + '); ' + s.totals.disputes + ' disputed now, ' + s.totals.lost + ' lost.'));
      var ord = $('#orders'); ord.textContent = '';
      if (!s.orders.length) ord.appendChild(el('p', { class: 'empty' }, 'No orders yet.'));
      s.orders.forEach(function (o) {
        var row = el('div', { class: 'row' });
        row.appendChild(el('span', null, new Date(o.createdAt).toISOString().slice(0, 16).replace('T', ' ')));
        row.appendChild(el('b', null, o.name + ' · ' + o.shown));
        row.appendChild(el('span', null, (o.player && o.player.name ? o.player.name : 'a deleted account') + (o.parent ? ' (a parent paid)' : '') + (o.via ? ' · sent by ' + o.via : '')));
        row.appendChild(el('span', { class: 'st st-' + o.status }, o.status + (o.mode === 'test' ? ' · test' : '') + (o.note ? ' · ' + o.note : '')));
        if (o.stripe) row.appendChild(link(o.stripe, 'In Stripe'));
        if (o.dispute) row.appendChild(link(o.dispute, 'The dispute'));
        if (o.releasable) {
          var release = el('button', { type: 'button', class: 'ghost small' }, 'Release reservation');
          release.addEventListener('click', function () {
            if (!confirm('Release ' + o.name + ' (' + o.shown + ') from the cap? We ask Stripe to expire an open Checkout Session. This does not refund a payment. A payment that still arrives grants the item, counts toward spending and can be refunded from the office.')) return;
            release.disabled = true;
            api('POST', '/_studio/api/shop/release', { order: o.id }).then(function (r) { if (!r.ok) throw new Error(r.message || 'That did not work.'); toast('Reservation released.'); load(); }).catch(function (e) { release.disabled = false; toast(e.message); });
          });
          row.appendChild(release);
        }
        if (o.refundable) {
          var b = el('button', { type: 'button', class: 'ghost small' }, 'Refund');
          b.addEventListener('click', function () {
            if (!confirm('Refund ' + o.name + ' (' + o.shown + ') in full? The buyer gets the money back and the item leaves their account.')) return;
            b.disabled = true;
            api('POST', '/_studio/api/shop/refund', { order: o.id }).then(function (r) { if (!r.ok) throw new Error(r.message || 'That did not work.'); toast('Refunded.'); load(); }).catch(function (e) { b.disabled = false; toast(e.message); });
          });
          row.appendChild(b);
        }
        (o.lines || []).forEach(function (line) {
          var detail = el('span', null, line.name + ' × ' + line.quantity + ' · ' + cents(line.amount, o.currency) + ' · ' + line.status);
          if (o.refundable && line.status !== 'refunded') {
            var refundLine = el('button', { type: 'button' }, 'Refund line');
            refundLine.onclick = function () {
              refundLine.disabled = true;
              api('POST', '/_studio/api/shop/refund', { order: o.id, line: line.id }).then(function (r) { if (!r.ok) throw new Error(r.message); load(); }).catch(function (e) { refundLine.disabled = false; toast(e.message); });
            };
            detail.appendChild(refundLine);
          }
          row.appendChild(detail);
        });
        ord.appendChild(row);
      });
      if (s.nextOrdersCursor) { var nextOrders = el('button', { type: 'button' }, 'Next orders'); nextOrders.onclick = function () { load('', s.nextOrdersCursor); }; ord.appendChild(nextOrders); }
      var ref = $('#referrals'); ref.textContent = '';
      if (s.referrals.nextCursor) { var next = el('button', { type: 'button' }, 'Next referrers'); next.onclick = function () { load(s.referrals.nextCursor); }; ref.appendChild(next); }
      (s.referrals.failures || []).forEach(function (x) { ref.appendChild(el('p', null, 'Statement failed for ' + x.via + ': ' + (x.why || x.status) + '. Start again after completion to retry.')); });
      var owe = s.referrals.owe || [];
      ref.appendChild(el('h3', null, 'You owe referrers'));
      if (!owe.length) ref.appendChild(el('p', { class: 'dim' }, 'Nothing: no sale came from another site\'s link yet.'));
      owe.forEach(function (b) {
        var detail = el('details'); detail.appendChild(el('summary', null, 'Sales'));
        var sales = el('div'); detail.appendChild(sales);
        var more = el('button', { type: 'button' }, 'Show sales'); detail.appendChild(more);
        var lineCursor = '';
        more.onclick = function () {
          more.disabled = true;
          api('GET', '/_studio/api/shop/lines?via=' + encodeURIComponent(b.via) + '&currency=' + b.currency + '&cursor=' + encodeURIComponent(lineCursor)).then(function (page) {
            sales.textContent = '';
            page.lines.forEach(function (line) { sales.appendChild(el('p', null, line.date + ' · ' + line.item + ' · ' + cents(line.share, b.currency) + ' · ' + line.state)); });
            lineCursor = page.nextCursor; more.hidden = !lineCursor; more.disabled = false; more.textContent = 'Next sales';
          }).catch(function () { more.disabled = false; toast('Sales did not answer.'); });
        };
        var row = el('div', { class: 'row' });
        row.appendChild(el('b', null, b.via));
        row.appendChild(el('span', null, 'due ' + cents(b.due, b.currency) + ' · held ' + cents(b.pending, b.currency) + ' · ' + b.lineCount + ' sale(s)'));
        if (b.due > 0) {
          var m = el('button', { type: 'button', class: 'ghost small' }, 'Mark paid');
          m.addEventListener('click', function () {
            var ref0 = prompt('What paid it (an invoice number, a PayPal reference)?'); if (ref0 === null) return;
            api('POST', '/_studio/api/shop/settle', { via: b.via, currency: b.currency, ref: ref0 }).then(function (r) { if (!r.ok) throw new Error(r.message); toast('Marked paid.'); load(); }).catch(function (e) { toast(e.message); });
          });
          row.appendChild(m);
        }
        ref.appendChild(row); ref.appendChild(detail);
      });
      var send = el('button', { type: 'button', class: 'ghost small' }, 'Send last month\'s signed statements');
      send.addEventListener('click', async function () {
        send.disabled = true; send.textContent = 'Sending; keep this tab open. Close it and press again to resume safely.';
        var cursor = '', period = null, sent = 0, failed = [];
        try {
          do {
            var r = await api('POST', '/_studio/api/shop/statements/send', { cursor: cursor, period: period });
            if (!r.ok) throw new Error(r.message || 'Not sent.');
            sent += r.sent.filter(function (x) { return x.ok; }).length;
            failed = failed.concat(r.sent.filter(function (x) { return !x.ok; }).map(function (x) { return x.via + ': ' + (x.why || x.status); }));
            send.textContent = 'Sent ' + sent + ' pages. Keep open; press again after closing to resume safely.';
            cursor = r.nextCursor; period = r.period;
            if (r.retryAfter) { send.textContent = 'Retrying with backoff; keep open, or press again later to resume safely.'; await new Promise(function (resolve) { setTimeout(resolve, r.retryAfter * 1000); }); }
          } while (cursor !== null);
          if (r.failures) failed = r.failures.map(function (x) { return x.via + ': ' + (x.why || x.status); });
          toast('Sent ' + sent + ' statement pages; ' + failed.length + ' failed.' + (failed.length ? ' ' + failed.join('; ') : ''));
        } catch (e) { toast(e.message); }
        send.disabled = false; send.textContent = 'Send last month’s signed statements';
      });
      ref.appendChild(send);
      ref.appendChild(el('h3', null, 'Owed to you'));
      var inn = s.referrals.owedToUs || [];
      if (!inn.length) ref.appendChild(el('p', { class: 'dim' }, 'No statements yet. When another studio sells to a player you sent, it sends a signed statement here.'));
      inn.forEach(function (x) {
        var row = el('div', { class: 'row' });
        row.appendChild(el('b', null, x.seller.replace(/^https:\/\//, '')));
        row.appendChild(el('span', null, x.period + ': due ' + cents(x.due, x.currency) + ', held ' + cents(x.pending, x.currency)));
        row.appendChild(link('/_studio/api/shop/received?seller=' + encodeURIComponent(x.seller) + '&period=' + encodeURIComponent(x.period), 'Signed statement pages'));
        if (x.due > 0) row.appendChild(link(s.referrals.invoice, 'Invoice them in Stripe'));
        ref.appendChild(row);
      });
    }).catch(function () { $('#state').textContent = 'The shop did not answer.'; });
  }
  load();
})();
`;

let officeHash = null;
/** /_studio/office/shop: the owner's shop. One inline script, allowed by its hash; connect only to this site. */
export async function officeShopPage(cat) {
  const name = cat.studio?.name ?? 'Studio';
  if (!officeHash) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(OFFICE_SHOP_SCRIPT));
    officeHash = `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
  }
  const body = `<header class="top"><h1>${esc(name)} <small>Shop</small></h1><div class="links"><a href="/_studio/office">Office</a><a href="/_studio/stats">Stats</a></div></header>
<style>.row{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.row b{font-weight:700}.st{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line2)}.st-refunded,.st-lost{opacity:.7}.st-disputed{border-color:#ff8a80;color:#ff8a80}h3{margin:22px 0 6px;font-size:15px}.links a{margin-right:2px}</style>
<div class="game" style="padding:14px 16px" id="state"><p class="empty">Reading the shop…</p></div>
<div class="game" style="padding:6px 16px 12px"><h3>Orders</h3><div id="orders"></div></div>
<div class="game" style="padding:6px 16px 12px" id="referrals"></div>
<div class="toast" id="toast" role="status" hidden></div>
<p class="note">You are the seller. Money goes from players to your own Stripe account; Homie never sees it and takes nothing. Refund is one tap here (your AI can only ask, and you confirm). A card dispute never touches the player's account: answer it in Stripe; if you lose it, that one item is taken back. Tax: when enabled, Stripe Tax works out and collects tax where you told Stripe you are registered${cat.shop?.till === 'stripe-managed' ? '; with Managed Payments Stripe is the seller of record and files it for you' : ''}. Payouts, the balance and receipts are Stripe's own pages, linked above. Referrals: you pay referrers yourself (they invoice you); nothing moves through Homie. This is not legal or tax advice.</p>`;
  return new Response(shell(cat, `Shop · ${name}`, body, { script: OFFICE_SHOP_SCRIPT }), {
    headers: { ...PRIVATE, 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src '${officeHash}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` },
  });
}
