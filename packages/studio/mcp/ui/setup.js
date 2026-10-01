/* The setup card: the new-studio checklist, this computer's setup status (what each row unlocks and its fix), the
 * studio in use, and its toolkit install as it runs. */
(function () {
  var C = Card;
  var MARK = { ok: '✓', act: '→', missing: '!', optional: '○', later: '…', unknown: '?' };
  function step(s) {
    var li = C.el('li', s.state);
    C.add(li, C.el('span', 'cn', s.state === 'done' ? '✓' : String(s.n)), C.add(C.el('div', 'cb'), C.el('b', '', s.label), s.state === 'now' ? C.el('span', '', 'Now') : null));
    return li;
  }
  function row(r) {
    var li = C.el('li', 'state-' + r.state);
    var body = C.add(C.el('div', 'cb'), C.el('b', '', r.label + (r.need === 'optional' ? ' (optional)' : '')), C.el('span', '', r.detail), C.el('span', '', 'Unlocks ' + r.unlocks));
    if (r.fix && r.state !== 'ok') body.appendChild(C.el('span', 'fix', r.fix.say));
    C.add(li, C.el('span', 'cn', MARK[r.state] || '?'), body, r.fix && r.fix.open && r.state !== 'ok' ? C.btn('Open', 'ghost small', function () { C.open(r.fix.open); }) : null);
    return li;
  }
  function render(sc) {
    var card = C.el('main', 'card');
    var cur = sc.current;
    var install = sc.install;
    var head = install && install.state === 'running' ? C.pill('Installing · ' + install.seconds + ' s', 'live', true)
      : cur ? C.pill(cur.games.length ? cur.games.length + (cur.games.length === 1 ? ' game' : ' games') : 'No game yet', cur.games.length ? 'ok' : '') : C.pill('New studio', '');
    C.add(card, C.top('Studio setup', head), C.el('h1', '', cur ? cur.name : 'Set up a studio'),
      C.el('p', 'sub', cur ? (cur.games.length ? 'On this computer, in ' + cur.folder : 'On this computer, in ' + cur.folder + '. Its home page says "First game coming soon".') : 'Studios live in ' + (sc.studiosDir || 'the folder set in the Homie extension') + '.'));
    var ol = C.el('ol', 'list');
    (sc.checklist || []).forEach(function (s) { ol.appendChild(step(s)); });
    card.appendChild(ol);
    if (install) {
      var msg = install.state === 'running' ? 'Installing the studio\'s toolkit and Wrangler (' + install.seconds + ' s)…' : install.state === 'done' ? 'The studio\'s toolkit is installed.' : 'The install failed: ' + (install.tail || []).slice(-2).join(' ');
      card.appendChild(C.el('p', 'note' + (install.state === 'failed' ? ' bad' : ''), msg));
    }
    var rows = (sc.status && sc.status.rows) || [];
    if (rows.length) {
      // What needs the person comes in full; what is ready is one line.
      var todo = rows.filter(function (r) { return r.state !== 'ok'; });
      var ready = rows.filter(function (r) { return r.state === 'ok'; });
      card.appendChild(C.el('h2', '', 'This computer and your accounts'));
      if (ready.length) card.appendChild(C.add(C.el('p', 'ready'), C.el('span', 'ok', '✓ Ready: '), C.el('span', '', ready.map(function (r) { return r.label; }).join(' · '))));
      if (todo.length) {
        var ul = C.el('ul', 'list');
        todo.forEach(function (r) { ul.appendChild(row(r)); });
        card.appendChild(ul);
      }
    }
    if ((sc.studios || []).length > 1) card.appendChild(C.el('p', 'fine', 'Studios here: ' + sc.studios.map(function (s) { return s.name; }).join(', ')));
    var foot = C.el('div', 'foot');
    foot.appendChild(C.el('span', 'when', 'Optional rows never block anything.'));
    var acts = C.el('div', 'actions');
    if (cur && !cur.games.length) {
      acts.appendChild(C.btn(C.state.demoing ? 'Opening…' : 'Play a live game', '', function () {
        if (C.state.demoing) return; C.state.demoing = true; C.render();
        C.call('game_demo', {}).then(function (r) {
          C.state.demoing = false; C.render();
          var d = r && r.structuredContent; var p = d && d.pick;
          if (p && p.play) { C.open(p.play); C.tell('demo', 'The person opened the live demo game ' + p.name + ' (' + p.play + ') from the setup card: step 2, see a working game. Nothing was copied into the studio.'); }
        }).catch(function () { C.state.demoing = false; C.render(); });
      }));
    }
    acts.appendChild(C.btn('Check again', 'ghost small', function () {
      C.call('setup_status', { fresh: true }).then(function (r) { C.take(r); }).catch(function () {});
    }));
    foot.appendChild(acts);
    card.appendChild(foot);
    if (install && install.state === 'done') C.tell('install-' + install.job, (cur ? cur.name : 'The studio') + '\'s toolkit finished installing; the studio is ready to build.');
    return card;
  }
  C.start({
    kind: 'setup', label: 'Studio setup', render: render,
    poll: function (sc) { return sc.install && sc.install.state === 'running' ? { tool: 'setup_status', args: {}, every: 3000 } : null; },
  });
})();
