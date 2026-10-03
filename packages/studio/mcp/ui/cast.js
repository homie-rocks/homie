/* The cast card: the assets a game needs with their route (the engine, the free CC0 starter library, generated, the
 * person's own), a library match with its thumbnail or a price, against the art budget (assets_plan); or the starter
 * library's matches for some words (assets_find), each with Add. Adding a library item is free; anything paid goes
 * through the person's yes in the chat (asset_make prices it first). */
(function () {
  var C = Card;
  var busy = {};
  function thumb(src, alt) { var t = C.el('div', 'thumb'); var i = src ? C.img(src, alt) : null; if (i) t.appendChild(i); else t.appendChild(C.el('span', '', '·')); return t; }
  function addItem(sc, item, extra) {
    if (busy[item.id] || !sc.game) return;
    busy[item.id] = 'Adding…'; C.render();
    var a = { game: sc.game, item: item.id };
    for (var k in (extra || {})) if (extra[k] !== null && extra[k] !== undefined) a[k] = extra[k];
    C.call('asset_add', a).then(function (r) {
      busy[item.id] = r && r.isError ? C.textOf(r) : 'Added';
      if (!(r && r.isError)) C.tell('add:' + item.id, 'The person added ' + item.id + ' (CC0, free) from the starter library to ' + sc.game + ' on the cast card.');
      if (sc.mode === 'plan') C.call('assets_plan', { game: sc.game }).then(C.take).catch(C.render); else C.render();
    }).catch(function () { busy[item.id] = 'Not added'; C.render(); });
  }
  function plan(card, sc) {
    var list = C.el('ul', 'list cast');
    (sc.rows || []).forEach(function (r) {
      var li = C.el('li', r.state === 'made' ? 'done' : r.state === 'stale' ? 'now' : 'todo');
      li.appendChild(thumb(r.match && r.match.thumb, r.match ? r.match.name : r.id));
      li.appendChild(C.add(C.el('div', 'cb'), C.el('b', '', r.id + (r.card ? ' · ' + r.card : '')), C.el('span', '', r.kind + ', ' + r.tier + ' · ' + (r.state === 'planned' ? (r.match ? 'library match: ' + r.match.name + ' (' + r.match.tris + ' triangles, CC0)' : r.route === 'procedural' ? 'drawn by the game\'s code (free)' : 'no library match: generated, about US$' + r.usd) : r.state + ' (' + r.route + ')'))));
      var side = C.el('div', 'actions');
      if (r.state === 'planned' && r.match) side.appendChild(C.btn(busy[r.match.id] || 'Use it (free)', 'small', function () { addItem(sc, r.match, { as: r.id, card: r.card, height: r.heightM || null }); }));
      else if (r.state === 'planned' && r.usd) side.appendChild(C.btn('Generate', 'ghost small', function () { C.tell('gen:' + r.id, 'The person wants ' + r.id + ' (' + (r.card || r.kind) + ') generated: price it with asset_make (a dry run) and ask before paying.'); busy[r.id] = 'Asked your AI to price it'; C.render(); }));
      else side.appendChild(C.pill(r.state === 'made' ? 'Made' : r.state === 'stale' ? 'Stale' : r.state, r.state === 'made' ? 'ok' : r.state === 'stale' ? 'warn' : ''));
      if (busy[r.id]) side.appendChild(C.el('span', 'fine', busy[r.id]));
      li.appendChild(side);
      list.appendChild(li);
    });
    card.appendChild(list);
    card.appendChild(C.el('p', 'fine', 'To generate what the library cannot cover: about US$' + (sc.total || 0) + (sc.budget !== null && sc.budget !== undefined ? ' against an art budget of US$' + sc.budget : ' (no art budget: free routes only until you set one)') + '. Spent so far: US$' + (sc.spend ? sc.spend.used.toFixed(2) : '0.00') + '.'));
  }
  function find(card, sc) {
    var grid = C.el('div', 'games');
    (sc.items || []).forEach(function (it) {
      var g = C.el('div', 'game');
      var art = C.el('div', 'art'); var i = it.thumb ? C.img(it.thumb, it.name) : null; if (i) art.appendChild(i); else art.appendChild(document.createTextNode(it.name.slice(0, 1)));
      g.appendChild(art);
      g.appendChild(C.el('b', '', it.name));
      g.appendChild(C.el('span', '', it.kind + ' · ' + it.tris + ' triangles · ' + it.kb + ' KB · ' + it.family + (it.rigged ? ' · rigged' : '')));
      if (sc.game) g.appendChild(C.btn(busy[it.id] || 'Add (free)', 'small', function () { addItem(sc, it); }));
      grid.appendChild(g);
    });
    card.appendChild(grid);
    card.appendChild(C.el('p', 'fine', 'Every item is CC0 (free for any use, no credit required), already phone-sized. Adding one copies it into the game: it never loads from anywhere else.'));
  }
  // The characters: the decisions that shape them, then each one made or planned, with its skeleton and clips.
  function characters(card, sc) {
    var d = sc.decisions || {};
    var facts = C.el('ul', 'list decisions');
    [['style.proportions', 'Proportions'], ['style.shape', 'Shape and silhouette'], ['cast.family', 'Library family'], ['rig.skeleton', 'Skeleton'], ['rig.source', 'Rigs from'], ['rig.bones', 'Bones']].forEach(function (k) {
      var v = d[k[0]]; if (!v) return;
      var li = C.el('li', v.state === 'locked' ? 'locked' : '');
      li.appendChild(C.add(C.el('div', 'cb'), C.el('b', '', k[1] + ': ' + v.label), C.el('span', '', v.why || '')));
      li.appendChild(C.pill(v.state, v.state === 'locked' ? 'ok' : ''));
      facts.appendChild(li);
    });
    card.appendChild(facts);
    var chips = C.el('div', 'chips');
    (sc.palette || []).forEach(function (hex) { var s = C.el('span', 'swatch'); s.style.background = hex; s.title = hex; chips.appendChild(s); });
    card.appendChild(C.add(C.el('p', 'fine', 'Palette and silhouette rule: ' + (sc.silhouette || '') + ' '), chips));
    var list = C.el('ul', 'list cast');
    (sc.rows || []).forEach(function (r) {
      var li = C.el('li', r.state === 'made' ? 'done' : 'todo');
      li.appendChild(thumb(r.thumb, r.id));
      li.appendChild(C.add(C.el('div', 'cb'), C.el('b', '', r.id + (r.card ? ' · ' + r.card : '')), C.el('span', '', r.state === 'made' ? r.kind + ' · ' + (r.route === 'generated' ? 'generated (US$' + r.usd + ')' : r.route + (r.source ? ': ' + r.source : '')) + ' · ' + r.family + ' skeleton, ' + r.bones + ' bones · ' + r.tris + ' triangles · ' + r.heightM + ' m' : r.kind + ' · planned, ' + (r.heightM ? r.heightM + ' m' : 'no model yet')), r.verbs && r.verbs.length ? C.el('span', '', 'Clips: ' + r.verbs.join(', ')) : null));
      var side = C.el('div', 'actions');
      if (r.state === 'made') side.appendChild(C.btn('Clips', 'ghost small', function () { C.call('anim_plan', { game: sc.game, asset: r.id }).then(C.take).catch(C.render); }));
      else {
        side.appendChild(C.btn('Find in the library', 'small', function () { C.call('assets_find', { game: sc.game, query: r.id.replace(/-/g, ' '), kind: r.kind }).then(C.take).catch(C.render); }));
        side.appendChild(C.btn('Generate', 'ghost small', function () { C.tell('char:' + r.id, 'The person wants ' + r.id + ' (' + (r.card || r.kind) + ') generated as a rigged character: price it with character_make (a dry run, about US$1.44) and ask before paying.'); busy[r.id] = 'Asked your AI to price it'; C.render(); }));
      }
      if (busy[r.id]) side.appendChild(C.el('span', 'fine', busy[r.id]));
      li.appendChild(side);
      list.appendChild(li);
    });
    card.appendChild(list);
    card.appendChild(C.el('p', 'fine', 'Library characters are free (CC0); a generated one is about US$1.44 on your own fal account, priced and asked for first. Spent so far: US$' + (sc.spend ? sc.spend.used.toFixed(2) : '0.00') + '.'));
  }
  function render(sc) {
    var card = C.el('main', 'card');
    var title = sc.mode === 'find' ? 'Free models for “' + sc.query + '”' : sc.mode === 'added' ? 'Added ' + (sc.added && sc.added.asset) : sc.mode === 'characters' ? 'The characters of ' + sc.game : 'The cast of ' + sc.game;
    C.add(card, C.top('Cast', sc.mode === 'characters' ? C.pill((sc.rows || []).filter(function (r) { return r.state === 'made'; }).length + ' made', '') : sc.mode === 'plan' ? C.pill((sc.rows || []).filter(function (r) { return r.state === 'made'; }).length + ' of ' + (sc.rows || []).length + ' made', '') : null), C.el('h1', '', title));
    if (sc.library && sc.library.error) card.appendChild(C.el('p', 'note', 'Starter library: ' + sc.library.error));
    if (sc.mode === 'plan') plan(card, sc);
    else if (sc.mode === 'characters') characters(card, sc);
    else if (sc.mode === 'find') find(card, sc);
    else if (sc.added) card.appendChild(C.el('p', 'sub', sc.added.asset + ' is in games/' + sc.game + (sc.added.after ? ': ' + sc.added.after.tris + ' triangles, ' + sc.added.after.kb + ' KB' : '') + '. Licence: ' + (sc.added.license || 'CC0') + '.'));
    return card;
  }
  C.start({ kind: 'cast', label: 'Cast', fullscreen: true, render: render, poll: null });
})();
