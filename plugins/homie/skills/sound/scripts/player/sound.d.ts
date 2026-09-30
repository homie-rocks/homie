/** Types for sound.js (the Homie plugin's sound skill): a game's effects and music from sound.json. */
export interface PlayOptions { volume?: number; pitch?: number; pan?: number; jitter?: number }
export interface SoundState { unlocked: boolean; running: boolean; loaded: number; music: { name: string; section: string; since: number } | null; missing: string[]; errors: string[] }
export interface Sound {
  /** Resolves once sound.json and every file it lists have loaded (or failed, which state().errors names). */
  ready: Promise<unknown>;
  /** Play an effect by name: a random variant, a little pitch jitter, at most a few of one name at once. Dropped before the first gesture. */
  play(name: string, options?: PlayOptions): AudioBufferSourceNode | null;
  /** Start a score's loops (its first section unless one is named); it starts on the first touch or key. */
  music(name: string, options?: { section?: string; fade?: number }): void;
  /** Switch to another section's loop exactly on the next bar line. */
  section(name: string, options?: { fade?: number }): void;
  stopMusic(options?: { fade?: number }): void;
  /** Music down to `to` (0..1) for `seconds`, then back. */
  duck(to?: number, seconds?: number): void;
  volume(levels: { master?: number; sfx?: number; music?: number }): void;
  mute(on?: boolean): void;
  readonly context: AudioContext | null;
  state(): SoundState;
}
export function createSound(options?: { base?: string; manifest?: string; maxPerName?: number; maxVoices?: number }): Sound;
