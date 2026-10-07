/**
 * Versioned bytes for numeric object graphs. References matter: a sliced search's
 * heap and node pool point at the SAME nodes. JSON alone silently breaks that.
 * This codec keeps references, IEEE special values and typed arrays. No executable
 * content is stored; the one query filter is rebound by identity on load.
 */
import { DEFAULT_QUERY_FILTER } from 'navcat';
const constructors = { Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array };
type Token = null | boolean | string | number | { r: number } | { n: string };
type RecordData = { kind: string; values: Token[]; keys?: string[] };
export function pack(kind: string, value: unknown): Uint8Array {
  const seen = new Map<object, number>(), records: RecordData[] = [];
  function visit(v: unknown): Token {
    if (v === undefined) return { n: 'undefined' };
    if (v === DEFAULT_QUERY_FILTER) return { n: 'filter' };
    if (typeof v === 'number') return Number.isFinite(v) && !Object.is(v, -0) ? v : { n: String(Object.is(v, -0) ? '-0' : v) };
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v !== 'object') throw new Error('nav: state must contain data only');
    const old = seen.get(v); if (old !== undefined) return { r: old };
    const id = records.length; seen.set(v, id);
    const rec: RecordData = { kind: 'object', values: [] }; records.push(rec);
    if (Array.isArray(v)) { rec.kind = 'array'; rec.values = Array.from(v, visit); }
    else if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      rec.kind = v.constructor.name;
      if (!(rec.kind in constructors)) throw new Error('nav: unsupported typed array');
      rec.values = Array.from(v as unknown as ArrayLike<number>, visit);
    } else {
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error('nav: unsupported state object');
      rec.keys = Object.keys(v); rec.values = rec.keys.map(k => visit((v as Record<string, unknown>)[k]));
    }
    return { r: id };
  }
  const root = visit(value);
  return new TextEncoder().encode(JSON.stringify({ format: 'homie-nav', version: 1, backend: 'navcat-0.4.1', kind, root, records }));
}
/** Read trusted game assets/saves, never arbitrary player input. */
export function unpack<T>(kind: string, bytes: Uint8Array): T {
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (data.format !== 'homie-nav' || data.version !== 1 || data.backend !== 'navcat-0.4.1' || data.kind !== kind || !Array.isArray(data.records)) throw new Error('nav: incompatible state bytes');
  const records = data.records as RecordData[];
  const objects = records.map(r => {
    if (!Array.isArray(r.values)) throw new Error('nav: invalid state record');
    if (r.kind === 'object') return {};
    if (r.kind === 'array') return [];
    if (!Object.hasOwn(constructors, r.kind)) throw new Error('nav: invalid state array');
    return new constructors[r.kind as keyof typeof constructors](r.values.length);
  });
  function read(t: Token): unknown {
    if (t === null || typeof t !== 'object') return t;
    if ('r' in t) {
      if (!Number.isInteger(t.r) || t.r < 0 || t.r >= objects.length) throw new Error('nav: invalid state reference');
      return objects[t.r];
    }
    switch (t.n) {
      case 'undefined': return undefined;
      case 'filter': return DEFAULT_QUERY_FILTER;
      case '-0': return -0;
      case 'NaN': return NaN;
      case 'Infinity': return Infinity;
      case '-Infinity': return -Infinity;
      default: throw new Error('nav: invalid state number');
    }
  }
  records.forEach((r, i) => {
    const out = objects[i] as Record<string, unknown>;
    r.values.forEach((v, j) => {
      const key = r.kind === 'object' ? r.keys?.[j] : String(j);
      if (key === undefined || key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('nav: invalid state key');
      out[key] = read(v);
    });
  });
  return read(data.root) as T;
}
