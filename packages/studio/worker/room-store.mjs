/**
 * A whole server-hosted room in SQLite. A small room updates one row; a large one uses pieces in the same synchronous
 * transaction. No index besides the integer primary key: the default is one row written per second, not two.
 * The boot row outlives a save being replayed, so two restores of that save can never reuse an epoch.
 */
export function roomStore(storage) {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS save (id INTEGER PRIMARY KEY, data BLOB NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS boots (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const pieceBytes = 1_000_000;
  return {
    read() {
      if (this.boots()?.retired === true) return null;
      const total = sql.exec('SELECT SUM(length(data)) AS bytes FROM save').toArray()[0]?.bytes ?? 0;
      if (total > 16_000_000) throw new Error('save exceeds 16 MB');
      const rows = sql.exec('SELECT id, data FROM save ORDER BY id').toArray();
      if (!rows.length) return null;
      if (rows.some((r, i) => r.id !== i) || rows.reduce((n, r) => n + r.data.byteLength, 0) > 16_000_000) throw new Error('save pieces missing or save exceeds 16 MB');
      const pieces = rows.map((r) => new Uint8Array(r.data));
      const bytes = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of pieces) { bytes.set(p, at); at += p.length; }
      const value = JSON.parse(decoder.decode(bytes));
      if (typeof value.host === 'string') {
        const hostText = value.host;
        value.host = JSON.parse(hostText);
        Object.defineProperty(value, 'hostText', { value: hostText });
      }
      return value;
    },
    write(value) {
      const bytes = encoder.encode(JSON.stringify(value));
      if (bytes.length > 16_000_000) throw new Error('save exceeds 16 MB');
      storage.transactionSync(() => {
        let id = 0;
        for (let at = 0; at < bytes.length; at += pieceBytes) sql.exec('INSERT INTO save (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', id++, bytes.slice(at, at + pieceBytes));
        sql.exec('DELETE FROM save WHERE id >= ?', id);
      });
    },
    boots() { return JSON.parse(sql.exec('SELECT data FROM boots WHERE id = 1').toArray()[0]?.data ?? 'null'); },
    boot(value) { sql.exec('INSERT INTO boots (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', JSON.stringify(value)); },
    retire() { this.boot({ retired: true }); },
    clear() { storage.transactionSync(() => { sql.exec('DELETE FROM save'); sql.exec('DELETE FROM boots'); }); },
  };
}

/** A repeatable delay spreads rooms that shared a failing isolate over thirty seconds. */
export function restoreDelay(id) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h % 30_001;
}
