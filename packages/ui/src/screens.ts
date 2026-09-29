/**
 * ============================================================================
 *  ScreenRouter — lifecycle, forced review routes, focus and confirmation.
 * ============================================================================
 *
 * A screen router is an `@homie-rocks/ui` capability. The working mechanism
 * existed inside `MenuShell`, where it was inseparable from race states, standings,
 * pause commands and lap boards. A new non-racing game could not reuse it
 * without pretending to be a race.
 *
 * This module is the smaller answer underneath that shell. It knows that one
 * named screen is current, that screens enter and exit, that a review URL can
 * force one, and that a finite list of controls can be walked and confirmed.
 * It does not know what a screen means, what state requests it, what any button
 * says, or what happens when that button is pressed.
 */

/** The DOM surface the router needs; kept structural so tests need no browser. */
export interface ScreenElement {
  readonly classList: {
    add(name: string): void;
    remove(name: string): void;
    toggle(name: string, force?: boolean): boolean;
  };
  click?(): void;
}

/** A dynamic focus list. The caller keeps the semantic index. */
export interface ScreenFocus {
  items(): readonly ScreenElement[];
  read(): number;
  write(index: number): void;
}

/** One registered screen. Its content and styling remain entirely caller-owned. */
export interface RoutedScreen {
  readonly root: ScreenElement;
  readonly focus?: ScreenFocus;
  /** Overrides the default “click the focused item” confirmation. */
  confirm?(): void;
  enter?(): void;
  exit?(): void;
  quiesce?(): void;
}

export interface ScreenRouterOptions<N extends string> {
  /** The closed vocabulary. Unknown query values are refused, never cast. */
  readonly names: readonly N[];
  /** Query parameter used by capture/review. `false` disables forcing. */
  readonly param?: string | false;
  /** Injectable for tests and non-window runtimes; defaults to location.search. */
  readonly search?: string;
  readonly activeClass?: string;
  readonly focusClass?: string;
  /** Called only after a focus index actually changes. */
  readonly onMove?: (screen: N, index: number) => void;
}

export interface ScreenRouter<N extends string> {
  readonly current: N | null;
  readonly forced: N | null;
  add(name: N, screen: RoutedScreen): void;
  show(name: N | null): void;
  force(name: N): void;
  clearForced(): void;
  /** The forced review route when present, otherwise the caller's desired screen. */
  resolve(want: N | null): N | null;
  nav(dir: -1 | 1): boolean;
  confirm(): boolean;
  quiesce(): void;
  dispose(): void;
}

/** Create a router with no game vocabulary and no renderer dependency. */
export function createScreens<N extends string>(opts: ScreenRouterOptions<N>): ScreenRouter<N> {
  const names = new Set<N>(opts.names);
  if (names.size !== opts.names.length) throw new Error('ScreenRouter: duplicate name in options');

  const activeClass = opts.activeClass ?? 'on';
  const focusClass = opts.focusClass ?? 'sel';
  const screens = new Map<N, RoutedScreen>();
  let current: N | null = null;

  const search = opts.search ?? (typeof location === 'undefined' ? '' : location.search);
  const param = opts.param === undefined ? 'ui' : opts.param;
  const query = param === false ? null : new URLSearchParams(search).get(param);
  let forced = query !== null && names.has(query as N) ? query as N : null;

  const requireName = (name: N): void => {
    if (!names.has(name)) throw new Error(`ScreenRouter: unknown screen ${JSON.stringify(name)}`);
  };
  const requireScreen = (name: N): RoutedScreen => {
    requireName(name);
    const screen = screens.get(name);
    if (!screen) throw new Error(`ScreenRouter: screen ${JSON.stringify(name)} was not added`);
    return screen;
  };

  const syncFocus = (screen: RoutedScreen): boolean => {
    const focus = screen.focus;
    if (!focus) return false;
    const items = focus.items();
    if (items.length === 0) return false;
    const raw = focus.read();
    const index = Number.isFinite(raw) ? ((Math.trunc(raw) % items.length) + items.length) % items.length : 0;
    if (index !== raw) focus.write(index);
    for (let i = 0; i < items.length; i++) items[i]!.classList.toggle(focusClass, i === index);
    return true;
  };

  return {
    get current() { return current; },
    get forced() { return forced; },

    add(name, screen) {
      requireName(name);
      if (screens.has(name)) throw new Error(`ScreenRouter: screen ${JSON.stringify(name)} was added twice`);
      screens.set(name, screen);
    },

    show(name) {
      if (name === current) return;
      const previous = current === null ? null : requireScreen(current);
      const next = name === null ? null : requireScreen(name);
      if (previous) {
        previous.root.classList.remove(activeClass);
        previous.exit?.();
      }
      current = name;
      if (next) {
        next.root.classList.add(activeClass);
        syncFocus(next);
        next.enter?.();
      }
    },

    force(name) {
      requireName(name);
      forced = name;
    },

    clearForced() { forced = null; },
    resolve(want) { return forced ?? want; },

    nav(dir) {
      if (current === null || (dir !== -1 && dir !== 1)) return false;
      const screen = requireScreen(current);
      const focus = screen.focus;
      if (!focus) return false;
      const items = focus.items();
      if (items.length === 0) return false;
      const from = Number.isFinite(focus.read()) ? Math.trunc(focus.read()) : 0;
      const index = ((from + dir) % items.length + items.length) % items.length;
      focus.write(index);
      syncFocus(screen);
      if (index !== from) opts.onMove?.(current, index);
      return true;
    },

    confirm() {
      if (current === null) return false;
      const screen = requireScreen(current);
      if (screen.confirm) {
        screen.confirm();
        return true;
      }
      const focus = screen.focus;
      if (!focus) return false;
      const items = focus.items();
      if (items.length === 0) return false;
      const index = ((Math.trunc(focus.read()) % items.length) + items.length) % items.length;
      const item = items[index];
      if (!item?.click) return false;
      item.click();
      return true;
    },

    quiesce() {
      if (current !== null) requireScreen(current).quiesce?.();
    },

    dispose() {
      if (current !== null) {
        const screen = requireScreen(current);
        screen.root.classList.remove(activeClass);
        screen.exit?.();
      }
      current = null;
      forced = null;
      screens.clear();
    },
  };
}
