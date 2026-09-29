/**
 * Caller-owned musical arrangement compiled into sampler triggers.
 *
 * Beats are quarter-note beats. Bar/beat positions use the denominator unit of
 * the time signature active at that bar. All musical content is data supplied
 * by the caller; this module contains no tempo, note, pattern, section, groove,
 * probability, or patch default.
 */

import {
  describeSamplerProblems,
  planSamples,
  type SampleAsset,
  type SampleRenderPlan,
  type SamplerSpec,
  type SampleTrigger,
} from './Sampler.ts';

export interface TempoPoint {
  readonly atBeat: number;
  readonly bpm: number;
}

export interface TimeSignaturePoint {
  readonly atBar: number;
  readonly numerator: number;
  readonly denominator: number;
}

export interface BarBeat {
  readonly bar: number;
  /** Zero-based, in the active time signature's denominator unit. */
  readonly beat: number;
}

export interface GrooveStep {
  readonly offsetMs: number;
  readonly velocityScale: number;
}

export interface GrooveSpec {
  readonly subdivisionBeats: number;
  readonly steps: readonly GrooveStep[];
}

export interface SwingSpec {
  readonly subdivisionBeats: number;
  /** Exact delay applied to odd subdivisions. */
  readonly lateByBeats: number;
}

export interface EventVariation {
  readonly probability?: number;
  readonly timingDeltaMs?: readonly [min: number, max: number];
  readonly velocityDelta?: readonly [min: number, max: number];
  readonly gainScale?: readonly [min: number, max: number];
  readonly pitchDeltaSemitones?: readonly [min: number, max: number];
}

export interface PatternEvent {
  readonly id: string;
  /** Exactly one of atBeat or atBarBeat is required. */
  readonly atBeat?: number;
  readonly atBarBeat?: BarBeat;
  readonly durationBeats?: number;
  readonly sampler: string;
  readonly velocity: number;
  readonly gain?: number;
  readonly midi?: number;
  readonly semitones?: number;
  readonly timeRatio?: number;
  readonly fitBeats?: number;
  readonly microtimingMs?: number;
  readonly variation?: EventVariation;
}

export interface PatternSpec {
  readonly lengthBeats: number;
  readonly groove?: string;
  readonly swing?: SwingSpec;
  readonly events: readonly PatternEvent[];
}

export interface PatternUse {
  readonly id: string;
  readonly pattern: string;
  /** Exactly one of atBeat or atBarBeat is required. */
  readonly atBeat?: number;
  readonly atBarBeat?: BarBeat;
  readonly repeats: number;
  readonly everyBeats: number;
  readonly velocityScale?: number;
  readonly gainScale?: number;
  readonly transposeSemitones?: number;
  readonly microtimingMs?: number;
  readonly enabled?: boolean;
}

export interface SectionSpec {
  readonly lengthBeats: number;
  readonly uses: readonly PatternUse[];
}

export interface PatternUseOverride {
  readonly use: string;
  readonly enabled?: boolean;
  readonly pattern?: string;
  readonly velocityScale?: number;
  readonly gainScale?: number;
  readonly transposeSemitones?: number;
  readonly microtimingMs?: number;
}

export interface SectionReturn {
  readonly id: string;
  readonly section: string;
  readonly repeats: number;
  /** Per-return changes to named uses in the reusable section. */
  readonly overrides?: readonly PatternUseOverride[];
  /** Caller-authored fills and answers are ordinary added pattern uses. */
  readonly addUses?: readonly PatternUse[];
}

export interface ArrangementProject {
  readonly seed: number;
  readonly tempoMap: readonly TempoPoint[];
  readonly timeSignatures: readonly TimeSignaturePoint[];
  readonly assets: Readonly<Record<string, SampleAsset>>;
  readonly samplers: Readonly<Record<string, SamplerSpec>>;
  readonly grooves: Readonly<Record<string, GrooveSpec>>;
  readonly patterns: Readonly<Record<string, PatternSpec>>;
  readonly sections: Readonly<Record<string, SectionSpec>>;
  readonly sequence: readonly SectionReturn[];
}

export interface CompiledArrangement {
  readonly durationBeats: number;
  readonly durationMs: number;
  readonly triggers: readonly SampleTrigger[];
  readonly samples: readonly SampleRenderPlan[];
}

const MAX_MAP_POINTS = 256;
const MAX_NAMED_ITEMS = 256;
const MAX_SEQUENCE_RETURNS = 256;
const MAX_REPEAT = 1024;
const MAX_DECLARED_EVENTS = 20_000;
const MAX_DECLARED_USES = 4_096;
const MAX_STEPS_PER_GROOVE = 1_024;
const MAX_EVENTS_PER_PATTERN = 4_096;
const MAX_USES_PER_SECTION = 1_024;
const MAX_RETURN_PARTS = 1_024;
const MAX_COMPILED_EVENTS = 20_000;

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function positive(v: unknown): v is number {
  return finite(v) && v > 0;
}

function integer(v: unknown): v is number {
  return Number.isInteger(v);
}

function range(range: readonly [number, number] | undefined, at: string, problems: string[]): void {
  if (!range) return;
  if (!finite(range[0]) || !finite(range[1]) || range[1] < range[0]) {
    problems.push(`${at} must be an increasing pair of finite numbers`);
  }
}

/** Piecewise integration of a caller-authored tempo map. */
export function beatToMs(tempoMap: readonly TempoPoint[], beat: number): number {
  if (!finite(beat) || beat < 0) throw new RangeError(`beat must be finite and non-negative, got ${beat}`);
  if (tempoMap.length === 0 || tempoMap[0]!.atBeat !== 0) {
    throw new RangeError('tempoMap must start at beat 0');
  }
  let ms = 0;
  for (let i = 0; i < tempoMap.length; i++) {
    const point = tempoMap[i]!;
    const next = tempoMap[i + 1];
    const end = next ? Math.min(beat, next.atBeat) : beat;
    if (end > point.atBeat) ms += (end - point.atBeat) * 60000 / point.bpm;
    if (!next || beat <= next.atBeat) return ms;
  }
  return ms;
}

/** Convert a bar/beat address to quarter-note beats. */
export function barBeatToBeat(signatures: readonly TimeSignaturePoint[], position: BarBeat): number {
  if (!integer(position.bar) || position.bar < 0 || !finite(position.beat) || position.beat < 0) {
    throw new RangeError(`bar/beat must be non-negative, got ${position.bar}:${position.beat}`);
  }
  if (signatures.length === 0 || signatures[0]!.atBar !== 0) {
    throw new RangeError('timeSignatures must start at bar 0');
  }
  let total = 0;
  for (let bar = 0; bar < position.bar; bar++) {
    let signature = signatures[0]!;
    for (const candidate of signatures) {
      if (candidate.atBar <= bar) signature = candidate;
      else break;
    }
    total += signature.numerator * 4 / signature.denominator;
  }
  let current = signatures[0]!;
  for (const candidate of signatures) {
    if (candidate.atBar <= position.bar) current = candidate;
    else break;
  }
  if (position.beat >= current.numerator) {
    throw new RangeError(`beat ${position.beat} lies outside bar ${position.bar}'s ${current.numerator}/${current.denominator} signature`);
  }
  return total + position.beat * 4 / current.denominator;
}

function positionedBeat(
  atBeat: number | undefined,
  atBarBeat: BarBeat | undefined,
  signatures: readonly TimeSignaturePoint[],
  at: string,
): number {
  if ((atBeat === undefined) === (atBarBeat === undefined)) {
    throw new RangeError(`${at} needs exactly one of atBeat or atBarBeat`);
  }
  return atBarBeat === undefined ? atBeat! : barBeatToBeat(signatures, atBarBeat);
}

/** FNV-1a, used only to make requested variations stable per occurrence/property. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function random01(seed: number, occurrence: string, property: string): number {
  return hash32(`${seed}\u0000${occurrence}\u0000${property}`) / 0x100000000;
}

function varied(
  pair: readonly [number, number] | undefined,
  seed: number,
  occurrence: string,
  property: string,
  fallback: number,
): number {
  if (!pair) return fallback;
  return pair[0] + (pair[1] - pair[0]) * random01(seed, occurrence, property);
}

function mergeUse(base: PatternUse, override: PatternUseOverride | undefined): PatternUse {
  if (!override) return base;
  return {
    ...base,
    ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
    ...(override.pattern !== undefined ? { pattern: override.pattern } : {}),
    ...(override.velocityScale !== undefined ? { velocityScale: override.velocityScale } : {}),
    ...(override.gainScale !== undefined ? { gainScale: override.gainScale } : {}),
    ...(override.transposeSemitones !== undefined ? { transposeSemitones: override.transposeSemitones } : {}),
    ...(override.microtimingMs !== undefined ? { microtimingMs: override.microtimingMs } : {}),
  };
}

/** Every invalid number, duplicate id, and missing reference, returned together. */
export function describeArrangementProblems(project: ArrangementProject): readonly string[] {
  const problems: string[] = [];
  if (!integer(project.seed)) problems.push('seed must be an integer');
  if (project.tempoMap.length > MAX_MAP_POINTS) problems.push(`tempoMap may contain at most ${MAX_MAP_POINTS} points`);
  if (project.timeSignatures.length > MAX_MAP_POINTS) problems.push(`timeSignatures may contain at most ${MAX_MAP_POINTS} points`);
  for (const [name, value] of Object.entries({
    assets: project.assets, samplers: project.samplers, grooves: project.grooves,
    patterns: project.patterns, sections: project.sections,
  })) if (Object.keys(value).length > MAX_NAMED_ITEMS) problems.push(`${name} may contain at most ${MAX_NAMED_ITEMS} entries`);
  if (project.sequence.length > MAX_SEQUENCE_RETURNS) problems.push(`sequence may contain at most ${MAX_SEQUENCE_RETURNS} returns`);
  let declaredEvents = 0;
  let declaredUses = 0;
  for (const [id, groove] of Object.entries(project.grooves)) {
    if (Array.isArray(groove.steps) && groove.steps.length > MAX_STEPS_PER_GROOVE) {
      problems.push(`grooves.${id}.steps may contain at most ${MAX_STEPS_PER_GROOVE} entries`);
    }
  }
  for (const [id, pattern] of Object.entries(project.patterns)) {
    if (Array.isArray(pattern.events)) {
      declaredEvents += pattern.events.length;
      if (pattern.events.length > MAX_EVENTS_PER_PATTERN) problems.push(`patterns.${id}.events may contain at most ${MAX_EVENTS_PER_PATTERN} entries`);
    }
  }
  for (const [id, section] of Object.entries(project.sections)) {
    if (Array.isArray(section.uses)) {
      declaredUses += section.uses.length;
      if (section.uses.length > MAX_USES_PER_SECTION) problems.push(`sections.${id}.uses may contain at most ${MAX_USES_PER_SECTION} entries`);
    }
  }
  for (const [i, ret] of project.sequence.entries()) {
    if ((ret.overrides?.length ?? 0) > MAX_RETURN_PARTS) problems.push(`sequence[${i}].overrides may contain at most ${MAX_RETURN_PARTS} entries`);
    if ((ret.addUses?.length ?? 0) > MAX_RETURN_PARTS) problems.push(`sequence[${i}].addUses may contain at most ${MAX_RETURN_PARTS} entries`);
    declaredUses += ret.addUses?.length ?? 0;
  }
  if (declaredEvents > MAX_DECLARED_EVENTS) problems.push(`patterns declare more than ${MAX_DECLARED_EVENTS} events in total`);
  if (declaredUses > MAX_DECLARED_USES) problems.push(`sections and returns declare more than ${MAX_DECLARED_USES} uses in total`);
  if (problems.length > 0) return problems;
  problems.push(...describeSamplerProblems(project.assets, project.samplers));
  if (!Array.isArray(project.tempoMap) || project.tempoMap.length === 0 || project.tempoMap[0]?.atBeat !== 0) {
    problems.push('tempoMap must start at beat 0');
  }
  project.tempoMap.forEach((p, i) => {
    if (!finite(p.atBeat) || p.atBeat < 0 || !positive(p.bpm)) problems.push(`tempoMap[${i}] needs non-negative atBeat and positive bpm`);
    if (i > 0 && p.atBeat <= project.tempoMap[i - 1]!.atBeat) problems.push(`tempoMap[${i}].atBeat must increase`);
  });
  if (!Array.isArray(project.timeSignatures) || project.timeSignatures.length === 0 || project.timeSignatures[0]?.atBar !== 0) {
    problems.push('timeSignatures must start at bar 0');
  }
  project.timeSignatures.forEach((p, i) => {
    if (!integer(p.atBar) || p.atBar < 0 || !integer(p.numerator) || p.numerator < 1 ||
        !integer(p.denominator) || p.denominator < 1) {
      problems.push(`timeSignatures[${i}] needs non-negative integer atBar and positive integer terms`);
    }
    if (i > 0 && p.atBar <= project.timeSignatures[i - 1]!.atBar) problems.push(`timeSignatures[${i}].atBar must increase`);
  });
  for (const [id, groove] of Object.entries(project.grooves)) {
    if (!positive(groove.subdivisionBeats) || !Array.isArray(groove.steps) || groove.steps.length === 0) {
      problems.push(`grooves.${id} needs positive subdivisionBeats and at least one step`);
    }
    groove.steps.forEach((s, i) => {
      if (!finite(s.offsetMs) || !finite(s.velocityScale) || s.velocityScale < 0) {
        problems.push(`grooves.${id}.steps[${i}] needs finite offsetMs and non-negative velocityScale`);
      }
    });
  }
  for (const [id, pattern] of Object.entries(project.patterns)) {
    const at = `patterns.${id}`;
    if (!positive(pattern.lengthBeats)) problems.push(`${at}.lengthBeats must be positive`);
    if (pattern.groove !== undefined && !project.grooves[pattern.groove]) problems.push(`${at}.groove ${pattern.groove} does not exist`);
    if (pattern.swing && (!positive(pattern.swing.subdivisionBeats) || !finite(pattern.swing.lateByBeats) ||
        pattern.swing.lateByBeats < 0 || pattern.swing.lateByBeats >= pattern.swing.subdivisionBeats)) {
      problems.push(`${at}.swing needs positive subdivisionBeats and lateByBeats inside 0..subdivisionBeats`);
    }
    const eventIds = new Set<string>();
    pattern.events.forEach((event, i) => {
      const et = `${at}.events[${i}]`;
      if (!event.id || eventIds.has(event.id)) problems.push(`${et}.id must be non-empty and unique`);
      eventIds.add(event.id);
      try {
        const beat = positionedBeat(event.atBeat, event.atBarBeat, project.timeSignatures, et);
        if (beat < 0 || beat >= pattern.lengthBeats) problems.push(`${et} position must lie inside the pattern`);
      } catch (error) { problems.push((error as Error).message); }
      if (!project.samplers[event.sampler]) problems.push(`${et}.sampler ${event.sampler} does not exist`);
      if (!finite(event.velocity) || event.velocity < 0 || event.velocity > 1) problems.push(`${et}.velocity must be inside 0..1`);
      if (event.durationBeats !== undefined && !positive(event.durationBeats)) problems.push(`${et}.durationBeats must be positive`);
      if (event.fitBeats !== undefined && !positive(event.fitBeats)) problems.push(`${et}.fitBeats must be positive`);
      if (event.timeRatio !== undefined && !positive(event.timeRatio)) problems.push(`${et}.timeRatio must be positive`);
      if (event.fitBeats !== undefined && event.timeRatio !== undefined) problems.push(`${et} cannot carry fitBeats and timeRatio`);
      if (event.midi !== undefined && event.semitones !== undefined) problems.push(`${et} cannot carry midi and semitones`);
      if (event.gain !== undefined && (!finite(event.gain) || event.gain < 0)) problems.push(`${et}.gain must be non-negative`);
      if (event.microtimingMs !== undefined && !finite(event.microtimingMs)) problems.push(`${et}.microtimingMs must be finite`);
      const v = event.variation;
      if (v?.probability !== undefined && (!finite(v.probability) || v.probability < 0 || v.probability > 1)) {
        problems.push(`${et}.variation.probability must be inside 0..1`);
      }
      range(v?.timingDeltaMs, `${et}.variation.timingDeltaMs`, problems);
      range(v?.velocityDelta, `${et}.variation.velocityDelta`, problems);
      range(v?.gainScale, `${et}.variation.gainScale`, problems);
      range(v?.pitchDeltaSemitones, `${et}.variation.pitchDeltaSemitones`, problems);
    });
  }
  const validateUse = (use: PatternUse, at: string, sectionLength?: number) => {
    if (!use.id || !project.patterns[use.pattern]) problems.push(`${at} needs an id and an existing pattern`);
    let useBeat: number | null = null;
    try { useBeat = positionedBeat(use.atBeat, use.atBarBeat, project.timeSignatures, at); }
    catch (error) { problems.push((error as Error).message); }
    if (useBeat !== null && useBeat < 0 || !integer(use.repeats) || use.repeats < 1 || use.repeats > MAX_REPEAT || !positive(use.everyBeats)) {
      problems.push(`${at} needs a non-negative position, positive integer repeats, and positive everyBeats`);
    }
    for (const [field, value] of Object.entries({
      velocityScale: use.velocityScale, gainScale: use.gainScale,
    })) {
      if (value !== undefined && (!finite(value) || value < 0)) problems.push(`${at}.${field} must be non-negative`);
    }
    if (use.transposeSemitones !== undefined && !finite(use.transposeSemitones)) problems.push(`${at}.transposeSemitones must be finite`);
    if (use.microtimingMs !== undefined && !finite(use.microtimingMs)) problems.push(`${at}.microtimingMs must be finite`);
    const pattern = project.patterns[use.pattern];
    if (pattern && sectionLength !== undefined && useBeat !== null && integer(use.repeats) && use.repeats >= 1 && positive(use.everyBeats)) {
      const endBeat = useBeat + (use.repeats - 1) * use.everyBeats + pattern.lengthBeats;
      if (endBeat > sectionLength + 1e-9) {
        problems.push(`${at} ends at beat ${endBeat}, beyond its section length ${sectionLength}`);
      }
    }
  };
  for (const [id, section] of Object.entries(project.sections)) {
    const at = `sections.${id}`;
    if (!positive(section.lengthBeats)) problems.push(`${at}.lengthBeats must be positive`);
    const useIds = new Set<string>();
    section.uses.forEach((use, i) => {
      validateUse(use, `${at}.uses[${i}]`, section.lengthBeats);
      if (useIds.has(use.id)) problems.push(`${at}.uses[${i}].id must be unique`);
      useIds.add(use.id);
    });
  }
  const returnIds = new Set<string>();
  project.sequence.forEach((ret, i) => {
    const at = `sequence[${i}]`;
    if (!ret.id || returnIds.has(ret.id)) problems.push(`${at}.id must be non-empty and unique`);
    returnIds.add(ret.id);
    const section = project.sections[ret.section];
    if (!section) problems.push(`${at}.section ${ret.section} does not exist`);
    if (!integer(ret.repeats) || ret.repeats < 1 || ret.repeats > MAX_REPEAT) {
      problems.push(`${at}.repeats must be a positive integer no greater than ${MAX_REPEAT}`);
    }
    const baseIds = new Set(section?.uses.map((u) => u.id) ?? []);
    ret.overrides?.forEach((override, j) => {
      if (!baseIds.has(override.use)) problems.push(`${at}.overrides[${j}].use ${override.use} does not exist`);
      if (override.pattern !== undefined && !project.patterns[override.pattern]) problems.push(`${at}.overrides[${j}].pattern does not exist`);
      const base = section?.uses.find((use) => use.id === override.use);
      if (base) validateUse(mergeUse(base, override), `${at}.overrides[${j}]`, section?.lengthBeats);
    });
    ret.addUses?.forEach((use, j) => validateUse(use, `${at}.addUses[${j}]`, section?.lengthBeats));
    const effectiveIds = [...baseIds];
    for (const use of ret.addUses ?? []) {
      if (effectiveIds.includes(use.id)) problems.push(`${at}.addUses id ${use.id} duplicates another use on this return`);
      effectiveIds.push(use.id);
    }
  });
  if (project.sequence.length === 0) problems.push('sequence must not be empty');
  let projectedEvents = 0;
  for (const ret of project.sequence) {
    const section = project.sections[ret.section];
    if (!section || !integer(ret.repeats) || ret.repeats < 1 || ret.repeats > MAX_REPEAT) continue;
    const overrideMap = new Map(ret.overrides?.map((override) => [override.use, override]) ?? []);
    const uses = [...section.uses.map((use) => mergeUse(use, overrideMap.get(use.id))), ...(ret.addUses ?? [])];
    for (const use of uses) {
      const pattern = project.patterns[use.pattern];
      if (!pattern || use.enabled === false || !integer(use.repeats) || use.repeats < 1 || use.repeats > MAX_REPEAT) continue;
      projectedEvents += ret.repeats * use.repeats * pattern.events.length;
      if (projectedEvents > MAX_COMPILED_EVENTS) break;
    }
    if (projectedEvents > MAX_COMPILED_EVENTS) break;
  }
  if (projectedEvents > MAX_COMPILED_EVENTS) {
    problems.push(`arrangement expands to more than ${MAX_COMPILED_EVENTS} events`);
  }
  return problems;
}

function gridIndex(atBeat: number, subdivision: number): number | null {
  const n = atBeat / subdivision;
  const rounded = Math.round(n);
  return Math.abs(n - rounded) < 1e-9 ? rounded : null;
}

/** Compile patterns, section returns, groove, variation, and sampler selection. */
export function compileArrangement(project: ArrangementProject): CompiledArrangement {
  const problems = describeArrangementProblems(project);
  if (problems.length > 0) throw new RangeError(problems.join('; '));
  const triggers: SampleTrigger[] = [];
  let cursorBeat = 0;

  for (const ret of project.sequence) {
    const section = project.sections[ret.section]!;
    const overrideMap = new Map(ret.overrides?.map((o) => [o.use, o]) ?? []);
    const baseUses = section.uses.map((use) => mergeUse(use, overrideMap.get(use.id)));
    const uses = [...baseUses, ...(ret.addUses ?? [])];
    for (let sectionRepeat = 0; sectionRepeat < ret.repeats; sectionRepeat++) {
      const sectionStart = cursorBeat + sectionRepeat * section.lengthBeats;
      for (const use of uses) {
        if (use.enabled === false) continue;
        const pattern = project.patterns[use.pattern]!;
        const groove = pattern.groove ? project.grooves[pattern.groove]! : null;
        for (let patternRepeat = 0; patternRepeat < use.repeats; patternRepeat++) {
          const patternStart = sectionStart + positionedBeat(use.atBeat, use.atBarBeat, project.timeSignatures, `use ${use.id}`) + patternRepeat * use.everyBeats;
          for (const event of pattern.events) {
            const occurrence = `${ret.id}/${sectionRepeat}/${use.id}/${patternRepeat}/${event.id}`;
            const variation = event.variation;
            const probability = variation?.probability ?? 1;
            if (random01(project.seed, occurrence, 'probability') >= probability) continue;

            const authoredEventBeat = positionedBeat(event.atBeat, event.atBarBeat, project.timeSignatures, `event ${event.id}`);
            let eventBeat = authoredEventBeat;
            if (pattern.swing) {
              const index = gridIndex(authoredEventBeat, pattern.swing.subdivisionBeats);
              if (index !== null && Math.abs(index % 2) === 1) eventBeat += pattern.swing.lateByBeats;
            }
            let grooveOffsetMs = 0;
            let grooveVelocity = 1;
            if (groove) {
              const index = gridIndex(authoredEventBeat, groove.subdivisionBeats);
              if (index !== null) {
                const step = groove.steps[((index % groove.steps.length) + groove.steps.length) % groove.steps.length]!;
                grooveOffsetMs = step.offsetMs;
                grooveVelocity = step.velocityScale;
              }
            }
            const absoluteBeat = patternStart + eventBeat;
            const timingVariation = varied(variation?.timingDeltaMs, project.seed, occurrence, 'timing', 0);
            const atMs = beatToMs(project.tempoMap, absoluteBeat) + grooveOffsetMs +
              (event.microtimingMs ?? 0) + (use.microtimingMs ?? 0) + timingVariation;
            const velocity = event.velocity * grooveVelocity * (use.velocityScale ?? 1) +
              varied(variation?.velocityDelta, project.seed, occurrence, 'velocity', 0);
            if (velocity < 0 || velocity > 1) {
              throw new RangeError(`compiled event ${occurrence} has velocity ${velocity}; variation and groove must keep it inside 0..1`);
            }
            const gainScale = varied(variation?.gainScale, project.seed, occurrence, 'gain', 1);
            if (gainScale < 0) throw new RangeError(`compiled event ${occurrence} has negative gain scale`);
            const pitchVariation = varied(variation?.pitchDeltaSemitones, project.seed, occurrence, 'pitch', 0);
            const transposition = (use.transposeSemitones ?? 0) + pitchVariation;
            const gateMs = event.durationBeats === undefined ? undefined :
              beatToMs(project.tempoMap, absoluteBeat + event.durationBeats) - beatToMs(project.tempoMap, absoluteBeat);
            const fitMs = event.fitBeats === undefined ? undefined :
              beatToMs(project.tempoMap, absoluteBeat + event.fitBeats) - beatToMs(project.tempoMap, absoluteBeat);
            const trigger: SampleTrigger = {
              id: occurrence,
              sampler: event.sampler,
              atMs,
              velocity,
              ...(gateMs !== undefined ? { gateMs } : {}),
              gain: (event.gain ?? 1) * (use.gainScale ?? 1) * gainScale,
              ...(event.midi !== undefined ? { midi: event.midi + transposition } : {}),
              ...(event.semitones !== undefined ? { semitones: event.semitones + transposition } :
                (event.midi === undefined && transposition !== 0 ? { semitones: transposition } : {})),
              ...(event.timeRatio !== undefined ? { timeRatio: event.timeRatio } : {}),
              ...(fitMs !== undefined ? { fitMs } : {}),
            };
            triggers.push(trigger);
          }
        }
      }
    }
    cursorBeat += section.lengthBeats * ret.repeats;
  }
  const musicalDurationMs = beatToMs(project.tempoMap, cursorBeat);
  const ordered = triggers.map((trigger, order) => ({ trigger, order }))
    .sort((a, b) => a.trigger.atMs - b.trigger.atMs || a.order - b.order)
    .map(({ trigger }) => trigger);
  const samples = planSamples(ordered, project.assets, project.samplers);
  const durationMs = Math.max(musicalDurationMs, ...samples.map((sample) => sample.timelineEndMs));
  return {
    durationBeats: cursorBeat,
    durationMs,
    triggers: ordered,
    samples,
  };
}
