/**
 * `homie-studio port plan <folder>` and `homie-studio port import <folder> --id <id>`:
 * the first two steps of making an existing single-player web game multiplayer.
 *
 * plan   reads the game without running it (loop, input, state, camera, physics,
 *        storage, audio, network, size) and drafts a port plan: a difficulty
 *        grade with its reasons, the netplay movement mode, the build mode, the
 *        check view, and every risk the sandboxed play frame will hit. The agent
 *        then READS the code and writes the final PORT.md; the draft is a start,
 *        never the verdict.
 * import copies the game into games/<id>/ untouched except for two lines (the
 *        port toolkit first in <head>, a phone-safe viewport), writes game.json,
 *        and keeps the licence beside it.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { GAME_ID } from './studio.mjs';

const SKIP = new Set(['node_modules', '.git', '.wrangler', '.port', '.DS_Store', '.cache', '.parcel-cache', '.vite', 'coverage']);
const CODE = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte']);
const TEXT = new Set([...CODE, '.html', '.htm', '.css', '.json', '.md', '.txt', '.glsl', '.frag', '.vert', '.tmx', '.xml', '.svg']);
const MAX_READ = 2 * 1024 * 1024;

function walk(dir, rel = '', out = []) {
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, p, out);
    else if (e.isFile()) out.push({ path: p, bytes: statSync(join(dir, p)).size, ext: extname(e.name).toLowerCase() });
  }
  return out;
}

const count = (text, re) => (text.match(re) ?? []).length;

/** A licence file's SPDX-ish kind, from its words. */
export function licenceOf(dir) {
  const names = readdirSync(dir).filter((n) => /^(licen[cs]e|copying)(\.|$)/i.test(n));
  if (!names.length) {
    const pkg = existsSync(join(dir, 'package.json')) ? JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) : null;
    return { file: null, kind: pkg?.license ? `${pkg.license} (package.json only)` : 'none', permissive: false };
  }
  const text = readFileSync(join(dir, names[0]), 'utf8');
  let kind = 'unknown';
  if (/Permission is hereby granted, free of charge/i.test(text)) kind = 'MIT';
  else if (/Apache License[\s\S]{0,40}Version 2\.0/i.test(text)) kind = 'Apache-2.0';
  else if (/Redistribution and use in source and binary forms/i.test(text)) kind = /Neither the name/i.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  else if (/Permission to use, copy, modify, and\/or distribute/i.test(text)) kind = 'ISC';
  else if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(text)) kind = 'AGPL';
  else if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(text)) kind = 'LGPL';
  else if (/GNU GENERAL PUBLIC LICENSE/i.test(text)) kind = 'GPL';
  else if (/Mozilla Public License/i.test(text)) kind = 'MPL-2.0';
  else if (/This is free and unencumbered software released into the public domain/i.test(text)) kind = 'Unlicense';
  else if (/Creative Commons/i.test(text)) kind = 'Creative Commons';
  return { file: names[0], kind, permissive: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'Unlicense'].includes(kind) };
}

/** Read a game folder and draft its port plan. */
export function planPort(folder) {
  const dir = resolve(folder ?? '.');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`);
  const files = walk(dir);
  const texts = [];
  let read = 0;
  for (const f of files) {
    if (!TEXT.has(f.ext) || f.bytes > 1024 * 1024 || read > MAX_READ) continue;
    // Vendored libraries (three.module.js, jquery…) are not the game: counted, not analysed.
    const vendored = /(^|\/)(vendor|libs?|third[-_]?party|build|jsm|addons|node_modules)\//i.test(f.path) || /(^|\/)(GLTFLoader|OBJLoader|FBXLoader|OrbitControls|PointerLockControls|BufferGeometryUtils|Octree|Capsule|OctreeHelper|EffectComposer|RenderPass|UnrealBloomPass)\.js$/.test(f.path) || /(\.min\.js|three(\.module)?\.js|three\.core\.js|jquery[-.\d]*\.js|phaser[.\w-]*\.js|pixi[.\w-]*\.js|matter[.\w-]*\.js|cannon[.\w-]*\.js|howler[.\w-]*\.js|lil-gui[.\w-]*\.js|stats[.\w-]*\.js|typeface\.js)$/i.test(f.path);
    const text = readFileSync(join(dir, f.path), 'utf8');
    read += text.length;
    texts.push({ ...f, text, vendored });
  }
  const game = texts.filter((t) => !t.vendored && (CODE.has(t.ext) || t.ext === '.html' || t.ext === '.htm'));
  const all = game.map((t) => t.text).join('\n');
  const everything = texts.map((t) => t.text).join('\n');
  const loc = game.filter((t) => CODE.has(t.ext)).reduce((n, t) => n + t.text.split('\n').length, 0)
    + game.filter((t) => t.ext === '.html').reduce((n, t) => n + (t.text.match(/<script(?![^>]*src)[^>]*>[\s\S]*?<\/script>/gi) ?? []).join('\n').split('\n').length, 0);
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  const pkg = existsSync(join(dir, 'package.json')) ? JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) : null;
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const html = files.filter((f) => f.ext === '.html' || f.ext === '.htm').map((f) => f.path);
  const index = html.find((p) => /(^|\/)index\.html?$/i.test(p) && !p.includes('/')) ?? html.find((p) => /index\.html?$/i.test(p)) ?? html[0] ?? null;
  const indexText = index ? readFileSync(join(dir, index), 'utf8') : '';
  const scripts = [...indexText.matchAll(/<script\b([^>]*)>/gi)].map((m) => ({ src: /src=["']([^"']+)["']/i.exec(m[1])?.[1] ?? null, module: /type=["']module["']/i.test(m[1]) }));
  const has = (re) => re.test(all) || re.test(everything);

  const engine = [];
  if (has(/from ['"]three['"]|THREE\.|three\.module\.js|three\.core\.js/)) engine.push('three.js');
  if (has(/BABYLON\.|@babylonjs/)) engine.push('babylon.js');
  if (has(/new Phaser\.Game|from ['"]phaser['"]/)) engine.push('phaser');
  if (has(/PIXI\.|from ['"]pixi\.js['"]/)) engine.push('pixi.js');
  if (has(/\bkaboom\(|from ['"]kaboom['"]|from ['"]kaplay['"]/)) engine.push('kaboom');
  if (has(/\bengineInit\(|LittleJS/)) engine.push('littlejs');
  if (has(/\bme\.game\b|melonJS/)) engine.push('melonjs');
  if (/function setup\s*\(|function draw\s*\(/.test(all) && /createCanvas\(/.test(all)) engine.push('p5');
  if (!engine.length && /getContext\(\s*['"]2d['"]/.test(all)) engine.push('canvas-2d');
  if (!engine.length && /getContext\(\s*['"](webgl2?|experimental-webgl)['"]/.test(all)) engine.push('webgl');
  if (!engine.length) engine.push('dom');
  const threeD = engine.some((e) => ['three.js', 'babylon.js', 'webgl'].includes(e));

  const physics = [];
  for (const [re, name] of [[/matter-js|Matter\.Engine/, 'matter.js'], [/cannon(-es)?|CANNON\./, 'cannon'], [/@dimforge\/rapier|RAPIER\./, 'rapier'], [/planck|Box2D|box2d/, 'box2d/planck'], [/ammo\.js|Ammo\(/, 'ammo.js'], [/oimo/i, 'oimo'], [/\bOctree\b.*capsule|Capsule\b/i, 'three octree collisions']]) {
    if (has(re)) physics.push(name);
  }
  const customPhysics = /gravity/i.test(all) && /(dy|vy|velocity|\.vel)\b/i.test(all);

  const loop = {
    raf: count(all, /requestAnim(ation)?Frame|setAnimationLoop|\bticker\.add|scene\.registerBeforeRender|engine\.runRenderLoop/g),
    interval: count(all, /setInterval\s*\(/g),
    timeoutLoop: count(all, /setTimeout\s*\(/g),
  };
  const input = {
    keys: count(all, /['"]key(down|up|press)['"]|onkey(down|up|press)|\.key(down|up)\s*\(/gi),
    keyCode: count(all, /keyCode|\.which\b/g),
    mouse: count(all, /['"](mouse(down|up|move)|click|dblclick|wheel|contextmenu)['"]|onclick|\.click\s*\(/gi),
    pointer: count(all, /['"]pointer(down|up|move|cancel)['"]/g),
    touch: count(all, /['"]touch(start|move|end|cancel)['"]|ontouch/g),
    pointerLock: count(all, /requestPointerLock/g),
    gamepad: count(all, /getGamepads/g),
  };
  const camera = {
    perspective: count(all, /PerspectiveCamera/g),
    orthographic: count(all, /OrthographicCamera/g),
    followsHeading: /camera\.(rotation\.y|quaternion)\s*[=.]|camera\.lookAt\([^)]*(dir|heading|forward)/i.test(all),
    firstPerson: input.pointerLock > 0 || /first[-\s]?person|PointerLockControls|FirstPersonControls/i.test(all),
    twoDScroll: /(camera|viewport|cam)\.(x|y)\s*[+\-]?=|ctx\.translate\(/.test(all),
  };
  const storage = { localStorage: count(all, /localStorage/g), sessionStorage: count(all, /sessionStorage/g), indexedDB: count(all, /indexedDB/g), cookie: count(all, /document\.cookie/g) };
  const audio = { webAudio: count(all, /AudioContext/g), media: count(all, /new Audio\(|<audio|\.play\(\)/g), howler: count(everything, /Howl\b|howler/g), tone: count(all, /Tone\./g) };
  const network = {
    fetch: count(all, /\bfetch\s*\(/g), xhr: count(all, /XMLHttpRequest|\$\.(get|getJSON|ajax)\(/g), websocket: count(all, /new WebSocket\(/g),
    absolutePaths: [...new Set([...(indexText + all).matchAll(/(?:src|href)=["'](\/[^/"'][^"']*)["']|fetch\(\s*["'](\/[^/"'][^"']*)["']/g)].map((m) => m[1] ?? m[2]))].slice(0, 12),
    cdn: [...new Set([...indexText.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)["']/g)].map((m) => new URL(m[1]).host))],
  };
  const workers = count(all, /new (Shared)?Worker\(/g);
  const wasm = files.filter((f) => f.ext === '.wasm').length + count(all, /WebAssembly\./g);
  const dialogs = count(all, /\b(alert|confirm|prompt)\s*\(/g);
  const random = count(all, /Math\.random\(/g);
  const multiplayer = /socket\.io|peerjs|new RTCPeerConnection|colyseus|firebase/i.test(everything);
  const homiePackage = existsSync(join(dir, 'homie.json'));
  const houseApi = /@homie\/(tabletop|arcade)|\bhomie\.(ready|report|showPrivate|on\(|seats)|__homie\//.test(all);
  // Real time: a body moved by time (dt, velocity, speed × delta, a game loop); turn-based: moves on input only.
  const realtime = count(all, /\bdt\b|deltaTime|\bdelta\b|velocity|\.vel\b|\.vx\b|\.vy\b|\bvx\b|\bvy\b|speed\s*\*|mainLoop|gameLoop|getDelta\(|update\(\s*(dt|delta|step)/g);
  const boardWords = count(all, /\b(turn|board|grid|tile|cell|move\(\s*(direction|dir)|swipe)s?\b/gi);
  const turnBased = (loop.raf === 0 && loop.interval === 0) || (realtime <= 2 && boardWords >= 3);
  const timing = /\b(rhythm|beat|bpm|frame[-\s]?perfect|metronome)\b/i.test(all);
  const sideView = !threeD && /gravity/i.test(all) && /jump/i.test(all);
  const ammo = /bullet|projectile|missile|shoot|fire/i.test(all);

  // ---------------------------------------------------------------- grade
  const reasons = [];
  let grade = 'easy';
  const up = (to, why) => { const order = ['easy', 'medium', 'hard', 'not a fit']; if (order.indexOf(to) > order.indexOf(grade)) grade = to; reasons.push(`${to}: ${why}`); };
  if (!index) up('not a fit', 'no index.html: a studio game is a web page');
  if (multiplayer) up('not a fit', 'it already has its own networking (socket.io/peer/firebase): port its rules instead, or keep it on its own server');
  if (network.websocket) up('hard', 'it opens its own WebSocket: a server it depends on will not be there');
  if (wasm && /SharedArrayBuffer/.test(all)) up('not a fit', 'WebAssembly threads need cross-origin isolation, which the sandboxed play frame cannot give');
  if (totalBytes > 60 * 1024 * 1024) up('hard', `${Math.round(totalBytes / 1048576)} MB of files: every visitor downloads all of it (keep a game well under 30 MB)`);
  if (timing) up('hard', 'precise timing (rhythm/beat): every screen needs the same clock; run the beat from the room clock (net.now())');
  if (physics.length && !turnBased) up('hard', `fast physics (${physics.join(', ')}): the host simulates the world; each player owns only their own body`);
  if (threeD && !turnBased) up(physics.length ? 'hard' : 'medium', `real-time 3D (${engine.join(', ')}): camera rules, screen-relative input and a stable yaw are needed`);
  if (camera.followsHeading) up('medium', 'the camera turns with the character: it must stop (input on screen axes, yaw only on look input)');
  if (camera.firstPerson) up('medium', 'first person with pointer lock: phones need a look-drag and a stick, and hits need the host');
  if (!turnBased && !threeD) up(customPhysics ? 'medium' : 'easy', customPhysics ? 'real-time 2D with its own gravity/velocity: owner movement keeps jumps local, the host runs everything else' : 'real-time 2D movement: owner movement');
  if (turnBased) reasons.push('easy: turn-based or grid rules: the host runs the rules from intents (host movement); or a race where everyone plays the same seed');
  if (loc > 6000) up('hard', `${loc} lines of game code: huge state; find the few things other players must see`);
  else if (loc > 2500) up('medium', `${loc} lines of game code`);
  if (ammo && !turnBased) up('medium', 'projectiles and hits: the host decides every hit and carries projectiles in the snapshot');
  if (workers) up('medium', 'it starts Web Workers: a sandboxed frame (opaque origin) cannot load a worker script by URL; inline it or drop it');
  if (network.absolutePaths.length) up('medium', `absolute paths (${network.absolutePaths.slice(0, 3).join(', ')}): the game is served under /<id>/__game/, so every path must be relative`);
  if (grade === 'easy' && !reasons.length) reasons.push('easy: a small game with simple state');

  const movement = turnBased ? 'host' : 'owner';
  const view = turnBased ? 'board' : camera.firstPerson ? 'first-person' : sideView ? 'side' : 'top';
  const buildMode = pkg?.scripts?.build && Object.keys(deps).some((d) => /^(vite|webpack|parcel|rollup|esbuild|@sveltejs|next)/.test(d)) ? 'command'
    : scripts.some((s) => s.module) || indexText.includes('importmap') ? 'static'
      : 'static';

  const risks = [];
  if (storage.localStorage || storage.sessionStorage || storage.cookie) risks.push('storage: localStorage/cookies throw in the sandboxed frame; the port toolkit (homie-port.js / port/early) puts in-memory stand-ins first. High scores last for the visit.');
  if (storage.indexedDB) risks.push('indexedDB is blocked in the sandboxed frame: guard every open() or drop it.');
  if (dialogs) risks.push(`${dialogs} alert/confirm/prompt call(s): they block every browser in the room and the host's clock; replace with in-game text.`);
  if (audio.webAudio || audio.media || audio.howler) risks.push('audio: starts suspended; the toolkit resumes it on the first touch/key. Remove any "click to start sound" gate that blocks play.');
  if (input.keys && !input.touch && !input.pointer) risks.push('keyboard only: phones need the touch kit (a floating stick that presses the same keys, small buttons for actions).');
  if (input.mouse && !input.touch) risks.push('mouse input: map it to touch (tap/drag) explicitly; do not rely on emulated mouse events on phones.');
  if (input.pointer && /pointerId\s*[<>]=?\s*0|pointerId\s*===?\s*-1|=\s*-1\s*;?\s*\/\/.*(touch|pointer)/.test(all)) risks.push('a negative pointer id is used as "no finger": iOS Safari ids are negative half the time. Use null.');
  if (loop.raf === 0 && loop.interval > 0) risks.push('the loop runs on setInterval: keep the rules on the host, and make rendering follow snapshots.');
  if (random > 0 && !turnBased) risks.push(`${random} Math.random() call(s): randomness that changes the world must happen on the host only (replicas get the result in snapshots or keyed state).`);
  if (network.cdn.length) risks.push(`loads from other hosts (${network.cdn.join(', ')}): copy those files into the game so it cannot break when a CDN does.`);
  if (camera.perspective && !camera.firstPerson) risks.push('3D camera: verify the owner tests (hold 5 s: straight line, yaw < 10°; alternate 10 s: every press goes the pressed way).');
  if (/antialias\s*:\s*true/.test(all) && threeD) risks.push('MSAA (antialias: true) drew a black world on iPhone WebKit in a past port; turn it off on WebKit or everywhere.');
  if (ammo && !turnBased) risks.push('projectiles/hits: the host decides every hit (a shooter\'s claim may be checked against recent positions); projectiles ride the snapshot.');

  if (houseApi) risks.push('it is written for a shared TV screen with phone pads (a Homie package): on the web every browser is its own screen and there is no pad. Keep its rules, drive them from netplay seats, keys and the touch kit, and give it a page of its own (index.html that boots the rules and draws them).');
  if (houseApi) up('medium', 'written for a shared TV screen and phone pads: the rules are reusable, the seats and the screen are not');
  const licence = licenceOf(dir);
  if (!licence.file && homiePackage) { licence.kind = 'a Homie package (the house\'s own game; no licence file)'; licence.permissive = true; }
  if (!licence.permissive) risks.push(`licence: ${licence.kind}${licence.file ? ` (${licence.file})` : ''} — publish only what its licence allows; with no licence, do not publish it.`);

  return {
    ok: true, command: 'port plan', folder: dir, grade, reasons,
    facts: {
      files: files.length, bytes: totalBytes, loc, index, scripts: scripts.slice(0, 12), engine, physics, customPhysics, loop, input, camera, storage, audio,
      network, workers, wasm, dialogs, random, realtime, boardWords, turnBased, sideView, houseApi, package: pkg ? { name: pkg.name, scripts: Object.keys(pkg.scripts ?? {}), deps: Object.keys(deps).slice(0, 30) } : null,
    },
    recommend: { movement, view, build: buildMode },
    risks, licence,
  };
}

/** Copy a game into games/<id>/ as this studio's port of it. */
export function importPort(root, folder, id, { name, mode } = {}) {
  if (!GAME_ID.test(String(id ?? ''))) throw new Error('give the port an id: --id <lowercase-id> (letters, digits, hyphens)');
  const src = resolve(folder ?? '');
  if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`${src} is not a folder`);
  const dest = join(root, 'games', id);
  if (existsSync(dest)) throw new Error(`games/${id} already exists; pick another id`);
  const rel = relative(src, dest);
  if (!rel.startsWith('..') && rel !== '') throw new Error('the game folder cannot contain the studio');
  const plan = planPort(src);
  if (!plan.facts.index) throw new Error(`${src} has no index.html; nothing to port`);
  const buildMode = mode ?? plan.recommend.build;
  mkdirSync(dest, { recursive: true });
  const copied = [];
  const copy = (rel2 = '') => {
    for (const e of readdirSync(join(src, rel2), { withFileTypes: true })) {
      if (SKIP.has(e.name) || (buildMode !== 'command' && e.name === 'dist')) continue;
      const p = rel2 ? `${rel2}/${e.name}` : e.name;
      if (e.isDirectory()) { mkdirSync(join(dest, p), { recursive: true }); copy(p); }
      else if (e.isFile()) { cpSync(join(src, p), join(dest, p)); copied.push(p); }
    }
  };
  copy();
  // A static game needs index.html at its root (the Worker serves games/<id>/index.html).
  if (buildMode === 'static' && plan.facts.index !== 'index.html') throw new Error(`the game's page is ${plan.facts.index}; move it to the folder's root as index.html first`);
  const title = /<title>([^<]{1,80})<\/title>/i.exec(readFileSync(join(src, plan.facts.index), 'utf8'))?.[1]?.trim();
  const meta = {
    id,
    name: String(name ?? title ?? id).slice(0, 60),
    blurb: '',
    players: { min: 1, max: 8 },
    roundSeconds: 120,
    build: buildMode === 'command' ? { mode: 'command', command: 'npm run build', out: 'dist' } : { mode: buildMode },
    netplay: { v: 1, public: true, movement: plan.recommend.movement },
    port: { from: basename(src), licence: plan.licence.kind, licenceFile: plan.licence.file, grade: plan.grade, view: plan.recommend.view, at: new Date().toISOString() },
  };
  writeFileSync(join(dest, 'game.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const edits = [];
  if (buildMode === 'static') {
    const indexPath = join(dest, 'index.html');
    let html = readFileSync(indexPath, 'utf8');
    if (!/homie-port\.js/.test(html)) {
      const tag = '<script src="./homie-port.js"></script>';
      // First script in <head>, after a charset declaration if there is one.
      if (/<meta[^>]+charset[^>]*>/i.test(html)) html = html.replace(/<meta[^>]+charset[^>]*>/i, (m) => `${m}\n${tag}`);
      else html = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, (m) => `${m}\n${tag}`) : `${tag}\n${html}`;
      edits.push('index.html: loads ./homie-port.js first (sandbox shims, first-touch audio, window.HomiePort)');
    }
    const vp = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    if (/<meta[^>]+name=["']viewport["'][^>]*>/i.test(html)) {
      html = html.replace(/<meta[^>]+name=["']viewport["'][^>]*>/i, `<meta name="viewport" content="${vp}">`);
      edits.push('index.html: phone-safe viewport (no pinch-zoom under a thumb)');
    } else {
      html = /<meta[^>]+charset[^>]*>/i.test(html) ? html.replace(/<meta[^>]+charset[^>]*>/i, (m) => `${m}\n<meta name="viewport" content="${vp}">`) : html.replace(/<head([^>]*)>/i, (m) => `${m}\n<meta name="viewport" content="${vp}">`);
      edits.push('index.html: added a phone-safe viewport');
    }
    writeFileSync(indexPath, html);
  }
  return {
    ok: true, command: 'port import', id, dir: dest, from: src, mode: buildMode, files: copied.length, edits, plan: { grade: plan.grade, movement: plan.recommend.movement, view: plan.recommend.view },
    next: [
      `Write games/${id}/PORT.md: the grade and why, the movement mode, what the host owns, what each browser owns, bots, touch, camera.`,
      buildMode === 'static' ? 'Add the netplay layer as a script after the game\'s own (HomiePort.createRoom …), or an "entry" in game.json bundled to assets/main.js.' : 'Import \'@homie-rocks/studio/port/early\' first, then build the netplay layer with createRoom.',
      `npm run dev (in the background), then: npx --no-install homie-studio port check ${id} --url http://127.0.0.1:8787`,
    ],
  };
}
