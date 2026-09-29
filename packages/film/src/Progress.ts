/**
 * ============================================================================
 *  Progress — a long render that says what it is doing, in a shell somebody
 *  is watching.
 * ============================================================================
 *
 * ## The outcome this file owns
 *
 *   **Nobody has to wonder whether the render has frozen.**
 *
 * That sounds like a nicety and it is not. One short film's recorder
 * printed `captured 300/3705 frames` once every ten seconds and nothing else,
 * and the retrospective lists *"visible, resumable production progress"* as a
 * product gap: a user should not have to wonder whether the render process
 * has frozen. A render nobody can read is a render people kill and
 * restart, which is how twenty minutes becomes forty.
 *
 * The ETA is a MEDIAN of recent frame times, not a mean of all of them.
 * The first frames of a capture are slow — shaders compile, textures upload,
 * the first shot's assets arrive — and a mean over the whole run keeps
 * apologising for that for the next twenty minutes. A median over a trailing
 * window converges in about a second and then tracks the truth, including
 * getting SLOWER when a heavy sequence starts, which is the case where an
 * honest number matters most.
 */

export interface ProgressState {
  readonly frame: number;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly shot: string;
  readonly chunk: number;
  readonly chunks: number;
  readonly stage: string;
  readonly warnings: readonly string[];
}

export interface Progress {
  /** Record that a frame finished. */
  frame(frame: number, shot: string): void;
  /** Say what the render is doing between frames — encoding, muxing, settling. */
  stage(stage: string): void;
  chunk(index: number, count: number): void;
  warn(message: string): void;
  /** A single line, ready to print. */
  line(): string;
  state(): ProgressState;
  /** Seconds remaining, or null before there is enough evidence to say. */
  eta(): number | null;
}

export interface ProgressOptions {
  readonly fromFrame: number;
  readonly toFrame: number;
  /** How many recent frames the ETA is estimated from. */
  readonly window?: number;
  /** Injectable so a test is not at the mercy of a real clock. */
  readonly now?: () => number;
}

export function createProgress(options: ProgressOptions): Progress {
  const now = options.now ?? (() => Date.now());
  const windowSize = options.window ?? 48;
  const durations: number[] = [];
  let lastAt: number | null = null;
  let frame = options.fromFrame;
  let shot = '';
  let stage = 'starting';
  let chunkIndex = 0;
  let chunkCount = 1;
  const warnings: string[] = [];

  const median = (): number | null => {
    if (durations.length < 4) return null;
    const sorted = [...durations].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : ((sorted[mid - 1]! + sorted[mid]!) / 2);
  };

  const eta = (): number | null => {
    const per = median();
    if (per === null) return null;
    return ((options.toFrame - frame) * per) / 1000;
  };

  return {
    frame(f, s) {
      const at = now();
      if (lastAt !== null) {
        durations.push(at - lastAt);
        if (durations.length > windowSize) durations.shift();
      }
      lastAt = at;
      frame = f;
      shot = s;
      stage = 'rendering';
    },
    stage(s) { stage = s; },
    chunk(index, count) { chunkIndex = index; chunkCount = count; },
    warn(message) { warnings.push(message); },
    state: () => ({ frame, fromFrame: options.fromFrame, toFrame: options.toFrame, shot, chunk: chunkIndex, chunks: chunkCount, stage, warnings }),
    eta,
    line() {
      const total = Math.max(1, options.toFrame - options.fromFrame);
      const done = Math.max(0, frame - options.fromFrame);
      const pct = Math.min(100, (done / total) * 100);
      const remaining = eta();
      const bar = renderBar(pct);
      const parts = [
        `${bar} ${pct.toFixed(1).padStart(5)}%`,
        `frame ${frame}/${options.toFrame}`,
        `chunk ${chunkIndex + 1}/${chunkCount}`,
        shot ? `shot ${shot}` : '',
        stage,
        remaining === null ? 'eta —' : `eta ${formatDuration(remaining)}`,
        warnings.length > 0 ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      return parts.join('  ·  ');
    },
  };
}

function renderBar(pct: number, width = 24): string {
  const filled = Math.round((pct / 100) * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}]`;
}

/** `2m 14s`, `41s`, `1h 03m`. Never `0.0166 hours`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}
