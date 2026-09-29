/**
 * ============================================================================
 *  Script — one durable object per spoken line, from the writing to the mix.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **A line's text, its voice, its take, its rendered audio, its transcript,
 *   its caption and its place in the mix are one object, so none of them can
 *   drift out of agreement with the others.**
 *
 * ## What it replaces
 *
 * One short film's working voice path, from its retrospective: *"a cast
 * JSON file, render and trim scripts, several transcript-QA files, manual
 * timing changes, and an FFmpeg mix graph whose input indices could shift as
 * assets changed."* Four of those five are a file that has to be kept in
 * agreement with another file by hand, and the fifth is a footgun.
 *
 * ### The index footgun, specifically
 *
 * An FFmpeg mix graph refers to its inputs as `[3:a]`. Insert one line of
 * dialogue at the head and every number after it means a different sound; the
 * command still runs, the mix still renders, and a character speaks in
 * somebody else's voice at somebody else's volume. There is no error.
 *
 * The fix is not care. It is that {@link buildMixGraph} emits the input LIST
 * and the filter graph **from the same array in the same pass**, and labels
 * every intermediate stream with the line's own id. An index cannot drift
 * from a label that was derived beside it, and a graph that names
 * `[a_mina_choice]` is one a person can read.
 *
 * ## Captions are derived, not typed
 *
 * That production typed `captionAt` and `captionTo` as absolute seconds on
 * each shot. Thirty of them, against forty-five shots whose boundaries moved
 * during the edit — and several ended up timed to a neighbouring shot's
 * window. Here a caption defaults to the rendered take's own measured length
 * at the line's authored time, and an override is shot-local. A caption cannot
 * name a window in a shot it does not belong to, because it cannot name a
 * window at all.
 *
 * ## Transcript QA is not optional and not a formality
 *
 * The retrospective calls Eleven Scribe's transcript check *"an unusually
 * valuable second check on intelligibility"*. A generated voice that says
 * something slightly different from the script is not a rendering error — it
 * is a line the audience will hear wrong and the caption will contradict.
 * {@link transcriptQA} scores every line and the coverage gate refuses a film
 * where a line has no transcript at all: unchecked and checked-and-fine must
 * not be the same colour.
 *
 * Nothing here shells out. It BUILDS the arguments and leaves running them to
 * a tool, so the whole audio path is testable in Node with no FFmpeg and no
 * network.
 */

import type { Film } from './Timeline.ts';

/* ========================================================================== */
/* The line                                                                   */
/* ========================================================================== */

/** Which voice says it, and exactly how. Provider-agnostic on purpose. */
export interface VoiceBinding {
  /** `elevenlabs`, `kokoro`, `recorded` — whatever rendered it. */
  readonly provider: string;
  /** The provider's own identifier for the voice. */
  readonly voiceId: string;
  /** Provider settings, verbatim. Opaque here; part of the receipt. */
  readonly settings?: Readonly<Record<string, unknown>>;
  /**
   * Which attempt this is. A retake is a NEW take, never an overwrite: the
   * previous file stays on disk, so "it sounded better before" is a fact that
   * can be checked rather than a thing somebody remembers.
   */
  readonly take: number;
}

/** The rendered audio for one take. */
export interface VoiceAsset {
  /** Path relative to the film's sound directory. */
  readonly path: string;
  /** Measured, not requested. */
  readonly seconds: number;
  readonly sha256?: string;
  /** Integrated loudness of the take alone, if measured. */
  readonly lufs?: number;
}

/** What a transcriber heard. */
export interface Transcript {
  readonly text: string;
  readonly provider?: string;
  /** 0…1, if the provider gives one. */
  readonly confidence?: number;
}

export type MixBus = 'dialogue' | 'narration' | 'sfx' | 'music' | 'ambience';

export interface ScriptLine {
  readonly id: string;
  /** The shot this line belongs to. Its timing is relative to that shot. */
  readonly shot: string;
  /** A cast id. */
  readonly character: string;
  /** What is written. This is the truth the transcript is compared against. */
  readonly text: string;
  /** Shot-local seconds from the cut in. */
  readonly at: number;
  readonly voice?: VoiceBinding;
  readonly asset?: VoiceAsset;
  readonly transcript?: Transcript;
  /**
   * Caption window, shot-local, overriding the derived one.
   *
   * Almost always absent. It exists for the case where a line is delivered
   * over a cut and the caption should linger, which is a directorial choice
   * and not a timing correction.
   */
  readonly caption?: { readonly at?: number; readonly to?: number };
  /** Trim, in dB. Applied before the bus. */
  readonly gainDb?: number;
  readonly bus?: MixBus;
  /** Buses this line pushes down while it speaks. */
  readonly ducks?: readonly { readonly bus: MixBus; readonly db: number }[];
  /** A line that is heard but not captioned — a crowd murmur, a radio bed. */
  readonly uncaptioned?: boolean;
}

/** A line with every derived absolute time on it. */
export interface ScheduledLine extends ScriptLine {
  /** Absolute seconds from the head of the film. */
  readonly absolute: number;
  /** Absolute caption window. */
  readonly captionFrom: number;
  readonly captionTo: number;
  /** Where the shot it belongs to starts and ends. */
  readonly shotStart: number;
  readonly shotEnd: number;
}

export interface ScriptProblem {
  readonly severity: 'error' | 'warning' | 'note';
  readonly code: string;
  readonly line: string;
  readonly detail: string;
}

/* ========================================================================== */
/* Scheduling                                                                 */
/* ========================================================================== */

export interface ScheduleOptions {
  /**
   * Seconds a caption stays up when the take's length is unknown.
   *
   * Only used for a line with no rendered asset — that is, a film being
   * written. A finished film's captions are the take lengths.
   */
  readonly assumedSeconds?: number;
  /** Extra time a caption stays on screen after the voice stops. */
  readonly captionTailSeconds?: number;
}

/**
 * Derive absolute times, and say everything wrong with the script.
 *
 * Both at once, deliberately: the problems are about the schedule, so
 * computing the schedule and then judging it in a second pass would let the
 * two disagree about what the schedule is.
 */
export function scheduleScript(
  film: Film,
  lines: readonly ScriptLine[],
  options: ScheduleOptions = {},
): { scheduled: ScheduledLine[]; problems: ScriptProblem[] } {
  const assumed = options.assumedSeconds ?? 2.4;
  const tail = options.captionTailSeconds ?? 0.35;
  const problems: ScriptProblem[] = [];
  const push = (severity: ScriptProblem['severity'], code: string, line: string, detail: string) =>
    problems.push({ severity, code, line, detail });

  const cast = new Set((film.manifest.cast ?? []).map((c) => c.id));
  const seen = new Set<string>();
  const scheduled: ScheduledLine[] = [];

  for (const line of lines) {
    if (seen.has(line.id)) push('error', 'duplicate-line', line.id, 'two script lines share an id');
    seen.add(line.id);

    const shot = film.shot(line.shot);
    if (!shot) {
      push('error', 'unknown-shot', line.id, `belongs to shot "${line.shot}", which is not in the film`);
      continue;
    }
    if (cast.size > 0 && !cast.has(line.character)) {
      push('error', 'unknown-character', line.id, `spoken by "${line.character}", who is not in the cast`);
    }
    if (line.at < 0 || line.at > shot.seconds) {
      push('error', 'line-outside-shot', line.id,
        `starts at ${line.at}s inside a ${shot.seconds}s shot`);
    }

    const spoken = line.asset?.seconds ?? assumed;
    const absolute = shot.start + line.at;
    const captionFrom = shot.start + (line.caption?.at ?? line.at);
    const captionTo = shot.start + (line.caption?.to ?? Math.min(shot.seconds, line.at + spoken + tail));

    if (!line.asset) push('warning', 'no-take', line.id, 'has no rendered audio; its caption length is assumed, not measured');
    if (!line.voice && line.asset) push('warning', 'no-voice-binding', line.id, 'has audio but does not say which voice made it — a retake cannot be reproduced');
    if (!line.transcript && line.asset) {
      push('warning', 'no-transcript', line.id,
        'has audio and no transcript — nothing has checked that the voice says what the script says');
    }
    if (line.asset && line.at + spoken > shot.seconds + 0.001) {
      push('warning', 'line-overruns-shot', line.id,
        `runs ${(line.at + spoken - shot.seconds).toFixed(2)}s past its own shot. Legal over a cut; usually a shot that got shortened.`);
    }
    if (captionTo <= captionFrom) push('error', 'caption-empty', line.id, 'the caption window has no length');

    scheduled.push({ ...line, absolute, captionFrom, captionTo, shotStart: shot.start, shotEnd: shot.end });
  }

  scheduled.sort((a, b) => a.absolute - b.absolute || a.id.localeCompare(b.id));

  // Two mouths at once on the same bus is a mix problem the writer can see and
  // the renderer cannot. Overlapping DIFFERENT buses is normal.
  for (let i = 1; i < scheduled.length; i++) {
    const a = scheduled[i - 1]!;
    const b = scheduled[i]!;
    const busA = a.bus ?? 'dialogue';
    const busB = b.bus ?? 'dialogue';
    if (busA !== busB) continue;
    const endA = a.absolute + (a.asset?.seconds ?? assumed);
    if (b.absolute < endA - 0.05) {
      push(a.character === b.character ? 'error' : 'warning', 'overlapping-dialogue', b.id,
        `starts ${(endA - b.absolute).toFixed(2)}s before "${a.id}" finishes on the same bus` +
        (a.character === b.character ? ' — and it is the same character, who has one mouth' : ''));
    }
  }

  return { scheduled, problems };
}

/* ========================================================================== */
/* Captions                                                                   */
/* ========================================================================== */

/** WebVTT, which is what a browser `<track>` wants. */
export function captionsVTT(lines: readonly ScheduledLine[], speakerPrefix = true): string {
  const rows = ['WEBVTT', ''];
  let n = 0;
  for (const line of lines) {
    if (line.uncaptioned) continue;
    n++;
    rows.push(String(n));
    rows.push(`${vttTime(line.captionFrom)} --> ${vttTime(line.captionTo)}`);
    rows.push(speakerPrefix ? `<v ${line.character}>${line.text}` : line.text);
    rows.push('');
  }
  return rows.join('\n');
}

/** SRT, which is what a burn-in filter and most players want. */
export function captionsSRT(lines: readonly ScheduledLine[]): string {
  const rows: string[] = [];
  let n = 0;
  for (const line of lines) {
    if (line.uncaptioned) continue;
    n++;
    rows.push(String(n));
    rows.push(`${srtTime(line.captionFrom)} --> ${srtTime(line.captionTo)}`);
    rows.push(line.text);
    rows.push('');
  }
  return rows.join('\n');
}

function clock(seconds: number): { h: number; m: number; s: number; ms: number } {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  // Round, not truncate: a caption cue authored at exactly 12.0005 s should
  // not land a millisecond early on one edge and late on the other.
  const ms = Math.round((total - Math.floor(total)) * 1000) % 1000;
  return { h, m, s, ms };
}
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
function vttTime(seconds: number): string {
  const { h, m, s, ms } = clock(seconds);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}
function srtTime(seconds: number): string {
  const { h, m, s, ms } = clock(seconds);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/* ========================================================================== */
/* Transcript QA                                                              */
/* ========================================================================== */

export interface LineQA {
  readonly id: string;
  readonly character: string;
  /** Word error rate, 0 = perfect. */
  readonly wer: number;
  /** The intended text, normalised. */
  readonly said: string;
  /** What the transcriber heard, normalised. */
  readonly heard: string;
  readonly verdict: 'clean' | 'drifted' | 'wrong' | 'unchecked';
}

/**
 * Compare every line's script to what a transcriber heard.
 *
 * The verdict thresholds are deliberately generous at the low end and hard at
 * the high end: a transcriber mishearing "colour" for "color" is not a defect,
 * and a line where a third of the words are different is not a line the
 * audience will follow. `unchecked` is its own verdict and never collapses
 * into `clean`.
 */
export function transcriptQA(lines: readonly ScheduledLine[]): LineQA[] {
  return lines.map((line) => {
    const said = normaliseSpeech(line.text);
    const heard = line.transcript ? normaliseSpeech(line.transcript.text) : '';
    if (!line.transcript) {
      return { id: line.id, character: line.character, wer: Number.NaN, said, heard, verdict: 'unchecked' as const };
    }
    const wer = wordErrorRate(said.split(' ').filter(Boolean), heard.split(' ').filter(Boolean));
    const verdict = wer <= 0.1 ? 'clean' as const : wer <= 0.34 ? 'drifted' as const : 'wrong' as const;
    return { id: line.id, character: line.character, wer, said, heard, verdict };
  });
}

/**
 * Lowercase, strip punctuation, collapse whitespace, and spell out the
 * handful of things a transcriber renders differently from a writer.
 *
 * The number expansion is the one that matters in practice: a script says
 * "eighteen" and a transcriber writes "18", and a word error rate that counts
 * that as an error reports a clean take as drifted, which teaches everyone to
 * ignore the metric. Only 0–20 and the round tens, because that is where the
 * disagreement actually is and a general number-to-words function here would
 * be a second implementation of something no film needs.
 */
export function normaliseSpeech(text: string): string {
  const words: Record<string, string> = {
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
    '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
    '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen', '15': 'fifteen',
    '16': 'sixteen', '17': 'seventeen', '18': 'eighteen', '19': 'nineteen', '20': 'twenty',
    '30': 'thirty', '40': 'forty', '50': 'fifty', '60': 'sixty', '70': 'seventy',
    '80': 'eighty', '90': 'ninety', '100': 'hundred',
  };
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .map((w) => words[w] ?? w)
    .join(' ')
    .trim();
}

/** Levenshtein over words, normalised by the reference length. */
export function wordErrorRate(reference: readonly string[], heard: readonly string[]): number {
  if (reference.length === 0) return heard.length === 0 ? 0 : 1;
  // One row at a time: the full matrix is O(nm) memory for no reason, and a
  // line of dialogue is short enough that the constant factor is invisible.
  let previous = Array.from({ length: heard.length + 1 }, (_, i) => i);
  for (let i = 1; i <= reference.length; i++) {
    const current = [i];
    for (let j = 1; j <= heard.length; j++) {
      const cost = reference[i - 1] === heard[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return (previous[heard.length] ?? reference.length) / reference.length;
}

/* ========================================================================== */
/* The mix                                                                    */
/* ========================================================================== */

export interface MixSource {
  /** A file to bring in that is not a dialogue line: score, ambience, a designed effect. */
  readonly id: string;
  readonly path: string;
  readonly bus: MixBus;
  /** Absolute seconds. */
  readonly at: number;
  readonly gainDb?: number;
  readonly fadeInMs?: number;
  readonly fadeOutMs?: number;
  readonly seconds?: number;
}

export interface MixOptions {
  /** Directory every `path` is relative to. */
  readonly soundDir: string;
  readonly outPath: string;
  readonly durationSeconds: number;
  /** Broadcast/streaming target. −14 LUFS is what that film's master landed on. */
  readonly targetLufs?: number;
  readonly truePeakDb?: number;
  readonly sampleRate?: number;
  /** dB the music bus drops while any dialogue plays. 0 disables ducking. */
  readonly musicDuckDb?: number;
}

export interface MixGraph {
  /** Files in the exact order they are passed to `-i`, derived beside the graph. */
  readonly inputs: readonly { readonly index: number; readonly id: string; readonly path: string }[];
  /** The `-filter_complex` string. */
  readonly filter: string;
  /** Full argument vector, ready for `spawn('ffmpeg', args)`. */
  readonly args: readonly string[];
  /** The label the mix comes out on. */
  readonly outLabel: string;
}

/**
 * Build the whole mix as one deterministic argument vector.
 *
 * The invariant: **`inputs[i].index === i`, and every filter reference is
 * generated from the same loop that produced that entry.** There is no place
 * in this function where a number is typed. That is the entire defence
 * against the failure the retrospective names, and it is structural rather
 * than careful.
 */
export function buildMixGraph(
  lines: readonly ScheduledLine[],
  sources: readonly MixSource[],
  options: MixOptions,
): MixGraph {
  const rate = options.sampleRate ?? 48000;
  const targetLufs = options.targetLufs ?? -14;
  const truePeak = options.truePeakDb ?? -1;
  const duck = options.musicDuckDb ?? 0;

  const inputs: { index: number; id: string; path: string }[] = [];
  const chains: string[] = [];
  const byBus = new Map<MixBus, string[]>();

  const addToBus = (bus: MixBus, label: string): void => {
    const list = byBus.get(bus) ?? [];
    list.push(label);
    byBus.set(bus, list);
  };

  const place = (id: string, path: string, atSeconds: number, gainDb: number, bus: MixBus, fadeInMs?: number, fadeOutMs?: number, seconds?: number): void => {
    const index = inputs.length;
    inputs.push({ index, id, path });
    const label = `a_${safeLabel(id)}`;
    // adelay wants milliseconds per channel; `all=1` applies it to every one
    // so a stereo take does not arrive with one channel early — which is a
    // phasing artefact people describe as "it sounds underwater".
    const delayMs = Math.max(0, Math.round(atSeconds * 1000));
    const steps = [`[${index}:a]aresample=${rate}`, `aformat=sample_fmts=fltp:channel_layouts=stereo`];
    if (fadeInMs && fadeInMs > 0) steps.push(`afade=t=in:st=0:d=${(fadeInMs / 1000).toFixed(3)}`);
    if (fadeOutMs && fadeOutMs > 0 && seconds) {
      steps.push(`afade=t=out:st=${Math.max(0, seconds - fadeOutMs / 1000).toFixed(3)}:d=${(fadeOutMs / 1000).toFixed(3)}`);
    }
    if (gainDb !== 0) steps.push(`volume=${gainDb}dB`);
    if (delayMs > 0) steps.push(`adelay=${delayMs}:all=1`);
    steps.push(`apad`);
    chains.push(`${steps.join(',')}[${label}]`);
    addToBus(bus, label);
  };

  for (const line of lines) {
    if (!line.asset) continue;
    place(line.id, joinPath(options.soundDir, line.asset.path), line.absolute, line.gainDb ?? 0, line.bus ?? 'dialogue');
  }
  for (const source of sources) {
    place(source.id, joinPath(options.soundDir, source.path), source.at, source.gainDb ?? 0, source.bus, source.fadeInMs, source.fadeOutMs, source.seconds);
  }

  const busLabels: string[] = [];
  for (const [bus, labels] of [...byBus.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const out = `bus_${bus}`;
    if (labels.length === 1) chains.push(`[${labels[0]}]anull[${out}]`);
    else chains.push(`${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[${out}]`);
    busLabels.push(out);
  }

  // Ducking: the music bus is compressed by the dialogue bus rather than by a
  // hand-drawn automation curve, because a curve has to be redrawn every time
  // a line moves and a sidechain does not. It needs a COPY of the dialogue —
  // `asplit` — since the same stream cannot be both the key and a member of
  // the sum.
  const hasMusic = busLabels.includes('bus_music');
  if (duck > 0 && hasMusic && busLabels.includes('bus_dialogue')) {
    chains.push(`[bus_dialogue]asplit=2[dlg_mix][dlg_key]`);
    chains.push(`[bus_music][dlg_key]sidechaincompress=threshold=0.05:ratio=${(1 + duck / 3).toFixed(2)}:attack=12:release=320:makeup=1[bus_music_ducked]`);
    for (let i = 0; i < busLabels.length; i++) {
      if (busLabels[i] === 'bus_music') busLabels[i] = 'bus_music_ducked';
      if (busLabels[i] === 'bus_dialogue') busLabels[i] = 'dlg_mix';
    }
  }

  const summed = 'mix_sum';
  if (busLabels.length === 0) {
    // A film with no sound at all is legal — a silent animatic is exactly
    // that — and it must produce a valid track rather than a broken graph.
    chains.push(`anullsrc=r=${rate}:cl=stereo[${summed}]`);
  } else if (busLabels.length === 1) {
    chains.push(`[${busLabels[0]}]anull[${summed}]`);
  } else {
    chains.push(`${busLabels.map((l) => `[${l}]`).join('')}amix=inputs=${busLabels.length}:normalize=0:dropout_transition=0[${summed}]`);
  }

  const outLabel = 'mix_out';
  chains.push(`[${summed}]loudnorm=I=${targetLufs}:TP=${truePeak}:LRA=11,atrim=0:${options.durationSeconds.toFixed(3)},asetpts=N/SR/TB[${outLabel}]`);

  const filter = chains.join(';');
  const args = [
    '-hide_banner', '-nostdin', '-y',
    ...(busLabels.length === 0 ? ['-f', 'lavfi', '-t', options.durationSeconds.toFixed(3), '-i', `anullsrc=r=${rate}:cl=stereo`] : []),
    ...inputs.flatMap((i) => ['-i', i.path]),
    '-filter_complex', filter,
    '-map', `[${outLabel}]`,
    '-ar', String(rate), '-ac', '2',
    '-c:a', 'pcm_s24le',
    '-t', options.durationSeconds.toFixed(3),
    options.outPath,
  ];

  return { inputs, filter, args, outLabel };
}

/** A stream label FFmpeg will accept: it splits on `[`, `]`, `;` and `,`. */
function safeLabel(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, '_');
}

function joinPath(dir: string, file: string): string {
  if (!dir) return file;
  if (file.startsWith('/')) return file;
  return dir.endsWith('/') ? `${dir}${file}` : `${dir}/${file}`;
}

/* ========================================================================== */
/* Coverage                                                                   */
/* ========================================================================== */

export interface ScriptCoverage {
  readonly lines: number;
  readonly withTakes: number;
  readonly withTranscripts: number;
  readonly captioned: number;
  /** Shots that have dialogue. */
  readonly shotsWithLines: number;
  /** Cast members who speak. */
  readonly speakingCast: readonly string[];
  /** Cast members in the manifest who never speak. */
  readonly silentCast: readonly string[];
}

export function scriptCoverage(film: Film, lines: readonly ScheduledLine[]): ScriptCoverage {
  const speaking = new Set(lines.map((l) => l.character));
  const shots = new Set(lines.map((l) => l.shot));
  return {
    lines: lines.length,
    withTakes: lines.filter((l) => l.asset).length,
    withTranscripts: lines.filter((l) => l.transcript).length,
    captioned: lines.filter((l) => !l.uncaptioned).length,
    shotsWithLines: shots.size,
    speakingCast: [...speaking].sort(),
    silentCast: (film.manifest.cast ?? []).map((c) => c.id).filter((id) => !speaking.has(id)).sort(),
  };
}
