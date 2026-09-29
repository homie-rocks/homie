/**
 * ============================================================================
 *  Every device a player might be holding, brought up and taken down together.
 * ============================================================================
 *  `Keys`, `PadReader`, `Pulse` and `TouchPresence` were already here, one file
 *  each, each knowing exactly one device. What was still sitting in two places
 *  was the RIG they are wired into: the four fields, the four listeners, the
 *  order they come up in, the order they go down in, and the two forwarders the
 *  rest of a game's `Input` reaches them through.
 *
 *  Measured 2026-08-21, before this file existed: the input modules of a kart
 *  racer and a space racer carried it BYTE FOR BYTE, comments included, in the
 *  same order, down to the blank lines. That is not a coincidence to be tidied
 *  up — it is one mechanism that got copied, and while it is copied the two
 *  games can drift apart at the one place that decides whether a controller
 *  works at all.
 *
 *  ---------------------------------------------------------------------------
 *  IT STILL KNOWS WHAT A STICK READS AND NEVER WHAT A BUTTON MEANS
 *
 *  This package's rule is the README's and it is unchanged here. Look at what
 *  is NOT on this class: no `steer`, no `accel`, no `drift`, no item, no pause,
 *  no `state`. It owns four devices, one bring-up, one teardown, and two
 *  forwarders. The four `was*` flags are the one thing that comes close, and
 *  they are edge bookkeeping — "was this held last frame" is a property of a
 *  frame boundary, not of a button; the game names the buttons and decides
 *  which edges are worth reporting.
 *
 *  ---------------------------------------------------------------------------
 *  WHY IT IS A BASE CLASS AND NOT A FIELD
 *
 *  The alternative was `private rig = new DeviceRig(...)`, which reads better in
 *  the abstract and costs a rename at every one of the ~90 sites in the two
 *  games that say `this.reader`, `this.keys`, `this.presence`, `this.pulser`,
 *  `this.padSteered` or `this.padUsed`. A rename that large is where an edit
 *  that does not apply hides, and none of those sites is being improved by it.
 *  Extending means NO CALL SITE CHANGES, which is the same reason
 *  `@homie-rocks/device/ThumbPad.ts` is a base class.
 *
 *  It is generic over `RigPad` — FOUR MEMBERS, listed below — rather than over
 *  a game's `TouchControls`, because a god-object argument makes a package
 *  depend on every field any game ever adds. Both games' `TouchControls`
 *  satisfy `RigPad` structurally already.
 *
 *  THE FIELD ORDER IS LOAD-BEARING AND IT IS SAFE. A base class's field
 *  initialisers run BEFORE a derived class's, so `this.pad` is still undefined
 *  while `presence` and `pulser` are being constructed. Neither reads it: the
 *  hooks are arrow functions, evaluated when the presence mounts and when the
 *  motor is asked, both of which are long after the constructor. If you add a
 *  field here that touches `this.pad` eagerly, it will be `undefined` and the
 *  symptom will be an on-screen pad that never appears.
 *
 *  ---------------------------------------------------------------------------
 *  NOTHING HERE IS VERIFIED UNDER A THUMB OR A CONTROLLER.
 *
 *  Said plainly rather than left to be inferred. There is no automated
 *  instrument that can press a DualSense — the Gamepad API is fed by real HID
 *  traffic and CDP has no gamepad domain — and CDP touch events bypass the
 *  browser's gesture arbitration, so a synthetic touch harness passes green
 *  while every control is dead under a real thumb. The rig's probe measures the
 *  bring-up and the teardown exhaustively and prints that caveat on every run.
 * ============================================================================
 */
import { Keys } from './Keys.ts';
import { PadReader, type PadTuning } from './PadReader.ts';
import { Pulse, type PulseBudget } from './Pulse.ts';
import { TouchPresence, blockPageGestures } from './TouchPresence.ts';

/**
 * The four things this rig asks of a game's on-screen pad, and no more.
 *
 * `pulse` is assignable rather than a method because the rig WRITES it: the
 * pad gets the one haptics gate so a control-level tick obeys the same budget
 * as a gameplay one, instead of inventing a second path to the motor.
 */
export interface RigPad {
  /** show the on-screen controls */
  mount(): void;
  /** take them away again */
  unmount(): void;
  /** the one field of a game's pad state this rig reads */
  readonly state: { readonly haptics: boolean };
  /** written once at bring-up, so the pad's own ticks go through the budget */
  pulse: (pattern: number[]) => void;
}

export abstract class DeviceRig<P extends RigPad> {
  /**
   * The game's on-screen pad.
   *
   * PUBLIC in both games deliberately, and their comments say why: the controls
   * screen drives it and their `IInput` may not be widened for it, so the UI
   * reaches it through a cast. Declared `protected abstract` here so a derived
   * class may widen it to public — which is what both do.
   */
  protected abstract readonly pad: P;

  protected readonly keys: Keys;
  /** the physical controller */
  protected readonly reader: PadReader;
  /** the phone's motor, on the budget the game supplied */
  protected readonly pulser: Pulse;
  /** the two-stage "is a finger driving this" decision */
  protected readonly presence: TouchPresence;

  /** true once a finger has actually driven the on-screen pad */
  protected padUsed = false;
  /**
   * True once the gamepad stick has been the steering source.
   *
   * IT IS DROPPED BY `PadReader`'s `onLost`, WIRED BELOW, AND THAT WIRE IS THE
   * WHOLE REASON THE FLAG LIVES HERE. The package has no business knowing what
   * a steering source is — its own comment says so — so it takes a callback,
   * and the callback needs somewhere to write. What the flag MEANS afterwards
   * (whether a centred stick reports centre or lets a key ramp take over) is
   * the game's, read in the game's `update()`, and nothing in this file reads
   * it back.
   */
  protected padSteered = false;

  /** edge bookkeeping — previous frame's held state per logical button */
  protected wasDrift = false;
  protected wasItem = false;
  protected wasPause = false;
  protected wasAny = false;

  /**
   * THREE ARGUMENTS, NO DEFAULTS, and that is the same rule the rest of this
   * package follows: every one of them is a taste about a thumb, and a default
   * here would silently become one game's feel imposed on the other. A game
   * that forgets one fails to compile, which is the point.
   */
  constructor(swallow: Iterable<string>, padTuning: PadTuning, pulseBudget: PulseBudget) {
    this.keys = new Keys(swallow);
    this.reader = new PadReader(padTuning, () => { this.padSteered = false; });
    this.pulser = new Pulse(pulseBudget, () => !(this.touch && !this.pad.state.haptics));
    this.presence = new TouchPresence({
      mount: () => this.pad.mount(),
      unmount: () => this.pad.unmount(),
      used: () => this.padUsed,
    });
  }

  /** true if the player is on a touch device and the virtual pad is shown */
  get touch() { return this.presence.touch; }

  /**
   * Bring every device up. STATEMENT FOR STATEMENT IN THE ORDER IT WAS IN, in
   * both games, and that is not a style point — `blockPageGestures()` after
   * `presence.start()` is what the shipped games do, and reordering a bring-up
   * to read better is how a listener ends up attached to a page state that has
   * already changed under it.
   */
  protected startDevices() {
    this.keys.listen();
    addEventListener('gamepadconnected', this.onPad);
    addEventListener('gamepaddisconnected', this.onPadOff);
    this.presence.start();
    blockPageGestures();

    // Give the pad the one haptics gate, so a control-level tick obeys the same
    // budget as a gameplay one rather than inventing a second path.
    this.pad.pulse = (p) => this.pulse(p);
  }

  /**
   * Take them all down again.
   *
   * EVERY LISTENER `startDevices` ADDED IS REMOVED HERE, and the rig's probe
   * asserts that as an outcome rather than by reading this list — a teardown
   * checked against a hand-kept list rots upward, passing while covering less.
   * A game's own `dispose()` still owns whatever IT subscribed to; this owns
   * the devices.
   */
  protected stopDevices() {
    this.keys.stop();
    removeEventListener('gamepadconnected', this.onPad);
    removeEventListener('gamepaddisconnected', this.onPadOff);
    this.presence.stop();
  }

  protected onPad = (e: GamepadEvent) => { this.reader.connected(e.gamepad.index); };
  protected onPadOff = () => { this.reader.disconnected(); };

  /**
   * Two forwarders, kept because the event table in a game's `init()` is the
   * readable half of that file and it names them a dozen times.
   *
   * `haptic()` drives a GAMEPAD; `pulse()` drives a PHONE. They are different
   * devices taking different units and conflating them was a real bug — the
   * phone path was once gated on a dual-rumble MAGNITUDE, so the two events the
   * whole boost loop is built on never vibrated while being hit did. Both
   * budgets live in this package; WHAT IS WORTH FEELING stays in the game, and
   * that is the seam.
   */
  protected haptic(strong: number, weak: number, ms: number) { this.reader.rumble(strong, weak, ms); }
  protected pulse(pattern: number[]) { this.pulser.fire(pattern); }
}
