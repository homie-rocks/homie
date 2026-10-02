/* The studio card: its games with Play (on this computer and live), songs, videos and posts, where it runs, its
 * live rooms, a live game to try while it has none, and what's new when its toolkit is older than this Homie. */
(function () {
  var C = Card;
  function initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
  function render(sc) {
    var card = C.el('main', 'card');
    C.add(card, C.top('Studio', C.pill(sc.site ? 'Online' : sc.dev ? 'Running here' : 'On this computer', sc.site ? 'ok' : '')), C.el('h1', '', sc.name), C.el('p', 'sub', sc.tagline || sc.folder));
    var stats = C.el('div', 'stats');
    [[sc.games.length, sc.games.length === 1 ? 'game' : 'games'], [sc.songs.length, sc.songs.length === 1 ? 'song' : 'songs'], [sc.videos.length, sc.videos.length === 1 ? 'video' : 'videos'], [sc.posts, sc.posts === 1 ? 'post' : 'posts'], [(sc.rooms || []).length, 'live rooms']].forEach(function (x) {
      stats.appendChild(C.add(C.el('span'), C.el('b', '', String(x[0])), C.el('span', '', ' ' + x[1])));
    });
    card.appendChild(stats);
    if (sc.games.length) {
      var grid = C.el('div', 'games');
      sc.games.forEach(function (g) {
        var art = C.el('div', 'art'); var pic = C.img(g.cover, g.name);
        if (pic) art.appendChild(pic); else art.textContent = initials(g.name);
        var acts = C.el('div', 'actions');
        if (g.play.dev) acts.appendChild(C.btn('Play here', 'small', function () { C.open(g.play.dev); }));
        if (g.play.live) acts.appendChild(C.btn('Play live', g.play.dev ? 'ghost small' : 'small', function () { C.open(g.play.live); }));
        grid.appendChild(C.add(C.el('div', 'game'), art, C.el('b', '', g.name), g.blurb ? C.el('span', '', g.blurb) : null, sc.site && !g.live ? C.el('span', 'fine', 'Not online yet: deploy puts it there') : null, acts.childNodes.length ? acts : null));
      });
      card.appendChild(grid);
    } else {
      var soon = C.add(C.el('div', 'soon'), C.el('b', '', 'First game coming soon'), C.el('span', '', 'That is what the studio\'s home page says until its first game is made. Plan it first: it is made the way you decide.'));
      if (sc.demo) soon.appendChild(C.add(C.el('div', 'actions'), C.btn('Play ' + sc.demo.name, 'small', function () { C.open(sc.demo.play); C.tell('demo', 'The person opened the live demo ' + sc.demo.name + ' from the studio card.'); }), C.el('span', 'fine', 'A live game on ' + sc.demo.studio + ', made with Homie')));
      card.appendChild(soon);
    }
    if ((sc.rooms || []).length) card.appendChild(C.el('p', 'fine', 'Playing now: ' + sc.rooms.map(function (r) { return r.game + ' (' + r.players + ')'; }).join(', ')));
    // A studio on an older toolkit than this Homie: what's new since (this package's CHANGELOG.md), and the words to ask.
    if (sc.behind) {
      var news = C.add(C.el('div', 'news'), C.el('b', '', 'New in Homie since ' + sc.behind.pinned));
      ((sc.behind.whatsNew && sc.behind.whatsNew.versions) || []).slice(0, 3).forEach(function (v) { news.appendChild(C.add(C.el('span'), C.el('code', '', v.version), C.el('span', '', ' ' + v.summary))); });
      news.appendChild(C.el('span', 'fine', 'This studio is on ' + sc.behind.pinned + ', and ' + sc.behind.here + ' is here. Say \u201cUpgrade my studio\u201d to see what changes; nothing does until you agree.'));
      card.appendChild(news);
      C.tell('behind', sc.name + ' pins @homie-rocks/studio ' + sc.behind.pinned + ' and this Homie is ' + sc.behind.here + ': offer the upgrade (studio_run ["upgrade"] shows what is new and the plan, and changes nothing).');
    }
    var foot = C.el('div', 'foot');
    foot.appendChild(C.el('span', 'when', sc.site ? sc.site.replace(/^https?:\/\//, '') : sc.dev ? sc.dev.url.replace(/^https?:\/\//, '') : 'Not online yet'));
    var acts = C.el('div', 'actions');
    if (sc.dev) acts.appendChild(C.btn('Open here', 'ghost small', function () { C.open(sc.dev.url + '/'); }));
    if (sc.site) acts.appendChild(C.btn('Open site', 'small', function () { C.open(sc.site + '/'); }));
    foot.appendChild(acts);
    card.appendChild(foot);
    return card;
  }
  C.start({ kind: 'studio', label: 'Studio', render: render, poll: null });
})();
