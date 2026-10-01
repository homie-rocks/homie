/* The build card: one build's stages, each check going green, a picture and where to play it, money against the
 * budget, and Stop. It follows the build every 2 s while it runs and tells the model once when it ends. */
(function () {
  var C = Card;
  var ICON = { pass: '✓', done: '✓', fail: '✕', failed: '✕', running: '●', pending: '·', skip: '–', skipped: '–', stopped: '■' };
  var STATE = { running: ['Running', 'live', true], passed: ['Done', 'ok'], failed: ['Failed', 'bad'], stopped: ['Stopped', ''] };
  function money(n, unit) { return unit === 'credits' ? Math.round(n).toLocaleString('en-US') + ' credits' : '$' + Number(n || 0).toFixed(2); }
  function render(sc) {
    var f = sc.feed; var card = C.el('main', 'card');
    var st = STATE[f.state] || ['…', ''];
    C.add(card, C.top('Build', C.add(C.el('div', 'actions'), C.pill(st[0], st[1], st[2]), C.fullscreenButton())), C.el('h1', '', f.title || 'A build'),
      C.el('p', 'sub', [f.studio, f.what === 'game' ? null : f.what, f.state === 'running' ? 'started ' + C.ago(f.startedAt) : f.endedAt ? 'took ' + C.dur(Date.parse(f.endedAt) - Date.parse(f.startedAt)) : null].filter(Boolean).join(' · ')));
    var stages = C.el('div', 'stages');
    (f.stages || []).forEach(function (s) { stages.appendChild(C.add(C.el('div', 'stage ' + s.state), C.el('div', 'bar'), C.el('span', '', (ICON[s.state] && s.state !== 'pending' ? ICON[s.state] + ' ' : '') + s.label))); });
    card.appendChild(stages);
    var cur = (f.stages || []).filter(function (s) { return s.note && s.state !== 'pending'; }).pop();
    if (cur) card.appendChild(C.el('p', 'fine', cur.label + ': ' + cur.note));
    if ((f.checks || []).length) {
      var list = C.el('div');
      f.checks.forEach(function (c) { list.appendChild(C.add(C.el('div', 'check ' + c.state), C.el('span', 'i', ICON[c.state] || '·'), C.el('span', '', c.label + (c.note ? ' — ' + c.note : '')), c.ms ? C.el('span', 'n', C.dur(c.ms)) : null)); });
      card.appendChild(list);
    }
    var p = f.preview;
    if (p && (p.image || p.url)) {
      var box = C.el('div', 'preview');
      var pic = C.img(p.image, p.caption || 'The game');
      if (pic) box.appendChild(pic);
      if (p.caption) box.appendChild(C.el('span', 'fine', p.caption));
      card.appendChild(box);
    }
    if (f.spend && (f.spend.used > 0 || f.spend.budget !== null)) card.appendChild(C.el('p', 'fine', 'Spent ' + money(f.spend.used, f.spend.unit) + (f.spend.budget !== null ? ' of ' + money(f.spend.budget, f.spend.unit) : '')));
    if (f.error) card.appendChild(C.el('p', 'note bad', f.error));
    var failed = (sc.jobs || []).filter(function (j) { return j.state === 'failed'; });
    if (failed.length && !f.error) card.appendChild(C.el('pre', 'log', failed.map(function (j) { return j.label + ': ' + ((j.result && j.result.why) || (j.tail || []).slice(-3).join('\n')); }).join('\n')));
    else if ((f.log || []).length && f.state === 'running') card.appendChild(C.el('pre', 'log', f.log.slice(-3).map(function (l) { return l.text; }).join('\n')));
    var foot = C.el('div', 'foot');
    foot.appendChild(C.el('span', 'when', f.state === 'running' ? 'Updated ' + C.ago(f.updatedAt) : 'Ended ' + C.ago(f.endedAt)));
    var acts = C.el('div', 'actions');
    if (f.state === 'running' && !(f.stop && f.stop.requested)) {
      acts.appendChild(C.btn(C.state.stopping ? 'Stopping…' : 'Stop', 'danger small', function () {
        if (C.state.stopping) return; C.state.stopping = true; C.render();
        C.call('build_stop', { build: sc.build }).then(function (r) { C.state.stopping = false; C.take(r); }).catch(function () { C.state.stopping = false; C.render(); });
      }));
    } else if (f.stop && f.stop.requested && f.state === 'running') acts.appendChild(C.pill('Stopping at the next safe point', 'warn'));
    if (p && p.url && /^https?:/.test(p.url)) acts.appendChild(C.btn('Play it', f.state === 'passed' ? '' : 'ghost small', function () { C.open(p.url); }));
    foot.appendChild(acts);
    card.appendChild(foot);
    var r = sc.run;
    if (r && r.state !== 'running' && f.state === 'running') {
      card.insertBefore(C.el('p', 'note' + (r.state === 'failed' ? ' bad' : ' ok'), (r.state === 'passed' ? '✓ ' : '') + r.title + ': ' + (r.state === 'passed' ? 'passed' : 'failed' + (r.why ? ' — ' + r.why : ''))), foot);
      C.tell('run-' + sc.build + '-' + r.kind, r.title + ' ' + r.state + (r.why ? ': ' + r.why : '') + ' (build ' + sc.build + ' stays open).');
    }
    if (f.state !== 'running') {
      var passed = (f.checks || []).filter(function (c) { return c.state === 'pass'; }).length;
      C.tell('end-' + sc.build, 'Build ' + sc.build + ' (' + f.title + ') ended: ' + f.state + (f.checks && f.checks.length ? ', ' + passed + ' of ' + f.checks.length + ' checks passed' : '') + (f.error ? '. Error: ' + f.error : '') + (p && p.url ? '. Play: ' + p.url : '') + '. Tell the person in a line or two.');
    }
    return card;
  }
  C.start({
    kind: 'build', label: 'Build', fullscreen: true, render: render,
    poll: function (sc) { return sc.feed && sc.feed.state === 'running' ? { tool: 'build_progress', args: { build: sc.build }, every: 2000 } : null; },
  });
})();
