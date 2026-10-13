import { brand, charge, own } from './guard.ts';

export interface Substep { readonly dt: number; readonly index: number; readonly count: number; readonly first: boolean; readonly fraction: number }
export interface StepPose { pos: {x:number;y:number;z:number}; vel: {x:number;y:number;z:number}; heading: {x:number;y:number;z:number}; grounded: boolean }
const traces = new WeakMap<object, readonly StepPose[]>();
const running = new WeakSet<object>();
const scalar = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const vector = (value: unknown) => ({x:scalar(own(value,'x')),y:scalar(own(value,'y')),z:scalar(own(value,'z'))});
const pose = (body: object): StepPose => ({pos:vector(own(body,'pos')),vel:vector(own(body,'vel')),heading:vector(own(body,'heading')),grounded:own(body,'grounded') === true});

/** Same integration and trace accounting on authority and prediction; no independent quota. */
export function substeps(tickHz: number) {
  return (body: object, hz: number, step: (context: Substep) => void): void => {
    charge(8);
    const count = typeof hz === 'number' ? hz / tickHz : NaN;
    if (typeof hz !== 'number' || !Number.isSafeInteger(count) || count < 1) throw new RangeError('substeps: hz must be a positive integer multiple of room.tickHz');
    if (!body || typeof body !== 'object' || typeof step !== 'function') throw new TypeError('substeps: expected body, hz, callback');
    if (running.has(body) || traces.has(body)) throw new Error('substeps: integrate a body only once per move');
    // Pay before allocation and callbacks. Each pose copies ten scalars and three vectors.
    charge(64 * (count + 1));
    const samples: StepPose[] = [pose(body)];
    running.add(body);
    traces.delete(body);
    try {
      for (let index = 0; index < count; index++) {
        step(brand(Object.freeze({dt:1/hz,index,count,first:index === 0,fraction:(index+1)/count})));
        samples.push(pose(body));
      }
      traces.set(body, samples);
    } finally { running.delete(body); }
  };
}

/** Runtime-only drawing data, never an extra part of a room save or wire frame. */
export function takeSubsteps(body: object): readonly StepPose[] | undefined {
  const samples = traces.get(body);
  traces.delete(body);
  return samples;
}
