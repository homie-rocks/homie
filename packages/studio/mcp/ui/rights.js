/* The rights card: every asset's licence in plain words (asset_rights): where it came from, its licence, the credit it
 * owes; what would stop a public game from publishing, with its fix; and RIGHTS.md itself. */
(function () {
  var C = Card;
  var LICENCE = { cc0: 'CC0 (public domain)', 'cc-by-4.0': 'CC BY 4.0', 'cc-by-3.0': 'CC BY 3.0', own: 'Your own work', generated: 'Generated on your account', qal: 'Quaternius licence', mixamo: 'Mixamo', other: 'Other' };
  function render(sc) {
    var card = C.el('main', 'card');
    var refuse = (sc.problems || []).filter(function (p) { return p.level === 'refuse'; });
    C.add(card, C.top('Rights', C.pill(refuse.length ? refuse.length + ' to fix' : 'Publishable', refuse.length ? 'bad' : 'ok')), C.el('h1', '', 'Who owns what in ' + sc.game));
    var list = C.el('ul', 'list');
    (sc.rows || []).forEach(function (r) {
      var li = C.el('li', r.license ? 'done' : 'now');
      li.appendChild(C.add(C.el('div', 'cb'), C.el('b', '', r.id + ' · ' + r.kind), C.el('span', '', (LICENCE[r.license] || r.license || 'NO LICENCE RECORDED') + ' · ' + r.route + (r.from ? ' (' + r.from + ')' : '') + (r.placeholder ? ' · a placeholder' : '')), r.attribution ? C.el('span', 'fix', 'Credit: ' + r.attribution) : null));
      list.appendChild(li);
    });
    card.appendChild(list);
    (sc.problems || []).forEach(function (p) { card.appendChild(C.el('p', 'note' + (p.level === 'refuse' ? ' bad' : ''), p.asset + ': ' + p.problem + (p.fix ? ' (' + p.fix + ')' : ''))); });
    if (sc.text) {
      var d = C.el('details'); d.appendChild(C.el('summary', '', sc.file || 'RIGHTS.md'));
      d.appendChild(C.el('pre', 'log', sc.text));
      d.ontoggle = function () { C.size(); };
      card.appendChild(d);
    }
    card.appendChild(C.el('p', 'fine', 'Terms change: read the providers\' live pages again before publishing anything commercial.'));
    return card;
  }
  C.start({ kind: 'rights', label: 'Rights', render: render, poll: null });
})();
