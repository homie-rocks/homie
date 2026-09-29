/**
 * ===========================================================================
 *  Device classification
 * ===========================================================================
 *  This used to be `/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)`.
 *  That test is wrong in the one way that matters most: iPadOS Safari defaults
 *  to "Request Desktop Website" and reports a *Macintosh* user agent with no
 *  iPad token anywhere in it. The same mistake has already bitten the touch
 *  controls in this project once. An iPad falling through to the desktop GPU
 *  sniff below reports an Apple GPU string and is handed Ultra, which on a
 *  device with a shared memory pool is an instant jetsam kill.
 *
 *  So the UA is used only as corroboration, never as the deciding signal. The
 *  signals that actually describe the hardware are:
 *
 *    pointer: coarse / hover: none  — the browser telling us the primary input
 *                                     is a finger. True on every phone and
 *                                     tablet including desktop-mode iPadOS.
 *    navigator.maxTouchPoints       — non-zero on iPadOS in desktop mode; zero
 *                                     on a Mac, trackpad and Touch Bar alike.
 *    screen.width/height            — CSS pixels of the panel, which separates
 *                                     a phone from a tablet far more reliably
 *                                     than any device name.
 *    deviceMemory / hardwareConcurrency — where the browser offers them, a
 *                                     direct read on the memory ceiling we are
 *                                     actually budgeting against.
 *
 *  A touch laptop (Surface, some Chromebooks) reports coarse pointer *and* a
 *  large screen *and* plenty of cores, so it lands on the desktop path, which
 *  is the intent.
 * ===========================================================================
 *
 *  EXTRACTED 2026-08-19, VERBATIM, FROM FOUR GAMES THAT HAD IT BYTE-IDENTICAL.
 *  `mql`, `NavExtras`, `DeviceProfile`, `profileDevice` and `device` were the
 *  same bytes in all four (one hash over the block); one differed only in the
 *  reflow of the comment above and in one doc line of `device()`. Four
 *  copies of one function, so the reduction is provable by hash rather than by
 *  argument.
 *
 *  THE REST OF THE GAMES' SETTINGS FILE IS NOT HERE AND MUST NOT COME HERE.
 *  That file also holds `glCapabilities()`, the quality presets, the texture
 *  cap and the pixel budget — roughly 640 lines that belong to
 *  `@homie-rocks/render`. The one file was split in two; this package took the
 *  device half and left the GL half exactly where it was.
 *
 *  THE NAME COLLISION THAT WOULD HAVE MERGED THE WRONG TWO THINGS. There is a
 *  SECOND `interface DeviceProfile` in the games this came from — `{ webgl2,
 *  halfFloat, software, name }`, with its own `probeDevice()`, in the renderer
 *  of three of the four. It is a GL capability record and has nothing to do
 *  with a panel. An extraction driven by the symbol name merges them; those
 *  three stay in their games and this package never sees them.
 * ===========================================================================
 */

function mql(q: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(q).matches;
}

interface NavExtras {
  maxTouchPoints?: number;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  userAgentData?: { mobile?: boolean };
}

export interface DeviceProfile {
  /** primary input is a finger — phone or tablet, including desktop-mode iPadOS */
  touchPrimary: boolean;
  /** touch device whose panel is phone-sized; the tightest memory ceiling we ship to */
  handheld: boolean;
  /** GB of RAM if the browser will say, else 0 */
  memoryGB: number;
  cores: number;
  /** shortest edge of the panel in CSS pixels */
  minEdge: number;
  dpr: number;
}

export function profileDevice(): DeviceProfile {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & NavExtras;
  const touchPoints = nav.maxTouchPoints ?? 0;
  const coarse = mql('(pointer: coarse)') || mql('(any-pointer: coarse)');
  const noHover = mql('(hover: none)');
  const uaMobile = nav.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile Safari|Silk/i.test(nav.userAgent || '');

  // Two independent signals must agree, so a desktop browser that happens to
  // report a coarse pointer (a plugged-in tablet, a remote session) does not
  // get demoted, and an iPad in desktop mode — coarse + 5 touch points — does.
  const touchPrimary = ((coarse || noHover) && touchPoints > 0) ||
    (uaMobile && (coarse || noHover || touchPoints > 0));

  const sw = typeof screen !== 'undefined' ? screen.width || 0 : 0;
  const sh = typeof screen !== 'undefined' ? screen.height || 0 : 0;
  const minEdge = Math.min(sw || 9999, sh || 9999);
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const memoryGB = nav.deviceMemory ?? 0;
  const cores = nav.hardwareConcurrency ?? 0;

  // 500 CSS px of short edge is comfortably above every phone in landscape
  // (iPhone 15 Pro Max is 430) and comfortably below every tablet (iPad mini is
  // 744). A "large" phone and a "small" tablet do not overlap here.
  const handheld = touchPrimary && (minEdge <= 500 || (memoryGB > 0 && memoryGB <= 4));

  return { touchPrimary, handheld, memoryGB, cores, minEdge, dpr };
}

let deviceProfile: DeviceProfile | null = null;

/**
 * The classification a game's settings read. Systems may read it; none may
 * write it. Probed once, then memoised.
 *
 * KNOWN, MEASURED, AND DELIBERATELY NOT FIXED IN THE PARITY COMMIT: this
 * memoises `dpr`, and `devicePixelRatio` changes when a window is dragged
 * between displays or the browser is zoomed. Three games compute a resolution
 * floor from the memoised value, so this is a cache of a fact that will
 * outlive the fact and then answer for it. Symptom on a single fixed panel:
 * NONE. UNMEASURED for a laptop with an external monitor. The fix is a
 * behaviour change and belongs in its own commit: memoise only what cannot
 * change and read `dpr` and `minEdge` on demand.
 */
export function device(): DeviceProfile {
  return (deviceProfile ??= profileDevice());
}
