/* The Tell Homie card: a note to the people who make Homie, exactly as it would go, with Send, Edit and Don't send.
 * Nothing leaves this computer until the person presses Send here (or says yes in the chat). Edit drafts the note
 * again from the person's own words, through the same redaction, so what the card shows is always what would go.
 * The model is told what the person chose, once. Every text is set as text, never as HTML. */
(function () {
  var C = Card;
  var KINDS = [['stuck', 'Stuck'], ['confusing', 'Confusing'], ['idea', 'Idea'], ['praise', 'Praise'], ['bug', 'Bug']];
  var LABEL = { stuck: 'Stuck', confusing: 'Confusing', idea: 'Idea', praise: 'Praise', bug: 'Bug' };
  var ui = { editing: false, busy: false, why: null, kind: null, text: null, email: null };

  function fieldsOf(sc) {
    var n = sc.note || {};
    return { kind: n.kind, text: n.text, step: n.step || undefined, email: n.email || undefined, offered: n.offered === true,
      studioVersion: n.studioVersion || undefined, pluginVersion: n.pluginVersion || undefined, app: n.app || undefined };
  }

  function act(sc, args, after) {
    if (ui.busy) return;
    ui.busy = true; ui.why = null; C.render();
    C.call('homie_feedback', args).then(function (res) {
      ui.busy = false;
      // Refused (not sent, a reworded note that cannot go, the app said no): the note stays on screen with why.
      var d = res && res.structuredContent;
      if (!d || d.kind !== 'feedback' || res.isError) { ui.why = C.textOf(res) || 'That did not work. Nothing was sent.'; C.render(); return; }
      if (after) after(res);
      C.take(res);
    }).catch(function () { ui.busy = false; ui.why = 'The app did not answer. Nothing was sent.'; C.render(); });
  }

  function quote(text) {
    var q = C.el('blockquote', 'quote');
    String(text || '').split('\n').forEach(function (line, i) { if (i) q.appendChild(C.el('br')); q.appendChild(document.createTextNode(line)); });
    return q;
  }

  function editor(card, sc) {
    var n = sc.note || {};
    if (ui.kind === null) { ui.kind = n.kind || 'idea'; ui.text = n.text || ''; ui.email = n.email || ''; }
    var kinds = C.el('div', 'kinds'); kinds.setAttribute('role', 'radiogroup'); kinds.setAttribute('aria-label', 'What kind of note');
    KINDS.forEach(function (k) {
      var b = C.btn(k[1], 'small ' + (ui.kind === k[0] ? '' : 'ghost'), function () { ui.kind = k[0]; C.render(); });
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', ui.kind === k[0] ? 'true' : 'false');
      kinds.appendChild(b);
    });
    card.appendChild(kinds);
    var area = C.el('textarea'); area.value = ui.text; area.rows = 5; area.maxLength = 1500; area.setAttribute('aria-label', 'Your note, in your words');
    area.oninput = function () { ui.text = area.value; };
    card.appendChild(area);
    var mail = C.el('input'); mail.type = 'email'; mail.placeholder = 'Your email, if you want a reply (optional)'; mail.value = ui.email; mail.setAttribute('aria-label', 'Reply address (optional)');
    mail.oninput = function () { ui.email = mail.value; };
    card.appendChild(mail);
    var acts = C.el('div', 'actions');
    acts.appendChild(C.btn(ui.busy ? 'Saving…' : 'Use this', '', function () {
      var f = fieldsOf(sc);
      act(sc, { action: 'draft', kind: ui.kind, text: ui.text, step: f.step, email: (ui.email || '').trim() || undefined, offered: f.offered, studioVersion: f.studioVersion, pluginVersion: f.pluginVersion, app: f.app, by: 'card' }, function (res) {
        ui.editing = false; ui.kind = null;
        var d = res && res.structuredContent;
        if (d && d.state === 'draft') C.tell('edit:' + d.draft, 'The person reworded the note on the Tell Homie card. Nothing is sent yet; the card shows the new text (draft ' + d.draft + ') with Send. Do not send it yourself unless they say yes.');
      });
    }));
    acts.appendChild(C.btn('Cancel', 'ghost', function () { ui.editing = false; ui.kind = null; C.render(); }));
    card.appendChild(acts);
  }

  function render(sc) {
    var card = C.el('main', 'card');
    var state = sc.state;
    var head = state === 'sent' ? C.pill('Sent', 'ok') : state === 'declined' ? C.pill('Not sent', '') : state === 'draft' ? C.pill('Not sent yet', 'warn') : C.pill('Not sent', 'bad');
    C.add(card, C.top('Note', head));
    card.appendChild(C.el('h1', '', state === 'sent' ? 'Sent to Homie. Thank you.' : state === 'declined' ? 'Not sent' : 'A note to the people who make Homie'));
    var n = sc.note;
    if (state === 'draft' && ui.editing) { editor(card, sc); }
    else if (n) {
      card.appendChild(C.el('p', 'sub', state === 'sent' ? 'This is what they got:' : state === 'declined' ? 'Nothing left this computer. This was the note:' : 'This is exactly what would go:'));
      card.appendChild(C.add(C.el('div', 'chips'), C.pill(LABEL[n.kind] || n.kind, 'live')));
      card.appendChild(quote(n.text));
      if (sc.with) card.appendChild(C.el('p', 'fine', 'With it: ' + sc.with));
      if (sc.taken && sc.taken.length) card.appendChild(C.el('p', 'fine', 'Homie took out ' + sc.taken.join(', ') + ' before showing it here.'));
    }
    if (ui.why) card.appendChild(C.el('p', 'note bad', ui.why));
    if (state === 'draft' && !ui.editing) {
      var acts = C.el('div', 'actions send');
      var send = C.btn(ui.busy ? 'Sending…' : 'Send', '', function () {
        act(sc, Object.assign({ action: 'send', draft: sc.draft, by: 'card' }, fieldsOf(sc)), function (res) {
          var d = res && res.structuredContent;
          if (d && d.state === 'sent') C.tell('sent:' + sc.draft, 'The person pressed Send on the Tell Homie card: the note went to Homie (reference ' + String(d.reference || '').slice(0, 8) + '). Thank them in one line, and do not offer another note in this session.');
        });
      });
      send.disabled = ui.busy;
      acts.appendChild(send);
      var edit = C.btn('Edit', 'ghost', function () { ui.editing = true; ui.kind = null; C.render(); }); edit.disabled = ui.busy;
      acts.appendChild(edit);
      var no = C.btn('Don’t send', 'ghost', function () {
        act(sc, { action: 'decline', draft: sc.draft, by: 'card' }, function () {
          C.tell('declined:' + sc.draft, 'The person pressed Don’t send on the Tell Homie card. Nothing was sent. Do not offer to send a note again in this session.');
        });
      });
      no.disabled = ui.busy;
      acts.appendChild(no);
      card.appendChild(acts);
    }
    if (state === 'sent' && sc.reference) card.appendChild(C.el('p', 'fine', 'Reference ' + String(sc.reference).slice(0, 8) + '. Notes are private: only the people who make Homie read them.'));
    var foot = C.el('div', 'foot');
    foot.appendChild(C.el('span', 'when', state === 'sent' ? 'Sent to ' + (sc.to || 'homie.rocks') : state === 'declined' ? 'Nothing was sent.' : 'Nothing is sent until you press Send. Goes to ' + (sc.to || 'homie.rocks') + ', privately.'));
    card.appendChild(foot);
    return card;
  }

  C.start({ kind: 'feedback', label: 'Note', render: render, poll: null });
})();
