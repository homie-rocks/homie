/*
 * THE DESKTOP SHELL (standalone/STANDALONE.md): one window that shows the game's web folder, and nothing else. It is
 * the same file for every game: what differs is app.json beside it. The page gets no Node, no preload and no way out
 * of its own folder; a link opens in the person's browser.
 *
 *   --smoke[=<ms>]   a self-check for `homie-studio standalone`: load, wait, print ONE line of JSON saying where the
 *                    page is, whether the game's frame loaded, what failed to load and what the console said, exit.
 *                    With --shot=<file.png>, a picture of the window as it was then.
 */
'use strict';
const { app, BrowserWindow, Menu, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const { fileFor, rangeOf, mayNavigate } = require('./files.cjs');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'app.json'), 'utf8'));
const WEB = path.join(__dirname, 'web');
const ORIGIN = 'app://game';
const smokeArg = process.argv.find((a) => /^--smoke(=\d+)?$/.test(a));
const SMOKE = smokeArg ? Number(smokeArg.split('=')[1]) || 6000 : 0;

// Nothing a page does may raise Electron's own error dialog over the game: said in the log, and the game goes on.
process.on('uncaughtException', (error) => { try { console.error(`shell: ${String(error && error.stack ? error.stack : error).slice(0, 600)}`); } catch { /* no console */ } });

// This game's own storage and its own single-instance lock: two games with the same name never share either.
// The self-check keeps nothing: its storage is a folder of its own in the temporary folder, removed when it ends.
const smokeData = SMOKE ? fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'standalone-smoke-')) : null;
if (smokeData) { app.setPath('userData', smokeData); app.on('quit', () => { try { fs.rmSync(smokeData, { recursive: true, force: true }); } catch { /* the system clears it */ } }); }
else if (/^[A-Za-z][A-Za-z0-9.]{2,120}$/.test(cfg.appId || '')) app.setPath('userData', path.join(app.getPath('appData'), cfg.appId));

// The page's own origin: a standard, secure one, so its storage, its modules and its fetches behave as on a site.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

/*
 * STARTED BY STEAM (Steam sets SteamAppId for what it starts; a game.json with a Steam app is not enough). The
 * overlay is a library the Steam client loads into this process, and it draws only when the GPU runs in the browser
 * process, so that switch is passed. This has never been run under Steam, and Electron apps often show no overlay.
 * Chromium's sandbox is NOT turned off here: a switch added at this point is too late for it, and inside Steam's
 * Linux container the way to do that is the launch option --no-sandbox, set in Steamworks (STANDALONE.md says so).
 */
const underSteam = Boolean(process.env.SteamAppId || process.env.SteamGameId || process.env.SteamOverlayGameId);
if (underSteam) app.commandLine.appendSwitch('in-process-gpu');
// Steam's own API, only when game.json asked for it and Steam started the game: whatever happens is said in the log,
// and the game runs either way. This binding has never been run by the people who wrote this file.
if (underSteam && cfg.steam && cfg.steam.api) {
  try {
    const steam = require('steamworks-ffi-node');
    const s = (steam.SteamworksSDK || steam.default || steam).getInstance();
    // Steam's own libraries, copied beside this file from the SDK the studio's owner downloaded (never shipped by Homie).
    s.setSdkPath(path.join(__dirname, 'steamworks_sdk'));
    const started = s.init({ appId: cfg.steam.app });
    if (started) { console.log('steam: the Steamworks binding started'); app.on('before-quit', () => { try { s.shutdown(); } catch { /* gone */ } }); }
    else console.error('steam: the Steamworks binding said it did not start (init answered false); playing without it');
  } catch (error) { console.error(`steam: the Steamworks binding did not start (${String(error && error.message).slice(0, 200)}); playing without it`); }
}

const MEDIA = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm' };
async function serve(request) {
  const file = fileFor(WEB, request.url);
  if (!file) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  // A part of a file (a player seeking in a song): answered here, since a file fetch is always the whole of it.
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return new Response('not found', { status: 404 }); }
  const range = rangeOf(request.headers.get('range'), size);
  if (range === 'whole') return net.fetch(pathToFileURL(file).toString());
  if (range === 'none') return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  const stream = fs.createReadStream(file, range);
  // A player that stops asking (a seek, a closed page) ends the stream early: that is not an error of anybody's.
  stream.on('error', () => {});
  return new Response(Readable.toWeb(stream), { status: 206, headers: { 'content-type': MEDIA[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': String(range.end - range.start + 1), 'content-range': `bytes ${range.start}-${range.end}/${size}`, 'accept-ranges': 'bytes' } });
}

/** macOS wants a menu bar: the app's own (Quit), Edit (so copy and paste work in the room-code field) and Window. No Reload, no tools, no Help. */
function menu() {
  if (process.platform !== 'darwin') return null;
  return Menu.buildFromTemplate([
    { label: cfg.name, submenu: [{ role: 'about', label: `About ${cfg.name}` }, { type: 'separator' }, { role: 'hide', label: `Hide ${cfg.name}` }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit', label: `Quit ${cfg.name}` }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' }] },
  ]);
}

function open() {
  const win = new BrowserWindow({
    width: cfg.width || 1280, height: cfg.height || 720, minWidth: 480, minHeight: 320, show: !SMOKE,
    title: cfg.name, backgroundColor: cfg.background || '#04060c', autoHideMenuBar: true,
    ...(process.platform === 'linux' && fs.existsSync(path.join(__dirname, 'icon.png')) ? { icon: path.join(__dirname, 'icon.png') } : {}),
    // The developer tools are for the copy a studio runs from its own folder, never for the one it ships.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, devTools: !app.isPackaged },
  });
  const wc = win.webContents;
  wc.on('will-navigate', (event, url) => { if (!mayNavigate(url, { main: true })) event.preventDefault(); });
  wc.on('will-frame-navigate', (event) => { if (!mayNavigate(event.url, { main: event.isMainFrame })) event.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.key === 'Enter' && input.alt))) { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
  });
  if (SMOKE) smoke(win);
  win.loadURL(`${ORIGIN}/index.html`);
}

/** The self-check: what a person would see go wrong, as one line of JSON, then exit (1 when the game did not load). */
function smoke(win) {
  const wc = win.webContents;
  const failed = []; const errors = []; let requests = 0;
  session.defaultSession.webRequest.onCompleted((d) => { requests += 1; if (d.statusCode >= 400) failed.push(`${d.statusCode} ${d.url}`.slice(0, 200)); });
  session.defaultSession.webRequest.onErrorOccurred((d) => { failed.push(`${d.error} ${d.url}`.slice(0, 200)); });
  wc.on('console-message', (event) => { if (event.level === 'error') errors.push(String(event.message).slice(0, 300)); });
  wc.on('did-fail-load', (event, code, why, url) => failed.push(`${code} ${why} ${url}`.slice(0, 200)));
  const probe = `(() => { const f = document.querySelector('iframe.game'); let g = null;
    try { const w = f.contentWindow, d = f.contentDocument, n = w.__homieNet; g = { href: w.location.href, ready: d.readyState, canvas: d.querySelectorAll('canvas').length, net: w.HOMIE_NET ? { url: w.HOMIE_NET.url, room: w.HOMIE_NET.room || null, app: w.HOMIE_NET.app === true } : null, helper: n ? { role: n.role, offline: n.offline, connected: n.connected, link: n.link, roster: Array.isArray(n.roster) ? n.roster.length : null } : null }; } catch (e) { g = { error: String(e) }; }
    return { origin: location.origin, title: document.title, shell: window.__shell ? { room: window.__shell.room, online: window.__shell.online, link: window.__shell.link, starts: window.__shell.starts } : null, game: g }; })()`;
  setTimeout(async () => {
    let page = null;
    try { page = await wc.executeJavaScript(probe); } catch (error) { errors.push(`probe: ${String(error && error.message)}`); }
    const shot = process.argv.find((x) => x.startsWith('--shot='));
    if (shot) { try { fs.writeFileSync(shot.slice(7), (await wc.capturePage()).toPNG()); } catch (error) { errors.push(`shot: ${String(error && error.message)}`); } }
    const loaded = Boolean(page && page.game && page.game.ready === 'complete');
    process.stdout.write(`${JSON.stringify({ smoke: 1, ok: loaded && !failed.length && !errors.length, loaded, packaged: app.isPackaged, requests, failed, errors, ...page })}\n`);
    app.exit(loaded ? 0 : 1);
  }, SMOKE);
}

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => {
    protocol.handle('app', serve);
    // The page may lock the pointer, go full screen and put an invite link on the clipboard. Nothing else is asked for.
    const allowed = new Set(['pointerLock', 'fullscreen', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((wc, permission, done) => done(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.has(permission));
    Menu.setApplicationMenu(menu());
    open();
  });
  app.on('window-all-closed', () => app.quit());
}
