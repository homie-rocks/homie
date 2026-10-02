/* The Game Lab card: one take of a game's mechanic, New (the working tree) beside Today (the last commit). A still of
 * both at the take's busiest moment, the phases of each as a timing strip, whether replays match, the game's
 * JavaScript per frame, and Open (the lab runs on this computer). */
(function () {
  var C = Card;
  var COLOURS = ['#a374ff', '#17c3b2', '#f5a524', '#ff6fb5', '#8bd346', '#4dd2ff', '#ffd84a', '#e58cff'];
  function strip(rows, frames) {
    // rows: { label, phases: [{ name, from, to }] }: blocks at their frames on the take's own axis; colours by name, shared.
    var names = [];
    rows.forEach(function (r) { (r.phases || []).forEach(function (p) { if (names.indexOf(p.name) < 0) names.push(p.name); }); });
    var box = C.el('div');
    box.style.cssText = 'display:grid;gap:6px;margin:12px 0 4px';
    rows.forEach(function (r) {
      var line = C.el('div');
      line.style.cssText = 'display:grid;grid-template-columns:52px 1fr;gap:8px;align-items:center';
      var label = C.el('span', '', r.label);
      label.style.cssText = 'font:700 11px/1 var(--f-mono);letter-spacing:.08em;color:' + r.colour;
      var bar = C.el('div');
      bar.style.cssText = 'position:relative;height:20px;border-radius:4px;overflow:hidden;background:var(--c-bg2)';
      (r.phases || []).forEach(function (p) {
        var b = C.el('span', '', p.name);
        var colour = COLOURS[names.indexOf(p.name) % COLOURS.length];
        b.title = p.name + ': frames ' + p.from + ' to ' + p.to;
        b.style.cssText = 'position:absolute;top:0;bottom:0;left:' + ((p.from - 1) / frames) * 100 + '%;width:calc(' + ((p.to - p.from + 1) / frames) * 100 + '% - 1px);background:' + colour + ';color:#0b0d14;font:700 10px/20px var(--f-mono);padding:0 4px;white-space:nowrap;overflow:hidden;text-overflow:clip';
        bar.appendChild(b);
      });
      if (!(r.phases || []).length) { var e = C.el('span', 'fine', r.empty || 'no phases'); e.style.cssText = 'margin:0;line-height:20px;padding:0 8px'; bar.appendChild(e); }
      line.appendChild(label); line.appendChild(bar);
      box.appendChild(line);
    });
    return box;
  }
  function render(sc) {
    var card = C.el('main', 'card');
    var det = sc.deterministic || {};
    var same = det.new === null && (det.today === null || det.today === undefined);
    var head = sc.running ? C.pill('Checking', 'live', true) : same ? C.pill('Replays match', 'ok') : C.pill('Replays differ', 'bad');
    C.add(card, C.top('Game Lab', C.add(C.el('div', 'actions'), head, C.fullscreenButton())), C.el('h1', '', (sc.name || sc.game) + (sc.take ? ' · ' + sc.take : '')),
      C.el('p', 'sub', sc.running ? 'The lab is open on this computer; its first check is still running.' : 'New (the working tree) beside Today' + (sc.today ? ' (' + sc.today + ')' : '') + ' · ' + sc.frames + ' frames at ' + sc.fps + ' fps'));
    if (sc.still) {
      var box = C.el('div', 'preview');
      var pic = C.img(sc.still, 'New beside Today at the take\'s busiest moment');
      if (pic) { pic.style.maxHeight = 'none'; pic.style.objectFit = 'contain'; box.appendChild(pic); }
      card.appendChild(box);
    }
    if (sc.timeline && sc.frames) {
      card.appendChild(strip([
        { label: 'NEW', colour: '#e08a12', phases: sc.timeline.new },
        { label: 'TODAY', colour: '#2f8fd8', phases: sc.timeline.today || [], empty: sc.todayNote || 'no phases' },
      ], sc.frames));
      card.appendChild(C.el('p', 'fine', 'Phases on the take\'s ' + sc.frames + ' frames (' + (sc.frames / sc.fps).toFixed(2) + ' s).'));
    }
    if (sc.cost && sc.cost.new) {
      card.appendChild(C.el('p', 'fine', 'The game\'s JavaScript a frame, on average: New ' + sc.cost.new.mean + ' ms (p95 ' + sc.cost.new.p95 + ')' + (sc.cost.today ? ', Today ' + sc.cost.today.mean + ' ms (p95 ' + sc.cost.today.p95 + ')' : '') + '.'));
    }
    if (!same && !sc.running) card.appendChild(C.el('p', 'note bad', 'The same build played the take differently' + (det.new !== null ? ' (New from frame ' + det.new + ')' : '') + (det.today ? ' (Today from frame ' + det.today + ')' : '') + ': something in the game reads a clock or dice the lab does not drive.'));
    (sc.errors || []).slice(0, 3).forEach(function (e) { card.appendChild(C.el('p', 'note bad', e)); });
    var foot = C.el('div', 'foot');
    foot.appendChild(C.el('span', 'when', 'Runs on this computer'));
    var acts = C.el('div', 'actions');
    if (sc.url) acts.appendChild(C.btn('Open the lab', '', function () { C.open(sc.url); C.tell('lab-open', 'The person opened the Game Lab for ' + (sc.name || sc.game) + ' from the card.'); }));
    foot.appendChild(acts);
    card.appendChild(foot);
    return card;
  }
  C.start({ kind: 'lab', label: 'Game Lab', fullscreen: true, render: render, poll: null });
})();
