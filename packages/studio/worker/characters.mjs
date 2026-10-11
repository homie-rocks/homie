/** Characters belong to existing player account IDs. Only trusted room code calls this store.
 * A lease never expires: a delayed room cannot spend a second copy after a timeout.
 * The existing Table namespace supplies per-account objects; no new database or hand-entered ID.
 */
export function characterStore(storage) {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS characters (game TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const read = game => JSON.parse(sql.exec('SELECT data FROM characters WHERE game = ?', game).toArray()[0]?.data ?? 'null');
  const write = (game, value) => sql.exec('INSERT INTO characters(game,data) VALUES (?,?) ON CONFLICT(game) DO UPDATE SET data=excluded.data', game, JSON.stringify(value));
  return {
    read,
    acquire(game, holder, schema) {
      return storage.transactionSync(() => {
        const row = read(game) ?? { lease: 0, holder: null, character: null, schema };
        if (row.schema !== schema) return { ok: false, error: 'character-schema-changed' };
        if (row.holder && row.holder !== holder) return { ok: false, error: 'character-held', holder: row.holder };
        if (!row.holder) { row.holder = holder; row.lease += 1; write(game, row); }
        return { ok: true, ...row };
      });
    },
    return(game, holder, lease, character) {
      return storage.transactionSync(() => {
        const row = read(game);
        if (!row || lease > row.lease) throw new Error('Unknown character lease');
        // Lost acknowledgement or an older room: success means retire that outbox,
        // never apply an old return to a newer lease.
        if (lease < row.lease || !row.holder) return { ok: true };
        if (row.holder !== holder) throw new Error('Wrong character holder');
        write(game, { ...row, holder: null, character });
        return { ok: true };
      });
    },
  };
}

export async function characterRequest(env, account, body) {
  const object = env.TABLE.get(env.TABLE.idFromName(`__player/${account}`));
  const response = await object.fetch('https://player/__character', { method: 'POST', body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Character storage unavailable');
  return response.json();
}
