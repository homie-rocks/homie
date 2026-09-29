/**
 * ============================================================================
 *  @homie-rocks/input/GlassPad.ts — the on-screen pad for a game drawn on THIS
 *  screen.
 * ============================================================================
 *
 * THREE PADS IN THIS ENGINE, AND THEY ARE NOT THE SAME DEVICE
 * ---------------------------------------------------------------------------
 * · `@homie-rocks/arcade/Surface` is a PLAYER'S PHONE: a reflowing flex column
 *   on a separate device, on a separate origin, talking to the host over the
 *   network.
 * · `@homie-rocks/device/ThumbPad` is a STEERING pad: one stick, one scalar `steer`,
 *   tilt, a release ramp, a coach and stored preferences. Its own arithmetic
 *   agrees — `thumbCurve(dx, …)` takes a single axis — and `clampStickOrigin`
 *   says out loud that a stick may not migrate out of its own half.
 * · THIS is a pad drawn over the game itself, on the panel the game is on, with
 *   BOTH halves live at once: one thumb walks and the other aims. It is the
 *   layout every twin-stick shooter on a phone has had since 2009.
 *
 * A twin-stick layout is not a configuration of a steering pad, it is a
 * contradiction of one, which is what an attempt to bend a first-person shooter
 * onto `ThumbPad` found. This file is the capability that was missing, and it
 * is deliberately small: the two halves are `Stick2` and `DragLook`, which
 * already exist, and what is added here is the DOM — the layer, the two
 * floating rings, the button cluster, and the pointer bookkeeping that keeps a
 * thumb on a button from also being a thumb on a half.
 *
 * WHAT IS THE GAME'S, AND IT IS THE SHORT LIST THAT MATTERS
 * ---------------------------------------------------------------------------
 * Nothing in here knows what a button MEANS — the package's own rule. A game
 * hands over: which buttons exist, what each one says, whether it is held or
 * latched, where the split between the halves is, which pointer types belong
 * to this pad, whether its two feedback rings are drawn, and the two feel
 * numbers for the stick. It gets back four questions it may ask every frame —
 * `held`, `pressed`, `stick`, `look` — and maps those into its own vocabulary.
 *
 * The BUTTON POSITIONS stay with the game too, as a class per button and a
 * stylesheet of its own. Where FIRE sits relative to JUMP in a shooter is a
 * shooter's argument about a hand, and a package holding a table of positions
 * would be holding eight games' arguments in one file.
 *
 * EVERY CUSTOM PROPERTY THIS SHEET USES IS DEFINED IN THIS SHEET
 * ---------------------------------------------------------------------------
 * Not a style preference — the defect this package shipped the same week, in
 * `@homie-rocks/arcade/Surface.ts`. Five `--hm-pad-*` tokens were used and none was
 * defined, on the theory that a game forgetting one should render visibly
 * broken. That is right for TypeScript and wrong for CSS: an undefined custom
 * property is invalid at computed-value time, so it silently falls back to the
 * property's INITIAL value — transparent, and black text — and nothing throws,
 * nothing warns and no typechecker can see it. Every phone controller in all
 * eight games was black-on-white for several iterations, with every automated
 * check green, because every check asserts presses and none looks at a pixel.
 * A photograph from a real phone is what found it.
 *
 * So: defaults for all of them, on `:root`, so a game's own `:root` wins with
 * no `!important` — and a probe FAILS on any `var()` in this file without a
 * definition beside it.
 *
 * UNVERIFIED UNDER A THUMB, and that is the honest headline for the whole file.
 * CDP touch events bypass the browser's gesture arbitration, so a green harness
 * and a dead button are indistinguishable from a terminal. The split fraction,
 * the ring size and every geometry number a caller passes are UNVERIFIED until
 * a person holds a phone. The probe says these numbers did not CHANGE; it never
 * says they are any good.
 */
import { DragLook } from './DragLook.ts';
import { Stick2 } from './Stick2.ts';

/**
 * One button in the cluster.
 *
 * `hold` is down-while-held and reads through `held()`. `press` is an edge that
 * latches on the way down and is collected once by `pressed()` — the difference
 * between a trigger and a reload, and it is declared rather than inferred
 * because a game asking `pressed()` of a hold button would silently get an edge
 * nobody designed.
 *
 * `cls` is the class that POSITIONS it, and it is required: a button with no
 * position lands at the layer's origin, on top of every other one, which is a
 * cluster that looks like a single button and cannot be told apart in a
 * screenshot. Making it required means a forgotten position does not compile.
 */
export interface GlassButton {
  id: string;
  label: string;
  mode: 'hold' | 'press';
  cls: string;
}

/**
 * The whole of what a game decides.
 *
 * `split` is the fraction of the viewport width below which a thumb belongs to
 * the movement half. Required, and it is a real disagreement between games: one
 * first-person shooter measured 0.46 so the aiming half is the larger one, and
 * a walk with no gun would sensibly use 0.5.
 *
 * `stick` and `look` are handed straight to `Stick2` and `DragLook`, which
 * document why neither of them ships a default.
 */
export interface GlassPadSpec {
  split: number;
  stick: { radius: number; deadzone: number };
  look: { tapSlop: number };
  buttons: readonly GlassButton[];
  /**
   * Caller-owned transport policy: touch only, or every non-mouse pointer.
   * Required because accepting a mouse steals a desktop game's separate drag.
   */
  accept: (event: PointerEvent) => boolean;
  /**
   * Whether to draw the two floating feedback rings. Required because adding
   * controls over an existing film is an art change, not a safe default.
   */
  rings: boolean;
}

/**
 * The stylesheet.
 *
 * Written as an array of plain strings with no backticks anywhere: a backtick
 * inside a comment in a template literal closes the document mid-file, the
 * module then has no exports, and "node --check" does not even agree it is
 * broken because it parses the file as CommonJS. That has happened before.
 *
 * Sizes are in vmin with a px ceiling so the pad is the same physical size on a
 * phone and on a tablet, and the 46 px floor on anything a thumb lands on is
 * NOT a caller's number: it is the target floor @homie-rocks/device states from the
 * device table, and a game is not entitled to a smaller one.
 */
const STYLE: readonly string[] = [
  /*
   * Defaults on :root. A game overrides any of them with one line and no
   * !important; see the header for why shipping none was the defect.
   */
  ':root{--gp-ring:rgba(200,212,230,.18);--gp-ring-fill:rgba(8,12,20,.12);',
  '--gp-knob:rgba(62,224,200,.28);--gp-btn-bg:rgba(12,16,24,.42);',
  '--gp-btn-edge:rgba(224,162,74,.4);--gp-btn-ink:#d8e0ea;',
  '--gp-btn-down:rgba(62,224,200,.34);',
  '--gp-ring-size:22vmin;--gp-knob-size:9vmin;--gp-btn-size:14vmin;',
  '--gp-btn-max:72px;--gp-font:700 2.4vmin/1 "Avenir Next Condensed",system-ui,sans-serif}',
  /*
   * The layer. pointer-events auto and touch-action none on the ROOT, because
   * the halves are the root itself — there is no element to drag on, the empty
   * screen IS the control, which is what "drag anywhere" means.
   */
  '.gp-root{position:fixed;inset:0;z-index:20;pointer-events:auto;touch-action:none;',
  '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}',
  '.gp-root.gp-hidden{display:none}',
  /* The floating ring: drawn where the base IS, which trails the thumb. */
  '.gp-ring{position:absolute;width:var(--gp-ring-size);height:var(--gp-ring-size);',
  'margin:calc(var(--gp-ring-size)/-2) 0 0 calc(var(--gp-ring-size)/-2);',
  'border-radius:50%;border:1px solid var(--gp-ring);background:var(--gp-ring-fill);',
  'pointer-events:none;opacity:0}',
  '.gp-ring.gp-on{opacity:1}',
  '.gp-ring::after{content:"";position:absolute;left:50%;top:50%;',
  'width:var(--gp-knob-size);height:var(--gp-knob-size);',
  'margin:calc(var(--gp-knob-size)/-2) 0 0 calc(var(--gp-knob-size)/-2);',
  'border-radius:50%;background:var(--gp-knob);',
  'transform:translate(var(--gp-kx,0px),var(--gp-ky,0px))}',
  /* The cluster. Position comes from the game's own class on each button. */
  '.gp-btn{position:absolute;width:var(--gp-btn-size);height:var(--gp-btn-size);',
  'max-width:var(--gp-btn-max);max-height:var(--gp-btn-max);min-width:46px;min-height:46px;',
  'border-radius:50%;border:1px solid var(--gp-btn-edge);background:var(--gp-btn-bg);',
  'color:var(--gp-btn-ink);font:var(--gp-font);letter-spacing:.1em;',
  'display:grid;place-items:center;pointer-events:auto}',
  '.gp-btn[data-gp-down="1"]{background:var(--gp-btn-down)}',
];

/** The sheet, as one string. Exported so a probe can read what actually ships. */
export const GLASS_PAD_CSS = STYLE.join('');

const STYLE_ID = 'homie-glass-pad-css';

/**
 * An on-screen twin-stick pad.
 *
 * Construct it, `mount()` it into whatever element the game's UI lives in, and
 * ask it four questions a frame. It owns its own listeners because it owns its
 * own layer — the reason `Stick2` refuses to (it does not know the element)
 * does not apply to a class that MADE the element.
 */
export class GlassPad {
  readonly stick: Stick2;
  readonly look: DragLook;

  #spec: GlassPadSpec;
  #root: HTMLElement | null = null;
  #ringMove: HTMLElement | null = null;
  #ringLook: HTMLElement | null = null;
  #down = new Set<string>();
  #latched = new Set<string>();
  /** pointer id -> the button it landed on, so a lift releases the right one. */
  #onButton = new Map<number, string>();
  /**
   * Where the aiming thumb last was, FOR DRAWING ONLY.
   *
   * It lives here and not in `DragLook`, deliberately. That class publishes a
   * delta; the moment it also published a position, the next caller would read
   * the position and it would quietly become a second `Stick2` with two
   * lifetimes fighting over one gesture. The pad remembers what the pad draws.
   */
  #lookX = 0;
  #lookY = 0;

  constructor(spec: GlassPadSpec) {
    this.#spec = spec;
    this.stick = new Stick2(spec.stick);
    this.look = new DragLook(spec.look);
  }

  /**
   * Build the layer and start listening. Idempotent — a second call while
   * mounted does nothing, because `Input` classes get re-initialised on a
   * scene change and a pad with two sets of listeners double-counts every
   * drag, which reads as a camera that turns twice as fast only sometimes.
   */
  mount(host?: HTMLElement | null): void {
    if (this.#root) return;
    injectStyle();
    const parent = host ?? document.body;
    const root = document.createElement('div');
    root.className = 'gp-root gp-hidden';
    if (this.#spec.rings) {
      this.#ringMove = ring(root);
      this.#ringLook = ring(root);
    }
    for (const b of this.#spec.buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `gp-btn ${b.cls}`;
      el.dataset.gp = b.id;
      el.textContent = b.label;
      root.appendChild(el);
    }
    parent.appendChild(root);
    this.#root = root;

    root.addEventListener('pointerdown', this.#onDown);
    addEventListener('pointermove', this.#onMove);
    addEventListener('pointerup', this.#onUp);
    addEventListener('pointercancel', this.#onUp);
    root.addEventListener('contextmenu', prevent);
  }

  /**
   * Take the layer away and stop listening.
   *
   * The listeners are removed by the same function references they were added
   * with — an arrow field, not a bound method made at add time, which would
   * remove nothing at all and leave a dead pad steering a live game.
   */
  unmount(): void {
    const root = this.#root;
    if (!root) return;
    root.removeEventListener('pointerdown', this.#onDown);
    removeEventListener('pointermove', this.#onMove);
    removeEventListener('pointerup', this.#onUp);
    removeEventListener('pointercancel', this.#onUp);
    root.removeEventListener('contextmenu', prevent);
    root.remove();
    this.#root = null;
    this.#ringMove = null;
    this.#ringLook = null;
    this.clear();
  }

  /** Is the layer in the document? */
  get mounted(): boolean { return this.#root !== null; }

  /**
   * Show or hide it. Hiding CLEARS, because a pad that went away holding a
   * direction is a player who walks into a wall through the whole pause menu.
   */
  setVisible(on: boolean): void {
    if (!this.#root) return;
    this.#root.classList.toggle('gp-hidden', !on);
    if (!on) this.clear();
  }

  get visible(): boolean {
    return this.#root !== null && !this.#root.classList.contains('gp-hidden');
  }

  /** Is this button down right now? For a `hold` button. */
  held(id: string): boolean { return this.#down.has(id); }

  /**
   * Was this button pressed since the last time anybody asked? For a `press`
   * button. Collected by reading, so exactly one system may ask.
   */
  pressed(id: string): boolean {
    if (!this.#latched.has(id)) return false;
    this.#latched.delete(id);
    return true;
  }

  /**
   * Is a thumb doing anything at all?
   *
   * A game uses this to decide the player is driving with a finger rather than
   * a keyboard, so a latched press that nobody has collected yet counts: the
   * press happened, and the frame that reads this may be the frame before the
   * one that reads the latch.
   */
  get anyActive(): boolean {
    return this.stick.active || this.look.active ||
      this.#down.size > 0 || this.#latched.size > 0;
  }

  /** Drop every thumb and every latch. For blur, a pause, or leaving the game. */
  clear(): void {
    this.stick.clear();
    this.look.clear();
    this.#down.clear();
    this.#latched.clear();
    this.#onButton.clear();
    this.#paint();
  }

  #onDown = (e: PointerEvent): void => {
    if (!this.visible || !this.#spec.accept(e)) return;
    const target = e.target as HTMLElement | null;
    const btn = target?.closest?.('[data-gp]') as HTMLElement | null;
    const id = btn?.dataset.gp;
    if (id) {
      // A thumb on a button is NOT also a thumb on a half. The early return is
      // the whole reason the cluster can sit over the aiming half at all.
      this.#onButton.set(e.pointerId, id);
      this.#down.add(id);
      if (this.#spec.buttons.find((b) => b.id === id)?.mode === 'press') {
        this.#latched.add(id);
      }
      btn.dataset.gpDown = '1';
      // Capture on the BUTTON, so a thumb that slides off it still releases it
      // — without this a finger that drifts leaves the button down for ever,
      // and a stuck FIRE is indistinguishable from a game that will not stop
      // shooting.
      try { btn.setPointerCapture(e.pointerId); } catch { /* not every browser */ }
      e.preventDefault();
      return;
    }
    if (e.clientX < innerWidth * this.#spec.split) {
      // WHICH HALF IS WHICH IS THE GAME'S — the split is a spec field for
      // exactly that reason — but the ROUTING is here, because the routing is
      // the same sentence in every game that has two halves.
      this.stick.down(e.pointerId, e.clientX, e.clientY);
    } else if (this.look.down(e.pointerId, e.clientX, e.clientY)) {
      this.#lookX = e.clientX;
      this.#lookY = e.clientY;
    }
    e.preventDefault();
    this.#paint();
  };

  #onMove = (e: PointerEvent): void => {
    if (!this.#spec.accept(e)) return;
    if (this.#onButton.has(e.pointerId)) return;
    if (this.stick.move(e.pointerId, e.clientX, e.clientY)) { this.#paint(); return; }
    if (this.look.move(e.pointerId, e.clientX, e.clientY)) {
      this.#lookX = e.clientX;
      this.#lookY = e.clientY;
      this.#paint();
    }
  };

  #onUp = (e: PointerEvent): void => {
    if (!this.#spec.accept(e)) return;
    const id = this.#onButton.get(e.pointerId);
    if (id !== undefined) {
      this.#onButton.delete(e.pointerId);
      this.#down.delete(id);
      const el = this.#root?.querySelector(`[data-gp="${id}"]`) as HTMLElement | null;
      if (el) delete el.dataset.gpDown;
      return;
    }
    this.stick.up(e.pointerId);
    this.look.up(e.pointerId);
    this.#paint();
  };

  /**
   * Put the two rings where their bases are.
   *
   * Called from the pointer handlers rather than from a frame loop, because the
   * pad has no frame loop and asking a game to drive one would make the pad's
   * appearance depend on whether the game remembered — and a harness that
   * drives the loop itself would never notice the missing caller.
   */
  #paint(): void {
    place(this.#ringMove, this.stick.active,
      this.stick.originX, this.stick.originY,
      this.stick.x * this.#spec.stick.radius, this.stick.y * this.#spec.stick.radius);
    // The look half has no base and no deflection — it is a delta, not a
    // position — so its ring is drawn at the thumb with the knob centred. It is
    // there to say "this half heard you", nothing more.
    place(this.#ringLook, this.look.active, this.#lookX, this.#lookY, 0, 0);
  }
}

function ring(parent: HTMLElement): HTMLElement {
  const e = document.createElement('div');
  e.className = 'gp-ring';
  parent.appendChild(e);
  return e;
}

function place(
  el: HTMLElement | null, on: boolean,
  x: number, y: number, kx: number, ky: number,
): void {
  if (!el) return;
  el.classList.toggle('gp-on', on);
  if (!on) return;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.setProperty('--gp-kx', `${kx}px`);
  el.style.setProperty('--gp-ky', `${ky}px`);
}

function prevent(e: Event): void { e.preventDefault(); }

/**
 * One style element, whatever happens.
 *
 * Injected rather than imported, because this package has four resolvers — Node,
 * Vite, a bundler-less browser through an import map, and a harness — and only
 * one of them has a CSS loader. A sheet that arrives with the module arrives in
 * all four.
 */
function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = GLASS_PAD_CSS;
  document.head.appendChild(s);
}
