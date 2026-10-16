/** An action is a server-owned, revisioned proposal; the browser never supplies its consequence. */
export function validateItems(items) {
  if (!Array.isArray(items) || items.length > 100) throw new Error('Expected at most 100 actions');
  const ids = new Set();
  for (const item of items) {
    for (const key of ['id', 'revision', 'title', 'consequence', 'confirmLabel']) {
      if (typeof item[key] !== 'string' || !item[key].trim() || item[key].length > 1000) throw new Error(`Invalid action ${key}`);
    }
    if (ids.has(item.id)) throw new Error('Duplicate action id');
    ids.add(item.id);
  }
  return items;
}

/** Plug in list() and execute({id,revision,operation,key}); reconcile uncertain writes before retrying. */
export function mountChecklist(root, { list, execute }) {
  let disposed = false, generation = 0;
  const states = new Map();
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
        const consequence = el('p', item.consequence); const note = el('p', '');
        note.setAttribute('role', 'status');
        const button = el('button', item.confirmLabel); button.type = 'button';
        title.id = `${prefix}-${rows.children.length}-title`;
        consequence.id = `${prefix}-${rows.children.length}-effect`;
        button.setAttribute('aria-describedby', `${title.id} ${consequence.id}`);
        const state = states.get(item.id);
        if (state && (state.pending || state.revision === item.revision)) { button.disabled = true; note.textContent = 'Outcome unknown. Refresh to reconcile before acting again.'; }
        async function run(operation, token) {
          if (button.disabled || disposed) return;
          button.disabled = true; note.textContent = operation === 'undo' ? 'Undoing…' : 'Confirming…';
          const key = crypto.randomUUID();
          states.set(item.id, {revision: item.revision, key, pending:true});
          try {
            const result = await execute({id: item.id, revision: item.revision, operation, key, ...(token ? {token} : {})});
            if (disposed) return;
            if (!result || result.ok !== true) throw new Error('Unconfirmed outcome');
            states.delete(item.id);
            pending.delete(item.id); if (current === generation) announce();
            note.textContent = result.message || (operation === 'undo' ? 'Undone.' : 'Confirmed.');
            button.textContent = 'Done';
            if (operation === 'confirm' && result.undoToken) {
              button.textContent = 'Undo'; button.disabled = false;
              button.onclick = () => run('undo', result.undoToken);
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
  return {ready, refresh, dispose() { disposed = true; root.replaceChildren(); }};
}
