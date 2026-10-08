/** Binary graph format, little endian, with shared object shapes and references.
 * The 16-byte header is magic, version, payload length, and checksum. Typed arrays
 * are copied as raw sections; no numeric text or recursively encoded byte blobs.
 * Object references preserve the sliced search heap's aliases.
 */
import { queryFilter } from './internal/FilterValue.ts';
// The graph layout is tied to this exact backend version as well as our schema.
const VERSION = 3;
const BACKEND = 'navcat@0.4.1';
const arrays = [
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Float64Array,
] as const;
function writeElement(v: DataView, type: number, i: number, n: number): void {
  const o = i * arrays[type]!.BYTES_PER_ELEMENT;
  switch (type) {
    case 0: v.setUint8(o, n); break;
    case 1: v.setUint16(o, n, true); break;
    case 2: v.setUint32(o, n, true); break;
    case 3: v.setInt8(o, n); break;
    case 4: v.setInt16(o, n, true); break;
    case 5: v.setInt32(o, n, true); break;
    case 6: v.setFloat32(o, n, true); break;
    case 7: v.setFloat64(o, n, true); break;
  }
}
function readElement(v: DataView, type: number, i: number): number {
  const o = i * arrays[type]!.BYTES_PER_ELEMENT;
  switch (type) {
    case 0: return v.getUint8(o);
    case 1: return v.getUint16(o, true);
    case 2: return v.getUint32(o, true);
    case 3: return v.getInt8(o);
    case 4: return v.getInt16(o, true);
    case 5: return v.getInt32(o, true);
    case 6: return v.getFloat32(o, true);
    default: return v.getFloat64(o, true);
  }
}
const MAGIC = 0x324e4d48;
export function hash(bytes: Uint8Array): number {
  let value = 2166136261;
  for (const byte of bytes) value = Math.imul(value ^ byte, 16777619);
  return value >>> 0;
}
export function pack(kind: string, value: unknown): Uint8Array {
  let bytes = new Uint8Array(4096),
    offset = 16;
  const objects = new Map<object, number>(),
    strings = new Map<string, number>(),
    shapes = new Map<string, number>();
  const reserve = (count: number): void => {
    if (offset + count <= bytes.length) return;
    const next = new Uint8Array(Math.max(bytes.length * 2, offset + count));
    next.set(bytes);
    bytes = next;
  };
  const byte = (n: number): void => {
    reserve(1);
    bytes[offset++] = n;
  };
  const uint = (n: number): void => {
    while (n > 127) {
      byte((n & 127) | 128);
      n = Math.floor(n / 128);
    }
    byte(n);
  };
  const string = (s: string): void => {
    const id = strings.get(s);
    if (id !== undefined) {
      uint(id * 2);
      return;
    }
    strings.set(s, strings.size);
    uint(s.length * 2 + 1);
    // UTF-16 code units preserve every JavaScript string, without platform codecs.
    for (let i = 0; i < s.length; i++) uint(s.charCodeAt(i));
  };
  const write = (v: unknown): void => {
    if (v === null) {
      byte(0);
      return;
    }
    if (v === undefined) {
      byte(1);
      return;
    }
    if (v === false || v === true) {
      byte(v ? 3 : 2);
      return;
    }
    if (v === queryFilter) {
      byte(4);
      return;
    }
    if (typeof v === 'number') {
      if (Number.isSafeInteger(v) && v >= 0 && v <= 0xffffffff && !Object.is(v, -0)) {
        byte(5);
        uint(v);
      } else {
        byte(6);
        reserve(8);
        new DataView(bytes.buffer).setFloat64(offset, v, true);
        offset += 8;
      }
      return;
    }
    if (typeof v === 'string') {
      byte(7);
      string(v);
      return;
    }
    if (typeof v !== 'object') throw new Error('nav: state must contain data only');
    const ref = objects.get(v);
    if (ref !== undefined) {
      byte(8);
      uint(ref);
      return;
    }
    objects.set(v, objects.size);
    if (Array.isArray(v)) {
      byte(9);
      uint(v.length);
      for (const item of v) write(item);
      return;
    }
    if (ArrayBuffer.isView(v)) {
      const type = arrays.findIndex((c) => v instanceof c);
      if (type < 0) throw new Error('nav: unsupported typed array');
      byte(11 + type);
      uint(v.byteLength);
      reserve(v.byteLength);
      const input = v as unknown as ArrayLike<number>;
      const section = new DataView(bytes.buffer, offset, v.byteLength);
      for (let i = 0; i < input.length; i++) writeElement(section, type, i, input[i]!);
      offset += v.byteLength;
      return;
    }
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
      throw new Error('nav: unsupported state object');
    byte(10);
    const keys = Object.keys(v),
      signature = keys.map((k) => `${k.length}:${k}`).join('');
    const shape = shapes.get(signature);
    if (shape !== undefined) uint(shape * 2);
    else {
      shapes.set(signature, shapes.size);
      uint(keys.length * 2 + 1);
      for (const key of keys) string(key);
    }
    for (const key of keys) write((v as Record<string, unknown>)[key]);
  };
  string(kind);
  string(BACKEND);
  write(value);
  const result = bytes.slice(0, offset),
    header = new DataView(result.buffer);
  header.setUint32(0, MAGIC, true);
  header.setUint32(4, VERSION, true);
  header.setUint32(8, offset, true);
  header.setUint32(12, hash(result.subarray(16)), true);
  return result;
}
/** Assets and room saves, not player input. Invalid or truncated data fails here. */
export function unpack<T>(kind: string, bytes: Uint8Array): T {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      bytes.length < 16 ||
      view.getUint32(0, true) !== MAGIC ||
      view.getUint32(4, true) !== VERSION ||
      view.getUint32(8, true) !== bytes.length ||
      view.getUint32(12, true) !== hash(bytes.subarray(16))
    )
      throw Error();
    let offset = 16;
    const objects: unknown[] = [],
      strings: string[] = [],
      shapes: string[][] = [];
    const byte = (): number => {
      if (offset >= bytes.length) throw Error();
      return bytes[offset++]!;
    };
    const uint = (): number => {
      let result = 0,
        factor = 1;
      for (let n = 0; n < 5; n++) {
        const b = byte();
        result += (b & 127) * factor;
        if (b < 128) return result;
        factor *= 128;
      }
      throw Error();
    };
    const string = (): string => {
      const code = uint();
      if (!(code & 1)) {
        const s = strings[code / 2];
        if (s === undefined) throw Error();
        return s;
      }
      const length = Math.floor(code / 2);
      if (length > bytes.length - offset) throw Error();
      let s = '';
      for (let i = 0; i < length; i++) s += String.fromCharCode(uint());
      strings.push(s);
      return s;
    };
    const read = (depth = 0): unknown => {
      if (depth > 256) throw Error();
      const tag = byte();
      if (tag === 4 && !queryFilter) throw Error();
      if (tag < 5) return [null, undefined, false, true, queryFilter][tag];
      if (tag === 5) return uint();
      if (tag === 6) {
        const n = view.getFloat64(offset, true);
        offset += 8;
        return n;
      }
      if (tag === 7) return string();
      if (tag === 8) {
        const id = uint();
        if (id >= objects.length) throw Error();
        return objects[id];
      }
      if (tag === 9) {
        const n = uint();
        if (n > bytes.length - offset) throw Error();
        const a: unknown[] = [];
        objects.push(a);
        for (let i = 0; i < n; i++) a.push(read(depth + 1));
        return a;
      }
      if (tag === 10) {
        const out: Record<string, unknown> = {};
        objects.push(out);
        const code = uint();
        let keys: string[];
        if (code & 1) {
          keys = [];
          const n = Math.floor(code / 2);
          if (n > bytes.length - offset) throw Error();
          for (let i = 0; i < n; i++) keys.push(string());
          shapes.push(keys);
        } else {
          keys = shapes[code / 2]!;
          if (!keys) throw Error();
        }
        for (const key of keys) {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error();
          out[key] = read(depth + 1);
        }
        return out;
      }
      const ctor = arrays[tag - 11];
      if (!ctor) throw Error();
      const n = uint();
      if (n % ctor.BYTES_PER_ELEMENT || n > bytes.length - offset) throw Error();
      const a = new ctor(n / ctor.BYTES_PER_ELEMENT);
      const section = new DataView(bytes.buffer, bytes.byteOffset + offset, n);
      for (let i = 0; i < a.length; i++) a[i] = readElement(section, tag - 11, i);
      offset += n;
      objects.push(a);
      return a;
    };
    if (string() !== kind || string() !== BACKEND) throw Error();
    const out = read();
    if (offset !== bytes.length) throw Error();
    return out as T;
  } catch {
    throw new Error('nav: invalid or incompatible state bytes');
  }
}
/** Zero-copy views of a save, suitable for SQLite values under the 2 MiB limit.
 * Store the count and all chunks atomically; reassemble before restore.
 */
export function chunks(bytes: Uint8Array, limit = 1_048_576): Uint8Array[] {
  if (!Number.isInteger(limit) || limit < 16 || limit > 2_000_000)
    throw new Error('nav: invalid chunk size');
  const result: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += limit) result.push(bytes.subarray(i, i + limit));
  return result;
}
export function joinChunks(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
