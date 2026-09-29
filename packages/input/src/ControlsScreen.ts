/**
 * ============================================================================
 *  ControlsScreen — the WIRING between a thumb pad and the controls sheet.
 * ============================================================================
 *
 * `ControlsSheet` (beside this file) already owns the picture: the two
 * columns, the segmented control, the glyphs, the live meter, the tilt
 * permission dance and the layout half of the stylesheet. What it does NOT
 * own is which knobs a game hangs on it, and until now each racer carried its
 * own 90-to-110 line class doing exactly that — the same six rows, reading
 * and writing the same seven methods on the same `ThumbPad` base, with the
 * same three comments explaining the same three traps.
 *
 * Measured on 2026-08-21, the controls menus of a kart racer and a space
 * racer were 54 shared lines with **44 of them lifting verbatim out of runs of
 * ten or more, the longest 24 lines** — the highest strict ratio left anywhere
 * in the games this was extracted from. This file is
 * those 44 lines, once.
 *
 * ---------------------------------------------------------------------------
 * WHAT MOVED, AND WHAT DELIBERATELY DID NOT
 * ---------------------------------------------------------------------------
 * MOVED, because it is one mechanism and not two:
 *
 *   · the six settings — hand, throttle, steering help, the assist, vibration
 *     and tilt range — including their option VALUES (0 / 0.35 / 0.6 is a
 *     tuning both games arrived at and neither has a reason to differ on) and
 *     which `set*` on the pad each one writes;
 *   · the meter's source, including the branch that is the whole reason it is
 *     not just `state.steer` — see `meter` below;
 *   · the sensor block, which is five one-line forwards to the pad;
 *   · the lifecycle: `attach` / `show` / `close` / `update`, and the guard in
 *     `update` that a race ending behind this screen must close it;
 *   · the footnote, including the branch on `navigator.vibrate`.
 *
 * DID NOT MOVE, and is on `ControlsScreenSpec`:
 *
 *   · **the cards.** Which schemes exist is the same four ids in both games,
 *     but what they are CALLED and how they are described is copy — "Roll the
 *     phone. Both thumbs free for the buttons." against "Roll the handset.
 *     Both thumbs free for the air-brakes." A package that wrote that sentence
 *     would be writing one game's fiction into the other's.
 *   · **`assistLabel`.** `prefs.driftAssist` is one stored number with one
 *     meaning per game: an auto-drift in the kart, an air-brake hold in the
 *     ship. The wiring is identical; the word is not, and it is the word the
 *     player reads.
 *   · **`notes`.** Lines about controls a game ADDED that no scheme covers.
 *   · **`theme`.** Art direction. This package refuses to own a livery.
 *
 * Every one of those four is REQUIRED. There is no default and no `?`,
 * deliberately: a game that forgets its theme should fail to compile, because
 * a game that silently inherits the sibling's `--kc-accent` looks completely
 * fine and is wearing the other game's colours in front of the players.
 *
 * ---------------------------------------------------------------------------
 * NO `Ctx` CROSSES THIS SEAM
 * ---------------------------------------------------------------------------
 * `ControlsPad` below is exactly the fields this file reads off the pad and
 * nothing else — six preferences, two output axes, `auto`, seven setters and
 * the four tilt members. `ThumbPad` satisfies it structurally, so neither
 * game changed a call site to get here. Notably absent: anything about a
 * race. `update()` takes a BOOLEAN, not a race state, because the only thing
 * this screen ever wanted to know is "should you get out of the way now".
 * ============================================================================
 */
import { ControlsSheet, type SheetCard } from './ControlsSheet.ts';

/**
 * Exactly what the controls screen reads off a thumb pad.
 *
 * `@homie-rocks/device`'s `ThumbPad` satisfies this and so does anything else that
 * stores the same six preferences; the interface is declared here rather than
 * imported so this package does not take a dependency on that one for a
 * shape it only reads.
 */
export interface ControlsPad {
  readonly prefs: {
    scheme: string;
    hand: string;
    haptics: boolean;
    steerAssist: number;
    driftAssist: number;
    tiltRange: number;
  };
  readonly state: { steer: number; digital: number };
  /** auto-throttle. Lives on the pad rather than in `prefs` — see ThumbPad. */
  readonly auto: boolean;
  readonly tiltAvailable: boolean;
  readonly tiltDegrees: number;
  setScheme(id: string): void;
  setHand(hand: 'right' | 'left'): void;
  setAuto(on: boolean): void;
  setSteerAssist(a: number): void;
  setDriftAssist(a: number): void;
  setHaptics(on: boolean): void;
  setTiltRange(deg: number): void;
  requestTilt(): Promise<boolean>;
  recentreTilt(): void;
  setPreview(on: boolean): void;
}

/** The four things about this screen that are the GAME's, not the platform's. */
export interface ControlsScreenSpec {
  /** the ways to steer, in this game's own words. Ids must be the pad's. */
  cards: SheetCard[];
  /** what this game calls `prefs.driftAssist` to the player. */
  assistLabel: string;
  /** lines about controls only this game has. `[]` when there are none. */
  notes: string[];
  /** the `--kc-*` token block, plus any rules only this game's stack needs. */
  theme: string;
}

/**
 * The controls screen: a `ControlsSheet` with a thumb pad on the other end.
 *
 * Two rules are decided HERE rather than by a consumer, because both were
 * paid for once already and a second game should not get to re-decide them:
 *
 * 1. **Nothing this screen does can end a round.** Every control below either
 *    writes a preference or calls `setScheme`, which releases every pointer
 *    and zeroes the command; none of them touches the game's own state. This
 *    screen is reachable from the pause menu mid-round and switching schemes
 *    there resumes into the new one. The pause menu that permanently ended
 *    your race is the reason that sentence is in this comment.
 *
 * 2. **The one outside state it acts on arrives as a boolean.** See `update`.
 */
export class ControlsScreen {
  private readonly sheet: ControlsSheet;
  private pad: ControlsPad | null = null;
  /** the consumer's click feedback, if it has any. Null until `attach`. */
  private emit: ((name: 'move' | 'confirm') => void) | null = null;

  /** true while this screen owns the frame */
  get open() { return this.sheet.open; }

  constructor(parent: HTMLElement, spec: ControlsScreenSpec) {
    this.sheet = new ControlsSheet(parent, {
      title: 'Controls',
      cards: spec.cards,
      card: () => this.pad?.prefs.scheme,
      choose: (id) => this.pad?.setScheme(id),
      // The meter reads the STEERING SOURCE, and which field that is depends on
      // the scheme: the `buttons` scheme reports a digital request rather than
      // an axis, and showing `steer` there would show the ramp instead of the
      // press the player just made.
      meter: {
        label: 'Steer',
        read: () => (this.pad?.prefs.scheme === 'buttons' ? this.pad.state.digital : this.pad?.state.steer ?? 0),
      },
      sensor: {
        card: 'tilt',
        request: () => this.pad?.requestTilt() ?? Promise.resolve(false),
        recentre: () => this.pad?.recentreTilt(),
        available: () => this.pad?.tiltAvailable ?? false,
        degrees: () => this.pad?.tiltDegrees ?? 0,
      },
      rows: [
        {
          key: 'hand', label: 'Hand',
          options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }],
          get: () => this.pad?.prefs.hand, set: (v) => this.pad?.setHand(v as 'right' | 'left'),
        },
        {
          key: 'auto', label: 'Throttle',
          options: [{ value: true, label: 'Auto' }, { value: false, label: 'Manual' }],
          get: () => this.pad?.auto, set: (v) => this.pad?.setAuto(v as boolean),
        },
        {
          key: 'steerAssist', label: 'Steering help',
          options: [{ value: 0, label: 'Off' }, { value: 0.35, label: 'Light' }, { value: 0.6, label: 'Strong' }],
          get: () => this.pad?.prefs.steerAssist, set: (v) => this.pad?.setSteerAssist(v as number),
        },
        {
          // The KEY is `driftAssist` in every game and the LABEL never is.
          // The key is on stored preference blobs that players already have —
          // renaming it to match a word resets everybody's saved setting — and
          // the label is what the row means in this game, which is why it is
          // the one row label on the spec.
          key: 'driftAssist', label: spec.assistLabel,
          options: [{ value: 0, label: 'Off' }, { value: 0.5, label: 'Half' }, { value: 1, label: 'Full' }],
          get: () => this.pad?.prefs.driftAssist, set: (v) => this.pad?.setDriftAssist(v as number),
        },
        {
          key: 'haptics', label: 'Vibration',
          options: [{ value: true, label: 'On' }, { value: false, label: 'Off' }],
          get: () => this.pad?.prefs.haptics, set: (v) => this.pad?.setHaptics(v as boolean),
        },
        {
          key: 'tiltRange', label: 'Tilt range',
          options: [{ value: 20, label: '20°' }, { value: 26, label: '26°' }, { value: 34, label: '34°' }],
          get: () => this.pad?.prefs.tiltRange, set: (v) => this.pad?.setTiltRange(v as number),
        },
      ],
      notes: spec.notes,
      footnote: typeof navigator.vibrate === 'function'
        ? 'Drive the control below this line · saved on this device'
        : 'Drive the control below this line · vibration unavailable in this browser',
      preview: (on) => this.pad?.setPreview(on),
      sound: (name) => this.emit?.(name),
      ready: () => this.pad !== null,
      theme: spec.theme,
    });
  }

  /**
   * Hand over the pad the settings read and write, and the click feedback.
   *
   * Both are late because the screen is constructed with the rest of the UI,
   * before the game has an input stack. Everything above reads `this.pad`
   * through an optional chain for exactly that window: a sheet built and
   * never attached shows its defaults and writes nothing, rather than
   * throwing in front of the players.
   */
  attach(pad: ControlsPad | null, sound: (name: 'move' | 'confirm') => void) {
    this.pad = pad;
    this.emit = sound;
    this.sheet.sync();
  }

  show() { this.sheet.show(); }
  close() { this.sheet.close(); }

  /**
   * One frame. `dismiss` is the game saying "the round is over" — pausing is
   * fine, but finishing behind this screen is not a state it should survive,
   * and neither is the round being reset out from under it.
   *
   * The `pad` guard is not decoration: this method used to return early
   * without one, so a results transition with no pad attached left the sheet
   * up. Reproduced rather than tidied.
   */
  update(dismiss: boolean) {
    this.sheet.update();
    if (this.sheet.open && this.pad && dismiss) this.sheet.close();
  }
}
