/**
 * ============================================================================
 *  Delivery — one verified master, several honest copies of it.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **The file somebody posts is derived from the file that was graded, by a
 *   recorded transform, and it can say so.**
 *
 * ## Why this exists
 *
 * One short film's trailer was posted from the archival master because there was
 * nothing else. That works until it does not: a 1080p CRF-17 master is large,
 * has no fast-start atom, and carries no burned captions for a player that
 * autoplays muted — which is how most of a timeline watches everything.
 *
 * The retrospective asks for *"an export preset that creates a smaller
 * fast-start H.264 copy with sensible bitrate/file-size limits, BT.709
 * metadata, compliant AAC audio, optional burned-in captions, a selected
 * poster frame, and a short publishing receipt. The archival master should
 * remain separate."* The last sentence is the load-bearing one.
 *
 * ## Presets are named for what they are, never for where they go
 *
 * A preset called after a service is a preset that is wrong the next time that
 * service changes its limits, and nothing in the file says when it was right.
 * `social-short` is a description of a file: about a minute, about a
 * megabit-and-a-half a second, fast start, burned captions, square-friendly
 * safe areas. Whether a particular service accepts it is a **measured**
 * question, answered elsewhere by a delivery profile that carries dated
 * evidence and evaluates a real file against it. These presets produce the
 * candidate; that evaluates it. Neither guesses.
 *
 * ## Nothing here runs anything
 *
 * It builds argument vectors. A delivery tool runs them, and a test can
 * assert on the exact arguments with no FFmpeg installed — which
 * matters, because the arguments are where the colour metadata gets dropped
 * and a dropped colour tag is invisible until somebody watches it on a
 * different panel and says the greens look wrong.
 */

export interface DeliveryPreset {
  readonly id: string;
  /** What this file IS. Not where it goes. */
  readonly what: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number | null;
  /** Average video bitrate, bits per second. Null means quality-targeted (CRF). */
  readonly videoBitrate: number | null;
  readonly crf: number | null;
  readonly maxrate: number | null;
  readonly bufsize: number | null;
  readonly audioBitrate: number;
  readonly audioSampleRate: number;
  /** Move the index to the head so a player can start before the file arrives. */
  readonly faststart: boolean;
  /** Burn the captions into the picture, for a player that starts muted. */
  readonly burnCaptions: boolean;
  /** A soft ceiling. Exceeding it is a warning on the receipt, not a refusal. */
  readonly softMaxBytes: number | null;
}

/**
 * The archival master: what everything else is derived from.
 *
 * Quality-targeted rather than bitrate-targeted, because this file is not
 * being transmitted anywhere and a fixed bitrate on a master throws away
 * exactly the detail a later re-encode needs.
 */
export const MASTER_PRESET: DeliveryPreset = {
  id: 'master',
  what: '1080p, quality-targeted, BT.709 limited range, 320 kbps AAC. Never posted; everything else comes from it.',
  width: 1920, height: 1080, fps: null,
  videoBitrate: null, crf: 17, maxrate: null, bufsize: null,
  audioBitrate: 320_000, audioSampleRate: 48_000,
  faststart: true, burnCaptions: false, softMaxBytes: null,
};

/** What a television plays over a home network: the same picture, a smaller file. */
export const TELEVISION_PRESET: DeliveryPreset = {
  id: 'television',
  what: '1080p, ~8 Mbit/s, fast start, 256 kbps AAC. Sized for a LAN and a panel across a sofa.',
  width: 1920, height: 1080, fps: null,
  videoBitrate: 8_000_000, crf: null, maxrate: 10_000_000, bufsize: 16_000_000,
  audioBitrate: 256_000, audioSampleRate: 48_000,
  faststart: true, burnCaptions: false, softMaxBytes: null,
};

/**
 * A copy for a feed: small, fast to start, and legible with the sound off.
 *
 * The bitrate is chosen so two minutes lands near 25 MB, which is under every
 * upload limit met so far, and 720p rather than 1080p because a
 * feed re-encodes whatever it is given and handing it fewer, cleaner pixels
 * survives that better than handing it more.
 */
export const SOCIAL_PRESET: DeliveryPreset = {
  id: 'social-short',
  what: '720p, ~1.6 Mbit/s, fast start, burned captions, 128 kbps AAC. Legible muted, small enough to upload anywhere.',
  width: 1280, height: 720, fps: 30,
  videoBitrate: 1_600_000, crf: null, maxrate: 2_400_000, bufsize: 4_800_000,
  audioBitrate: 128_000, audioSampleRate: 48_000,
  faststart: true, burnCaptions: true, softMaxBytes: 40 * 1024 * 1024,
};

export const DELIVERY_PRESETS: readonly DeliveryPreset[] = [MASTER_PRESET, TELEVISION_PRESET, SOCIAL_PRESET];

export function presetById(id: string): DeliveryPreset | undefined {
  return DELIVERY_PRESETS.find((p) => p.id === id);
}

export interface DeliveryRequest {
  readonly preset: DeliveryPreset;
  readonly inPath: string;
  readonly outPath: string;
  /** An SRT to burn in. Required when the preset says `burnCaptions`. */
  readonly captionsPath?: string;
  /** Font size for burned captions, in points at the OUTPUT height. */
  readonly captionSizePt?: number;
}

/**
 * The full argument vector for one derived copy.
 *
 * Every colour tag is written on the output even though the input already has
 * them. That is not belt and braces: a scale filter produces a new stream with
 * no colour metadata at all, and an untagged BT.709 file is interpreted as
 * BT.601 by about half of everything, which shifts every green in a garden.
 * That failure looks like a grading choice and gets argued about instead of
 * fixed.
 */
export function buildDeliveryArgs(request: DeliveryRequest): string[] {
  const { preset } = request;
  if (preset.burnCaptions && !request.captionsPath) {
    throw new Error(`the "${preset.id}" preset burns captions and no captions file was given — a muted feed would play it silent and blank`);
  }

  const filters: string[] = [
    `scale=${preset.width}:${preset.height}:flags=lanczos:force_original_aspect_ratio=decrease`,
    `pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
  ];
  if (preset.burnCaptions && request.captionsPath) {
    const size = request.captionSizePt ?? Math.round(preset.height * 0.042);
    // `force_style` rather than relying on the file's own styling, because an
    // SRT has none and a player's default is a different size on every panel.
    // MarginV keeps the text inside title-safe at this height.
    filters.push(
      `subtitles=${ffEscape(request.captionsPath)}:force_style='FontName=Helvetica,FontSize=${size},` +
      `PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=3,Outline=2,Shadow=0,` +
      `Alignment=2,MarginV=${Math.round(preset.height * 0.09)}'`,
    );
  }
  filters.push('format=yuv420p');

  const args = [
    '-hide_banner', '-loglevel', 'warning', '-nostdin', '-y',
    '-i', request.inPath,
    '-vf', filters.join(','),
    ...(preset.fps ? ['-r', String(preset.fps), '-fps_mode', 'cfr'] : []),
    '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level', '4.0',
    ...(preset.crf !== null ? ['-crf', String(preset.crf)] : []),
    ...(preset.videoBitrate !== null ? ['-b:v', String(preset.videoBitrate)] : []),
    ...(preset.maxrate !== null ? ['-maxrate', String(preset.maxrate)] : []),
    ...(preset.bufsize !== null ? ['-bufsize', String(preset.bufsize)] : []),
    '-pix_fmt', 'yuv420p',
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', String(preset.audioBitrate), '-ar', String(preset.audioSampleRate), '-ac', '2',
    ...(preset.faststart ? ['-movflags', '+faststart'] : []),
    request.outPath,
  ];
  return args;
}

/**
 * One frame, for a poster.
 *
 * `-ss` BEFORE `-i` seeks by keyframe and is fast and wrong; after `-i` it
 * decodes to the exact frame and is slow and right. A poster frame is one
 * frame, so it is right.
 */
export function posterFrameArgs(inPath: string, atSeconds: number, outPath: string, width = 1920): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning', '-nostdin', '-y',
    '-i', inPath,
    '-ss', atSeconds.toFixed(3),
    '-frames:v', '1',
    '-vf', `scale=${width}:-2:flags=lanczos`,
    '-q:v', '2',
    outPath,
  ];
}

/** What a delivered copy claims about itself. */
export interface PublishingReceipt {
  readonly schema: 'homie.film-delivery/1';
  readonly filmId: string;
  readonly preset: string;
  readonly presetWhat: string;
  /** The master this was derived from, and its digest. */
  readonly fromPath: string;
  readonly fromSha256: string;
  readonly outPath: string;
  readonly outSha256: string;
  readonly bytes: number;
  readonly seconds: number;
  readonly width: number;
  readonly height: number;
  readonly captionsBurned: boolean;
  readonly posterPath: string | null;
  readonly posterAtSeconds: number | null;
  /** The exact arguments, so the transform is reproducible and arguable. */
  readonly args: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Everything worth saying about a delivered copy before somebody posts it.
 *
 * A soft limit produces a warning rather than a refusal on purpose: the person
 * holding the file knows what they are uploading it to and this code does not,
 * and a tool that refuses to produce a file somebody asked for — on a guess
 * about a third party's current limits — is a tool that gets worked around.
 */
export function deliveryWarnings(preset: DeliveryPreset, bytes: number, seconds: number): string[] {
  const warnings: string[] = [];
  if (preset.softMaxBytes !== null && bytes > preset.softMaxBytes) {
    warnings.push(`${(bytes / 1024 / 1024).toFixed(1)} MB is over this preset's ${(preset.softMaxBytes / 1024 / 1024).toFixed(0)} MB guideline`);
  }
  if (preset.id === SOCIAL_PRESET.id && seconds > 140) {
    warnings.push(`${seconds.toFixed(0)}s is longer than most feeds play inline without a tap`);
  }
  if (preset.burnCaptions === false && preset.id === SOCIAL_PRESET.id) {
    warnings.push('captions are not burned in; a feed that autoplays muted will play this silent and wordless');
  }
  return warnings;
}

/** FFmpeg's filter parser eats `:`, `'` and `\`; a path with any of them breaks the graph. */
function ffEscape(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
