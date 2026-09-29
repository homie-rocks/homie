/**
 * ============================================================================
 *  measuredBox — publish a panel's REAL size into a custom property, so the
 *  thing under it can get out of the way.
 * ============================================================================
 *
 *  A stylesheet cannot ask how tall a panel came out. So a layer whose columns
 *  stack writes the number itself, and the failures of NOT writing it are the
 *  same two every time:
 *
 *   · A TYPED HEIGHT IS A LIE THE MOMENT THE TEXT CHANGES. One panel measured
 *     118 px with a two-line body and 168 px with a four-line one; the constant
 *     in the stylesheet was neither, and the ledger under it was drawn straight
 *     through the one panel a lost player was reading.
 *   · A TYPED CAP CAN GO NEGATIVE. A `calc()` that subtracts a typed column
 *     height from the viewport is invalid below some viewport height, and an
 *     invalid declaration does not clamp — it DELETES the rule. The cap that
 *     was protecting a panel simply stops existing on a short screen, which is
 *     the screen it mattered on.
 *
 *  ── A ResizeObserver AND NOT A PER-FRAME READ ──────────────────────────────
 *
 *  `getBoundingClientRect` forces a synchronous layout. This number changes a
 *  handful of times a session — a panel appears, a body grows a line, the
 *  column wraps — and reading it in an update loop is ninety forced layouts a
 *  second to learn nothing.
 *
 *  ── BORDER BOX OR CONTENT BOX, AND THE CALLER SAYS WHICH ───────────────────
 *
 *  `contentRect` is the CONTENT box. A column whose children carry a 1 px
 *  border is two pixels taller than that, and the panel below it is positioned
 *  from the OUTER edge. Two pixels is not a collision, but it is a lie in a
 *  number whose whole job is to be exact — so `box: 'border'` reads
 *  `offsetHeight`, and `box: 'content'` keeps the observer's own fractional
 *  measurement for a caller that has already worked out its own correction.
 *
 *  ── THE WINDOW LISTENER IS A BACKSTOP, NOT THE MECHANISM ───────────────────
 *
 *  The observer fires on SIZE. A viewport change that alters a column's WRAP
 *  can land on the height the observer last saw, and then nothing fires. That
 *  is what `onViewport` is for; it is cheap and it is never per frame.
 *
 *  ── NO PROPERTY NAME AND NO NUMBER IS HERE ─────────────────────────────────
 *
 *  The custom-property names are the caller's, and that is not politeness: a
 *  package that wrote `--left-h` would require every stylesheet to spell it
 *  that way, and a custom property a package writes and no stylesheet reads is
 *  invisible — no error, no warning, every probe green, and the layout simply
 *  wrong.
 */

/** What to observe, what to write, and in what units. No defaults. */
export interface MeasuredBoxSpec {
  /** The element whose size is the fact. */
  el: HTMLElement;
  /** The element whose inline style carries the properties. Often the root. */
  into: HTMLElement;
  /** Custom property for the height, or null to publish no height. */
  heightVar: string | null;
  /** Custom property for the width, or null to publish no width. */
  widthVar: string | null;
  /**
   * `border` reads offsetWidth/offsetHeight — integers, outer edge.
   * `content` reads the observer's contentRect — fractional, inner edge.
   */
  box: 'border' | 'content';
  /** Added to the CONTENT measurement before anything else. 0 for 'border'. */
  borderPad: number;
  /** Added to the height after the floor test. A gap below the panel. */
  gap: number;
  /** At or below this many pixels the properties publish `0px`. */
  floor: number;
  /** Also republish on a window resize. See the header. */
  onViewport: boolean;
}

export interface MeasuredBox {
  /** Measure and write now. Safe to call at any time. */
  publish(): void;
  /** Stop observing, drop the listener, and zero the properties. */
  stop(): void;
}

/**
 * Start publishing. Returns immediately without measuring — the first real
 * value arrives from the observer's initial callback, which fires as soon as
 * the element has a box.
 *
 * Degrades to the viewport listener alone where `ResizeObserver` does not
 * exist, and to nothing at all where neither does; a layer that cannot measure
 * keeps whatever the stylesheet authored, which is the right failure.
 */
export function measuredBox(spec: MeasuredBoxSpec): MeasuredBox {
  let ro: ResizeObserver | null = null;

  const write = (h: number, w: number): void => {
    if (spec.heightVar !== null) {
      spec.into.style.setProperty(
        spec.heightVar, h > spec.floor ? (h + spec.gap).toFixed(0) + 'px' : '0px');
    }
    if (spec.widthVar !== null) {
      spec.into.style.setProperty(
        spec.widthVar, w > spec.floor ? w.toFixed(0) + 'px' : '0px');
    }
  };

  const publish = (): void => {
    write(spec.el.offsetHeight, spec.el.offsetWidth);
  };

  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver((entries) => {
      if (spec.box === 'border') { publish(); return; }
      for (const e of entries) {
        write(e.contentRect.height + spec.borderPad, e.contentRect.width + spec.borderPad);
      }
    });
    ro.observe(spec.el);
  }

  const onResize = (): void => publish();
  if (spec.onViewport) addEventListener('resize', onResize);

  return {
    publish,
    stop(): void {
      if (ro) { ro.disconnect(); ro = null; }
      if (spec.onViewport) removeEventListener('resize', onResize);
      write(0, 0);
    },
  };
}
