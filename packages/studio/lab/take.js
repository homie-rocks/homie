/*
 * A take: one short, repeatable piece of play the Game Lab shows in both builds (games/<id>/lab.json). The same file
 * is read by the lab page (served as it is) and by `homie-studio lab` in Node.
 *
 *   {
 *     "v": 1,
 *     "default": "knock",
 *     "takes": {
 *       "knock": {
 *         "note": "Walk right into Rook and bump him",
 *         "seconds": 3,              // how long the take is
 *         "seed": 7,                 // the world's dice (Math.random) in both builds
 *         "device": "desk",          // desk (1280x800) or phone (390x844)
 *         "fps": 60,                 // 60, 30, 15 or 12 frames a second
 *         "stage": "dummy",          // a scene the game sets up for this mechanic (lab.stage; optional)
 *         "view": "close",           // one of the game's lab.camera presets (optional)
 *         "overlays": ["onion"],     // overlays on at the start (optional)
 *         "track": "speed",          // the graph shown first (optional)
 *         "storage": { "key": "value" },   // localStorage at the start (a saved hero, a setting)
 *         "inputs": [
 *           { "at": 0.1, "key": "ArrowRight", "hold": 0.6 },   // pressed at 0.1 s, held 0.6 s
 *           { "at": 0.9, "key": "Space" },                    // a tap
 *           { "at": 1.0, "down": "KeyW" }, { "at": 1.4, "up": "KeyW" },
 *           { "at": 1.5, "pointer": "down", "x": 120, "y": 600, "id": 2, "pt": "touch" }
 *         ]
 *       }
 *     }
 *   }
 *
 * Times are seconds from the take's start; x and y are CSS pixels of the game's page at the take's device size.
 */

export const DEVICES = Object.freeze({
  desk: { w: 1280, h: 800, dpr: 1, label: 'Desk' },
  phone: { w: 390, h: 844, dpr: 2, label: 'Phone' },
});
export const FPS = Object.freeze([60, 30, 15, 12]);
export const SCALES = Object.freeze([1, 0.5, 0.25, 0.1]);
export const LIMITS = Object.freeze({ seconds: 60, inputs: 5000, takes: 24, name: 32 });
export const TAKE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const r4 = (v) => Math.round(v * 10000) / 10000;

/** What is wrong with a take, in words (empty: nothing). */
export function checkTake(take, name = 'take') {
  const out = [];
  if (!take || typeof take !== 'object' || Array.isArray(take)) return [`${name} is not an object`];
  const s = Number(take.seconds);
  if (!(s > 0 && s <= LIMITS.seconds)) out.push(`${name}.seconds must be between 0 and ${LIMITS.seconds}`);
  if (take.fps !== undefined && !FPS.includes(Number(take.fps))) out.push(`${name}.fps must be one of ${FPS.join(', ')}`);
  if (take.device !== undefined && !Object.hasOwn(DEVICES, take.device)) out.push(`${name}.device must be desk or phone`);
  if (take.seed !== undefined && !(Number.isInteger(Number(take.seed)) && Number(take.seed) >= 0)) out.push(`${name}.seed must be a whole number`);
  if (take.stage !== undefined && !(typeof take.stage === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(take.stage))) out.push(`${name}.stage is a short lowercase name`);
  if (take.storage !== undefined && (typeof take.storage !== 'object' || Array.isArray(take.storage) || take.storage === null)) out.push(`${name}.storage must be an object of keys`);
  const inputs = take.inputs ?? [];
  if (!Array.isArray(inputs)) out.push(`${name}.inputs must be a list`);
  else {
    if (inputs.length > LIMITS.inputs) out.push(`${name} has ${inputs.length} inputs (at most ${LIMITS.inputs})`);
    inputs.forEach((row, i) => {
      const at = Number(row?.at);
      if (!(at >= 0)) { out.push(`${name}.inputs[${i}].at must be seconds from the start`); return; }
      const kinds = ['key', 'down', 'up', 'pointer'].filter((k) => row[k] !== undefined);
      if (kinds.length !== 1) out.push(`${name}.inputs[${i}] needs exactly one of key, down, up or pointer`);
      else if (kinds[0] === 'pointer') {
        if (!['down', 'move', 'up', 'cancel'].includes(row.pointer)) out.push(`${name}.inputs[${i}].pointer is down, move, up or cancel`);
        if (!Number.isFinite(Number(row.x)) || !Number.isFinite(Number(row.y))) out.push(`${name}.inputs[${i}] needs x and y`);
      } else if (typeof row[kinds[0]] !== 'string' || !/^[A-Za-z0-9]{1,24}$/.test(row[kinds[0]])) out.push(`${name}.inputs[${i}].${kinds[0]} is a KeyboardEvent code such as ArrowRight, KeyW or Space`);
    });
  }
  return out;
}

/** Every take of a lab file, checked: { takes, default, problems }. */
export function readLabFile(json) {
  const problems = [];
  const takes = {};
  if (!json || typeof json !== 'object') return { takes, default: null, problems: ['lab.json is not an object'] };
  const all = json.takes && typeof json.takes === 'object' ? json.takes : {};
  for (const [name, take] of Object.entries(all).slice(0, LIMITS.takes)) {
    if (!TAKE_NAME.test(name)) { problems.push(`take "${name}": a name is lowercase letters, digits and hyphens`); continue; }
    const p = checkTake(take, name);
    if (p.length) problems.push(...p); else takes[name] = take;
  }
  const names = Object.keys(takes);
  return { takes, default: names.includes(json.default) ? json.default : names[0] ?? null, problems };
}

/** How many frames a take has at its frame rate. */
export function framesOf(take, fps = take?.fps ?? 60) { return Math.max(1, Math.round(num(take?.seconds, 3) * fps)); }

/** A take as the harness plays it: inputs as events in ms, in order. */
export function expandTake(take, { fps } = {}) {
  const f = FPS.includes(Number(fps)) ? Number(fps) : FPS.includes(Number(take.fps)) ? Number(take.fps) : 60;
  const events = [];
  for (const row of take.inputs ?? []) {
    const at = num(row.at, 0) * 1000;
    if (row.key !== undefined) {
      events.push({ at, type: 'key', code: row.key, down: true });
      events.push({ at: at + Math.max(1000 / f, num(row.hold, 0.05) * 1000), type: 'key', code: row.key, down: false });
    } else if (row.down !== undefined) events.push({ at, type: 'key', code: row.down, down: true });
    else if (row.up !== undefined) events.push({ at, type: 'key', code: row.up, down: false });
    else if (row.pointer !== undefined) events.push({ at, type: 'pointer', ev: row.pointer, x: num(row.x, 0), y: num(row.y, 0), id: Math.max(1, Math.round(num(row.id, 1))), pt: row.pt === 'mouse' || row.pt === 'pen' ? row.pt : 'touch' });
  }
  // Stable: two events at one time keep the file's order.
  const order = events.map((e, i) => [e, i]).sort((a, b) => a[0].at - b[0].at || a[1] - b[1]).map(([e]) => e);
  return {
    fps: f,
    frames: framesOf(take, f),
    seed: Number.isInteger(Number(take.seed)) ? Number(take.seed) : 1,
    device: Object.hasOwn(DEVICES, take.device) ? take.device : 'desk',
    stage: typeof take.stage === 'string' ? take.stage : null,
    view: typeof take.view === 'string' ? take.view : null,
    overlays: Array.isArray(take.overlays) ? take.overlays.map(String) : [],
    track: typeof take.track === 'string' ? take.track : null,
    storage: take.storage && typeof take.storage === 'object' ? take.storage : null,
    inputs: order,
  };
}

/**
 * What the harness recorded (events in ms) as a take's inputs (seconds): a key pressed and let go becomes one row
 * with its hold; anything else stays an edge.
 */
export function inputsFromRecording(events) {
  const rows = [];
  const open = new Map();
  for (const e of events) {
    const at = r4(num(e.at, 0) / 1000);
    if (e.type === 'key' && e.down) { const row = { at, down: e.code }; open.set(e.code, row); rows.push(row); }
    else if (e.type === 'key') {
      const d = open.get(e.code);
      if (d) { open.delete(e.code); delete d.down; d.key = e.code; d.hold = r4(at - d.at); } else rows.push({ at, up: e.code });
    } else if (e.type === 'pointer') rows.push({ at, pointer: e.ev, x: e.x, y: e.y, id: e.id, pt: e.pt });
  }
  return rows.map((r) => (r.key !== undefined ? { at: r.at, key: r.key, hold: r.hold } : r));
}

/** lab.json as text: readable, one input to a line. */
export function formatLabFile(json) {
  const out = ['{', `  "v": 1,`, `  "default": ${JSON.stringify(json.default ?? null)},`, '  "takes": {'];
  const names = Object.keys(json.takes ?? {});
  names.forEach((name, i) => {
    const t = json.takes[name];
    const keys = Object.keys(t).filter((k) => k !== 'inputs');
    out.push(`    ${JSON.stringify(name)}: {`);
    const lines = keys.map((k) => `      ${JSON.stringify(k)}: ${JSON.stringify(t[k])}`);
    const inputs = Array.isArray(t.inputs) ? t.inputs : [];
    lines.push(`      "inputs": [${inputs.length ? `\n${inputs.map((r) => `        ${JSON.stringify(r)}`).join(',\n')}\n      ` : ''}]`);
    out.push(lines.join(',\n'));
    out.push(`    }${i < names.length - 1 ? ',' : ''}`);
  });
  out.push('  }', '}');
  return `${out.join('\n')}\n`;
}

/** tunables.json as text: one tunable to a line, so a kept change is a one-line diff. */
export function formatTunables(spec) {
  const names = Object.keys(spec ?? {});
  if (!names.length) return '{}\n';
  const one = (s) => (s && typeof s === 'object' && !Array.isArray(s) ? `{ ${Object.entries(s).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }` : JSON.stringify(s));
  return `{\n${names.map((k, i) => `  ${JSON.stringify(k)}: ${one(spec[k])}${i < names.length - 1 ? ',' : ''}`).join('\n')}\n}\n`;
}

/** A tunable's value (a bare number, or { value }). */
export function tunableValue(s) { return typeof s === 'number' ? s : num(s?.value, NaN); }

/** tunables.json with new values (by name): what is unknown or not a number is refused, ranges are kept. */
export function setTunables(spec, values) {
  const next = JSON.parse(JSON.stringify(spec ?? {}));
  const changed = [];
  const refused = [];
  for (const [k, raw] of Object.entries(values ?? {})) {
    const v = Number(raw);
    if (!Object.hasOwn(next, k)) { refused.push(`${k}: not in tunables.json`); continue; }
    if (!Number.isFinite(v)) { refused.push(`${k}: ${JSON.stringify(raw)} is not a number`); continue; }
    const s = next[k];
    const before = tunableValue(s);
    if (typeof s === 'number') next[k] = v;
    else {
      s.value = v;
      // A value past the slider's end moves the end: the file says what was kept, and the slider still reaches it.
      if (Number.isFinite(s.min) && v < s.min) s.min = v;
      if (Number.isFinite(s.max) && v > s.max) s.max = v;
    }
    if (before !== v) changed.push({ name: k, from: before, to: v });
  }
  return { spec: next, changed, refused };
}
