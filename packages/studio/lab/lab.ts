/*
 * @homie-rocks/studio/lab — a game opts into the Game Lab (`homie-studio lab <game>`) with a few calls. The lab plays
 * the same take in two builds side by side, New (the working tree) and Today (the last commit), on one clock, with the
 * same seed and the same presses, and draws what these calls report: a timeline of phases, graphs of tracked values,
 * the game's own overlays, preset views and live sliders.
 *
 * Outside the lab every call is a no-op (one check of a constant), so the calls stay in the game for good and cost a
 * player nothing. The lab's clock, dice and inputs are installed in the game's page before its first script (the
 * lab's harness, lab/harness.js): requestAnimationFrame, performance.now(), Date.now(), timers and Math.random() all
 * run on the lab's clock there, so netplay's offline host, a round's countdown and a knockback's timer all slow down,
 * pause and step together.
 *
 *   import { lab } from '@homie-rocks/studio/lab';
 *   import tuning from '../tunables.json';
 *
 *   const T = lab.tunables(tuning);                 // T.knockSpeed: the file's value; in the lab, the slider's
 *   const view = lab.camera({ game: null, close: { zoom: 2.4 } });
 *   lab.overlay('trail', (ctx) => { for (const p of lab.past('me', 30)) dot(ctx, p.x, p.y); });
 *
 *   function frame(t: number): void {
 *     const dt = lab.time.dt(t, 0.05);              // seconds since the last frame, at most 0.05
 *     ...
 *     lab.track('speed', Math.hypot(vx, vy), 'px/s');
 *     lab.phase(knocked ? 'LAUNCH' : null, 'Leaves fast, eases out');
 *     lab.pose('me', { x, y });
 *     ...in the world's transform: lab.draw(ctx);
 *   }
 *
 * tunables.json (next to game.json): { "knockSpeed": { "value": 950, "min": 300, "max": 2000, "step": 10,
 * "unit": "px/s", "group": "Knock", "note": "How fast a bumped body leaves" }, ... }. A slider the person keeps is
 * written back into that file by the lab, so a kept change is code.
 */

/** One tunable in tunables.json: its value and the slider around it. A bare number is a value with no range. */
export interface TunableSpec {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  group?: string;
  note?: string;
}
export type TunableFile = Record<string, TunableSpec | number>;
export type Tuned<S extends TunableFile> = { readonly [K in keyof S]: number };

/** What the lab's harness puts on the page (window.__homieLab) before the game's first script. */
interface LabHost {
  v: 1;
  pane: 'new' | 'today';
  stage: string | null;
  frame: number;
  fps: number;
  scale: number;
  paused: boolean;
  track(name: string, value: number, unit?: string): void;
  phase(name: string | null, note?: string): void;
  pose(name: string, value: Record<string, unknown>): void;
  past(name: string, count: number, every: number): Record<string, unknown>[];
  views(names: string[]): void;
  view(): string | null;
  overlays(names: string[]): void;
  overlay(name: string): boolean;
  tunables(spec: TunableFile): Record<string, number>;
  random(): number;
  hold(): void;
  ready(): void;
}

const host: LabHost | null = typeof window !== 'undefined' ? ((window as unknown as { __homieLab?: LabHost }).__homieLab ?? null) : null;
const ON = Boolean(host && host.v === 1);

type Draw = (ctx: unknown, ...rest: unknown[]) => void;
const drawers = new Map<string, Draw>();
let lastT = -1;

const valueOf = (s: TunableSpec | number): number => (typeof s === 'number' ? s : Number(s?.value));

export const lab = {
  /** True when this page is a pane of the Game Lab. */
  on: ON,

  time: {
    /**
     * Seconds since the previous frame, at most `max` (a tab that slept does not teleport the world). Call it once a
     * frame with requestAnimationFrame's time. In the lab that time is the lab's clock: every frame is exactly one step
     * of its frame rate (60, 30, 15 or 12 a second), so a take plays the same every time, at any speed.
     */
    dt(t: number, max = 0.05): number {
      const d = lastT < 0 ? 0 : Math.max(0, (t - lastT) / 1000);
      lastT = t;
      return Math.min(max, d);
    },
    /** The time now in ms (performance.now(); the lab's clock in the lab). */
    now(): number { return performance.now(); },
    /** The lab's frame number (1 is the take's first frame); 0 outside the lab. */
    get frame(): number { return host?.frame ?? 0; },
    /** Frames a second the lab runs the game at (60 outside the lab). */
    get fps(): number { return host?.fps ?? 60; },
    /** How fast the lab plays (1, 0.5, 0.25, 0.1): the game never needs it, a frame is a frame at any speed. */
    get scale(): number { return host?.scale ?? 1; },
    get paused(): boolean { return host?.paused ?? false; },
  },

  /**
   * The take's stage (lab.json "stage"), or null: a scene the game sets up for one mechanic, the way a fighting game's
   * training mode stands a dummy in front of you. Read it where the round starts; it is null outside the lab, so a
   * stage never reaches a player. Check the mechanic in a take without a stage too: real play is the test.
   */
  get stage(): string | null { return host?.stage ?? null; },

  /** A number to graph this frame (New against Today). `unit` names its axis the first time. */
  track(name: string, value: number, unit?: string): void { if (ON) host!.track(name, value, unit); },

  /**
   * The phase the mechanic is in from now on: a short name in capitals (COIL, RISE, HANG, LAUNCH, SETTLE) and a note
   * that says what it is for ("Overlap on the way out"). null: none. It lasts until the next call, so call it when the
   * phase changes, or every frame with what it is.
   */
  phase(name: string | null, note?: string): void { if (ON) host!.phase(name, note); },

  /** A small picture of something this frame ({ x, y, angle, sx, sy }): what `past` returns to an overlay. */
  pose(name: string, value: Record<string, unknown>): void { if (ON) host!.pose(name, value); },

  /** The last `count` poses of `name`, newest first, one every `every` frames (onion skins, arcs, trails). */
  past<P extends Record<string, unknown> = Record<string, number>>(name: string, count = 8, every = 1): P[] {
    return ON ? (host!.past(name, count, every) as P[]) : [];
  },

  /**
   * Preset views the lab offers as buttons (Side, Front, Top, Orbit in a 3D game; Close, Arena in a flat one). Returns
   * the active preset's value each frame: the first preset outside the lab (give it null: the game's own camera).
   */
  camera<V>(presets: Record<string, V>): () => V | null {
    const names = Object.keys(presets);
    const first = names.length ? (presets[names[0] as string] as V) : null;
    if (!ON) return () => first;
    host!.views(names);
    return () => { const v = host!.view(); return v !== null && Object.hasOwn(presets, v) ? (presets[v] as V) : first; };
  },

  /** An overlay the lab can switch on (onion skin, arcs, smears, hit boxes): drawn by the game's own renderer. */
  overlay(name: string, draw: Draw): void {
    if (!ON) return;
    drawers.set(name, draw);
    host!.overlays([...drawers.keys()]);
  },

  /** Draw every overlay the lab has on, in whatever transform the game is in (call it in world space). */
  draw(ctx: unknown, ...rest: unknown[]): void {
    if (!ON) return;
    for (const [name, fn] of drawers) if (host!.overlay(name)) { try { fn(ctx, ...rest); } catch { /* an overlay never breaks the frame */ } }
  },

  /**
   * The game's tunables (tunables.json): an object of numbers by name. Outside the lab, the file's values. In the lab,
   * the values the sliders hold now (a take restarts when one moves); the lab writes kept values back into the file.
   */
  tunables<S extends TunableFile>(spec: S): Tuned<S> {
    const base: Record<string, number> = {};
    for (const [k, s] of Object.entries(spec)) base[k] = valueOf(s);
    if (!ON) return Object.freeze(base) as Tuned<S>;
    const live = host!.tunables(spec);
    const out = {} as Record<string, number>;
    for (const k of Object.keys(base)) Object.defineProperty(out, k, { enumerable: true, get: () => (Number.isFinite(live[k]) ? (live[k] as number) : (base[k] as number)) });
    return out as Tuned<S>;
  },

  /** Rules use the same slider file as the view. Public values keep their public. prefix in the Lab's UI. */
  rulesTune(raw: Record<string, unknown>): Record<string, unknown> {
    if (!ON) return raw;
    const pub = raw.public && typeof raw.public === 'object' ? raw.public as Record<string, unknown> : {};
    const spec: TunableFile = {};
    for (const [k, v] of Object.entries(raw)) if (k !== 'public' && (typeof v === 'number' || typeof (v as TunableSpec)?.value === 'number')) spec[k] = v as TunableSpec | number;
    for (const [k, v] of Object.entries(pub)) if (typeof v === 'number' || typeof (v as TunableSpec)?.value === 'number') spec[`public.${k}`] = v as TunableSpec | number;
    const values = host!.tunables(spec);
    const out: Record<string, unknown> & { public: Record<string, unknown> } = { ...raw, public: { ...pub } };
    for (const k of Object.keys(spec)) if (Number.isFinite(values[k])) {
      if (k.startsWith('public.')) out.public[k.slice(7)] = values[k]; else out[k] = values[k];
    }
    return out;
  },

  /**
   * Dice for juice (particles, shake, sparks): its own stream in the lab, so a build that adds a particle never moves
   * a gem or a bot in the other build (Math.random() is the world's dice, the same in both). Math.random() outside.
   */
  random(): number { return ON ? host!.random() : Math.random(); },

  /** A game that loads assets after its page has loaded: hold() early, ready() when it can play. */
  hold(): void { if (ON) host!.hold(); },
  ready(): void { if (ON) host!.ready(); },
};

export default lab;
