/** Only an explicit choice enables a new directory claim. */
export function directoryUrl(value) {
  if (value === true) return 'https://homie.rocks';
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) ? url.origin : null;
  } catch { return null; }
}
