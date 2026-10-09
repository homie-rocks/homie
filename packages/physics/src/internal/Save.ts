/** Versioned MessagePack metadata and exact solver bytes in one buffer.
 * CRC-32 detects accidental damage before the solver sees any bytes. This is
 * integrity checking, not authentication; never accept a client-provided save.
 */
import { encode, decode, ExtData, ExtensionCodec } from "@msgpack/msgpack";

const MAGIC = 0x48505953; // HPYS: the format version lives in the header.
const HEADER = 24;
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let i = 0; i < 8; i++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = (value >>> 8) ^ table[(value ^ byte) & 255]!;
  return (value ^ 0xffffffff) >>> 0;
}
// Object keys occur once in a file dictionary, records contain integer key IDs.
// Objects and arrays carry distinct tags; negative zero has a lossless extension.
const codec = new ExtensionCodec();
codec.register({ type: 1, encode: () => null, decode: () => -0 });
function compact(value: unknown, names: string[]): unknown {
  if (value instanceof Uint8Array) return value;
  if (value instanceof Float32Array || value instanceof Uint32Array)
    return [
      2,
      value instanceof Float32Array ? 0 : 1,
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ];
  if (Object.is(value, -0)) return new ExtData(1, new Uint8Array());
  if (Array.isArray(value)) return [0, ...value.map((v) => compact(v, names))];
  if (value && typeof value === "object") {
    const out: unknown[] = [1];
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) continue;
      let id = names.indexOf(key);
      if (id < 0) {
        id = names.length;
        names.push(key);
      }
      out.push(id, compact(v, names));
    }
    return out;
  }
  return value;
}
function expand(value: unknown, names: string[]): unknown {
  if (!Array.isArray(value)) return value;
  if (value[0] === 2) {
    if (
      value.length !== 3 ||
      !(value[2] instanceof Uint8Array) ||
      value[2].byteLength % 4 ||
      (value[1] !== 0 && value[1] !== 1)
    )
      throw new RangeError("physics: invalid typed metadata");
    const bytes = value[2].slice();
    return value[1] === 0
      ? new Float32Array(bytes.buffer)
      : new Uint32Array(bytes.buffer);
  }
  if (value[0] === 0) return value.slice(1).map((v) => expand(v, names));
  if (value[0] !== 1 || value.length % 2 !== 1)
    throw new RangeError("physics: invalid metadata record");
  const out: Record<string, unknown> = {};
  for (let i = 1; i < value.length; i += 2) {
    const key = names[value[i] as number];
    if (
      key === undefined ||
      key === "__proto__" ||
      key === "constructor" ||
      Object.hasOwn(out, key)
    )
      throw new RangeError("physics: invalid metadata key");
    out[key] = expand(value[i + 1], names);
  }
  return out;
}
export function pack(meta: unknown, raw: Uint8Array): Uint8Array {
  const names: string[] = [];
  const data = compact(meta, names);
  const header = encode([names, data], { extensionCodec: codec });
  const bytes = new Uint8Array(HEADER + header.length + raw.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC);
  view.setUint32(4, 4, true);
  view.setUint32(8, header.length, true);
  view.setUint32(12, raw.length, true);
  bytes.set(header, HEADER);
  bytes.set(raw, HEADER + header.length);
  view.setUint32(16, crc(bytes.subarray(HEADER)), true);
  view.setUint32(20, 0, true);
  return bytes;
}
export function unpack(bytes: Uint8Array): { meta: unknown; raw: Uint8Array } {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length < HEADER ||
    bytes.length > 64 * 1024 * 1024
  ) {
    throw new RangeError("physics: invalid snapshot size");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(20, true) !== 0)
    throw new RangeError(
      "physics: incompatible engine version; saves do not cross engine versions",
    );
  const n = view.getUint32(8, true),
    size = view.getUint32(12, true);
  if (
    view.getUint32(0) !== MAGIC ||
    view.getUint32(4, true) !== 4 ||
    view.getUint32(20, true) !== 0 ||
    HEADER + n + size !== bytes.length ||
    view.getUint32(16, true) !== crc(bytes.subarray(HEADER))
  ) {
    throw new RangeError("physics: incompatible or damaged snapshot");
  }
  try {
    const decoded = decode(bytes.subarray(HEADER, HEADER + n), {
      extensionCodec: codec,
      maxArrayLength: 1000000,
      maxMapLength: 1000000,
      maxStrLength: 4096,
    }) as [string[], unknown];
    if (
      !Array.isArray(decoded) ||
      !Array.isArray(decoded[0]) ||
      !decoded[0].every((key) => typeof key === "string")
    )
      throw new RangeError("physics: invalid metadata dictionary");
    return {
      meta: expand(decoded[1], decoded[0]),
      raw: bytes.subarray(HEADER + n),
    };
  } catch (cause) {
    throw new RangeError("physics: invalid snapshot metadata", { cause });
  }
}
