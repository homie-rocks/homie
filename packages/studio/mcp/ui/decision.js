/* The look-decision card: what one decision_set did. For a LOCKED decision about to change, the blast radius first:
 * every asset made under it that would go stale, what remaking each would cost, and what a free palette re-tint fixes.
 * Nothing changes until the person presses "Change it"; nothing is ever remade by itself. */
(function () {
  var C = Card;
  var STATE = { auto: 'Auto', steered: 'Steered', pinned: 'Pinned by use', locked: 'Locked' };
  var done = null;
  function chips(colours) {
    var row = C.el('span', 'chips');
    (colours || []).forEach(function (c) { var s = C.el('span', 'swatch'); s.style.background = c; s.title = c; row.appendChild(s); });
    return row;
  }
  function blast(card, b) {
    var list = C.el('ul', 'list');
    (b.assets || []).forEach(function (a) {
      var li = C.el('li', a.free ? 'done' : '');
      li.appendChild(C.add(C.el('div', 'cb'), C.el('b', '', a.id + (a.card ? ' · ' + a.card : '')), C.el('span', '', a.route + ', made under its ' + a.why)));
      li.appendChild(a.free ? C.pill('Free: ' + a.free.replace(/ \(.*\)$/, ''), 'ok') : a.remake.usd ? C.pill('US$' + a.remake.usd.toFixed(2) + ' to remake', 'warn') : C.pill(a.remake.how, ''));
      list.appendChild(li);
    });
    card.appendChild(list);
    card.appendChild(C.el('p', 'fine', (b.assets || []).length + ' asset' + ((b.assets || []).length === 1 ? '' : 's') + ' would go stale. Remaking those with no free fix: about US$' + (b.totals ? b.totals.usd.toFixed(2) : '0.00') + '. ' + (b.note || '')));
  }
  function render(sc) {
    var card = C.el('main', 'card');
    var r = sc.record;
    var head = sc.pending ? C.pill('Not changed yet', 'warn') : sc.ok ? C.pill(r ? (STATE[r.state] || r.state) : 'Done', r && r.state === 'locked' ? 'ok' : '') : C.pill('Not done', 'bad');
    C.add(card, C.top('Look decision', head), C.el('h1', '', sc.pending ? 'Change the locked ' + (sc.decision || '').replace('style.', '') + '?' : r ? r.id + ': ' + r.label : (sc.action === 'pick' ? 'Picked from the style board' : 'Done')));
    if (r && r.colours) card.appendChild(chips(r.colours));
    if (sc.why) card.appendChild(C.el('p', sc.ok ? 'sub' : 'note bad', sc.why));
    if (sc.pending && sc.blast) {
      card.appendChild(C.el('p', 'sub', 'From ' + (sc.blast.from || '?') + (sc.blast.to ? ' to ' + sc.blast.to : '') + '. This is what it would make stale:'));
      blast(card, sc.blast);
      if (done) card.appendChild(C.el('p', 'note ' + (done === 'changed' ? 'ok' : ''), done === 'changed' ? 'Changed. The stale assets are listed; nothing was remade.' : 'Kept as it was.'));
      else {
        var acts = C.el('div', 'actions');
        acts.appendChild(C.btn('Change it', 'danger', function () {
          var a = sc.ask || {};
          C.call('decision_set', { game: sc.game, decision: a.decision, value: a.value, unlock: true, reason: a.reason || 'the person confirmed on the card', confirm: true, by: 'person' }).then(function (res) {
            done = 'changed';
            C.tell('changed:' + Date.now(), 'The person confirmed changing the locked ' + a.decision + ' on the card. ' + ((sc.blast.assets || []).length) + ' asset(s) are now stale; nothing was remade. Ask before remaking any.');
            C.take(res);
          });
        }));
        acts.appendChild(C.btn('Keep it', 'ghost', function () { done = 'kept'; C.tell('kept:' + Date.now(), 'The person kept the locked ' + (sc.ask && sc.ask.decision) + ' as it is.'); C.render(); }));
        card.appendChild(acts);
      }
    } else if (sc.blast) {
      card.appendChild(C.el('p', 'sub', 'Made under the old one (stale now, nothing remade):'));
      blast(card, sc.blast);
    }
    if (sc.changed && sc.changed.length && sc.action !== 'set') card.appendChild(C.el('p', 'fine', 'Changed: ' + sc.changed.join(', ')));
    if (sc.refused && sc.refused.length) card.appendChild(C.el('p', 'fine', 'Left as locked: ' + sc.refused.join(', ')));
    if (!sc.pending && sc.stale && sc.stale.length) card.appendChild(C.el('p', 'note', 'Stale: ' + sc.stale.join(', ') + '. Remaking any is the person\'s call, priced first.'));
    var foot = C.el('div', 'foot');
    foot.appendChild(C.el('span', 'when', 'Spent US$' + (sc.spend ? sc.spend.used.toFixed(2) : '0.00') + (sc.spend && sc.spend.cap !== null ? ' of US$' + sc.spend.cap : '')));
    card.appendChild(foot);
    return card;
  }
  C.start({ kind: 'decision', label: 'Look decision', render: render, poll: null });
})();
