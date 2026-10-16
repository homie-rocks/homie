// Pipe startup waits on protocol responses rather than stderr endpoint discovery.
// Bound those responses by the same deadline as launch (Puppeteer defaults to 30s).
export function ciLaunchOptions(options = {}) {
  const timeout = options.timeout ?? 30_000;
  return { ...options, pipe: true, timeout, protocolTimeout: timeout };
}
