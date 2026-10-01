/* The Game Codex card: the codex page itself (drawn by @homie-rocks/studio lib/codex.mjs in the game's own look:
 * a tab per section, cards, controls, milestones, decisions, open questions, the build's status), in a frame. */
(function () {
  var C = Card;
  function render(sc) {
    var card = C.el('main', 'card');
    var todo = (sc.missing || []).length;
    C.add(card, C.top('Game Codex', C.add(C.el('div', 'actions'), C.pill(todo ? todo + ' to decide' : 'Every section filled', todo ? 'warn' : 'ok'), C.fullscreenButton())), C.el('h1', '', sc.title));
    // The page has its own tabs; the card says only what is still open.
    if (sc.openQuestions) card.appendChild(C.el('p', 'sub', sc.openQuestions + ' open question' + (sc.openQuestions === 1 ? '' : 's') + ' · ' + (sc.sections || []).length + ' sections'));
    if (sc.html) {
      var frame = C.el('iframe', 'frame');
      frame.title = 'The Game Codex for ' + sc.title;
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.srcdoc = sc.html;
      card.appendChild(frame);
    } else card.appendChild(C.el('p', 'note', 'The page is too big to show here.'));
    if (todo) card.appendChild(C.el('p', 'fine', 'Not decided yet: ' + sc.missing.join(', ') + '.'));
    return card;
  }
  C.start({ kind: 'codex', label: 'Game Codex', fullscreen: true, render: render, poll: null });
})();
