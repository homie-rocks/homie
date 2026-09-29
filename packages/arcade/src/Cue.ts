/** One semantic incident routed to the room's available output surfaces. */

export interface RoomCue {
  readonly kind: string;
  /** Radians around the listener. Zero is in front. */
  readonly bearing: number | null;
  readonly buzz: readonly (string | number)[];
  readonly colour: string | null;
  readonly strength: number;
}

export interface CueOutputs {
  lights(cue: { kind: string; colour: string | null; strength: number }): void | Promise<void>;
  audio(cue: { kind: string; x: number; z: number; strength: number }): void | Promise<void>;
  haptic(cue: { kind: string; seat: string | number; strength: number }): void | Promise<void>;
}

export interface CueDispatch {
  readonly lights: boolean;
  readonly audio: boolean;
  readonly haptics: number;
  readonly settled: Promise<void>;
}

export function dispatchRoomCue(cue: RoomCue, outputs: CueOutputs): CueDispatch {
  const bearing = Number.isFinite(cue.bearing) ? Number(cue.bearing) : 0;
  const strength = Math.max(0, Math.min(1, Number(cue.strength) || 0));
  const work: Promise<void>[] = [];
  work.push(Promise.resolve(outputs.lights({ kind: cue.kind, colour: cue.colour, strength })));
  work.push(Promise.resolve(outputs.audio({
    kind: cue.kind,
    x: Math.sin(bearing),
    z: -Math.cos(bearing),
    strength,
  })));
  for (const seat of new Set(cue.buzz)) {
    work.push(Promise.resolve(outputs.haptic({ kind: cue.kind, seat, strength })));
  }
  return { lights: true, audio: true, haptics: new Set(cue.buzz).size, settled: Promise.all(work).then(() => undefined) };
}
