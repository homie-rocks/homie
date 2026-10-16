// CI launches use the pipe transport. The caller's protocolTimeout stays as given (long-running
// browser tests rely on it, often 180–300 s); startup gets its own deadline instead, because
// Puppeteer does not apply `timeout` while it waits on the pipe.
export function ciLaunchOptions(options = {}) {
  return { ...options, pipe: true, timeout: options.timeout ?? 30_000 };
}

/** Bound Chrome's startup by the launch deadline; a browser that starts after the deadline is closed. */
export async function launchWithDeadline(launch, options) {
  const deadline = options.timeout ?? 30_000;
  let timer;
  const started = launch(options);
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      started.then(browser => browser.close(), () => {});
      reject(new Error(`Chrome did not start within ${deadline} ms`));
    }, deadline);
  });
  try { return await Promise.race([started, expired]); }
  finally { clearTimeout(timer); }
}
