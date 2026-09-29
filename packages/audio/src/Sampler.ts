/**
 * A neutral, offline sampler planner.
 *
 * This module selects caller-authored regions and turns triggers into an exact
 * render plan. It does not load files or choose an instrument, pitch, groove,
 * velocity response, loop, or choke time. Those decisions are all required in
 * the structures below when they matter.
 */

export interface AssetSource {
  /** Stable provenance supplied by the caller (URL, package id, recording id). */
  readonly uri: string;
}

export interface AssetLicense {
  /** SPDX id or another exact licence identifier. */
  readonly id: string;
  readonly url?: string;
  readonly attribution?: string;
}

export interface SampleLoop {
  /** Absolute positions in the source asset. */
  readonly startMs: number;
  readonly endMs: number;
  /** The tail/head overlap. Zero requests a hard loop. */
  readonly crossfadeMs: number;
}

export interface SampleRegion {
  /** Absolute source offsets. The source before startMs is never rendered. */
  readonly startMs: number;
  readonly endMs: number;
  /** Absolute source position which must land on the trigger time. */
  readonly transientMs?: number;
  readonly loop?: SampleLoop;
}

export interface SampleAsset {
  /** Relative path below the host's audio root, or below package when supplied. */
  readonly file: string;
  /** Optional installed integration package id. Hosts resolve package/file safely. */
  readonly package?: string;
  /** Immutable content identity. The host is expected to verify it before rendering. */
  readonly sha256: string;
  readonly source: AssetSource;
  readonly license: AssetLicense;
  readonly bpm?: number;
  readonly key?: string;
  readonly rootMidi?: number;
  readonly regions: Readonly<Record<string, SampleRegion>>;
}

export interface SampleVoice {
  readonly asset: string;
  readonly region: string;
  /** Voice trim. Event and velocity gains are applied separately. */
  readonly gain?: number;
}

export interface VelocityZone {
  readonly id: string;
  /** Half-open [low, high), except that a high endpoint of 1 includes 1. */
  readonly velocity: readonly [low: number, high: number];
  /** Inclusive MIDI range. Omit for an unpitched zone. */
  readonly keys?: readonly [low: number, high: number];
  /** Overrides the selected asset's rootMidi. */
  readonly rootMidi?: number;
  /** Deterministic round-robin order. The first matching trigger selects index 0. */
  readonly voices: readonly SampleVoice[];
}

export interface SamplerSpec {
  readonly zones: readonly VelocityZone[];
  /** Explicit amplitude response. Omit to use velocity only for layer selection. */
  readonly velocityGain?: readonly [atZero: number, atOne: number];
  readonly choke?: {
    readonly group: string;
    readonly releaseMs: number;
  };
}

export interface SampleTrigger {
  /** Stable caller-authored occurrence identity. */
  readonly id: string;
  readonly sampler: string;
  /** The moment the region's transient must reach. */
  readonly atMs: number;
  /** Bounds a loop and/or gates a one-shot. */
  readonly gateMs?: number;
  readonly velocity: number;
  readonly gain?: number;
  /** Exactly one pitch address may be supplied. */
  readonly midi?: number;
  readonly semitones?: number;
  /** Output duration / source duration, independent of pitch. */
  readonly timeRatio?: number;
  /** Fit one non-looping region to this many milliseconds. */
  readonly fitMs?: number;
}

export interface LoopRenderPlan {
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly crossfadeMs: number;
  /**
   * A crossfaded cycle is `[start + crossfade, end]` faded into
   * `[start, start + crossfade]`. Its output is this long and can be repeated
   * without constructing one graph node per repetition.
   */
  readonly cycleStartMs: number;
  readonly cycleDurationMs: number;
  readonly transformedCycleMs: number;
}

export interface SampleRenderPlan {
  readonly triggerId: string;
  readonly sampler: string;
  readonly zone: string;
  readonly roundRobinIndex: number;
  readonly asset: string;
  readonly region: string;
  readonly file: string;
  readonly package?: string;
  readonly sha256: string;
  readonly source: AssetSource;
  readonly license: AssetLicense;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly sourceTransientMs: number;
  readonly loop: LoopRenderPlan | null;
  readonly pitchSemitones: number;
  readonly pitchRatio: number;
  readonly timeRatio: number;
  /**
   * Multiplier applied to the host sample rate for FFmpeg's asetrate. Resample
   * back to the host rate, then apply the atempo factors below. Their product
   * is `1 / (pitchRatio * timeRatio)`, so pitch and duration stay independent.
   */
  readonly asetrateRatio: number;
  /** FFmpeg atempo factors; every value is in its supported [0.5, 100] range. */
  readonly atempo: readonly number[];
  /** May be negative when pre-roll precedes project zero. */
  readonly timelineStartMs: number;
  /** Host-side crop required when timelineStartMs is negative. */
  readonly cropLeadingMs: number;
  /** The authored transient landing, retained independently of pre-roll. */
  readonly transientAtMs: number;
  readonly naturalEndMs: number;
  /** End after gate and choke semantics. */
  readonly timelineEndMs: number;
  readonly fadeOutStartMs: number | null;
  readonly gain: number;
  readonly velocity: number;
  readonly chokeGroup: string | null;
}

const SHA256 = /^[a-fA-F0-9]{64}$/;
const MAX_REGIONS_PER_ASSET = 4_096;
const MAX_TOTAL_REGIONS = 20_000;
const MAX_ZONES_PER_SAMPLER = 256;
const MAX_TOTAL_ZONES = 4_096;
const MAX_VOICES_PER_ZONE = 64;
const MAX_TOTAL_VOICES = 20_000;
const MAX_TRIGGERS = 20_000;
const MAX_TRIGGER_ZONE_TESTS = 2_000_000;

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function positive(v: unknown): v is number {
  return finite(v) && v > 0;
}

function intersects(a: readonly [number, number] | undefined, b: readonly [number, number] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a[0] <= b[1] && b[0] <= a[1];
}

function velocityMatches(v: number, range: readonly [number, number]): boolean {
  return v >= range[0] && (v < range[1] || (v === 1 && range[1] === 1));
}

function keyMatches(midi: number | undefined, range: readonly [number, number] | undefined): boolean {
  if (!range) return midi === undefined;
  return midi !== undefined && midi >= range[0] && midi <= range[1];
}

/** Split an atempo factor without changing its product. */
export function atempoFactors(factor: number): readonly number[] {
  if (!positive(factor)) throw new RangeError(`atempo factor must be positive, got ${factor}`);
  const out: number[] = [];
  let rest = factor;
  while (rest < 0.5) {
    out.push(0.5);
    rest /= 0.5;
  }
  while (rest > 100) {
    out.push(100);
    rest /= 100;
  }
  if (Math.abs(rest - 1) > 1e-12 || out.length === 0) out.push(rest);
  return out;
}

/** Every structural or cross-reference problem, in one pass. */
export function describeSamplerProblems(
  assets: Readonly<Record<string, SampleAsset>>,
  samplers: Readonly<Record<string, SamplerSpec>>,
): readonly string[] {
  const problems: string[] = [];
  let totalRegions = 0;
  let totalZones = 0;
  let totalVoices = 0;
  for (const [assetId, asset] of Object.entries(assets)) {
    const count = asset?.regions ? Object.keys(asset.regions).length : 0;
    totalRegions += count;
    if (count > MAX_REGIONS_PER_ASSET) problems.push(`assets.${assetId}.regions may contain at most ${MAX_REGIONS_PER_ASSET} entries`);
  }
  for (const [samplerId, sampler] of Object.entries(samplers)) {
    const zones = Array.isArray(sampler?.zones) ? sampler.zones : [];
    totalZones += zones.length;
    if (zones.length > MAX_ZONES_PER_SAMPLER) problems.push(`samplers.${samplerId}.zones may contain at most ${MAX_ZONES_PER_SAMPLER} entries`);
    for (const [i, zone] of zones.entries()) {
      const voices = Array.isArray(zone?.voices) ? zone.voices.length : 0;
      totalVoices += voices;
      if (voices > MAX_VOICES_PER_ZONE) problems.push(`samplers.${samplerId}.zones[${i}].voices may contain at most ${MAX_VOICES_PER_ZONE} entries`);
    }
  }
  if (totalRegions > MAX_TOTAL_REGIONS) problems.push(`assets declare more than ${MAX_TOTAL_REGIONS} regions in total`);
  if (totalZones > MAX_TOTAL_ZONES) problems.push(`samplers declare more than ${MAX_TOTAL_ZONES} zones in total`);
  if (totalVoices > MAX_TOTAL_VOICES) problems.push(`samplers declare more than ${MAX_TOTAL_VOICES} voices in total`);
  if (problems.length > 0) return problems;
  for (const [assetId, asset] of Object.entries(assets)) {
    const at = `assets.${assetId}`;
    if (!asset.file) problems.push(`${at}.file must be non-empty`);
    if (!SHA256.test(asset.sha256)) problems.push(`${at}.sha256 must be 64 hexadecimal characters`);
    if (!asset.source?.uri) problems.push(`${at}.source.uri must be non-empty`);
    if (!asset.license?.id) problems.push(`${at}.license.id must be non-empty`);
    if (asset.bpm !== undefined && !positive(asset.bpm)) problems.push(`${at}.bpm must be positive`);
    if (asset.rootMidi !== undefined && !finite(asset.rootMidi)) problems.push(`${at}.rootMidi must be finite`);
    if (!asset.regions || Object.keys(asset.regions).length === 0) problems.push(`${at}.regions must not be empty`);
    for (const [regionId, region] of Object.entries(asset.regions ?? {})) {
      const rt = `${at}.regions.${regionId}`;
      if (!finite(region.startMs) || region.startMs < 0) problems.push(`${rt}.startMs must be non-negative`);
      if (!finite(region.endMs) || !(region.endMs > region.startMs)) problems.push(`${rt}.endMs must exceed startMs`);
      if (region.transientMs !== undefined &&
          (!finite(region.transientMs) || region.transientMs < region.startMs || region.transientMs > region.endMs)) {
        problems.push(`${rt}.transientMs must lie inside the region`);
      }
      if (region.loop) {
        const l = region.loop;
        if (!finite(l.startMs) || !finite(l.endMs) ||
            l.startMs < region.startMs || l.endMs > region.endMs || l.endMs <= l.startMs) {
          problems.push(`${rt}.loop must lie inside the region and have positive length`);
        }
        if (!finite(l.crossfadeMs) || l.crossfadeMs < 0 || l.crossfadeMs * 2 >= l.endMs - l.startMs) {
          problems.push(`${rt}.loop.crossfadeMs must be non-negative and less than half the loop length`);
        }
        if (region.transientMs !== undefined && region.transientMs > l.startMs) {
          problems.push(`${rt}.transientMs must not follow loop.startMs or the loop can prevent it from landing`);
        }
      }
    }
  }

  for (const [samplerId, sampler] of Object.entries(samplers)) {
    const at = `samplers.${samplerId}`;
    if (!Array.isArray(sampler.zones) || sampler.zones.length === 0) problems.push(`${at}.zones must not be empty`);
    if (sampler.velocityGain && (!finite(sampler.velocityGain[0]) || !finite(sampler.velocityGain[1]) ||
        sampler.velocityGain[0] < 0 || sampler.velocityGain[1] < 0)) {
      problems.push(`${at}.velocityGain endpoints must be non-negative`);
    }
    if (sampler.choke && (!sampler.choke.group || !finite(sampler.choke.releaseMs) || sampler.choke.releaseMs < 0)) {
      problems.push(`${at}.choke needs a group and a non-negative releaseMs`);
    }
    const ids = new Set<string>();
    (sampler.zones ?? []).forEach((zone, i) => {
      const zt = `${at}.zones[${i}]`;
      if (!zone.id || ids.has(zone.id)) problems.push(`${zt}.id must be non-empty and unique`);
      ids.add(zone.id);
      const [lo, hi] = zone.velocity;
      if (!finite(lo) || !finite(hi) || lo < 0 || hi > 1 || !(hi > lo)) {
        problems.push(`${zt}.velocity must be an increasing range inside 0..1`);
      }
      if (zone.keys && (!Number.isInteger(zone.keys[0]) || !Number.isInteger(zone.keys[1]) || zone.keys[1] < zone.keys[0])) {
        problems.push(`${zt}.keys must be an increasing integer MIDI range`);
      }
      if (zone.rootMidi !== undefined && !finite(zone.rootMidi)) problems.push(`${zt}.rootMidi must be finite`);
      if (!Array.isArray(zone.voices) || zone.voices.length === 0) problems.push(`${zt}.voices must not be empty`);
      (zone.voices ?? []).forEach((voice, j) => {
        const vt = `${zt}.voices[${j}]`;
        const asset = assets[voice.asset];
        if (!asset) problems.push(`${vt}.asset ${JSON.stringify(voice.asset)} does not exist`);
        else if (!asset.regions[voice.region]) problems.push(`${vt}.region ${JSON.stringify(voice.region)} does not exist on ${voice.asset}`);
        if (voice.gain !== undefined && (!finite(voice.gain) || voice.gain < 0)) problems.push(`${vt}.gain must be non-negative`);
      });
    });
    for (let i = 0; i < sampler.zones.length; i++) {
      for (let j = i + 1; j < sampler.zones.length; j++) {
        const a = sampler.zones[i]!;
        const b = sampler.zones[j]!;
        const velocityOverlap = Math.max(a.velocity[0], b.velocity[0]) < Math.min(a.velocity[1], b.velocity[1]);
        if (velocityOverlap && intersects(a.keys, b.keys)) {
          problems.push(`${at}.zones ${a.id} and ${b.id} overlap in velocity and key range`);
        }
      }
    }
  }
  return problems;
}

function planLoop(region: SampleRegion, timeRatio: number): LoopRenderPlan | null {
  if (!region.loop) return null;
  const l = region.loop;
  const cycle = l.endMs - l.startMs - l.crossfadeMs;
  return {
    sourceStartMs: l.startMs,
    sourceEndMs: l.endMs,
    crossfadeMs: l.crossfadeMs,
    cycleStartMs: l.startMs + l.crossfadeMs,
    cycleDurationMs: cycle,
    transformedCycleMs: cycle * timeRatio,
  };
}

/**
 * Select velocity layers and round robins, then calculate source and timeline
 * transforms. The result is sorted by trigger time, with equal-time triggers
 * retaining caller order.
 */
export function planSamples(
  triggers: readonly SampleTrigger[],
  assets: Readonly<Record<string, SampleAsset>>,
  samplers: Readonly<Record<string, SamplerSpec>>,
): readonly SampleRenderPlan[] {
  if (triggers.length > MAX_TRIGGERS) throw new RangeError(`triggers may contain at most ${MAX_TRIGGERS} entries`);
  const zoneTests = triggers.reduce((sum, trigger) => sum + (samplers[trigger.sampler]?.zones.length ?? 0), 0);
  if (zoneTests > MAX_TRIGGER_ZONE_TESTS) {
    throw new RangeError(`sampler selection plans ${zoneTests} trigger-zone tests; maximum is ${MAX_TRIGGER_ZONE_TESTS}`);
  }
  const problems = [...describeSamplerProblems(assets, samplers)];
  triggers.forEach((trigger, i) => {
    const at = `triggers[${i}]`;
    if (!trigger.id) problems.push(`${at}.id must be non-empty`);
    if (!samplers[trigger.sampler]) problems.push(`${at}.sampler ${JSON.stringify(trigger.sampler)} does not exist`);
    if (!finite(trigger.atMs)) problems.push(`${at}.atMs must be finite`);
    if (!finite(trigger.velocity) || trigger.velocity < 0 || trigger.velocity > 1) problems.push(`${at}.velocity must be inside 0..1`);
    if (trigger.gain !== undefined && (!finite(trigger.gain) || trigger.gain < 0)) problems.push(`${at}.gain must be non-negative`);
    if (trigger.gateMs !== undefined && !positive(trigger.gateMs)) problems.push(`${at}.gateMs must be positive`);
    if (trigger.timeRatio !== undefined && !positive(trigger.timeRatio)) problems.push(`${at}.timeRatio must be positive`);
    if (trigger.fitMs !== undefined && !positive(trigger.fitMs)) problems.push(`${at}.fitMs must be positive`);
    if (trigger.timeRatio !== undefined && trigger.fitMs !== undefined) problems.push(`${at} cannot carry both timeRatio and fitMs`);
    if (trigger.midi !== undefined && trigger.semitones !== undefined) problems.push(`${at} cannot carry both midi and semitones`);
    if (trigger.midi !== undefined && !finite(trigger.midi)) problems.push(`${at}.midi must be finite`);
    if (trigger.semitones !== undefined && !finite(trigger.semitones)) problems.push(`${at}.semitones must be finite`);
  });
  if (problems.length > 0) throw new RangeError(problems.join('; '));

  const indexed = triggers.map((trigger, order) => ({ trigger, order }))
    .sort((a, b) => a.trigger.atMs - b.trigger.atMs || a.order - b.order);
  const rr = new Map<string, number>();
  const plans: SampleRenderPlan[] = [];

  for (const { trigger } of indexed) {
    const sampler = samplers[trigger.sampler]!;
    const matches = sampler.zones.filter((zone) =>
      velocityMatches(trigger.velocity, zone.velocity) && keyMatches(trigger.midi, zone.keys));
    if (matches.length !== 1) {
      throw new RangeError(
        `trigger ${trigger.id} matches ${matches.length} zones on sampler ${trigger.sampler}; it must match exactly one`,
      );
    }
    const zone = matches[0]!;
    const rrKey = `${trigger.sampler}\u0000${zone.id}`;
    const occurrence = rr.get(rrKey) ?? 0;
    rr.set(rrKey, occurrence + 1);
    const roundRobinIndex = occurrence % zone.voices.length;
    const voice = zone.voices[roundRobinIndex]!;
    const asset = assets[voice.asset]!;
    const region = asset.regions[voice.region]!;

    if (trigger.fitMs !== undefined && region.loop) {
      throw new RangeError(`trigger ${trigger.id} uses fitMs with a looping region; choose fitMs or looping, not both`);
    }
    if (region.loop && trigger.gateMs === undefined) {
      throw new RangeError(`trigger ${trigger.id} uses a looping region and needs gateMs to bound it`);
    }

    const root = zone.rootMidi ?? asset.rootMidi;
    if (trigger.midi !== undefined && root === undefined) {
      throw new RangeError(`trigger ${trigger.id} supplies midi but zone ${zone.id} and asset ${voice.asset} have no rootMidi`);
    }
    const pitchSemitones = trigger.semitones ?? (trigger.midi !== undefined ? trigger.midi - root! : 0);
    const pitchRatio = 2 ** (pitchSemitones / 12);
    const sourceDuration = region.endMs - region.startMs;
    const timeRatio = trigger.fitMs !== undefined ? trigger.fitMs / sourceDuration : (trigger.timeRatio ?? 1);
    const tempo = 1 / (pitchRatio * timeRatio);
    const sourceTransientMs = region.transientMs ?? region.startMs;
    const preRollMs = (sourceTransientMs - region.startMs) * timeRatio;
    const timelineStartMs = trigger.atMs - preRollMs;
    const transformedDuration = sourceDuration * timeRatio;
    const naturalEndMs = timelineStartMs + transformedDuration;
    const timelineEndMs = trigger.gateMs === undefined
      ? naturalEndMs
      : Math.min(naturalEndMs, trigger.atMs + trigger.gateMs);
    const velocityGain = sampler.velocityGain
      ? sampler.velocityGain[0] + (sampler.velocityGain[1] - sampler.velocityGain[0]) * trigger.velocity
      : 1;
    const gain = (trigger.gain ?? 1) * (voice.gain ?? 1) * velocityGain;
    plans.push({
      triggerId: trigger.id,
      sampler: trigger.sampler,
      zone: zone.id,
      roundRobinIndex,
      asset: voice.asset,
      region: voice.region,
      file: asset.file,
      ...(asset.package ? { package: asset.package } : {}),
      sha256: asset.sha256,
      source: asset.source,
      license: asset.license,
      sourceStartMs: region.startMs,
      sourceEndMs: region.endMs,
      sourceTransientMs,
      loop: planLoop(region, timeRatio),
      pitchSemitones,
      pitchRatio,
      timeRatio,
      asetrateRatio: pitchRatio,
      atempo: atempoFactors(tempo),
      timelineStartMs,
      cropLeadingMs: Math.max(0, -timelineStartMs),
      transientAtMs: trigger.atMs,
      naturalEndMs,
      timelineEndMs: region.loop ? trigger.atMs + trigger.gateMs! : timelineEndMs,
      fadeOutStartMs: null,
      gain,
      velocity: trigger.velocity,
      chokeGroup: sampler.choke?.group ?? null,
    });
  }

  /* Choke is a timeline operation, after selection and transformation. */
  const active = new Map<string, number[]>();
  for (let i = 0; i < plans.length; i++) {
    const current = plans[i]!;
    const sampler = samplers[current.sampler]!;
    const choke = sampler.choke;
    if (!choke) continue;
    const earlier = active.get(choke.group) ?? [];
    for (const priorIndex of earlier) {
      const prior = plans[priorIndex]!;
      if (prior.timelineEndMs <= current.transientAtMs) continue;
      const priorReleaseMs = samplers[prior.sampler]!.choke!.releaseMs;
      const fade = Math.max(prior.timelineStartMs, current.transientAtMs - priorReleaseMs);
      plans[priorIndex] = { ...prior, timelineEndMs: current.transientAtMs, fadeOutStartMs: fade };
    }
    active.set(choke.group, [i]);
  }
  return plans;
}
