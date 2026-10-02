/* The style board card: a game's three directions, each drawn by the game engine (a painted mood image beside it only as
 * a labelled target), with Pick, Mix, Steer and Lock; and the style decisions with their state (auto, steered, pinned
 * by use, locked). Every press is the person's: decision_set with by "person", then style_board redraws the card, and
 * the model is told once what changed. */
(function () {
  var C = Card;
  var STATE = { auto: 'Auto', steered: 'Steered', pinned: 'Pinned', locked: 'Locked' };
  var STATE_CLS = { auto: '', steered: '', pinned: 'live', locked: 'ok' };
  var ui = { mix: false, steer: null, busy: false, msg: null };
  var fontsAsked = {};
  function loadFont(f) {
    if (!f || fontsAsked[f] || !/^[A-Za-z0-9 ]{1,40}$/.test(f)) return;
    fontsAsked[f] = true;
    var l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@400;700&display=swap';
    l.onload = function () { C.size(); };
    document.head.appendChild(l);
  }
  function chips(colours) {
    var row = C.el('span', 'chips');
    (colours || []).forEach(function (c) { if (!/^#[0-9a-f]{3,8}$/i.test(c)) return; var s = C.el('span', 'swatch'); s.style.background = c; s.title = c; row.appendChild(s); });
    return row;
  }
  function refresh(sc, note) {
    return C.call('style_board', { game: sc.game }).then(function (r) { ui.busy = false; ui.msg = note || null; C.take(r); }).catch(function () { ui.busy = false; C.render(); });
  }
  function act(sc, args, tell, note) {
    if (ui.busy) return;
    ui.busy = true; ui.msg = 'Working…'; C.render();
    var a = { game: sc.game, by: 'person' };
    for (var k in args) a[k] = args[k];
    C.call('decision_set', a).then(function (r) {
      var why = r && r.isError ? C.textOf(r) : null;
      if (!why && tell) C.tell(tell.key + ':' + Date.now(), tell.text);
      refresh(sc, why || note);
    }).catch(function () { ui.busy = false; ui.msg = 'That did not reach the studio.'; C.render(); });
  }
  function direction(sc, d) {
    var box = C.el('div', 'dir' + (d.chosen ? ' chosen' : ''));
    if (d.swatch) { var i = C.img(d.swatch, 'Direction ' + d.id.toUpperCase() + ', drawn by the game engine'); if (i) box.appendChild(i); }
    if (d.mood && d.mood.image) {
      var m = C.img(d.mood.image, 'A painted mood image (a target)');
      if (m) { box.appendChild(m); box.appendChild(C.el('p', 'fine', 'Painted target, not what the game draws' + (d.mood.usd ? ' (US$' + d.mood.usd + ')' : ''))); }
    }
    var head = C.add(C.el('div', 'dirhead'), C.el('b', '', d.id.toUpperCase()), C.el('span', '', d.label));
    box.appendChild(head);
    box.appendChild(chips(d.colours));
    if (d.fonts && d.fonts.display) {
      loadFont(d.fonts.display); loadFont(d.fonts.body);
      var t = C.el('p', 'type', sc.title);
      t.style.fontFamily = '"' + d.fonts.display + '", var(--f-sans)';
      var b = C.el('p', 'fine', d.fonts.display + ' and ' + d.fonts.body);
      if (d.fonts.body) b.style.fontFamily = '"' + d.fonts.body + '", var(--f-sans)';
      box.appendChild(t); box.appendChild(b);
    }
    var acts = C.el('div', 'actions');
    acts.appendChild(C.btn(d.chosen ? 'Picked' : 'Pick ' + d.id.toUpperCase(), d.chosen ? 'ghost small' : 'small', function () {
      act(sc, { pick: d.id }, { key: 'pick', text: 'The person picked direction ' + d.id.toUpperCase() + ' (' + d.label + ') on the style board.' }, 'Picked ' + d.id.toUpperCase() + '.');
    }));
    box.appendChild(acts);
    return box;
  }
  function mixTable(sc) {
    var rows = {};
    sc.directions.forEach(function (d) { (d.rows || []).forEach(function (r) { (rows[r.decision] = rows[r.decision] || {})[d.id] = r; }); });
    var t = C.el('div', 'mix');
    Object.keys(rows).forEach(function (dec) {
      var line = C.el('div', 'mixrow');
      line.appendChild(C.el('span', 'mixname', dec.replace('style.', '')));
      sc.directions.forEach(function (d) {
        var r = rows[dec][d.id]; if (!r) return;
        var b = C.btn(d.id.toUpperCase() + ' · ' + r.label, r.same ? 'small' : 'ghost small', function () {
          var m = {}; m[dec] = d.id;
          act(sc, { mix: m }, { key: 'mix', text: 'The person took the ' + dec + ' of direction ' + d.id.toUpperCase() + ' (' + r.label + ') on the style board.' }, 'Mixed in ' + dec + ' from ' + d.id.toUpperCase() + '.');
        });
        b.title = r.same ? 'the game has this now' : 'take this one';
        line.appendChild(b);
      });
      t.appendChild(line);
    });
    return t;
  }
  function decisions(sc) {
    var style = (sc.phases || []).filter(function (p) { return p.id === 'style'; })[0];
    if (!style) return null;
    var list = C.el('ul', 'list decisions');
    style.rows.forEach(function (r) {
      var li = C.el('li', r.state);
      var body = C.add(C.el('div', 'cb'), C.add(C.el('b'), document.createTextNode(r.name + ' ')), C.el('span', '', r.label + (r.steer ? ' (“' + r.steer + '”)' : '')));
      if (r.colours) body.appendChild(chips(r.colours));
      li.appendChild(body);
      var side = C.el('div', 'actions');
      side.appendChild(C.pill(STATE[r.state] || r.state, STATE_CLS[r.state] || ''));
      if (r.state !== 'locked') {
        side.appendChild(C.btn('Steer', 'ghost small', function () { ui.steer = r.id; C.render(); }));
        side.appendChild(C.btn('Lock', 'ghost small', function () {
          act(sc, { decision: r.id, lock: true, words: 'tapped Lock on the style board' }, { key: 'lock', text: 'The person locked ' + r.id + ' (' + r.label + ') on the style board.' }, 'Locked ' + r.name + '.');
        }));
      }
      li.appendChild(side);
      if (ui.steer === r.id) {
        var form = C.el('div', 'steer');
        var input = C.el('input'); input.type = 'text'; input.placeholder = r.id === 'style.palette' ? 'warmer, less saturated, #ff8a3d accent…' : r.id === 'style.camera' ? 'closer, higher, top-down…' : r.id === 'style.light' ? 'golden hour, harder shadows…' : 'in your words';
        input.maxLength = 100;
        var go = function () { var w = input.value.trim(); if (!w) return; ui.steer = null; act(sc, { decision: r.id, steer: w }, { key: 'steer', text: 'The person steered ' + r.id + ': "' + w + '".' }, 'Steered ' + r.name + ': ' + w + '.'); };
        input.onkeydown = function (e) { if (e.key === 'Enter') go(); if (e.key === 'Escape') { ui.steer = null; C.render(); } };
        form.appendChild(input); form.appendChild(C.btn('Steer', 'small', go));
        li.appendChild(form);
        setTimeout(function () { input.focus(); }, 0);
      }
      list.appendChild(li);
    });
    return list;
  }
  function render(sc) {
    var card = C.el('main', 'card');
    var locked = 0; var total = 0;
    (sc.phases || []).forEach(function (p) { if (p.id !== 'style') return; p.rows.forEach(function (r) { total++; if (r.state === 'locked') locked++; }); });
    C.add(card, C.top('Style board', C.add(C.el('div', 'actions'), C.pill(locked === total && total ? 'Style locked' : locked + ' of ' + total + ' locked', locked === total && total ? 'ok' : ''), C.fullscreenButton())),
      C.el('h1', '', sc.title), C.el('p', 'sub', sc.line || 'No decisions yet.'));
    if (ui.msg) card.appendChild(C.el('p', 'note', ui.msg));
    if (!sc.directions || !sc.directions.length) {
      card.appendChild(C.el('p', 'note', 'No board yet: three directions, drawn by the game engine, free.'));
      card.appendChild(C.add(C.el('div', 'actions'), C.btn('Draw the board', '', function () { ui.msg = 'Drawing (about 20 s)…'; C.render(); C.call('style_explore', { game: sc.game }).then(function (r) { ui.msg = null; C.take(r); }); })));
    } else {
      var grid = C.el('div', 'dirs');
      sc.directions.forEach(function (d) { grid.appendChild(direction(sc, d)); });
      card.appendChild(grid);
      card.appendChild(C.el('p', 'fine', 'Each swatch is what the game will look like: drawn by its own engine, with the free starter library\'s pieces re-tinted into the palette.'));
      var bar = C.el('div', 'actions');
      bar.appendChild(C.btn(ui.mix ? 'Done mixing' : 'Mix', 'ghost small', function () { ui.mix = !ui.mix; C.render(); }));
      bar.appendChild(C.btn('Lock the style', 'small', function () {
        act(sc, { decision: 'style.render', lock: 'style', words: 'tapped Lock the style on the style board' }, { key: 'lockall', text: 'The person locked the whole style (every style decision) on the style board.' }, 'The style is locked.');
      }));
      if (!sc.directions.some(function (d) { return d.mood; })) {
        bar.appendChild(C.btn(sc.quote && sc.quote.usd ? 'Paint mood images (US$' + sc.quote.usd + ')' : 'Price mood images', 'ghost small', function () {
          if (sc.quote && sc.quote.usd) {
            C.tell('mood:' + Date.now(), 'The person asked for the three painted mood images at about US$' + sc.quote.usd + ' on their own fal account (a target, labelled so). Make them with style_explore paid and approve.');
            ui.msg = 'Asked your AI to paint them (about US$' + sc.quote.usd + ', your fal account).'; C.render();
          } else { ui.msg = 'Pricing…'; C.render(); C.call('style_explore', { game: sc.game, paid: true }).then(function (r) { ui.msg = null; C.take(r); }); }
        }));
      }
      card.appendChild(bar);
      if (ui.mix) card.appendChild(mixTable(sc));
    }
    var dl = decisions(sc);
    if (dl) { card.appendChild(C.el('h2', '', 'Style decisions')); card.appendChild(dl); }
    var foot = C.el('div', 'foot');
    foot.appendChild(C.el('span', 'when', (sc.stale && sc.stale.length ? sc.stale.length + ' stale asset' + (sc.stale.length === 1 ? '' : 's') + ' · ' : '') + 'Spent US$' + (sc.spend ? sc.spend.used.toFixed(2) : '0.00') + (sc.spend && sc.spend.cap !== null ? ' of US$' + sc.spend.cap : '')));
    card.appendChild(foot);
    return card;
  }
  C.start({ kind: 'style', label: 'Style board', fullscreen: true, render: render, poll: null });
})();
