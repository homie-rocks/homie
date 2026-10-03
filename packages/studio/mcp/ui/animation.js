/* The animation card: each character's clips against the verbs the game needs, every one a small looping preview drawn
 * by the game engine under the game's light (anim_preview), where it came from (its own, or the CC0 library's clips
 * retargeted onto its skeleton), the verbs it lacks with Add (anim_add: free, baked into its skeleton's clip library),
 * and Feel: the Game Lab on the move that plays it (game_lab with its take), New beside Today. */
(function () {
  var C = Card;
  var state = { busy: null };
  function tile(r, c, sc) {
    var t = C.el('div', 'clip' + (c.have ? '' : ' missing'));
    var art = C.el('div', 'art');
    var src = r.previews && r.previews[c.verb];
    var i = src ? C.img(src, r.id + ' ' + c.verb) : null;
    if (i) art.appendChild(i); else art.appendChild(C.el('span', '', c.have ? '…' : '+'));
    t.appendChild(art);
    t.appendChild(C.el('b', '', c.verb + (c.loop ? ' ↻' : '')));
    t.appendChild(C.el('span', '', c.have ? (c.source ? c.source + (c.retargeted ? ' · retargeted' : '') : 'its own') : 'missing'));
    if (!c.have) t.appendChild(C.btn(state.busy === r.id + c.verb ? 'Adding…' : 'Add (free)', 'small', function () {
      state.busy = r.id + c.verb; C.render();
      C.call('anim_add', { game: sc.game, asset: r.id, verbs: [c.verb] }).then(function (res) { state.busy = null; C.tell('clip:' + r.id + c.verb, 'The person added the ' + c.verb + ' clip to ' + r.id + ' on the animation card (free, retargeted onto its skeleton).'); C.take(res); }).catch(function () { state.busy = null; C.render(); });
    }));
    var take = sc.feel && sc.feel[c.verb];
    if (c.have && take) t.appendChild(C.btn('Feel', 'ghost small', function () {
      state.busy = 'Opening the Game Lab on “' + take + '”…'; C.render();
      C.tell('feel:' + c.verb, 'The person pressed Feel on ' + r.id + '\'s ' + c.verb + ' clip: the Game Lab opens on the "' + take + '" take, New beside Today; its Motion sliders (fade, actSpeed, jumpStretch, landSquash, lean, ...) tune how it feels.');
      C.call('game_lab', { game: sc.game, take: take }).then(function (res) { state.busy = null; C.take(res); }).catch(function () { state.busy = 'The Game Lab did not start.'; C.render(); });
    }));
    return t;
  }
  function render(sc) {
    var card = C.el('main', 'card');
    var rows = sc.rows || [];
    var missing = rows.reduce(function (n, r) { return n + (r.missing || []).length; }, 0);
    C.add(card, C.top('Clips', C.add(C.el('div', 'actions'), C.pill(missing ? missing + ' missing' : 'All there', missing ? 'warn' : 'ok'), C.fullscreenButton())),
      C.el('h1', '', 'How the characters of ' + sc.game + ' move'),
      C.el('p', 'sub', 'The game needs ' + (sc.verbs || []).join(', ') + '. Clips are baked into one library per skeleton at build time; every character on that skeleton shares it.'));
    if (state.busy && !/^[a-z0-9-]+[a-z]+$/.test(state.busy)) card.appendChild(C.el('p', 'note', state.busy));
    rows.forEach(function (r) {
      var sec = C.el('section', 'chars');
      sec.appendChild(C.add(C.el('div', 'dirhead'), C.el('b', '', r.id), C.el('span', '', r.familyLabel + ' · ' + r.bones + ' bones' + (r.animsKB ? ' · clips ' + r.animsKB + ' KB' : '') + ' · ' + r.route)));
      if (r.shown) {
        var grid = C.el('div', 'clips');
        (r.clips || []).forEach(function (c) { grid.appendChild(tile(r, c, sc)); });
        (r.extra || []).forEach(function (v) { grid.appendChild(tile(r, { verb: v, have: true, loop: false, source: null }, sc)); });
        sec.appendChild(grid);
        if (!r.previewed) sec.appendChild(C.btn(state.busy === 'draw' + r.id ? 'Drawing…' : 'Draw its clips (free)', 'ghost small', function () { state.busy = 'draw' + r.id; C.render(); C.call('anim_preview', { game: sc.game, asset: r.id }).then(function (res) { state.busy = null; C.take(res); }).catch(function () { state.busy = null; C.render(); }); }));
      } else sec.appendChild(C.btn('Show its clips', 'ghost small', function () { C.call('anim_plan', { game: sc.game, asset: r.id }).then(C.take).catch(C.render); }));
      card.appendChild(sec);
    });
    (sc.unrigged || []).forEach(function (u) { card.appendChild(C.el('p', 'fine', u + ' has no rig: a still model (the animate guide says how to rig one).')); });
    var foot = C.el('div', 'foot');
    foot.appendChild(C.el('span', 'when', Object.keys(sc.feel || {}).length ? 'Feel opens the Game Lab on this computer' : 'No Game Lab take yet: the lab guide adds one'));
    card.appendChild(foot);
    return card;
  }
  C.start({ kind: 'animation', label: 'Clips', fullscreen: true, render: render, poll: null });
})();
