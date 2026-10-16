/** An action is a server-owned, revisioned proposal; the browser never supplies its consequence. */
export function validateItems(items) {
  if (!Array.isArray(items) || items.length > 100) throw new Error('Expected at most 100 actions');
  const ids = new Set();
  for (const item of items) {
    for (const key of ['id', 'revision', 'title', 'consequence', 'confirmLabel']) {
      if (typeof item[key] !== 'string' || !item[key].trim() || item[key].length > 1000) throw new Error(`Invalid action ${key}`);
    }
    if (item.irreversible !== undefined && typeof item.irreversible !== 'boolean') throw new Error('Invalid irreversible flag');
    if (ids.has(item.id)) throw new Error('Duplicate action id');
    ids.add(item.id);
  }
  return items;
}

/** Plug in list() and execute({id,revision,operation,key}); reconcile uncertain writes before retrying. */
export function mountChecklist(root, { list, execute }) {
  let disposed = false, generation = 0;
  const states = new Map(), keys = new Map(), timers = new Set();
  const prefix = `actions-${crypto.randomUUID()}`;
  root.classList.add('owner-checklist');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const rows = document.createElement('ul'); root.replaceChildren(status, rows);
  const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  async function refresh() {
    const current = ++generation;
    status.textContent = 'Loading actions…';
    try {
      const items = validateItems(await list());
      if (disposed || current !== generation) return;
      rows.replaceChildren();
      const pending = new Set(items.map(item => item.id));
      const announce = () => {status.textContent = pending.size ? `${pending.size} actions to review` : 'All caught up.';};
      for (const item of items) {
        const row = el('li', ''); const title = el('h2', item.title);
        const consequence = el('p', item.consequence + (item.irreversible ? ' Irreversible — cannot be undone.' : '')); const note = el('p', 'Pending');
        row.dataset.state = 'pending';
        note.setAttribute('role', 'status');
        const button = el('button', item.confirmLabel); button.type = 'button';
        title.id = `${prefix}-${rows.children.length}-title`;
        consequence.id = `${prefix}-${rows.children.length}-effect`;
        button.setAttribute('aria-describedby', `${title.id} ${consequence.id}`);
        let undoTimer;
        const state = states.get(item.id);
        if (state?.pending) { button.disabled = true; note.textContent = 'Outcome unknown. Refresh to reconcile before acting again.'; }
        async function run(operation, grant) {
          if (grant && Date.now() >= grant.undoExpiresAt) {button.hidden = true; return;}
          if (button.disabled || disposed) return;
          button.disabled = true; row.dataset.state = 'confirming'; button.textContent = operation === 'undo' ? 'Undoing…' : 'Confirming…'; note.textContent = button.textContent;
          const revision = operation === 'undo' ? grant.undoRevision : item.revision;
          const identity = JSON.stringify([item.id, revision, operation]);
          if (!keys.has(identity)) keys.set(identity, crypto.randomUUID());
          const key = keys.get(identity);
          states.set(item.id, {revision: item.revision, key, pending:true});
          try {
            const result = await execute({id: item.id, revision, operation, key, ...(grant ? {token:grant.undoToken} : {})});
            if (disposed) return;
            if (!result || result.ok !== true) throw new Error('Unconfirmed outcome');
            if (operation === 'undo') {clearTimeout(undoTimer); timers.delete(undoTimer);}
            states.delete(item.id);
            row.dataset.state = operation === 'undo' ? 'undone' : 'done';
            pending.delete(item.id);
            note.textContent = `${operation === 'undo' ? 'Undone' : 'Done'} — ${result.message || (operation === 'undo' ? 'Previous state restored.' : item.consequence)}`;
            button.textContent = operation === 'undo' ? 'Undone' : 'Done';
            if (operation === 'undo' && result.pendingItem) {
              const restored = validateItems([result.pendingItem])[0];
              if (restored.id !== item.id || restored.revision === item.revision) throw new Error('Wrong restored action');
              Object.assign(item, restored); pending.add(item.id);
              button.textContent = item.confirmLabel; button.disabled = false; button.hidden = false;
              consequence.textContent = item.consequence + (item.irreversible ? ' Irreversible — cannot be undone.' : '');
              title.textContent = item.title; button.onclick = () => run('confirm');
            }
            if (current === generation) announce();
            if (operation === 'confirm' && typeof result.undoToken === 'string' && typeof result.undoRevision === 'string' && result.undoRevision !== item.revision && Number.isFinite(result.undoExpiresAt) && result.undoExpiresAt > Date.now() && !item.irreversible) {
              button.textContent = 'Undo'; button.disabled = false;
              button.onclick = () => run('undo', result);
              const expire = () => {
                if (Date.now() < result.undoExpiresAt) {schedule(); return;}
                button.hidden = true; button.disabled = true;
              };
              const schedule = () => {const timer = undoTimer = setTimeout(() => {timers.delete(timer); expire();}, Math.min(2147483647, result.undoExpiresAt - Date.now())); timers.add(timer);};
              schedule();
            }
          } catch {
            states.set(item.id, {revision: item.revision, key, pending:false});
            if (!disposed) note.textContent = 'Outcome unknown. Refresh to reconcile before acting again.';
          }
        }
        button.onclick = () => run('confirm'); row.append(title, consequence, button, note); rows.append(row);
      }
      announce();
    } catch { if (!disposed && current === generation) status.textContent = 'Actions could not be loaded. Try refreshing.'; }
  }
  const ready = refresh();
  return {ready, refresh, dispose() { disposed = true; for (const timer of timers) clearTimeout(timer); timers.clear(); root.replaceChildren(); }};
}
