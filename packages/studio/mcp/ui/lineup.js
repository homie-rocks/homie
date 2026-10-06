/* The lineup card: every made asset at true scale on a 1 m grid under the game's light, front and three-quarter, their
 * silhouettes at phone size, each asset's flags (over budget, palette drift, an unreadable silhouette, another library
 * family, stale) and the scene's budgets as bars (asset_lineup). Also a generated prop on its way (asset_make): the price
 * before anything is paid, the concept to look at, then the model; each paid step only on the person's press. */
(function () {
  var C = Card;
  var state = { busy: null };
  function bar(label, value, budget, unit) {
    if (value === null || value === undefined || !budget) return null;
    var row = C.el('div', 'budget');
    var pct = Math.min(100, Math.round((value / budget) * 100));
    var b = C.el('div', 'track'); var f = C.el('i'); f.style.width = pct + '%'; if (value > budget) f.className = 'over'; b.appendChild(f);
    C.add(row, C.el('span', '', label), b, C.el('span', 'n', (typeof value === 'number' ? value.toLocaleString('en-US') : value) + ' / ' + budget.toLocaleString('en-US') + (unit || '')));
    return row;
  }
  function lineup(card, sc) {
    var pics = C.el('div', 'preview');
    [['front', 'Front, true scale on a 1 m grid'], ['quarter', 'Three-quarter, under the game\'s light']].forEach(function (p) { var i = sc.images && C.img(sc.images[p[0]], p[1]); if (i) { i.style.maxHeight = 'none'; i.style.objectFit = 'contain'; pics.appendChild(i); } });
    card.appendChild(pics);
    if (sc.images && sc.images.silhouettes) { var s = C.img(sc.images.silhouettes, 'Silhouettes at 64 px'); if (s) { s.className = 'sil'; card.appendChild(s); } }
    var list = C.el('ul', 'list');
    (sc.rows || []).forEach(function (r) {
      var li = C.el('li', r.flags.length ? 'now' : 'done');
      li.appendChild(C.add(C.el('div', 'cb'), C.el('b', '', r.label + (r.size ? ' · ' + r.size[1] + ' m' : '')), C.el('span', '', r.kind + ', ' + r.route + (r.usage === 'unused' ? ' · unused (not drawn by the game)' : '') + (r.drift ? (r.drift.repaint ? ' · repainted from style.json in the game' : ' · palette distance ' + r.drift.mean) : '')), r.flags.length ? C.el('span', 'fix', r.flags.join(' · ')) : null));
      li.appendChild(C.pill(r.flags.length ? r.flags.length + ' flag' + (r.flags.length === 1 ? '' : 's') : 'Fits', r.flags.length ? 'warn' : 'ok'));
      list.appendChild(li);
    });
    card.appendChild(list);
    if (sc.totals && sc.budgets) {
      card.appendChild(C.el('h2', '', 'Phone budgets: an estimate from the recorded files'));
      [bar('Draw calls', sc.totals.drawCalls, sc.budgets.drawCalls), bar('Triangles', sc.totals.triangles, sc.budgets.triangles), bar('Picture memory', sc.totals.textureMB, sc.budgets.textureMB, ' MB'), bar('Shipped payload', sc.totals.firstPlayMB, sc.budgets.firstPlayMB, ' MB')].forEach(function (b) { if (b) card.appendChild(b); });
    }
  }
  function make(card, sc) {
    var run = function (args, note) {
      state.busy = note; C.render();
      var a = { game: sc.game, asset: sc.asset };
      for (var q in (sc.request || {})) a[q] = sc.request[q];
      for (var k in args) a[k] = args[k];
      C.call(sc.character ? 'character_make' : 'asset_make', a).then(function (r) { state.busy = null; C.take(r); }).catch(function () { state.busy = 'That did not reach the studio.'; C.render(); });
    };
    if (sc.concept) { var i = C.img(sc.concept, 'The concept for ' + sc.asset); if (i) { i.style.maxHeight = '360px'; i.style.objectFit = 'contain'; card.appendChild(C.add(C.el('div', 'preview'), i)); } }
    if (sc.dryRun) {
      card.appendChild(C.el('p', 'sub', (sc.step === 'mesh' ? (sc.character ? 'The rigged character' : 'The 3D model') : 'The concept image') + ' costs about US$' + (sc.price ? sc.price.usd : '?') + (sc.total ? '; the whole ' + (sc.character ? 'character' : 'prop') + ' about US$' + sc.total : '') + ', on your own fal account.'));
      card.appendChild(C.add(C.el('div', 'actions'), C.btn('Make it (US$' + (sc.price ? sc.price.usd : '?') + ')', '', function () { C.tell('approve:' + sc.asset + sc.step, 'The person approved US$' + (sc.price && sc.price.usd) + ' for the ' + sc.step + ' of ' + sc.asset + ' on the card.'); run({ step: sc.step, approve: true }, 'Making it…'); })));
    } else if (sc.needs === 'approval' || sc.why) card.appendChild(C.el('p', 'note', sc.why || 'Needs the person\'s yes.'));
    else if ((sc.step === 'concept' || sc.step === 'look') && sc.concept) {
      card.appendChild(C.el('p', 'sub', sc.character ? 'Look at it: one character, whole, in an A-pose, in the game\'s style, on a plain background? Then the rigged 3D character (about US$' + (sc.then ? sc.then.usd : '1.40') + '); its clips come from the free library.' : 'Look at it: the thing, whole, in the game\'s style, on a plain background? Then the 3D model (about US$' + (sc.then ? sc.then.usd : '0.50') + ').'));
      card.appendChild(C.add(C.el('div', 'actions'), C.btn(sc.character ? 'Make the rigged character' : 'Make the 3D model', '', function () { C.tell('mesh:' + sc.asset, 'The person approved the ' + (sc.character ? 'rigged character' : '3D model') + ' of ' + sc.asset + ' (about US$' + (sc.then ? sc.then.usd : sc.character ? '1.40' : '0.50') + ') on the card.'); run({ step: 'mesh', approve: true }, sc.character ? 'Making the rigged character (2 to 5 minutes)…' : 'Making the model (1 to 3 minutes)…'); })));
    } else if (sc.step === 'mesh' && sc.after) {
      card.appendChild(C.el('p', 'note ok', sc.asset + ': ' + sc.before.tris + ' → ' + sc.after.tris + ' triangles, ' + sc.after.kb + ' KB, ' + sc.after.heightM + ' m. Recorded with its receipts and licence.' + (sc.character && sc.verbs && sc.verbs.length ? ' Clips (the library\'s, retargeted, free): ' + sc.verbs.join(', ') + '.' : '')));
      card.appendChild(C.add(C.el('div', 'actions'), C.btn('Show the lineup', 'ghost', function () { state.busy = 'Drawing the lineup…'; C.render(); C.call('asset_lineup', { game: sc.game }).then(function (r) { state.busy = null; C.take(r); }); }), sc.character ? C.btn('Show its clips', 'ghost', function () { state.busy = 'Drawing its clips…'; C.render(); C.call('anim_preview', { game: sc.game, asset: sc.asset }).then(function (r) { state.busy = null; C.take(r); }); }) : null));
    }
  }
  function render(sc) {
    var card = C.el('main', 'card');
    var flagged = sc.mode === 'lineup' ? sc.flagged : null;
    C.add(card, C.top(sc.mode === 'make' ? (sc.character ? 'Make a character' : 'Make a prop') : 'Lineup', C.add(C.el('div', 'actions'), flagged !== null && flagged !== undefined ? C.pill(flagged ? flagged + ' flagged' : 'One look', flagged ? 'warn' : 'ok') : null, C.fullscreenButton())),
      C.el('h1', '', sc.mode === 'make' ? sc.asset : 'The cast of ' + sc.game + ', at true scale'));
    if (state.busy) card.appendChild(C.el('p', 'note', state.busy));
    if (sc.mode === 'make') make(card, sc); else lineup(card, sc);
    var foot = C.el('div', 'foot');
    foot.appendChild(C.el('span', 'when', 'Spent US$' + (sc.spend ? sc.spend.used.toFixed(2) : '0.00') + (sc.spend && sc.spend.cap !== null ? ' of US$' + sc.spend.cap : '') + ' · receipts in art/receipts.jsonl'));
    card.appendChild(foot);
    return card;
  }
  C.start({ kind: 'lineup', label: 'Lineup', fullscreen: true, render: render, poll: null });
})();
