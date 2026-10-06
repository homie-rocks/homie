/**
 * ART DIRECTION AS DECISIONS: games/<id>/codex/decisions.json, one record per decision (render style,
 * palette, shape language, proportions, materials, light, camera, UI type, effects, references; then the cast and its
 * routes, library family, scale and budgets; the skeleton and animation standards; the in-game budgets).
 *
 * Every decision has an automatic pick with a one-line why (from the person's words, the codex and the genre), and four
 * states:
 *   auto      the AI's pick; the AI may change it freely
 *   steered   the person nudged it ("warmer"); the AI may refine within the nudge, never undo it
 *   pinned    locked by use: the first asset built on an auto decision pins it, so the automatic path stays coherent
 *   locked    frozen by the person; changing it needs `unlock` with a reason, and shows the blast radius first
 * Each change bumps the decision's `rev`; every asset records the revisions it was made under (assets/manifest.json
 * `made.under`), so a changed decision makes exactly those assets stale: listed and priced, never remade by itself.
 *
 * The file is private like CODEX.md: a static game's served copy skips the whole codex/ folder.
 * games/<id>/style.json (public, tiny) carries the palette and fonts a game, its landing and its title cards draw with.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HEX, deltaHex, hexToRgb, luminance, mix, nudge } from './colour.mjs';
import { CAMERAS, FAMILIES, FONT_SETS, GENRES, LIGHTS, MOODS, PALETTES, PALETTE_KEYS, RENDERS, SHAPES } from './style-presets.mjs';
import { readTheme } from './site.mjs';
import { GAME_ID, listGames } from './studio.mjs';

export const DECISIONS_FILE = join('codex', 'decisions.json');
export const STATES = Object.freeze(['auto', 'steered', 'pinned', 'locked']);
export const PHASES = Object.freeze([
  { id: 'style', label: 'Style' }, { id: 'cast', label: 'Cast' }, { id: 'rigs', label: 'Rigs' }, { id: 'animations', label: 'Animations' }, { id: 'game', label: 'In game' },
]);
const HISTORY_MAX = 20;
const now = () => new Date().toISOString();
const clean = (s, n = 200) => String(s ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, n);

/* ------------------------------------------------------------------ the context a pick reads */

/** What the automatic picks read: the person's words, the codex (its concept, art text and cards), the game. */
export function contextOf(root, id, { prompt = '' } = {}) {
  const dir = join(root, 'games', id);
  let codex = '';
  try { codex = readFileSync(join(dir, 'CODEX.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, ''); } catch { codex = ''; }
  let game = {};
  try { game = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8')); } catch { game = {}; }
  const fm = /^---\n([\s\S]*?)\n---/.exec(codex)?.[1] ?? '';
  const pal = {};
  for (const k of [...PALETTE_KEYS, 'panel']) { const m = new RegExp(`^\\s+${k}:\\s*"?(#[0-9a-fA-F]{3,6})"?`, 'm').exec(fm); if (m) pal[k] = m[1]; }
  const fonts = {};
  for (const k of ['display', 'body']) { const m = new RegExp(`^\\s+${k}:\\s*"([^"]+)"`, 'm').exec(fm); if (m && m[1].trim()) fonts[k] = m[1].trim(); }
  const section = (re) => { const m = new RegExp(`^##\\s+${re}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, 'im').exec(codex); return m ? m[1] : ''; };
  const cards = [];
  for (const [key, re] of [['characters', '(?:characters|cast|heroes|creatures|enemies)'], ['items', '(?:items|props|pickups|collectibles)'], ['places', '(?:world|places|setting|zones?|levels?)']]) {
    for (const m of section(re).matchAll(/^###\s+(.+?)\s*$/gm)) cards.push({ section: key, title: clean(m[1], 60) });
  }
  const words = [prompt, game.name, game.blurb, section('(?:concept|the game|pitch|overview)'), section('(?:art|look|style|visual)'), section('(?:world|setting)')].filter(Boolean).join(' \n ');
  const score = (re) => (words.match(new RegExp(re.source, 'gi')) ?? []).length;
  const genre = Object.entries(GENRES).map(([g, v]) => [g, score(v.words)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'party';
  const mood = Object.fromEntries(Object.entries(MOODS).map(([m, re]) => [m, score(re)]));
  let theme = {};
  try { theme = readTheme(root); } catch { theme = {}; }
  // A game made from a starter already draws with a style.json (its palette, fonts, light, camera, render style): the
  // automatic picks start from what it draws, so `style init` never repaints a working game behind its back.
  let drawn = null;
  try { const t = JSON.parse(readFileSync(join(dir, 'style.json'), 'utf8')); if (t?.palette?.bg && !existsSync(join(dir, DECISIONS_FILE))) drawn = t; } catch { drawn = null; }
  // The verbs its characters already play (a starter's clip libraries): the clip set starts from them.
  // And how tall its characters already stand (the median measured height): the proportions start from them.
  let clipVerbs = [];
  let castHeightM = null;
  try {
    const assets = JSON.parse(readFileSync(join(dir, 'assets', 'manifest.json'), 'utf8')).assets ?? [];
    // A verb counts when at least half the characters can play it: one generated hero's extra clip is its own, not
    // a verb the whole cast now lacks.
    const libs = new Map(assets.filter((a) => a.kind === 'clip').map((a) => [a.rig?.skeleton, (a.clips ?? []).map((c) => c.verb)]));
    const cast = assets.filter((a) => (a.kind === 'character' || a.kind === 'creature') && a.rig);
    const count = new Map();
    for (const a of cast) for (const v of libs.get(a.rig.skeleton) ?? a.rig.verbs ?? []) count.set(v, (count.get(v) ?? 0) + 1);
    clipVerbs = cast.length ? [...count].filter(([, n]) => n * 2 >= cast.length).map(([v]) => v) : [...new Set([...libs.values()].flat())];
    const hs = assets.filter((a) => a.kind === 'character' && Number(a.measured?.heightM) > 0).map((a) => Number(a.measured.heightM)).sort((a, b) => a - b);
    if (hs.length) castHeightM = Math.round(hs[Math.floor(hs.length / 2)] * 100) / 100;
  } catch { clipVerbs = []; }
  return { id, prompt: clean(prompt, 600), words, score, genre, mood, codexPalette: pal, codexFonts: fonts, theme, cards, players: Number(game.players?.max ?? game.netplay?.maxPlayers ?? 8) || 8, name: game.name ?? id, codexArt: clean(section('(?:art|look|style|visual)'), 400), drawn, clipVerbs, castHeightM };
}

/** The best match in a preset table by word score: [key, score] or null. */
function best(table, ctx, { skip = [] } = {}) {
  const scored = Object.entries(table).filter(([k]) => !skip.includes(k)).map(([k, v]) => [k, v.words ? ctx.score(v.words) : 0]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return scored[0] ?? null;
}
const said = (ctx, re) => (ctx.words.match(new RegExp(re.source, 'gi')) ?? []).slice(0, 3).map((w) => `"${w.toLowerCase()}"`).join(', ');

/* ------------------------------------------------------------------ values */

/** A palette value from a preset (or a person's own colours). */
export function paletteValue(name, over = {}) {
  const p = PALETTES[name] ?? PALETTES['meadow-morning'];
  const out = { name: PALETTES[name] ? name : 'custom', ...Object.fromEntries(PALETTE_KEYS.map((k) => [k, p[k]])), ramp: [...p.ramp] };
  for (const k of PALETTE_KEYS) if (HEX.test(String(over[k] ?? ''))) out[k] = over[k];
  return out;
}
const paletteLabel = (v) => (v?.name && PALETTES[v.name] ? PALETTES[v.name].label.split(':')[0] : 'Own colours') + (v?.steered ? ` (${v.steered})` : '');

/** Resolve a light preset's colour words ("mix:bg>#ffffff:0.35") against a palette. */
export function lightColours(light, palette) {
  const res = (s) => {
    if (HEX.test(String(s))) return s;
    const m = /^mix:(\w+)>(#[0-9a-f]{6}|\w+):([\d.]+)$/i.exec(String(s));
    if (m) return mix(palette[m[1]] ?? palette.bg, HEX.test(m[2]) ? m[2] : palette[m[2]] ?? palette.bg, Number(m[3]));
    return palette[s] ?? palette.bg;
  };
  return { sky: res(light.sky), ground: res(light.ground) };
}

function lightValue(key, palette) {
  const L = LIGHTS[key] ?? LIGHTS.morning;
  const { sky, ground } = lightColours(L, palette);
  return { time: LIGHTS[key] ? key : 'morning', key: L.key, intensity: L.intensity, hardness: L.hardness, sky, ground, fog: L.fog, shadows: L.shadows, toonSteps: L.toonSteps, bloom: L.bloom, tiltShift: L.tiltShift };
}
function cameraValue(key, over = {}) {
  const c = CAMERAS[key] ?? CAMERAS['high-3/4'];
  return { angle: CAMERAS[key] ? key : 'high-3/4', projection: c.projection, pitch: c.pitch, distance: c.distance, fov: c.fov, ...over };
}

/* ------------------------------------------------------------------ the catalogue */

/*
 * Each decision: its phase, the question it answers, what it depends on (the graph: a change makes everything that
 * depends on it, directly or not, worth a look), and its automatic pick: (ctx, picked) -> { value, label, why, options }.
 * `picked` holds the decisions picked before it in this order, so a palette can follow the render style.
 */
export const CATALOGUE = Object.freeze([
  ['style.render', 'style', 'How is the world drawn?', [], (ctx) => {
    if (ctx.drawn?.render && RENDERS[ctx.drawn.render]) return { value: ctx.drawn.render, label: RENDERS[ctx.drawn.render].label, why: 'what the game draws now (its style.json)', options: Object.entries(RENDERS).map(([k, v]) => ({ id: k, label: v.label, value: k })) };
    const hit = best(RENDERS, ctx);
    const key = hit?.[0] ?? 'lowpoly-flat';
    return { value: key, label: RENDERS[key].label, why: hit ? `your words ${said(ctx, RENDERS[key].words)}: ${RENDERS[key].note}` : `nothing named a look: ${RENDERS[key].note}`, options: Object.entries(RENDERS).map(([k, v]) => ({ id: k, label: v.label, value: k })) };
  }],
  ['style.palette', 'style', 'Which colours, and what is each one for?', ['style.render', 'style.light'], (ctx) => {
    if (ctx.drawn?.palette) { const v = paletteValue('custom', ctx.drawn.palette); v.ramp = Array.isArray(ctx.drawn.palette.ramp) && ctx.drawn.palette.ramp.length ? ctx.drawn.palette.ramp.filter((c) => HEX.test(String(c))) : rampFrom(v); return { value: v, label: 'The game\'s own colours', why: 'what the game draws now (its style.json)', options: paletteOptions(ctx) }; }
    const own = PALETTE_KEYS.filter((k) => ctx.codexPalette[k]).length >= 3 && !isStudioTheme(ctx.codexPalette, ctx.theme);
    if (own) {
      const v = paletteValue('custom', ctx.codexPalette);
      v.ramp = rampFrom(v);
      return { value: v, label: 'The codex\'s own colours', why: 'the Game Codex already names them', options: paletteOptions(ctx) };
    }
    const hit = best(PALETTES, ctx);
    const key = hit?.[0] ?? ({ gather: 'meadow-morning', brawl: 'candy-pop', race: 'desert-noon', rpg: 'heroic-dawn', shooter: 'space-ink', platformer: 'meadow-morning', party: 'candy-pop', puzzle: 'candy-pop', sports: 'meadow-morning' })[ctx.genre] ?? 'meadow-morning';
    return { value: paletteValue(key), label: paletteLabel({ name: key }), why: hit ? `your words ${said(ctx, PALETTES[key].words)}` : `a ${ctx.genre} game reads best in bright, separate colours`, options: paletteOptions(ctx) };
  }],
  ['style.shape', 'style', 'What shape language: round, angular or blocky?', ['style.render'], (ctx, p) => {
    const hit = best(SHAPES, ctx);
    const key = p['style.render'] === 'voxel' ? 'blocky' : hit?.[0] ?? (ctx.mood.tense > ctx.mood.cozy ? 'angular' : 'round');
    return { value: { language: key, bevel: SHAPES[key].bevel, silhouette: 'every character readable black on white at 64 px tall' }, label: SHAPES[key].label, why: hit ? `your words ${said(ctx, SHAPES[key].words)}: ${SHAPES[key].note}` : SHAPES[key].note, options: Object.entries(SHAPES).map(([k, v]) => ({ id: k, label: v.label, value: { language: k, bevel: v.bevel } })) };
  }],
  ['style.proportions', 'style', 'How tall are the characters, in heads and metres?', ['style.render', 'style.camera'], (ctx) => {
    const g = GENRES[ctx.genre] ?? GENRES.party;
    const cute = /\b(cute|chibi|tiny|little|baby)\b/i.test(ctx.words); const real = /\b(realistic|heroic|tall)\b/i.test(ctx.words);
    const heads = cute ? 2.5 : real ? 6.5 : g.heads;
    const heightM = ctx.castHeightM ?? (real ? 1.8 : g.heightM);
    const why = ctx.castHeightM ? `the characters it already has stand ${ctx.castHeightM} m` : cute || real ? 'your words' : `a ${ctx.genre} game seen from ${CAMERAS[g.camera].label.toLowerCase()}: big heads read on a phone`;
    return { value: { heads, heightM, hands: heads < 4 ? 'big' : 'normal' }, label: `${heads} heads tall, ${heightM} m`, why, options: [2.5, 4.5, 6.5].map((h) => ({ id: `h${h}`, label: `${h} heads`, value: { heads: h, heightM: h < 3 ? 0.9 : h < 5 ? 1.5 : 1.8, hands: h < 4 ? 'big' : 'normal' } })) };
  }],
  ['style.materials', 'style', 'What are surfaces made of: flat colour, a gradient atlas, painted pictures or PBR?', ['style.render', 'game.devices'], (ctx, p) => {
    if (ctx.drawn?.materials?.model) { const m = ctx.drawn.materials; return { value: { model: m.model, outline: Boolean(m.outline), texelDensity: m.texelDensity ?? null, atlas: Boolean(m.atlas) }, label: labelOf('style.materials', m), why: 'what the game draws now (its style.json)', options: [] }; }
    const r = RENDERS[p['style.render']] ?? RENDERS['lowpoly-flat'];
    const density = { flat: null, toon: 128, 'hand-painted': 256, pbr: 384, pixel: 32 }[r.materials] ?? null;
    return { value: { model: r.materials, outline: r.outline, texelDensity: density, atlas: r.materials === 'flat' }, label: `${({ flat: 'Flat palette colours', toon: 'Toon ramp', 'hand-painted': 'Hand-painted albedo', pbr: 'PBR metal and roughness', pixel: 'Pixel textures' })[r.materials]}${r.outline ? ', outlines' : ''}`, why: `follows the render style (${r.label}); phones: one material per asset`, options: [['flat', 'Flat palette colours'], ['toon', 'Toon ramp'], ['hand-painted', 'Hand-painted albedo'], ['pbr', 'PBR']].map(([k, l]) => ({ id: k, label: l, value: { model: k, outline: k === 'toon', texelDensity: null, atlas: k === 'flat' } })) };
  }],
  ['style.light', 'style', 'Where does the light come from, how hard, and what time of day?', ['style.render'], (ctx, p) => {
    if (ctx.drawn?.light?.time && LIGHTS[ctx.drawn.light.time]) { const base = lightValue(ctx.drawn.light.time, p['style.palette'] ?? paletteValue('meadow-morning')); return { value: { ...base, ...Object.fromEntries(Object.entries(ctx.drawn.light).filter(([k]) => k in base)) }, label: LIGHTS[ctx.drawn.light.time].label, why: 'what the game draws now (its style.json)', options: Object.entries(LIGHTS).map(([k, v]) => ({ id: k, label: v.label, value: k })) }; }
    const hit = best(LIGHTS, ctx);
    const palName = p['style.palette']?.name;
    const key = hit?.[0] ?? ({ 'moonlit-grove': 'night', 'neon-dusk': 'night', 'embers-night': 'night', 'desert-noon': 'noon', 'autumn-grove': 'golden', 'ash-dawn': 'overcast', 'space-ink': 'night' })[palName] ?? 'morning';
    return { value: lightValue(key, p['style.palette'] ?? paletteValue('meadow-morning')), label: LIGHTS[key].label, why: hit ? `your words ${said(ctx, LIGHTS[key].words)}` : 'fits the palette', options: Object.entries(LIGHTS).map(([k, v]) => ({ id: k, label: v.label, value: k })) };
  }],
  ['style.camera', 'style', 'Where does the camera sit?', [], (ctx) => {
    if (ctx.drawn?.camera?.angle && CAMERAS[ctx.drawn.camera.angle]) { const c = ctx.drawn.camera; return { value: cameraValue(c.angle, Object.fromEntries(['pitch', 'distance', 'fov', 'projection'].filter((k) => c[k] !== undefined).map((k) => [k, c[k]]))), label: CAMERAS[c.angle].label, why: 'what the game draws now (its style.json)', options: Object.entries(CAMERAS).map(([k, v]) => ({ id: k, label: v.label, value: k })) }; }
    const asked = /\btop[- ]?down\b/i.test(ctx.words) ? 'top-down' : /\biso(metric)?\b/i.test(ctx.words) ? 'iso' : /\bside[- ]?(on|scroll\w*|view)?\b/i.test(ctx.words) ? 'side' : /\b(chase|third[- ]person)\b/i.test(ctx.words) ? 'chase' : null;
    const key = asked ?? (GENRES[ctx.genre] ?? GENRES.party).camera;
    return { value: cameraValue(key), label: CAMERAS[key].label, why: asked ? 'your words' : `a ${ctx.genre} game: ${CAMERAS[key].note}`, options: Object.entries(CAMERAS).map(([k, v]) => ({ id: k, label: v.label, value: k })) };
  }],
  ['style.ui', 'style', 'Which fonts, icons and HUD shape?', ['style.render', 'style.shape'], (ctx, p) => {
    const r = RENDERS[p['style.render']] ?? RENDERS['lowpoly-flat'];
    const fonts = { display: ctx.codexFonts.display ?? ctx.drawn?.fonts?.display ?? r.fonts.display, body: ctx.codexFonts.body ?? ctx.drawn?.fonts?.body ?? r.fonts.body };
    const radius = p['style.shape']?.language === 'angular' ? 4 : p['style.shape']?.language === 'blocky' ? 8 : 14;
    return { value: { ...fonts, icons: p['style.render'] === 'pixel-hd2d' ? 'pixel' : 'filled', radius, hud: 'chips' }, label: `${fonts.display} and ${fonts.body}`, why: ctx.codexFonts.display ? 'the codex names the fonts' : ctx.drawn?.fonts?.display ? 'what the game draws now (its style.json)' : `Google Fonts (OFL) that suit ${r.label.toLowerCase()}`, options: Object.entries(FONT_SETS).map(([k, v]) => ({ id: k, label: `${v.display} / ${v.body}`, value: v })) };
  }],
  ['style.vfx', 'style', 'What do effects look like?', ['style.render', 'style.light'], (ctx, p) => {
    const r = RENDERS[p['style.render']] ?? RENDERS['lowpoly-flat'];
    return { value: { particles: r.vfx, hitFlash: true, trails: /\b(race|speed|dash)\b/i.test(ctx.words), glow: (p['style.light']?.bloom ?? 0) > 0.2 }, label: `${({ soft: 'Soft glows', toon: 'Toon shapes', pixel: 'Pixel squares' })[r.vfx]}`, why: `follows ${r.label.toLowerCase()}`, options: [['soft', 'Soft glows'], ['toon', 'Toon shapes'], ['pixel', 'Pixel squares']].map(([k, l]) => ({ id: k, label: l, value: { particles: k, hitFlash: true, trails: false, glow: k === 'soft' } })) };
  }],
  ['style.refs', 'style', 'Which references, in words, and which golden images?', [], (ctx) => {
    const like = [...ctx.prompt.matchAll(/\b(?:like|feels? like|inspired by)\s+([A-Za-z0-9 '’:-]{3,40})/gi)].map((m) => clean(m[1], 40));
    return { value: { words: like, golden: [] }, label: like.length ? like.join('; ') : 'None yet', why: like.length ? 'your words' : 'golden images come once the style is locked (two to six)', options: [] };
  }],

  ['cast.list', 'cast', 'Which assets does the game need?', ['style.render'], (ctx) => {
    const list = castFrom(ctx);
    return { value: list, label: `${list.length} assets`, why: ctx.cards.length ? 'one per codex card, plus what the genre needs' : `what a ${ctx.genre} game needs; the codex's cards replace it`, options: [] };
  }],
  ['cast.routes', 'cast', 'Where does each family of assets come from?', ['cast.family'], () => ({ value: { characters: 'library', creatures: 'library', props: 'library', environment: 'procedural', textures: 'procedural', skies: 'procedural' }, label: 'Library and procedural (free)', why: 'free routes first; generated only within an art budget, for what the library cannot cover', options: [] })],
  ['cast.family', 'cast', 'Which one starter library family?', ['style.render'], (ctx, p) => {
    const fam = RENDERS[p['style.render']]?.family ?? 'kenney';
    return { value: fam, label: FAMILIES[fam].label, why: `${FAMILIES[fam].note}; one family a game, so every piece fits`, options: Object.entries(FAMILIES).map(([k, v]) => ({ id: k, label: v.label, value: k })) };
  }],
  ['cast.scale', 'cast', 'Units, character height, grid and pivot?', ['style.proportions'], (ctx, p) => {
    const h = p['style.proportions']?.heightM ?? 1;
    return { value: { unit: 'm', characterHeightM: h, grid: 2, pivot: 'bottom centre, +Y up, facing +Z' }, label: `1 unit = 1 m; characters ${h} m; a 2 m grid`, why: 'one scale for every asset, so they stand together in the lineup', options: [] };
  }],
  ['cast.tiers', 'cast', 'What may each asset cost on a phone?', ['style.camera', 'game.devices'], (ctx) => {
    const big = ctx.players > 8;
    const v = { hero: { triangles: big ? 5000 : 8000, texturePx: 1024, kb: 1536, bones: 48 }, npc: { triangles: 3000, texturePx: 512, kb: 600, bones: 32 }, prop: { triangles: 1500, texturePx: 512, kb: 300 }, signature: { triangles: 5000, texturePx: 1024, kb: 800 }, kit: { triangles: 1000, texturePx: 512, kb: 200 }, scene: { drawCalls: 100, triangles: 150_000, textureMB: 48, firstPlayMB: 5 } };
    return { value: v, label: `hero ${v.hero.triangles.toLocaleString('en-US')} · prop 1,500 · scene 150k triangles, 100 draws, 48 MB textures, 5 MB shipped payload`, why: `phone first${big ? `; rooms of ${ctx.players} make heroes lighter` : ''}`, options: [] };
  }],
  ['cast.variation', 'cast', 'How many looks per character from one model?', [], (ctx) => ({ value: { paletteSwaps: Math.min(4, Math.max(2, ctx.players)), partSwaps: false, decals: false }, label: '4 palette swaps of the hero', why: 'team colours without another model', options: [] })],

  ['rig.skeleton', 'rigs', 'Which skeleton standard?', [], (ctx) => {
    const beast = /\b(fox(es)?|cats?|dogs?|wolf|wolves|bears?|horses?|deer|rabbits?|bunn(y|ies)|animals?|pets?|creatures?|dragons?)\b/i.test(ctx.words);
    return { value: beast ? 'quadruped' : 'humanoid', label: beast ? 'Per-species (four legs)' : 'Homie humanoid (VRM names, Mixamo in)', why: beast ? `your characters are animals (${said(ctx, /\b(fox(es)?|cats?|dogs?|wolf|wolves|bears?|horses?|deer|rabbits?|bunn(y|ies)|animals?|pets?|creatures?|dragons?)\b/i)})` : 'people: one humanoid vocabulary shares one clip library', options: [{ id: 'humanoid', label: 'Humanoid', value: 'humanoid' }, { id: 'quadruped', label: 'Quadruped', value: 'quadruped' }, { id: 'none', label: 'None', value: 'none' }] };
  }],
  ['rig.source', 'rigs', 'Where do rigs come from?', ['rig.skeleton'], () => ({ value: 'library', label: 'The library\'s rigs', why: 'free; a character the library cannot cover can be generated with its rig on your fal account (the models skill)', options: [] })],
  ['rig.bones', 'rigs', 'How many bones?', ['cast.tiers', 'style.camera'], () => ({ value: { hero: 48, npc: 32, fingers: false, influences: 4 }, label: '48 a hero, 32 an NPC, 4 influences', why: 'three.js reads 4 influences; fingers only for close cameras', options: [] })],
  ['rig.sockets', 'rigs', 'Where do held things attach?', [], () => ({ value: ['hand.R', 'hand.L', 'head', 'back'], label: 'hand.R, hand.L, head, back', why: 'the standard set', options: [] })],
  ['rig.face', 'rigs', 'How do faces move?', ['style.camera'], () => ({ value: 'none', label: 'None (phones)', why: 'a face is a few pixels on a phone at this camera', options: [] })],

  ['anim.style', 'animations', 'How does motion feel?', ['style.render'], (ctx, p) => {
    const k = p['style.render'] === 'pixel-hd2d' ? 'stepped' : ctx.genre === 'rpg' ? 'grounded' : 'snappy';
    return { value: k, label: ({ snappy: 'Snappy cartoon', grounded: 'Grounded, stylised', stepped: 'Stepped (pixel)' })[k], why: `a ${ctx.genre} game`, options: [] };
  }],
  ['anim.clips', 'animations', 'Which clips each role needs?', [], (ctx) => (ctx.clipVerbs?.length
    ? { value: ctx.clipVerbs, label: ctx.clipVerbs.join(', '), why: 'the clips its characters already play', options: [] }
    : { value: (GENRES[ctx.genre] ?? GENRES.party).clips, label: (GENRES[ctx.genre] ?? GENRES.party).clips.join(', '), why: `the verbs of a ${ctx.genre} game`, options: [] })],
  ['anim.source', 'animations', 'Where do clips come from?', ['anim.clips'], () => ({ value: 'library', label: 'Library clips, retargeted', why: 'free CC0 clips, retargeted onto every skeleton; text-to-motion is not offered (the models available are non-commercial in effect)', options: [] })],
  ['anim.motion', 'animations', 'In place or root motion?', [], () => ({ value: { root: 'in-place', fps: 30 }, label: 'In place, 30 fps', why: 'the host moves bodies; clips never do (netplay)', options: [] })],
  ['anim.blend', 'animations', 'Crossfades and layers?', ['anim.style'], (ctx, p) => ({ value: { crossfadeS: p['anim.style'] === 'grounded' ? 0.25 : 0.12, upperBody: true, additiveHits: true }, label: p['anim.style'] === 'grounded' ? '0.25 s crossfades' : '0.12 s crossfades', why: 'follows the motion style', options: [] })],
  ['anim.procedural', 'animations', 'Which procedural layers?', ['style.camera'], (ctx) => ({ value: { lookAt: true, footIK: false, springs: /\b(tail|cape|hair|fox|ears?)\b/i.test(ctx.words), lean: true, squash: true }, label: 'Look-at, lean, squash; springs on tails and capes', why: 'cheap life on top of clips; foot planting off at this camera', options: [] })],

  ['game.devices', 'game', 'Which devices set the budgets?', [], () => ({ value: { phone: 1, computer: 2 }, label: 'Phone first; computers get 2x', why: 'every Homie game plays on phones', options: [] })],
  ['game.lod', 'game', 'Levels of detail and crowds?', ['game.devices'], (ctx) => ({ value: { lod1At: 18, crowd: ctx.players > 8 ? 'instanced biped beyond 18 m' : 'off' }, label: ctx.players > 8 ? 'Crowd mode for far players' : 'One level of detail', why: ctx.players > 8 ? `rooms of ${ctx.players}` : 'small rooms', options: [] })],
  ['game.shadows', 'game', 'Shadows?', ['game.devices', 'style.light'], () => ({ value: { phone: 'blob', computer: 'real' }, label: 'Blob on phones, real on computers', why: 'shadow maps cost a phone a whole pass', options: [] })],
  ['game.feel', 'game', 'The Game Lab tunables for feel?', ['anim.style'], () => ({ value: { hitStopMs: 70, crossfadeS: 0.12, lean: 0.25 }, label: 'Defaults from the motion style', why: 'tuned side by side in the Game Lab', options: [] })],
]);
export const CATALOGUE_IDS = CATALOGUE.map(([id]) => id);
const CAT = new Map(CATALOGUE.map(([id, phase, question, dependsOn, pick]) => [id, { id, phase, question, dependsOn, pick }]));

/**
 * A codex palette that is only the studio's site colours (what `codex new` copies in) is not the game's own: the
 * automatic pick reads the person's words instead.
 */
function isStudioTheme(p, theme = {}) {
  const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
  return (same(p.bg, theme.bg ?? '#0b0c12') && same(p.ink, theme.fg ?? '#f1f3f9')) || (same(p.bg, '#0b0c12') && same(p.accent, '#ffcf5a'));
}

function paletteOptions(ctx) {
  const scored = Object.entries(PALETTES).map(([k, v]) => [k, ctx.score(v.words)]).sort((a, b) => b[1] - a[1]);
  return scored.slice(0, 6).map(([k]) => ({ id: k, label: PALETTES[k].label, value: paletteValue(k) }));
}

/** A 12-colour ramp from a palette's seven: each, and a darker and lighter step of the main three. */
function rampFrom(p) {
  const out = PALETTE_KEYS.map((k) => p[k]).filter((c) => HEX.test(String(c)));
  for (const k of ['bg', 'accent', 'accent2']) if (HEX.test(String(p[k]))) out.push(nudge(p[k], { light: -0.15 }), nudge(p[k], { light: 0.15 }));
  return [...new Set(out)].slice(0, 16);
}

/** The cast a game needs: the codex's cards first, then the genre's starter list, named from the person's words. */
function castFrom(ctx) {
  const out = [];
  const add = (id, card, kind, tier, heightM) => { if (!out.some((x) => x.id === id)) out.push({ id, card, kind, tier, heightM }); };
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'asset';
  for (const c of ctx.cards) add(slug(c.title), `${c.section === 'characters' ? 'Characters' : c.section === 'items' ? 'Items' : 'Places'}/${c.title}`, c.section === 'characters' ? 'character' : c.section === 'items' ? 'prop' : 'kit', c.section === 'characters' ? 'hero' : c.section === 'items' ? 'prop' : 'kit', c.section === 'characters' ? 1 : c.section === 'items' ? 0.5 : 2);
  const w = ctx.words.toLowerCase();
  const who = /\b(fox(es)?|cats?|dogs?|bears?|rabbits?|bunn(y|ies)|frogs?|penguins?|robots?|knights?|wizards?|pirates?|aliens?|ninjas?|monkeys?|ducks?|pigs?)\b/.exec(w)?.[0];
  const what = /\b(berr(y|ies)|gems?|coins?|stars?|apples?|mushrooms?|acorns?|crystals?|eggs?|fish|cakes?|crowns?|flags?|orbs?)\b/.exec(w)?.[0];
  const sing = (s) => s.replace(/ies$/, 'y').replace(/(xes|ches|shes)$/, (m) => m.slice(0, -2)).replace(/s$/, '');
  if (!out.some((x) => x.kind === 'character')) add(who ? sing(who) : 'player', `Characters/${who ? sing(who)[0].toUpperCase() + sing(who).slice(1) : 'Player'}`, 'character', 'hero', 1);
  if (what && !out.some((x) => x.kind === 'prop' && x.id.startsWith(sing(what)))) add(sing(what), `Items/${sing(what)[0].toUpperCase() + sing(what).slice(1)}`, 'prop', 'prop', 0.4);
  const places = { forest: ['tree', 'bush', 'rock', 'mushroom'], desert: ['cactus', 'rock', 'dune'], sea: ['rock', 'palm', 'boat'], ocean: ['rock', 'palm', 'boat'], space: ['crate', 'antenna', 'rock'], dungeon: ['wall', 'pillar', 'chest'], city: ['building', 'lamp', 'crate'], snow: ['pine', 'rock', 'snowman'] };
  const place = Object.keys(places).find((p) => w.includes(p)) ?? (ctx.genre === 'gather' ? 'forest' : null);
  for (const p of place ? places[place] : ['rock', 'crate']) add(p, `Places/${p[0].toUpperCase() + p.slice(1)}`, 'prop', 'prop', p === 'tree' || p === 'pine' || p === 'palm' || p === 'building' ? 3 : 0.8);
  add('ground', 'Places/Ground', 'environment', 'kit', 0);
  return out.slice(0, 40);
}

/* ------------------------------------------------------------------ the file */

const fileOf = (root, id) => join(root, 'games', id, DECISIONS_FILE);

function gameDirOf(root, id) {
  if (!GAME_ID.test(String(id ?? ''))) throw new Error(`"${id}" is not a game id`);
  const dir = join(root, 'games', id);
  if (!existsSync(join(dir, 'game.json')) && !existsSync(join(dir, 'CODEX.md'))) throw new Error(`no game "${id}" (no games/${id}/game.json or CODEX.md)${listGames(root).length ? `; games: ${listGames(root).map((g) => g.id).join(', ')}` : ''}`);
  return dir;
}

export function readDecisions(root, id) {
  const file = fileOf(root, id);
  if (!existsSync(file)) return null;
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  if (doc?.v !== 1 || typeof doc.decisions !== 'object') throw new Error(`games/${id}/${DECISIONS_FILE} is not a decisions file (v 1)`);
  return doc;
}

/** Write it (atomically), and keep games/<id>/style.json in step. */
export function writeDecisions(root, id, doc) {
  const file = fileOf(root, id);
  mkdirSync(dirname(file), { recursive: true });
  doc.derived = { ...(doc.derived ?? {}), prompt: derivedPrompt(doc) };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(tmp, file);
  writeStyleTokens(root, id, doc);
  return doc;
}

/** games/<id>/style.json: the palette and fonts the game, its landing and its title cards draw with (public). */
export function styleTokens(doc) {
  const p = doc?.decisions?.['style.palette']?.value;
  const ui = doc?.decisions?.['style.ui']?.value;
  const light = doc?.decisions?.['style.light']?.value;
  const cam = doc?.decisions?.['style.camera']?.value;
  if (!p) return null;
  return {
    v: 1,
    palette: Object.fromEntries([...PALETTE_KEYS.map((k) => [k, p[k]]), ['ramp', p.ramp ?? []]]),
    fonts: ui ? { display: ui.display, body: ui.body } : null,
    light: light ? { time: light.time, key: light.key, intensity: light.intensity, hardness: light.hardness, sky: light.sky, ground: light.ground, fog: light.fog, bloom: light.bloom } : null,
    camera: cam ? { angle: cam.angle, projection: cam.projection, pitch: cam.pitch, distance: cam.distance, fov: cam.fov } : null,
    render: doc.decisions['style.render']?.value ?? null,
    materials: doc.decisions['style.materials']?.value ?? null,
    rev: Object.fromEntries(['style.palette', 'style.ui', 'style.light', 'style.camera'].map((k) => [k, doc.decisions[k]?.rev ?? 0])),
  };
}
function writeStyleTokens(root, id, doc) {
  const t = styleTokens(doc);
  if (!t) return;
  const file = join(root, 'games', id, 'style.json');
  const text = `${JSON.stringify(t, null, 2)}\n`;
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
}

/**
 * A record's change: set the state, append to its history (newest last, at most 20). The rev moves only when the VALUE
 * changes: a lock or a pin keeps every asset made under it current.
 */
function change(rec, patch, { by = 'ai', words = null, reason = null } = {}) {
  const at = now();
  const moved = Object.hasOwn(patch, 'value') && JSON.stringify(patch.value) !== JSON.stringify(rec.value);
  Object.assign(rec, patch, { rev: (rec.rev ?? 0) + (moved || !rec.rev ? 1 : 0), at, by });
  rec.history = [...(rec.history ?? []), { rev: rec.rev, state: rec.state, by, label: rec.label, ...(patch.steer ? { steer: patch.steer.at(-1) } : {}), ...(words ? { words: clean(words) } : {}), ...(reason ? { reason: clean(reason) } : {}), at }].slice(-HISTORY_MAX);
  return rec;
}

/**
 * `style init`: fill every decision with its automatic pick (state auto) from the person's words, the codex and the
 * genre. A decision the person steered or locked, or that an asset pinned, is never re-picked.
 */
export function initDecisions(root, id, { prompt = '', path = null, budget = null } = {}) {
  gameDirOf(root, id);
  const ctx = contextOf(root, id, { prompt });
  const doc = readDecisions(root, id) ?? { v: 1, scope: 'game', game: id, path: path ?? 'automatic', budget: null, prompt: '', decisions: {}, board: null, golden: [] };
  if (path) doc.path = path === 'hands-on' ? 'hands-on' : 'automatic';
  if (budget !== null && budget !== undefined) doc.budget = { usd: Math.max(0, Number(budget) || 0), provider: 'fal', approvedBy: 'the person, in chat', at: now() };
  if (prompt) doc.prompt = clean(prompt, 600);
  // Run again without words (to set a budget, or after the codex grew), it reads the words it was first given.
  if (!prompt && doc.prompt) ctx.prompt = doc.prompt;
  if (!prompt && doc.prompt) { const again = contextOf(root, id, { prompt: doc.prompt }); Object.assign(ctx, again); }
  const picked = {};
  const kept = [];
  const made = [];
  for (const [did] of CATALOGUE) {
    const def = CAT.get(did);
    const rec = doc.decisions[did];
    // Kept: anything the person steered or locked, anything pinned, and what a starter's style.json already draws.
    if (rec && (rec.state !== 'auto' || /^what the game draws now/.test(String(rec.why ?? '')))) { picked[did] = rec.value; kept.push(did); continue; }
    const pick = def.pick(ctx, picked);
    picked[did] = pick.value;
    if (rec && JSON.stringify(rec.value) === JSON.stringify(pick.value)) continue;
    const next = rec ?? { phase: def.phase, question: def.question, state: 'auto', by: 'ai', steer: [], rev: 0, dependsOn: def.dependsOn, history: [] };
    change(next, { value: pick.value, label: pick.label, why: pick.why, options: (pick.options ?? []).slice(0, 8), state: 'auto', phase: def.phase, question: def.question, dependsOn: def.dependsOn }, { by: 'ai' });
    doc.decisions[did] = next;
    made.push(did);
  }
  writeDecisions(root, id, doc);
  return { ok: true, command: 'style init', id, picked: made, kept, genre: ctx.genre, summary: oneLine(doc), file: `games/${id}/${DECISIONS_FILE}` };
}

/** The one line the automatic path says: "Look: flat low-poly, autumn grove palette, high three-quarter camera". */
export function oneLine(doc) {
  const d = doc.decisions;
  return `Look: ${(d['style.render']?.label ?? '?').toLowerCase()}, ${(d['style.palette']?.label ?? '?').toLowerCase()} palette, ${(d['style.light']?.label ?? '?').toLowerCase()}, ${(d['style.camera']?.label ?? '?').toLowerCase()} camera, ${d['style.ui']?.label ?? ''}`;
}

/** Everything that depends on `id`, directly or not (the decisions it drives). */
export function drives(doc, id) {
  const out = new Set();
  const walk = (x) => { for (const [k, rec] of Object.entries(doc.decisions)) if ((rec.dependsOn ?? CAT.get(k)?.dependsOn ?? []).includes(x) && !out.has(k)) { out.add(k); walk(k); } };
  walk(id);
  return [...out];
}

/** The value a person typed or tapped for a decision: an option's id, JSON, a preset name, or plain words. */
function valueFrom(id, rec, input) {
  if (input && typeof input === 'object') return { value: input, label: null };
  const s = String(input ?? '').trim();
  const opt = (rec.options ?? []).find((o) => o.id === s || o.label.toLowerCase() === s.toLowerCase());
  if (opt) return { value: id === 'style.light' ? lightValue(opt.value, docPalette) : id === 'style.camera' ? cameraValue(opt.value) : id === 'style.palette' && typeof opt.value === 'string' ? paletteValue(opt.value) : opt.value, label: opt.label };
  if (/^[[{]/.test(s)) { try { return { value: JSON.parse(s), label: null }; } catch { throw new Error(`${id}: not JSON: ${s.slice(0, 80)}`); } }
  if (id === 'style.render' && RENDERS[s]) return { value: s, label: RENDERS[s].label };
  if (id === 'style.palette' && PALETTES[s]) return { value: paletteValue(s), label: paletteLabel({ name: s }) };
  if (id === 'style.light' && LIGHTS[s]) return { value: lightValue(s, docPalette), label: LIGHTS[s].label };
  if (id === 'style.camera' && CAMERAS[s]) return { value: cameraValue(s), label: CAMERAS[s].label };
  if (id === 'cast.family' && FAMILIES[s]) return { value: s, label: FAMILIES[s].label };
  if (id === 'style.shape' && SHAPES[s]) return { value: { language: s, bevel: SHAPES[s].bevel, silhouette: rec.value?.silhouette }, label: SHAPES[s].label };
  if (id === 'style.ui' && FONT_SETS[s]) return { value: { ...rec.value, ...FONT_SETS[s] }, label: `${FONT_SETS[s].display} and ${FONT_SETS[s].body}` };
  return { value: s, label: s };
}
let docPalette = paletteValue('meadow-morning');

/** A label for a value the catalogue did not label. */
export function labelOf(id, value) {
  const v = value ?? {};
  if (id === 'style.palette') return paletteLabel(value);
  if (id === 'style.render') return RENDERS[value]?.label ?? String(value);
  if (id === 'style.light') return `${LIGHTS[v.time]?.label ?? 'Own light'}${v.hardness !== undefined && LIGHTS[v.time] && Math.abs(v.hardness - LIGHTS[v.time].hardness) > 0.01 ? (v.hardness > LIGHTS[v.time].hardness ? ', harder shadows' : ', softer shadows') : ''}`;
  if (id === 'style.camera') return `${CAMERAS[v.angle]?.label ?? 'Own camera'}${v.distance && CAMERAS[v.angle] && Math.abs(v.distance - CAMERAS[v.angle].distance) > 0.01 ? `, ${v.distance} m away` : ''}${v.pitch && CAMERAS[v.angle] && Math.abs(v.pitch - CAMERAS[v.angle].pitch) > 0.01 ? `, ${Math.round(v.pitch)}° down` : ''}`;
  if (id === 'style.ui' && v.display) return `${v.display} and ${v.body}`;
  if (id === 'style.shape' && v.language) return `${SHAPES[v.language]?.label ?? v.language}${v.bevel !== undefined && SHAPES[v.language] && Math.abs(v.bevel - SHAPES[v.language].bevel) > 0.01 ? (v.bevel > SHAPES[v.language].bevel ? ', chunkier bevels' : ', crisper edges') : ''}`;
  if (id === 'style.materials' && v.model) return `${({ flat: 'Flat palette colours', toon: 'Toon ramp', 'hand-painted': 'Hand-painted albedo', pbr: 'PBR metal and roughness', pixel: 'Pixel textures' })[v.model] ?? v.model}${v.outline ? ', outlines' : ''}`;
  if (id === 'style.proportions' && v.heads) return `${v.heads} heads tall, ${v.heightM} m`;
  if (id === 'style.vfx' && v.particles) return `${({ soft: 'Soft glows', toon: 'Toon shapes', pixel: 'Pixel squares' })[v.particles] ?? v.particles}${v.glow ? ', glow' : ''}`;
  if (id === 'cast.family') return FAMILIES[value]?.label ?? String(value);
  if (typeof value === 'string') return value.slice(0, 60);
  return JSON.stringify(value).slice(0, 60);
}

/**
 * Set one decision. `by`: 'ai' or 'person'. The rules:
 *   - a locked decision changes only with `unlock: true` and a `reason`; without `confirm: true` nothing changes and
 *     the answer is the blast radius (what would go stale, and what remaking it would cost);
 *   - the AI changes a pinned decision only while no paid asset depends on it (else: ask the person);
 *   - a person's change makes it steered; the AI's keeps it auto.
 * `manifest` (the game's assets/manifest.json) prices the blast radius.
 */
export function setDecision(root, id, did, input, { by = 'ai', why = null, words = null, unlock = false, reason = null, confirm = false, manifest = null } = {}) {
  const doc = readDecisions(root, id);
  if (!doc) throw new Error(`games/${id} has no decisions yet: homie-studio style init ${id}`);
  const rec = doc.decisions[did];
  if (!rec) throw new Error(`no decision "${did}" (${CATALOGUE_IDS.slice(0, 10).join(', ')}, …)`);
  docPalette = doc.decisions['style.palette']?.value ?? docPalette;
  const { value, label } = valueFrom(did, rec, input);
  if (rec.state === 'locked') {
    if (!unlock) return { ok: false, command: 'style set', id, decision: did, locked: true, why: `${did} is locked (${rec.label}${rec.by === 'person' ? ', by the person' : ''}): change it only with --unlock and a reason, after the person sees what goes stale` };
    if (!reason) return { ok: false, command: 'style set', id, decision: did, locked: true, why: 'a locked decision changes only with a reason: --reason "<what the person asked for>"' };
    const blast = blastRadius(doc, did, manifest, { to: label ?? labelOf(did, value) });
    if (!confirm) return { ok: true, command: 'style set', id, decision: did, pending: true, blast, why: 'Nothing changed yet: this is what would go stale. It changes only once the person says yes (confirm), and nothing is remade by itself.' };
    change(rec, { value, label: label ?? labelOf(did, value), why: why ?? `the person changed it: ${clean(reason)}`, state: 'locked' }, { by: 'person', reason });
    writeDecisions(root, id, doc);
    addLatestLine(root, id, `Changed the locked ${humanName(did)} to ${rec.label} (${clean(reason, 120)}). ${blast.assets.length ? `${blast.assets.length} asset${blast.assets.length === 1 ? '' : 's'} made under the old one ${blast.assets.length === 1 ? 'is' : 'are'} stale; none was remade.` : 'Nothing was made under the old one.'}`);
    return { ok: true, command: 'style set', id, decision: did, changed: true, blast: blastRadius(readDecisions(root, id), did, manifest), record: rec };
  }
  if (rec.state === 'pinned' && by !== 'person') {
    const paid = (manifest?.assets ?? []).filter((a) => a.made?.under?.[did] !== undefined && ['generated', 'premium'].includes(a.route));
    if (paid.length) return { ok: false, command: 'style set', id, decision: did, pinned: true, why: `${did} is pinned by ${paid.length} paid asset(s) (${paid.map((a) => a.id).join(', ')}): ask the person first; their yes changes it with --by person` };
  }
  if (rec.state === 'steered' && by !== 'person' && !rec.steer?.length) { /* a steer without words: the AI may refine */ }
  const state = by === 'person' ? (rec.state === 'pinned' ? 'pinned' : 'steered') : rec.state === 'pinned' ? 'auto' : rec.state;
  change(rec, { value, label: label ?? labelOf(did, value), why: why ?? (by === 'person' ? 'the person chose it' : rec.why), state }, { by, words });
  if (did === 'style.palette' && doc.decisions['style.light']?.state === 'auto') {
    const L = doc.decisions['style.light'];
    const relit = lightValue(L.value.time, rec.value);
    if (JSON.stringify(relit) !== JSON.stringify(L.value)) change(L, { value: relit, state: 'auto' }, { by: 'ai' });
  }
  writeDecisions(root, id, doc);
  return { ok: true, command: 'style set', id, decision: did, changed: true, record: rec, stale: staleAssets(doc, manifest).map((s) => s.id) };
}

/**
 * Steer: the person's words, applied where the vocabulary knows them ("warmer", "less saturated", "golden hour",
 * "closer", "chunkier", "add outlines", a hex colour), and always recorded. The decision becomes steered.
 */
export function steerDecision(root, id, did, words, { manifest = null } = {}) {
  const doc = readDecisions(root, id);
  if (!doc) throw new Error(`games/${id} has no decisions yet: homie-studio style init ${id}`);
  const rec = doc.decisions[did];
  if (!rec) throw new Error(`no decision "${did}"`);
  const w = clean(words, 120);
  if (!w) throw new Error('steer with words: "warmer", "less saturated", "closer", "golden hour", …');
  if (rec.state === 'locked') return { ok: false, command: 'style steer', id, decision: did, locked: true, why: `${did} is locked: unlock it (with a reason, after the blast radius) before steering it` };
  const { value, applied } = applySteer(did, rec.value, w, doc);
  const steer = [...(rec.steer ?? []), w].slice(-10);
  change(rec, { value, label: did === 'style.palette' ? paletteLabel({ ...value, steered: steer.join(', ') }) : labelOf(did, value), steer, state: rec.state === 'pinned' ? 'pinned' : 'steered', why: `steered by the person: "${w}"` }, { by: 'person', words: w });
  if (did === 'style.palette' && doc.decisions['style.light'] && doc.decisions['style.light'].state !== 'locked') {
    const L = doc.decisions['style.light'];
    L.value = { ...L.value, ...lightColours(LIGHTS[L.value.time] ?? LIGHTS.morning, value) };
  }
  writeDecisions(root, id, doc);
  return { ok: true, command: 'style steer', id, decision: did, applied, recorded: w, record: rec, stale: staleAssets(doc, manifest).map((s) => s.id), note: applied ? null : `"${w}" is recorded; the vocabulary does not move ${did} by itself, so refine the value with style set (the AI may refine within the nudge, never undo it)` };
}

/** What a steer word does to a value. Returns { value, applied }. */
export function applySteer(did, value, words, doc = null) {
  const w = words.toLowerCase();
  if (did === 'style.palette') {
    const ops = { warm: /warm/.test(w) ? (/(much|lot|very) warm/.test(w) ? 0.5 : 0.28) : 0, cool: /cool|cold|icy/.test(w) ? 0.28 : 0, sat: /(less|de)[- ]?saturat|muted|softer|dull|pastel/.test(w) ? 0.7 : /(more )?saturat|punch|vivid|bolder/.test(w) ? 1.3 : 1, light: /dark|night|moody/.test(w) ? -0.12 : /light|brighter|day/.test(w) ? 0.1 : 0 };
    const hexes = [...w.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/g)].map((m) => m[0]);
    const applied = ops.warm || ops.cool || ops.sat !== 1 || ops.light || hexes.length;
    if (!applied) return { value, applied: false };
    const out = { ...value, ramp: [...(value.ramp ?? [])] };
    for (const k of PALETTE_KEYS) if (HEX.test(String(out[k]))) out[k] = nudge(out[k], ops);
    out.ramp = out.ramp.map((c) => (HEX.test(String(c)) ? nudge(c, ops) : c));
    // A hex named with a key ("#ff8800 accent") sets that key; a bare hex sets the accent.
    for (const h of hexes) { const key = PALETTE_KEYS.find((k) => new RegExp(`${h}\\s+(for\\s+)?(the\\s+)?${k}\\b|${k}\\s*[:=]?\\s*${h}`).test(w)) ?? 'accent'; out[key] = h; }
    // Ink must still read on the background.
    if (Math.abs(luminance(out.ink) - luminance(out.bg)) < 0.35) out.ink = luminance(out.bg) > 0.4 ? '#141414' : '#f4f1ea';
    return { value: out, applied: true };
  }
  if (did === 'style.light') {
    const t = /golden|sunset|dusk/.test(w) ? 'golden' : /night|moon/.test(w) ? 'night' : /noon|midday/.test(w) ? 'noon' : /morning|dawn/.test(w) ? 'morning' : /overcast|cloud|fog/.test(w) ? 'overcast' : null;
    const pal = doc?.decisions?.['style.palette']?.value ?? docPalette;
    let v = t ? lightValue(t, pal) : { ...value };
    let applied = Boolean(t);
    if (/hard(er)? shadows?|crisp|harder/.test(w)) { v = { ...v, hardness: Math.min(1, (v.hardness ?? 0.4) + 0.25) }; applied = true; }
    if (/soft(er)? (shadows?|light)/.test(w)) { v = { ...v, hardness: Math.max(0, (v.hardness ?? 0.4) - 0.25) }; applied = true; }
    if (/more fog|foggier/.test(w)) { v = { ...v, fog: Math.min(1, (v.fog ?? 0.3) + 0.25) }; applied = true; }
    if (/less fog|no fog|clearer/.test(w)) { v = { ...v, fog: Math.max(0, (v.fog ?? 0.3) - 0.25) }; applied = true; }
    if (/more glow|bloom/.test(w)) { v = { ...v, bloom: Math.min(1, (v.bloom ?? 0.2) + 0.2) }; applied = true; }
    if (/less glow|no glow/.test(w)) { v = { ...v, bloom: Math.max(0, (v.bloom ?? 0.2) - 0.2) }; applied = true; }
    return { value: v, applied };
  }
  if (did === 'style.camera') {
    const v = { ...value };
    let applied = true;
    if (/closer|nearer|zoom in/.test(w)) v.distance = +(v.distance * 0.75).toFixed(2);
    else if (/further|farther|zoom out|wider/.test(w)) v.distance = +(v.distance * 1.3).toFixed(2);
    else if (/lower/.test(w)) v.pitch = Math.max(5, v.pitch - 10);
    else if (/higher|overhead/.test(w)) v.pitch = Math.min(85, v.pitch + 10);
    else { const k = Object.keys(CAMERAS).find((c) => w.includes(c.replace('-', ' ')) || w.includes(c)); if (k) return { value: cameraValue(k), applied: true }; applied = false; }
    return { value: v, applied };
  }
  if (did === 'style.render') {
    const k = /painterly|painted/.test(w) ? 'painted' : /crisper|cleaner|flatter|simpler/.test(w) ? 'lowpoly-flat' : /toon|cel|cartoon/.test(w) ? 'toon' : /pixel|retro/.test(w) ? 'pixel-hd2d' : /realistic|pbr|grounded/.test(w) ? 'stylised-pbr' : /voxel|blocky/.test(w) ? 'voxel' : null;
    return k ? { value: k, applied: true } : { value, applied: false };
  }
  if (did === 'style.shape') {
    const v = { ...value };
    if (/chunk|round|soft/.test(w)) { v.language = /chunk/.test(w) ? v.language : 'round'; v.bevel = Math.min(1, (v.bevel ?? 0.4) + 0.2); return { value: v, applied: true }; }
    if (/sharp|angular|pointy|edgy/.test(w)) { v.language = 'angular'; v.bevel = Math.max(0, (v.bevel ?? 0.4) - 0.2); return { value: v, applied: true }; }
    if (/block|boxy/.test(w)) { v.language = 'blocky'; return { value: v, applied: true }; }
    return { value, applied: false };
  }
  if (did === 'style.proportions') {
    const v = { ...value };
    if (/cuter|chibi|smaller/.test(w)) { v.heads = Math.max(2, +(v.heads - 0.5).toFixed(1)); v.hands = 'big'; return { value: v, applied: true }; }
    if (/taller|heroic|realistic/.test(w)) { v.heads = Math.min(8, +(v.heads + 0.5).toFixed(1)); v.heightM = +(v.heightM + 0.1).toFixed(2); return { value: v, applied: true }; }
    return { value, applied: false };
  }
  if (did === 'style.materials') {
    const v = { ...value };
    if (/add outlines?|outlined|ink/.test(w)) { v.outline = true; return { value: v, applied: true }; }
    if (/no outlines?|remove outlines?/.test(w)) { v.outline = false; return { value: v, applied: true }; }
    if (/more texture|textured|detail/.test(w)) { v.model = v.model === 'flat' ? 'hand-painted' : v.model; v.texelDensity = (v.texelDensity ?? 128) * 2; return { value: v, applied: true }; }
    if (/flat(ter)?|plain/.test(w)) { v.model = 'flat'; v.texelDensity = null; return { value: v, applied: true }; }
    return { value, applied: false };
  }
  if (did === 'style.ui') {
    const q = /"([^"]{2,40})"|'([^']{2,40})'/.exec(words);
    if (q) return { value: { ...value, display: q[1] ?? q[2] }, applied: true };
    const set = Object.keys(FONT_SETS).find((k) => w.includes(k));
    return set ? { value: { ...value, ...FONT_SETS[set] }, applied: true } : { value, applied: false };
  }
  if (did === 'style.vfx') {
    if (/less glow|no glow/.test(w)) return { value: { ...value, glow: false }, applied: true };
    if (/more glow|glowier/.test(w)) return { value: { ...value, glow: true }, applied: true };
    return { value, applied: false };
  }
  return { value, applied: false };
}

/** Lock one decision, or the whole style phase ('style'). Only the person locks: `words` records what they said. */
export function lockDecision(root, id, target, { by = 'person', words = null } = {}) {
  const doc = readDecisions(root, id);
  if (!doc) throw new Error(`games/${id} has no decisions yet: homie-studio style init ${id}`);
  if (by !== 'person') return { ok: false, command: 'style lock', why: 'only the person locks a decision (their tap on a card, or their words with --by person --words "…")' };
  const ids = target === 'style' || PHASES.some((p) => p.id === target) ? Object.keys(doc.decisions).filter((k) => doc.decisions[k].phase === (target === 'style' ? 'style' : target)) : [target];
  const locked = [];
  for (const did of ids) {
    const rec = doc.decisions[did];
    if (!rec) throw new Error(`no decision "${did}"`);
    if (rec.state === 'locked') continue;
    change(rec, { state: 'locked' }, { by: 'person', words });
    locked.push(did);
  }
  if (locked.length) {
    writeDecisions(root, id, doc);
    addLatestLine(root, id, `Locked ${locked.length > 2 ? `the ${target === 'style' ? 'style' : target} (${locked.length} decisions)` : locked.map((d) => `the ${humanName(d)}: ${doc.decisions[d].label}`).join('; ')}${words ? ` ("${clean(words, 100)}")` : ''}.`);
  }
  return { ok: true, command: 'style lock', id, locked, already: ids.filter((d) => !locked.includes(d)) };
}

/** Unlock: the person's word, with a reason, recorded. */
export function unlockDecision(root, id, did, { reason = null, by = 'person' } = {}) {
  const doc = readDecisions(root, id);
  if (!doc) throw new Error(`games/${id} has no decisions yet`);
  const rec = doc.decisions[did];
  if (!rec) throw new Error(`no decision "${did}"`);
  if (rec.state !== 'locked') return { ok: true, command: 'style unlock', id, decision: did, already: true };
  if (by !== 'person') return { ok: false, command: 'style unlock', why: 'the AI never unlocks on its own: it proposes, with the blast radius, and the person says yes' };
  if (!reason) return { ok: false, command: 'style unlock', why: 'unlock with a reason: --reason "<what the person asked for>"' };
  change(rec, { state: 'steered' }, { by, reason });
  writeDecisions(root, id, doc);
  addLatestLine(root, id, `Unlocked the ${humanName(did)} (${clean(reason, 120)}).`);
  return { ok: true, command: 'style unlock', id, decision: did, record: rec };
}

/**
 * Pinned by use: the first asset built on an auto decision pins it. Returns the decisions pinned now.
 * Called by the asset manifest whenever an asset is recorded.
 */
export function pinByUse(root, id, dids, assetId) {
  const doc = readDecisions(root, id);
  if (!doc) return [];
  const pinned = [];
  for (const did of dids) {
    const rec = doc.decisions[did];
    if (!rec || rec.state !== 'auto') continue;
    change(rec, { state: 'pinned', pinnedBy: assetId }, { by: 'use' });
    pinned.push(did);
  }
  if (pinned.length) writeDecisions(root, id, doc);
  return pinned;
}

/** The current revision of each decision an asset kind depends on (what `made.under` records). */
export function revisionsFor(doc, dids) {
  const out = {};
  for (const d of dids) {
    if (d === 'derived.prompt') out[d] = doc?.derived?.prompt?.rev ?? 0;
    else if (doc?.decisions?.[d]) out[d] = doc.decisions[d].rev;
  }
  return out;
}

/** Assets made under an older revision of any decision they name: [{ id, decisions: [{ id, was, now }] }]. */
export function staleAssets(doc, manifest) {
  const out = [];
  for (const a of manifest?.assets ?? []) {
    const old = [];
    for (const [d, rev] of Object.entries(a.made?.under ?? {})) {
      const nowRev = d === 'derived.prompt' ? doc?.derived?.prompt?.rev : doc?.decisions?.[d]?.rev;
      if (nowRev !== undefined && nowRev !== rev) old.push({ id: d, was: rev, now: nowRev });
    }
    if (old.length) out.push({ id: a.id, route: a.route, decisions: old });
  }
  return out;
}

/**
 * What changing `did` would make stale, and what remaking each would cost: [{ id, kind, route,
 * card, why, remake: { usd, how }, free }]. Generated assets cost their recorded steps again; library and procedural
 * ones nothing; a palette change re-tints flat-coloured assets for free with no model call.
 */
export function blastRadius(doc, did, manifest, { to = null } = {}) {
  const touched = new Set([did, ...drives(doc, did)]);
  const promptMoves = did.startsWith('style.');
  const assets = [];
  for (const a of manifest?.assets ?? []) {
    const under = Object.keys(a.made?.under ?? {});
    const hits = under.filter((d) => touched.has(d) || (promptMoves && d === 'derived.prompt'));
    if (!hits.length) continue;
    const paid = (a.made?.steps ?? []).filter((s) => Number(s.usd) > 0);
    const usd = +paid.reduce((n, s) => n + Number(s.usd), 0).toFixed(3);
    const flat = a.measured?.flat === true || a.from?.paletteSwap === true || a.route === 'procedural';
    const free = did === 'style.palette' && flat ? 'a palette re-tint (no model call, free)' : a.route === 'procedural' ? 'regenerated by its generator (free)' : a.route === 'library' ? 'another library match, or a re-tint (free)' : null;
    assets.push({ id: a.id, kind: a.kind, route: a.route, card: a.card ?? null, why: hits.map((h) => (h === 'derived.prompt' ? 'its concept prompt' : humanName(h))).join(', '), remake: { usd: a.route === 'generated' ? usd : 0, how: a.route === 'generated' ? `${paid.length} paid step${paid.length === 1 ? '' : 's'} again (${paid.map((s) => s.what).join(' + ')})` : a.route === 'imported' ? 'the person\'s own file: re-exported by hand' : 'free' }, free });
  }
  const rec = doc.decisions[did];
  return { decision: did, name: humanName(did), from: rec?.label ?? null, to, state: rec?.state ?? null, assets, totals: { assets: assets.length, usd: +assets.reduce((n, a) => n + (a.free ? 0 : a.remake.usd), 0).toFixed(3), usdIfAllRemade: +assets.reduce((n, a) => n + a.remake.usd, 0).toFixed(3), free: assets.filter((a) => a.free).length }, decisions: [...touched].filter((d) => d !== did), note: 'Nothing is remade by itself: the person approves the list, under the budget.' };
}

const HUMAN = { 'style.render': 'render style', 'style.palette': 'palette', 'style.shape': 'shape language', 'style.proportions': 'proportions', 'style.materials': 'materials', 'style.light': 'light', 'style.camera': 'camera', 'style.ui': 'fonts and HUD', 'style.vfx': 'effects', 'style.refs': 'references', 'cast.list': 'cast', 'cast.routes': 'routes', 'cast.family': 'library family', 'cast.scale': 'scale', 'cast.tiers': 'budgets', 'cast.variation': 'variations' };
export const humanName = (did) => HUMAN[did] ?? did.split('.').pop();

/* ------------------------------------------------------------------ the derived style prompt */

/**
 * About 80 words for every generation call, computed from the style decisions and never edited by hand: medium, shape,
 * palette hexes, light, camera, then "plain background, no text". Its rev moves only when its text does.
 */
export function derivedPrompt(doc) {
  const d = doc.decisions ?? {};
  const r = RENDERS[d['style.render']?.value]?.label ?? 'Stylised';
  const shape = d['style.shape']?.value;
  const pal = d['style.palette']?.value ?? {};
  const mat = d['style.materials']?.value ?? {};
  const light = d['style.light']?.value ?? {};
  const hexes = [pal.accent, pal.accent2, pal.gold, pal.good, pal.danger, ...(pal.ramp ?? []).slice(0, 6)].filter((c) => HEX.test(String(c)));
  const text = [
    `${r} 3D game asset`,
    shape ? `${SHAPES[shape.language]?.label.toLowerCase() ?? shape.language} shapes${shape.bevel > 0.4 ? ' with soft bevels' : ' with crisp edges'}` : null,
    ({ flat: 'flat matte colours, no texture noise', toon: 'cel shading in two or three bands', 'hand-painted': 'soft hand-painted texture', pbr: 'clean stylised PBR materials', pixel: 'crisp pixel texture' })[mat.model] ?? null,
    mat.outline ? 'thin dark outline' : null,
    hexes.length ? `palette ${[...new Set(hexes)].slice(0, 8).join(' ')}` : null,
    `${LIGHTS[light.time]?.label.toLowerCase() ?? 'soft'} feel but lit evenly and neutrally for modelling`,
    '3/4 view, centred, whole object in frame, plain light grey background, no ground shadow, no text, no logo',
  ].filter(Boolean).join(', ');
  const prev = doc.derived?.prompt;
  const from = Object.fromEntries(['style.render', 'style.shape', 'style.palette', 'style.materials', 'style.light'].map((k) => [k, d[k]?.rev ?? 0]));
  return { text, rev: prev?.text === text ? prev.rev : (prev?.rev ?? 0) + 1, from: prev?.text === text ? prev.from ?? from : from };
}

/* ------------------------------------------------------------------ directions for the style board */

/**
 * Three coherent directions: A is the automatic pick; B and C contrast it within what the game's
 * words allow (another render style and palette, another light and camera). Each is a full set of style values.
 */
export function directionsFor(root, id, { prompt = '' } = {}) {
  const doc = readDecisions(root, id);
  const ctx = contextOf(root, id, { prompt: prompt || doc?.prompt || '' });
  const base = {};
  for (const [did] of CATALOGUE.filter(([, ph]) => ph === 'style')) base[did] = doc?.decisions?.[did]?.value ?? CAT.get(did).pick(ctx, base).value;
  const renderA = base['style.render'];
  const palA = base['style.palette']?.name;
  const rank = (table, skip) => Object.entries(table).filter(([k]) => !skip.includes(k)).map(([k, v]) => [k, v.words ? ctx.score(v.words) : 0]).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const renderB = rank(RENDERS, [renderA, 'pixel-hd2d', 'stylised-pbr'])[0] ?? 'toon';
  const renderC = rank(RENDERS, [renderA, renderB, 'stylised-pbr'])[0] ?? 'painted';
  const pals = rank(PALETTES, [palA]);
  const lightA = base['style.light']?.time ?? 'morning';
  const lights = rank(LIGHTS, [lightA]);
  const camA = base['style.camera']?.angle ?? 'high-3/4';
  const cams = [camA === 'high-3/4' ? 'close-3/4' : 'high-3/4', camA === 'iso' ? 'top-down' : 'iso'];
  // A palette's own light: night palettes at night, autumn at golden hour, unless the person's words named one.
  const lightOf = (palName) => (best(LIGHTS, ctx)?.[0]) ?? ({ 'moonlit-grove': 'night', 'neon-dusk': 'night', 'embers-night': 'night', 'space-ink': 'night', 'desert-noon': 'noon', 'autumn-grove': 'golden', 'ash-dawn': 'overcast', 'heroic-dawn': 'morning' })[palName] ?? 'morning';
  const make = (dir, render, palName, lightKey, camKey) => {
    const r = RENDERS[render];
    const palette = palName ? paletteValue(palName) : base['style.palette'];
    const shape = render === 'voxel' ? 'blocky' : render === 'toon' && base['style.shape']?.language === 'round' ? 'round' : base['style.shape']?.language ?? 'round';
    const values = {
      'style.render': render,
      'style.palette': palette,
      'style.shape': { language: shape, bevel: SHAPES[shape].bevel, silhouette: base['style.shape']?.silhouette ?? 'every character readable black on white at 64 px tall' },
      'style.proportions': base['style.proportions'],
      'style.materials': { model: r.materials, outline: r.outline, texelDensity: { flat: null, toon: 128, 'hand-painted': 256, pbr: 384, pixel: 32 }[r.materials] ?? null, atlas: r.materials === 'flat' },
      'style.light': lightValue(lightKey, palette),
      'style.camera': cameraValue(camKey),
      'style.ui': { ...(base['style.ui'] ?? {}), ...r.fonts, radius: shape === 'angular' ? 4 : shape === 'blocky' ? 8 : 14 },
      'style.vfx': { particles: r.vfx, hitFlash: true, trails: false, glow: LIGHTS[lightKey].bloom > 0.2 },
    };
    return { id: dir, label: `${r.label} · ${paletteLabel(palette)} · ${LIGHTS[lightKey].label}`, values, family: r.family };
  };
  const a = make('a', renderA, null, lightA, camA);
  const palB = pals[0] ?? 'candy-pop';
  const palC = pals.find((p) => p !== palB && lightOf(p) !== lightOf(palB)) ?? pals[1] ?? 'moonlit-grove';
  const dirs = [
    { ...a, values: { ...a.values, ...base } },
    make('b', renderB, palB, lightOf(palB) === lightA ? lights[0] ?? 'golden' : lightOf(palB), cams[0]),
    make('c', renderC, palC, lightOf(palC), cams[1]),
  ];
  dirs[0].label = `${RENDERS[renderA].label} · ${doc?.decisions?.['style.palette']?.label ?? paletteLabel(base['style.palette'])} · ${LIGHTS[lightA].label}`;
  return { ctx: { genre: ctx.genre }, directions: dirs };
}

/** Pick a direction (all its style values) or Mix rows from several: { 'style.palette': 'b', … }. By the person. */
export function pickDirection(root, id, choice, { mixes = {}, manifest = null } = {}) {
  const doc = readDecisions(root, id);
  if (!doc?.board?.directions?.length) throw new Error(`games/${id} has no style board yet: homie-studio style board ${id}`);
  const by = Object.fromEntries(doc.board.directions.map((d) => [d.id, d]));
  if (choice && !by[choice]) throw new Error(`no direction "${choice}" (${Object.keys(by).join(', ')})`);
  const changed = [];
  const refused = [];
  const rows = new Set([...(choice ? Object.keys(by[choice].values) : []), ...Object.keys(mixes)]);
  for (const did of rows) {
    const from = by[mixes[did] ?? choice];
    if (!from) throw new Error(`no direction "${mixes[did]}" for ${did}`);
    const rec = doc.decisions[did];
    if (!rec) continue;
    const value = from.values[did];
    if (value === undefined || JSON.stringify(rec.value) === JSON.stringify(value)) continue;
    if (rec.state === 'locked') { refused.push(did); continue; }
    change(rec, { value, label: labelOf(did, value), why: `the person picked direction ${from.id.toUpperCase()} on the style board`, state: rec.state === 'pinned' ? 'pinned' : 'steered' }, { by: 'person' });
    changed.push(did);
  }
  doc.board.chosen = choice ?? doc.board.chosen ?? null;
  if (Object.keys(mixes).length) doc.board.mix = { ...(doc.board.mix ?? {}), ...mixes };
  writeDecisions(root, id, doc);
  if (changed.length) addLatestLine(root, id, `Picked ${choice ? `direction ${choice.toUpperCase()}` : 'a mix'} on the style board${Object.keys(mixes).length ? ` (${Object.entries(mixes).map(([d, x]) => `${humanName(d)} from ${x.toUpperCase()}`).join(', ')})` : ''}.`);
  return { ok: true, command: 'style pick', id, chosen: choice, changed, refused, stale: staleAssets(readDecisions(root, id), manifest).map((s) => s.id) };
}

/* ------------------------------------------------------------------ the codex */

/** One dated line under the codex's Latest, newest first ("- 2026-10-02: …"). */
export function addLatestLine(root, id, text) {
  const file = join(root, 'games', id, 'CODEX.md');
  if (!existsSync(file)) return false;
  const src = readFileSync(file, 'utf8');
  const line = `- ${now().slice(0, 10)}: ${clean(text, 300)}`;
  const m = /^##\s+Latest[^\n]*\n/m.exec(src);
  let out;
  if (m) {
    const at = m.index + m[0].length;
    const rest = src.slice(at);
    const lead = /^\s*\n?/.exec(rest)[0];
    out = `${src.slice(0, at)}${lead.includes('\n') ? '\n' : ''}${line}\n${rest.replace(/^\s*\n?/, '')}`;
  } else {
    const first = /^##\s/m.exec(src);
    out = first ? `${src.slice(0, first.index)}## Latest\n\n${line}\n\n${src.slice(first.index)}` : `${src.trimEnd()}\n\n## Latest\n\n${line}\n`;
  }
  writeFileSync(file, out);
  return true;
}

/** The decisions as rows a card, the codex and the mod draw: [{ phase, rows: [{ id, question, label, why, state, by, at, rev, steer }] }]. */
export function decisionRows(doc) {
  if (!doc) return [];
  // A label written before a value had words of its own (or by hand) is drawn again from the value.
  const labelFor = (did, r) => (typeof r.label === 'string' && !/^[[{]/.test(r.label) ? r.label : labelOf(did, r.value));
  return PHASES.map((p) => ({ ...p, rows: Object.entries(doc.decisions).filter(([, r]) => r.phase === p.id).map(([did, r]) => ({ id: did, name: humanName(did), question: r.question, label: labelFor(did, r), why: r.why, state: r.state, by: r.by, at: r.at, rev: r.rev, steer: r.steer ?? [], colours: did === 'style.palette' ? PALETTE_KEYS.map((k) => r.value?.[k]).filter((c) => HEX.test(String(c))) : null })) })).filter((p) => p.rows.length);
}

/** Phase progress for the strip: { style: { decided, total }, … } (decided = steered, pinned or locked). */
export function phaseProgress(doc) {
  const out = {};
  for (const p of PHASES) {
    const rows = Object.values(doc?.decisions ?? {}).filter((r) => r.phase === p.id);
    out[p.id] = { total: rows.length, settled: rows.filter((r) => r.state !== 'auto').length, locked: rows.filter((r) => r.state === 'locked').length };
  }
  return out;
}

export { deltaHex, hexToRgb };
