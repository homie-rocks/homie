import { normalizeWorld, denormalizeWorld, durableWorld, ownDurable, checkpointWorld, changes, applyChanges } from './world-journal.mjs';
/**
 * Match rooms keep their whole save and its cadence. A lasting world (`persistent`) writes what the game declared
 * durable the moment it changes, as one small journal transaction, and folds the rest of the room into a chunked
 * checkpoint on an interval and on the way down. Restore is the last checkpoint and then the journal after it.
 *
 * The journal is a ring. Row 0 holds the floor: the last sequence number the checkpoint already contains, written in
 * the checkpoint's own transaction. A record's row id is its sequence less the floor, so the records after a
 * checkpoint overwrite the ones before it and a checkpoint never pays a row for each record it folds. A read takes
 * only the rows above the floor, in order, and refuses a gap.
 *
 * Only integer primary keys: no secondary-index write amplification.
 * The boot row outlives a save being replayed, so two restores of that save can never reuse an epoch.
 */
export function roomStore(storage, { persistent = false } = {}) {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS save (id INTEGER PRIMARY KEY, data BLOB NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS boots (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  let journalReady = false;
  /** Opened once: a store that writes before it reads still continues the sequence on disk, so its checkpoint retires what is there. */
  function journal() {
    if (journalReady) return;
    sql.exec('CREATE TABLE IF NOT EXISTS world_journal (id INTEGER PRIMARY KEY, seq INTEGER NOT NULL, data BLOB NOT NULL)');
    floor = sql.exec('SELECT seq FROM world_journal WHERE id = 0').toArray()[0]?.seq ?? 0;
    sequence = Math.max(floor, sql.exec('SELECT MAX(seq) AS seq FROM world_journal WHERE id > 0').toArray()[0]?.seq ?? 0);
    journalReady = true;
  }
  // `base` is the world as last read or checkpointed, kept whole until a commit says which fields are durable;
  // `durable` is the projection of the last world a commit saw, and is what the next one is compared with.
  let sequence = 0, floor = 0, base = null, durable = null, checkpoint = null, checkpointAt = 0, checkpointTick = 0, committedInputs = null;
  let lasting = persistent;
  if (persistent) { const old = JSON.parse(sql.exec('SELECT data FROM boots WHERE id = 1').toArray()[0]?.data ?? 'null'); if (!old?.persistent) sql.exec('INSERT INTO boots(id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', JSON.stringify({ epoch: 0, count: 0, ...old, persistent: true })); }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const pieceBytes = 1_000_000;
  const inputState = v => ({inputs:v.host?.inputs ?? [],queues:v.host?.queues ?? []});
  /** What is on disk now equals `value`: the next commit is compared with it. */
  function settle(value) {
    base = normalizeWorld(structuredClone(value)); durable = null;
    checkpoint = JSON.stringify(checkpointWorld(base)); checkpointAt = value.at ?? 0; checkpointTick = base.host?.core?.tick ?? 0; committedInputs = inputState(base);
  }
  return {
    read() {
      const boot = this.boots();
      if (boot?.retired === true) return null;
      const maxBytes = boot?.persistent ? Infinity : 16_000_000;
      const total = sql.exec('SELECT SUM(length(data)) AS bytes FROM save').toArray()[0]?.bytes ?? 0;
      if (total > maxBytes) throw new Error('save exceeds 16 MB');
      const rows = sql.exec('SELECT id, data FROM save ORDER BY id').toArray();
      if (!rows.length) return null;
      if (rows.some((r, i) => r.id !== i) || rows.reduce((n, r) => n + r.data.byteLength, 0) > maxBytes) throw new Error('save pieces missing or save exceeds 16 MB');
      const pieces = rows.map((r) => new Uint8Array(r.data));
      const bytes = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of pieces) { bytes.set(p, at); at += p.length; }
      let value = JSON.parse(decoder.decode(bytes));
      if (lasting) journal();
      sequence = floor;
      const journals = lasting ? sql.exec('SELECT id, seq, data FROM world_journal WHERE id > 0 AND seq > ? ORDER BY seq', floor).toArray() : [];
      if (journals.length) {
        let normalized = normalizeWorld(value);
        let pending = '';
        const stream = new TextDecoder('utf-8', {fatal:true});
        for (const row of journals) {
          if (row.seq !== sequence + 1 || row.id !== row.seq - floor) throw new Error('World journal has a gap');
          pending += stream.decode(new Uint8Array(row.data), {stream:true}); sequence = row.seq;
          let end;
          while ((end = pending.indexOf('\n')) >= 0) { normalized = applyChanges(normalized, JSON.parse(pending.slice(0,end))); pending = pending.slice(end+1); }
        }
        pending += stream.decode();
        if (pending) throw new Error('Incomplete world journal transaction');
        value = denormalizeWorld(normalized);
      }
      if (lasting) settle(value);
      if (typeof value.host === 'string') {
        const hostText = value.host;
        value.host = JSON.parse(hostText);
        Object.defineProperty(value, 'hostText', { value: hostText });
      }
      return value;
    },
    /**
     * A lasting world's tick. Nothing durable changed and no checkpoint is due: no write. Something durable changed:
     * one journal transaction holding just that. The interval has passed (or `force`) and the room differs from its
     * checkpoint: the checkpoint, which takes the journal with it.
     */
    commit(value, { force = false, seconds = 30, tickHz = 20, fields }) {
      journal();
      if (!base) { this.write(value); return; }
      const next = normalizeWorld(value);
      durable ??= ownDurable(base, fields);
      const moved = changes(durable, durableWorld(next, fields));
      // The comparison is over sparse field maps. What is written is the full validated representation at each
      // path, so a new entity is recorded with its initial pose.
      const patches = moved.map((patch) => {
        if (patch.length === 1) return patch;
        let full = next;
        for (const key of patch[0]) full = full[key];
        return [patch[0], full];
      });
      if (force || value.at - checkpointAt >= seconds * 1000 || next.host.core.tick - checkpointTick >= seconds * tickHz) {
        if (patches.length || JSON.stringify(checkpointWorld(next)) !== checkpoint) { this.write(value); return; }
        // Still the checkpoint's own room: it is asked again an interval from now, not on every tick until then.
        checkpointAt = value.at; checkpointTick = next.host.core.tick;
      }
      if (patches.length) {
        // Input acknowledgements and pending pulses share the value transaction.
        // A restart must not consume a checkpoint's already-spent pulse again.
        const inputs = inputState(next);
        changes(committedInputs, inputs, ['host'], patches);
        // Advance logical time and RNG with a commitment, never once per tick.
        for (const key of ['tick','rng','nextId','seq']) patches.push([['host','core',key],next.host.core[key]]);
        patches.push([['at'],next.at]);
        // One transaction may span several bounded rows. A read folds the whole
        // transaction; no prefix can become visible across a crash.
        const bytes = encoder.encode(JSON.stringify(patches) + '\n');
        let last = sequence;
        storage.transactionSync(() => {
          for (let at = 0; at < bytes.length; at += pieceBytes) {
            last += 1;
            sql.exec('INSERT INTO world_journal (id, seq, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, data = excluded.data', last - floor, last, bytes.slice(at,at+pieceBytes));
          }
        });
        sequence = last;
        committedInputs = structuredClone(inputs);
      }
      // Brought up to this tick by what changed in it (each value copied), never by copying the room.
      durable = applyChanges(durable, moved);
    },
    write(value) {
      if (lasting) journal();
      const bytes = encoder.encode(JSON.stringify(value));
      if (bytes.length > 16_000_000 && !lasting) throw new Error('save exceeds 16 MB');
      storage.transactionSync(() => {
        let id = 0;
        for (let at = 0; at < bytes.length; at += pieceBytes) sql.exec('INSERT INTO save (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', id++, bytes.slice(at, at + pieceBytes));
        sql.exec('DELETE FROM save WHERE id >= ?', id);
        // The checkpoint holds every record so far: raising the floor retires them without touching their rows.
        if (lasting && sequence !== floor) sql.exec("INSERT INTO world_journal (id, seq, data) VALUES (0, ?, x'') ON CONFLICT(id) DO UPDATE SET seq = excluded.seq", sequence);
      });
      floor = sequence;
      if (lasting) settle(value);
    },
    boots() { const value = JSON.parse(sql.exec('SELECT data FROM boots WHERE id = 1').toArray()[0]?.data ?? 'null'); lasting ||= value?.persistent === true; return value; },
    boot(value) { sql.exec('INSERT INTO boots (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', JSON.stringify({ ...value, ...(lasting ? { persistent: true } : {}) })); },
    retire() { this.boot({ retired: true }); },
    clear() { if (lasting) journal(); storage.transactionSync(() => { sql.exec('DELETE FROM save'); sql.exec('DELETE FROM boots'); if (lasting) sql.exec('DELETE FROM world_journal'); }); journalReady = false; base = null; durable = null; checkpoint = null; committedInputs = null; sequence = 0; floor = 0; },
  };
}

/** A repeatable delay spreads rooms that shared a failing isolate over thirty seconds. */
export function restoreDelay(id) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h % 30_001;
}
