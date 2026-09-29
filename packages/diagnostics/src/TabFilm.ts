/**
 * ============================================================================
 *  TabFilm.ts — record THIS tab: the only in-page capture path that sees the
 *  WebGL canvas AND the DOM over it AND hears the page.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **A page can ask the browser to share itself, encode what is presented for
 *   as long as the caller wants, hand back one blob, and leave no track running
 *   afterwards — whether it finished, was cancelled at the picker, or was
 *   aborted mid-take.**
 *
 * ## Why it is here, and the argument against it
 *
 * An earlier review of the game this came from (one base-building game's
 * trailer recorder) sized it at about 110 lines, agreed it was general, and
 * DECLINED TO MOVE IT, for a reason worth keeping because it is the right
 * instinct: a tab capture is a permission prompt and a download, and an
 * automated check has no way to see one go red. Publishing a capability whose
 * failure mode is "the person did not click Share" into a package four games
 * import, with no instrument that can observe it, is how a green suite starts
 * lying.
 *
 * That argues for an instrument, not for a second copy — and there already IS a
 * second copy: a first-person shooter's trailer recorder has its own
 * `pickMime`, its own `getDisplayMedia` block and its own `download`, written
 * apart and drifted (it asks for an audio bitrate; the other does not). Two
 * implementations of the same browser call is precisely the state the copy
 * could not be allowed to reach, and the reason it did is that nothing could
 * see either of them.
 *
 * So the shape of this file is chosen to be OBSERVABLE WITHOUT A PERSON:
 * `mediaDevices`, `MediaRecorder`, `URL` and `document` all arrive through
 * `TabFilmHost`, which defaults to the real globals. A probe hands it stubs,
 * drives a whole take, and compares the constraint object and the chosen mime
 * against the pinned pre-move source. What it still cannot see is whether a
 * real Chrome honours the constraints — that remains a person's job, and the
 * probe says so rather than claiming otherwise.
 *
 * ## What is NOT here
 *
 * The shot list, the beats, the poses, the title card and the film's name. A
 * `TabFilm` is handed a filename and told when to stop; it has never heard of
 * the game. Every number below that could be a look — resolution, frame rate,
 * bitrate, the codec preference order — is a field on `TabFilmSpec` with the
 * caller's value required at the call site for the two that are art (see
 * `DEFAULT_WEBM_CANDIDATES` for the one that is not).
 */

/**
 * The browser surface this file touches, injectable so a probe can watch it.
 *
 * DEFAULTED RATHER THAN REQUIRED, deliberately: a game must not have to
 * assemble four globals to record a film, and a default that is the real global
 * cannot drift from the real global.
 */
export interface TabFilmHost {
  readonly mediaDevices: MediaDevices;
  readonly recorderCtor: typeof MediaRecorder;
  readonly url: { createObjectURL(b: Blob): string; revokeObjectURL(u: string): void };
  readonly document: Document;
  setTimeout(fn: () => void, ms: number): unknown;
}

function realHost(): TabFilmHost {
  return {
    mediaDevices: navigator.mediaDevices,
    recorderCtor: MediaRecorder,
    url: URL,
    document,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  };
}

/**
 * The codec preference order every webm capture in these games has used.
 *
 * This one IS a shared default rather than a caller's number, and the reason is
 * that it is not a taste: it is "the best thing this browser will actually
 * encode", tried best-first, and a game with an opinion about it would be a
 * game with an opinion about someone else's Chrome build. A caller may still
 * pass its own list — the shooter's trailer recorder proves that need is
 * real, since it wants a different audio bitrate around the same order.
 */
export const DEFAULT_WEBM_CANDIDATES: readonly string[] = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** What a take asks the browser for. Every field is the caller's. */
export interface TabFilmSpec {
  /** Requested capture size in pixels. Chrome treats these as a ceiling. */
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  /** Video bitrate. 12e6 is what a 60 s 1080p game trailer wants. */
  readonly videoBitsPerSecond?: number;
  readonly audioBitsPerSecond?: number;
  /**
   * How often the recorder flushes a chunk, milliseconds.
   *
   * NOT COSMETIC. `MediaRecorder.start()` with no argument delivers ONE blob at
   * stop, so a take that is aborted — or a tab that is closed — yields nothing
   * at all. A timeslice means the take that got interrupted still has most of
   * itself on the floor.
   */
  readonly timesliceMs: number;
  readonly mimeCandidates?: readonly string[];
}

/**
 * The best mime in `candidates` this browser will encode, or the last one as a
 * last resort.
 *
 * Falling back to the final candidate rather than to `''` is deliberate and it
 * is the pre-move behaviour: `MediaRecorder` with an unsupported `mimeType`
 * throws, and the constructor below catches that and builds an unconfigured
 * recorder — which produces a file. `''` would produce a file too, but it would
 * also silently discard the caller's bitrate, and a 60-second 1080p take at the
 * browser's default bitrate is a smeared unusable film that looks like a
 * rendering fault rather than an encoder setting.
 */
export function pickRecordingMime(
  candidates: readonly string[] = DEFAULT_WEBM_CANDIDATES,
  ctor: typeof MediaRecorder | undefined = typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined,
): string {
  for (let i = 0; i < candidates.length; i++) {
    if (ctor && ctor.isTypeSupported(candidates[i]!)) return candidates[i]!;
  }
  return candidates[candidates.length - 1] ?? 'video/webm';
}

/**
 * Ask the browser to share THIS tab.
 *
 * The four non-standard fields are Chrome's and are not in `lib.dom`, which is
 * why the object is cast. They are the difference between a picker that offers
 * the current tab first and a picker where the obvious choice — a monitor —
 * records the picker itself. `monitorTypeSurfaces: 'exclude'` removes that
 * choice entirely rather than trusting the person to avoid it.
 *
 * Rejects when the person cancels. That is not an error, and every caller has
 * to treat it as "they changed their mind" rather than as a failure.
 */
export function shareThisTab(spec: TabFilmSpec, host: TabFilmHost = realHost()): Promise<MediaStream> {
  return host.mediaDevices.getDisplayMedia({
    video: { frameRate: spec.frameRate, width: spec.width, height: spec.height },
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    systemAudio: 'include',
    monitorTypeSurfaces: 'exclude',
  } as MediaStreamConstraints);
}

/**
 * Hand a blob to the person as a file.
 *
 * The revoke is on a timer rather than immediate because Chrome starts the save
 * asynchronously from the synthetic click, and revoking inside the same task
 * cancels a download that has already been reported as started.
 */
export function offerDownload(blob: Blob, name: string, host: TabFilmHost = realHost()): void {
  const url = host.url.createObjectURL(blob);
  const a = host.document.createElement('a');
  a.href = url;
  a.download = name;
  host.document.body.appendChild(a);
  a.click();
  a.remove();
  host.setTimeout(() => host.url.revokeObjectURL(url), 4000);
}

/**
 * One take.
 *
 * Deliberately NOT a "record for N seconds" helper: what happens between
 * `begin()` and `finish()` is the caller's film, and a package that owned the
 * clock would own the shot. This owns the encoder, the chunk list and the
 * teardown, which is the part that is the same in every film anyone shoots.
 */
export class TabFilm {
  #rec: MediaRecorder | null = null;
  #stream: MediaStream | null = null;
  #chunks: Blob[] = [];
  #stopped: Promise<void> | null = null;
  #mime = '';
  #aborted = false;

  constructor(
    private readonly spec: TabFilmSpec,
    private readonly host: TabFilmHost = realHost(),
  ) {}

  get recording(): boolean { return this.#rec !== null; }
  get aborted(): boolean { return this.#aborted; }
  /** The mime the encoder actually accepted, once `begin` has run. */
  get mime(): string { return this.#mime; }

  /** Ask for the tab. Resolves to null when the person cancels the picker. */
  async share(): Promise<MediaStream | null> {
    try {
      this.#stream = await shareThisTab(this.spec, this.host);
      return this.#stream;
    } catch {
      this.#stream = null;
      return null;
    }
  }

  /** Start encoding the stream `share()` returned. */
  begin(): void {
    const stream = this.#stream;
    if (!stream || this.#rec) return;
    this.#chunks = [];
    this.#aborted = false;
    this.#mime = pickRecordingMime(this.spec.mimeCandidates ?? DEFAULT_WEBM_CANDIDATES, this.host.recorderCtor);
    const Ctor = this.host.recorderCtor;
    let rec: MediaRecorder;
    try {
      // A browser that reports a mime supported and then refuses it at
      // construction is not hypothetical — that is what the fallback is for,
      // and an unconfigured recorder still produces a film.
      const opts: MediaRecorderOptions = { mimeType: this.#mime };
      if (this.spec.videoBitsPerSecond !== undefined) opts.videoBitsPerSecond = this.spec.videoBitsPerSecond;
      if (this.spec.audioBitsPerSecond !== undefined) opts.audioBitsPerSecond = this.spec.audioBitsPerSecond;
      rec = new Ctor(stream, opts);
    } catch {
      rec = new Ctor(stream);
    }
    this.#rec = rec;
    rec.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size) this.#chunks.push(e.data); };
    this.#stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
    rec.start(this.spec.timesliceMs);
  }

  /**
   * Stop encoding, wait for the encoder to flush, drop every track, and return
   * the film.
   *
   * THE TRACKS ARE STOPPED HERE AND ON THE ABORT PATH BOTH. A live capture track
   * leaves Chrome's "sharing this tab" bar up over a game that has finished
   * filming, which reads as the page having hung.
   */
  async finish(): Promise<Blob> {
    const rec = this.#rec;
    if (rec && rec.state === 'recording') rec.stop();
    if (this.#stopped) await this.#stopped;
    this.#teardown();
    // The container type, without the codec clause: a `Blob` typed with a
    // codecs= parameter is rejected by some players that accept the same bytes
    // typed as the container alone.
    return new Blob(this.#chunks, { type: this.#mime.split(';')[0] || 'video/webm' });
  }

  /** Give up mid-take. Whatever has flushed so far is still in `finish()`. */
  abort(): void {
    this.#aborted = true;
    const rec = this.#rec;
    if (rec && rec.state === 'recording') rec.stop();
    if (this.#stream) for (const t of this.#stream.getTracks()) t.stop();
  }

  #teardown(): void {
    if (this.#stream) for (const t of this.#stream.getTracks()) t.stop();
    this.#stream = null;
    this.#rec = null;
    this.#stopped = null;
  }
}
