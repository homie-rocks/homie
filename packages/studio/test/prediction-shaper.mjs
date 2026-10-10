/** Seeded per-link, per-direction, per-kind packet delays. Interleaving unrelated sockets cannot change a stream. */
export function predictionShaper({ delay, loss, seed = 417, jitter = true }) {
  const streams = new Map();
  return (message, link) => {
    if (!['in', 'snap'].includes(message.t)) return delay / 2;
    const key = `${link}:${message.t}`;
    let rng = streams.get(key);
    if (rng === undefined) {
      rng = seed >>> 0;
      for (const char of key) rng = (Math.imul(rng, 31) + char.charCodeAt(0)) >>> 0;
    }
    const random = () => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      streams.set(key, rng);
      return rng / 4294967296;
    };
    if (random() < loss) return null;
    return delay / 2 * (jitter ? .75 + random() * .5 : 1);
  };
}
