/**
 * `homie-studio collision`: a model that can be drawn becomes a model that can be stood on, and stays that way.
 *
 *   homie-studio collision bake <game> <model.glb> [--cell 0.25] [--side top|under] [--max-y <m>]
 *   homie-studio collision check <game> [<model.glb>]
 *
 * Importing a model records what it looks like and where it came from. Nothing in that says where a figure may walk
 * on it, so the first playable version of a generated landmark is one figures fall through. `bake` reads the
 * model's triangles (every node's transform applied, in metres) and writes two files beside it:
 *
 *   <model>.collision.json   the height grid (@homie-rocks/heightfield MeshBake), the SHA-256 of the model file and
 *                            a checksum of its triangles, and three things a person AUTHORS and a re-bake keeps:
 *                            "proxies" (boxes, cylinders and ramps for what a figure walks around), "mover" (the
 *                            body that must fit: radius, height, step, arrival radius) and "routes" (ways a bot
 *                            should be able to walk, as lists of points)
 *   <model>.collision.svg    the plan at true scale (40 px to the metre, a metre grid, a scale bar): the grid shaded
 *                            by height, the proxies outlined, the routes drawn, and a mark where a route fails
 *
 * `check` is the gate: the model file is the one that was baked (a changed file is "stale: bake it again", by name),
 * the proxies are well formed, and a body of the mover's size both passes the static route check and walks every
 * route to its end. It answers ok: false with a row for each thing wrong, so it can stand in a build script.
 *
 * The game loads the JSON with `unpackBake` and `bakeField` and calls `bakeStale` against the mesh it loaded.
 *
 * The arithmetic is @homie-rocks/heightfield's, not a copy of it. It is not installed with the toolkit (a pinned
 * version of it that is not on npm yet would stop every new studio's install): the studio's own copy is used, else one
 * beside the toolkit, else the answer says the one install to run, which an AI with a shell runs itself.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { modelTools } from './optimise.mjs';
import { listGames } from './studio.mjs';

/** The body that must fit when a file names none: a person, in metres. */
export const DEFAULT_MOVER = Object.freeze({ radius: 0.35, height: 1.8, step: 0.3, maxDrop: 0.5, arrival: 1, speed: 4 });
const PX = 40;
/** How a walk that did not arrive reads in a sentence after "the bot". */
const ENDED = { fell: 'fell', blocked: 'was blocked', headroom: 'ran out of headroom', 'wrong level': 'reached the wrong level', timeout: 'ran out of time' };

/** @homie-rocks/heightfield's modules, from the studio's own install first, then from beside this toolkit. */
export async function heightfieldModules(root) {
  const names = ['MeshBake', 'Proxy', 'Levels', 'Route'];
  const from = [];
  if (root) { try { const req = createRequire(join(root, 'package.json')); from.push((n) => import(pathToFileURL(req.resolve(`@homie-rocks/heightfield/${n}.js`)).href)); } catch { /* not a package: the toolkit's own */ } }
  from.push((n) => import(`@homie-rocks/heightfield/${n}.js`));
  for (const load of from) {
    try { const [bake, proxy, levels, route] = await Promise.all(names.map(load)); if (bake.bakeMesh && route.traverse) return { ...bake, ...proxy, ...levels, ...route }; } catch { /* the next place */ }
  }
  return null;
}
const NEEDS = { ok: false, needs: 'heightfield', why: 'collision needs the package @homie-rocks/heightfield (0.2.0 or later, for its MeshBake module) in this studio, and found none', instead: 'npm install --save-exact @homie-rocks/heightfield   (in the studio folder; then ask again)' };

/** Every triangle of a model, in the scene's own space (each node's transform applied): { positions, indices }. */
export async function modelTriangles(bytes) {
  const { io } = await modelTools();
  const doc = await io.readBinary(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const positions = []; const indices = [];
  const scenes = doc.getRoot().listScenes();
  const scene = doc.getRoot().getDefaultScene() ?? scenes[0];
  if (!scene) return { positions: new Float32Array(0), indices: new Uint32Array(0) };
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      // 4 is TRIANGLES. Lines and points are not something to stand on; strips and fans are not what an optimiser writes.
      if (prim.getMode() !== 4) continue;
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const base = positions.length / 3; const el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, el);
        positions.push(m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12], m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13], m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14]);
      }
      const ix = prim.getIndices();
      if (ix) for (let i = 0; i < ix.getCount(); i += 1) indices.push(base + ix.getScalar(i));
      else for (let i = 0; i < pos.getCount(); i += 1) indices.push(base + i);
    }
  });
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * The plan at true scale, as SVG text: 40 px to the metre, north (-z) up. `problems` are points to mark.
 * A text file on purpose: it diffs, and a person can open it beside the lineup.
 */
export function collisionSvg(bake, { proxies = [], routes = [], problems = [], title = '' } = {}) {
  const { nx, nz, x0, z0, cell, heights, covered } = bake;
  const pad = 1; // metres of margin
  const w = ((nx - 1) * cell + pad * 2) * PX; const h = ((nz - 1) * cell + pad * 2) * PX + 30;
  const sx = (x) => ((x - x0 + pad) * PX).toFixed(1); const sz = (z) => ((z - z0 + pad) * PX).toFixed(1);
  let lo = Infinity; let hi = -Infinity;
  for (let k = 0; k < heights.length; k += 1) if (covered[k]) { lo = Math.min(lo, heights[k]); hi = Math.max(hi, heights[k]); }
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" font-family="system-ui, sans-serif" font-size="12">`,
    `<title>${esc(title || 'collision plan')}</title>`, `<rect width="100%" height="100%" fill="#101418"/>`];
  // Sixteen shades of height, runs of one shade along a row merged into one rectangle.
  for (let j = 0; j < nz; j += 1) {
    let run = -1; let shade = -1;
    const flush = (i) => { if (run >= 0) { const v = 60 + shade * 12; out.push(`<rect x="${sx(x0 + (run - 0.5) * cell)}" y="${sz(z0 + (j - 0.5) * cell)}" width="${((i - run) * cell * PX).toFixed(1)}" height="${(cell * PX).toFixed(1)}" fill="rgb(${v},${v + 8},${v + 14})"/>`); } run = -1; };
    for (let i = 0; i <= nx; i += 1) {
      const k = j * nx + i;
      const s = i < nx && covered[k] ? Math.min(15, Math.floor(((heights[k] - lo) / Math.max(1e-6, hi - lo)) * 16)) : -1;
      if (s !== shade) { flush(i); shade = s; if (s >= 0) run = i; }
    }
  }
  for (let x = Math.ceil(x0 - pad); x <= x0 + (nx - 1) * cell + pad; x += 1) out.push(`<line x1="${sx(x)}" y1="0" x2="${sx(x)}" y2="${(h - 30).toFixed(0)}" stroke="#ffffff" stroke-opacity="${x === 0 ? 0.35 : 0.08}"/>`);
  for (let z = Math.ceil(z0 - pad); z <= z0 + (nz - 1) * cell + pad; z += 1) out.push(`<line x1="0" y1="${sz(z)}" x2="${w.toFixed(0)}" y2="${sz(z)}" stroke="#ffffff" stroke-opacity="${z === 0 ? 0.35 : 0.08}"/>`);
  for (const p of proxies) {
    if (p.kind === 'cylinder') { out.push(`<circle cx="${sx(p.x)}" cy="${sz(p.z)}" r="${(p.r * PX).toFixed(1)}" fill="none" stroke="#ff7a59" stroke-width="2"><title>${esc(p.id ?? p.kind)}: ${p.h} m high</title></circle>`); continue; }
    const yaw = p.yaw ?? 0; const c = Math.cos(yaw); const s = Math.sin(yaw);
    const pts = [[-p.hx, -p.hz], [p.hx, -p.hz], [p.hx, p.hz], [-p.hx, p.hz]].map(([ax, az]) => `${sx(p.x + ax * c + az * s)},${sz(p.z - ax * s + az * c)}`).join(' ');
    out.push(`<polygon points="${pts}" fill="none" stroke="#ff7a59" stroke-width="2"${p.kind === 'ramp' ? ' stroke-dasharray="6 3"' : ''}><title>${esc(p.id ?? p.kind)}: ${p.h} m high</title></polygon>`);
  }
  for (const r of routes) out.push(`<polyline points="${(r.path ?? []).map((q) => `${sx(q.x)},${sz(q.z)}`).join(' ')}" fill="none" stroke="#5ec8ff" stroke-width="2"><title>${esc(r.name ?? 'route')}</title></polyline>`);
  for (const q of problems) out.push(`<circle cx="${sx(q.x)}" cy="${sz(q.z)}" r="7" fill="none" stroke="#ff3355" stroke-width="3"><title>${esc(q.why ?? '')}</title></circle>`);
  out.push(`<line x1="20" y1="${(h - 14).toFixed(0)}" x2="${20 + PX}" y2="${(h - 14).toFixed(0)}" stroke="#fff" stroke-width="3"/>`,
    `<text x="${28 + PX}" y="${(h - 10).toFixed(0)}" fill="#fff">1 m · ${esc(title)} · ${cell} m cell · heights ${Number.isFinite(lo) ? `${lo.toFixed(2)} to ${hi.toFixed(2)} m` : 'none'}</text>`, '</svg>');
  return `${out.join('\n')}\n`;
}

const gameDir = (root, id) => listGames(root).find((g) => g.id === id)?.dir ?? null;
/** Every file under a game's folder whose name passes `want`, sorted (no dot folders, no node_modules). */
function filesUnder(dir, want) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name.startsWith('.')) continue; const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (want(e.name)) out.push(p); } };
  walk(dir);
  return out.sort();
}
/** A model named on the command line: a path from the game's folder or from here, or a bare file name anywhere in the game. */
function modelPath(dir, file) {
  const direct = isAbsolute(file) ? file : [join(dir, file), resolve(file)].find((p) => existsSync(p));
  if (direct && existsSync(direct)) return direct;
  return file === basename(file) ? filesUnder(dir, (n) => n === file)[0] ?? null : null;
}
const sidecar = (model) => model.replace(/\.(glb|gltf)$/i, '') + '.collision.json';
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** Check one sidecar against its model: rows of { label, ok, note }, and the points where a route failed. */
async function checkOne(H, model, file) {
  const rows = []; const marks = [];
  const row = (label, ok, note = '') => rows.push({ label, ok, note });
  const side = readJson(file);
  if (!side || side.v !== 1 || !side.bake) { row('collision file', false, 'not a version 1 collision file: bake it again'); return { rows, marks, side: null, bake: null }; }
  let bake = null;
  try { bake = H.unpackBake(side.bake); } catch (e) { row('height grid', false, e.message); return { rows, marks, side, bake }; }
  if (!existsSync(model)) { row('model', false, `${basename(model)} is not beside its collision file`); return { rows, marks, side, bake }; }
  const bytes = readFileSync(model);
  if (sha256(bytes) === side.sha256) row('model', true, 'the file that was baked');
  else {
    // The file changed. Whether the SURFACE changed is the mesh checksum's question: a re-export with new textures
    // and the same triangles is still the same collider.
    const why = H.bakeStale(bake, await modelTriangles(bytes));
    row('model', !why, why ? `stale: ${why}` : 'the file changed, its triangles did not');
  }
  const proxies = Array.isArray(side.proxies) ? side.proxies : [];
  const bad = H.checkProxies(proxies);
  row('proxies', bad.length === 0, bad.length ? bad.join('; ') : `${proxies.length} authored`);
  const mover = { ...DEFAULT_MOVER, ...(side.mover ?? {}) };
  const world = H.createWorld({ ground: H.bakeField(bake), proxies: bad.length ? [] : proxies });
  const routes = Array.isArray(side.routes) ? side.routes : [];
  if (!routes.length) row('routes', true, 'none authored: add "routes" to the collision file to have a bot walk it');
  for (const r of routes) {
    const name = `route ${r.name ?? routes.indexOf(r) + 1}`;
    const path = Array.isArray(r.path) ? r.path : [];
    if (path.length < 2) { row(name, false, 'a route is { "name", "path": [{ "x", "y", "z" }, …] } with at least two points'); continue; }
    const found = H.checkRoute(world, path, mover);
    const run = H.traverse(world, path, mover);
    for (const p of found) marks.push({ x: p.at.x, z: p.at.z, why: `${name}: ${p.why}` });
    if (!run.ok) marks.push({ x: run.at.x, z: run.at.z, why: `${name}: the bot ${ENDED[run.why] ?? run.why} here` });
    const first = found[0];
    row(name, found.length === 0 && run.ok, found.length === 0 && run.ok ? `walked ${run.metres.toFixed(1)} m in ${run.seconds.toFixed(1)} s with a ${mover.arrival} m arrival radius`
      : [first ? `${first.part} ${first.index}: ${first.why} (at ${first.at.x.toFixed(2)}, ${first.at.z.toFixed(2)})${found.length > 1 ? ` and ${found.length - 1} more` : ''}` : null, run.ok ? null : `the bot ${ENDED[run.why] ?? run.why} at ${run.at.x.toFixed(2)}, ${run.at.z.toFixed(2)} heading for point ${run.index}`].filter(Boolean).join('; '));
  }
  return { rows, marks, side, bake };
}

/** `collision bake`: the grid, the checksums and the plan, beside the model. Authored proxies, mover and routes are kept. */
export async function collisionBake(root, id, file, { cell = 0.25, side = 'top', maxY, minY } = {}) {
  const command = 'collision bake';
  const dir = gameDir(root, id);
  if (!dir) return { ok: false, command, why: `no game ${id} in this studio` };
  const model = file ? modelPath(dir, file) : null;
  if (!model) return { ok: false, command, why: `which model? ${file ? `${file} is not in games/${id}` : `homie-studio collision bake ${id} <model.glb>`}` };
  if (!(Number(cell) > 0)) return { ok: false, command, why: '--cell is metres between posts, a positive number (0.25 suits a walkway)' };
  const H = await heightfieldModules(root);
  if (!H) return { ...NEEDS, command };
  const bytes = readFileSync(model);
  let bake;
  try { bake = H.bakeMesh(await modelTriangles(bytes), { cell: Number(cell), side: side === 'under' ? 'under' : 'top', ...(maxY !== undefined ? { maxY: Number(maxY) } : {}), ...(minY !== undefined ? { minY: Number(minY) } : {}) }); } catch (e) { return { ok: false, command, why: e.message }; }
  const out = sidecar(model);
  const before = readJson(out) ?? {};
  const doc = { v: 1, model: basename(model), sha256: sha256(bytes), bake: H.packBake(bake), proxies: Array.isArray(before.proxies) ? before.proxies : [], mover: { ...DEFAULT_MOVER, ...(before.mover ?? {}) }, routes: Array.isArray(before.routes) ? before.routes : [] };
  writeFileSync(out, `${JSON.stringify(doc)}\n`);
  const checked = await checkOne(H, model, out);
  const svg = out.replace(/\.json$/, '.svg');
  writeFileSync(svg, collisionSvg(bake, { proxies: doc.proxies, routes: doc.routes, problems: checked.marks, title: doc.model }));
  const cover = bake.covered.reduce((n, c) => n + c, 0);
  const rel = (p) => relative(root, p).split('\\').join('/');
  return {
    ok: true, command, game: id, model: rel(model), file: rel(out), plan: rel(svg), cell: bake.cell, posts: [bake.nx, bake.nz], covered: cover, triangles: bake.source.triangles, checksum: bake.source.checksum, rows: checked.rows,
    lines: [`Baked ${rel(model)}: ${bake.nx} x ${bake.nz} posts at ${bake.cell} m (${(bake.nx - 1) * bake.cell} m by ${(bake.nz - 1) * bake.cell} m), ${cover} over the model, from ${bake.source.triangles} triangles.`,
      `  ${rel(out)}  (authored "proxies", "mover" and "routes" in it are kept by a re-bake)`, `  ${rel(svg)}  the plan at true scale, 40 px to the metre`,
      ...checked.rows.map((r) => `  ${r.ok ? 'ok  ' : 'FAIL'} ${r.label}${r.note ? `: ${r.note}` : ''}`)],
  };
}

/** `collision check`: every collision file of a game (or one model's) against its model, its proxies and its routes. */
export async function collisionCheck(root, id, file) {
  const command = 'collision check';
  const dir = gameDir(root, id);
  if (!dir) return { ok: false, command, why: `no game ${id} in this studio` };
  const H = await heightfieldModules(root);
  if (!H) return { ...NEEDS, command };
  let files;
  if (file) { const model = modelPath(dir, file); if (!model || !existsSync(sidecar(model))) return { ok: false, command, why: `${file} has no collision file: homie-studio collision bake ${id} ${file}` }; files = [sidecar(model)]; }
  else files = filesUnder(dir, (n) => n.endsWith('.collision.json'));
  const rel = (p) => relative(root, p).split('\\').join('/');
  const models = []; const lines = [];
  for (const f of files) {
    const side = readJson(f);
    const model = join(dirname(f), side?.model ?? `${basename(f, '.collision.json')}.glb`);
    const one = await checkOne(H, model, f);
    if (one.bake) writeFileSync(f.replace(/\.json$/, '.svg'), collisionSvg(one.bake, { proxies: one.side?.proxies ?? [], routes: one.side?.routes ?? [], problems: one.marks, title: basename(model) }));
    models.push({ file: rel(f), ok: one.rows.every((r) => r.ok), rows: one.rows });
    lines.push(`${rel(f)}`, ...one.rows.map((r) => `  ${r.ok ? 'ok  ' : 'FAIL'} ${r.label}${r.note ? `: ${r.note}` : ''}`));
  }
  if (!files.length) lines.push(`No collision files in games/${id}. homie-studio collision bake ${id} <model.glb> makes one.`);
  const failed = models.filter((m) => !m.ok);
  return { ok: failed.length === 0, command, game: id, models, lines, ...(failed.length ? { why: `${lines.join('\n')}\n${failed.length} of ${models.length} collision file(s) need attention` } : {}) };
}

/** The CLI's `collision` command (bin/homie-studio.mjs hands it over whole). */
export async function collisionCommand(root, sub, positional, flags) {
  const id = positional[2] ?? (listGames(root).length === 1 ? listGames(root)[0].id : null);
  const usage = 'homie-studio collision bake <game> <model.glb> [--cell 0.25] [--side top|under] [--max-y <m>] | collision check <game> [<model.glb>]';
  if (!id || !['bake', 'check'].includes(sub)) return { ok: false, command: 'collision', why: usage };
  if (sub === 'check') return collisionCheck(root, id, positional[3]);
  return collisionBake(root, id, positional[3], { cell: flags.get('cell') ?? 0.25, side: flags.get('side') ?? 'top', maxY: flags.get('max-y'), minY: flags.get('min-y') });
}
