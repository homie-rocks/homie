/** Stream purchased bytes so a large resource does not have to fit in Worker memory. */
import { resourceKind } from "./resource-kinds.mjs";
const encoder = new TextEncoder();
async function* base64(object) {
  const reader = object.body?.getReader?.();
  const source = reader ? null : new Uint8Array(await object.arrayBuffer());
  let carry = new Uint8Array();
  let offset = 0;
  try {
    for (;;) {
      const next = reader
        ? await reader.read()
        : {
            done: offset >= source.length,
            value: source.subarray(offset, (offset += 49152)),
          };
      if (next.done) break;
      const bytes = new Uint8Array(carry.length + next.value.length);
      bytes.set(carry);
      bytes.set(next.value, carry.length);
      const end = bytes.length - (bytes.length % 3);
      for (let at = 0; at < end; at += 49152) {
        let binary = "";
        for (const byte of bytes.subarray(at, Math.min(at + 49152, end)))
          binary += String.fromCharCode(byte);
        yield btoa(binary);
      }
      carry = bytes.slice(end);
    }
    if (carry.length) yield btoa(String.fromCharCode(...carry));
  } finally {
    reader?.releaseLock();
  }
}
export function purchaseResponse(data, env, { mcp, envelope } = {}) {
  data = { delivery: 'If this stream is interrupted, retry the same purchase to retrieve the files without paying again.', ...data };
  async function* chunks() {
    if (mcp) {
      const { content, ...rest } = envelope.result;
      yield `{"jsonrpc":"2.0","id":${JSON.stringify(envelope.id)},"result":{${Object.keys(rest).length ? JSON.stringify(rest).slice(1, -1) + "," : ""}"content":[${content.map((c) => JSON.stringify(c)).join(",")}`;
    } else yield JSON.stringify(data).slice(0, -1) + ',"files":[';
    let first = true;
    for (const file of data.manifest.files) {
      const object = await resourceKind(data.entitlement.resource.kind).readFile(env,file);
      if (!object)
        throw new Error(
          "Purchased file temporarily unavailable; retry this order",
        );
      if (mcp)
        yield `,{"type":"resource","resource":{"uri":${JSON.stringify(`urn:sha256:${file.sha256}?path=${encodeURIComponent(file.path)}`)},"mimeType":"application/octet-stream","blob":"`;
      else
        yield `${first ? "" : ","}{"path":${JSON.stringify(file.path)},"data":"`;
      first = false;
      yield* base64(object);
      yield mcp ? '"}}' : '"}';
    }
    yield mcp ? "]}}" : "]}";
  }
  const iterator = chunks();
  return new Response(
    new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await iterator.next();
          if (done) controller.close();
          else controller.enqueue(encoder.encode(value));
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return();
      },
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}
