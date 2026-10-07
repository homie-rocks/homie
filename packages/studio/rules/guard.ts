/*
 * guard.ts — what guarded rules call while they run: the step budget, the size cap and the guarded accesses.
 * =============================================================================
 *
 * `homie-studio build` rewrites every rules module (lib/rules-guard.mjs): a counter at the top of every loop and every
 * function, every computed key through `g`/`s`/`u`, every method call through `c`. This file is the other half: the
 * functions those rewrites call. It runs wherever rules run: inside the `Table`, in a browser (a view's `move`), and in
 * Node for the build check. No imports, erasable TypeScript only.
 *
 * It is a wall against a careless module written by the studio's own AI, not a sandbox against code written to attack.
 * Rules cannot catch what it throws, because the build refuses `try` in rules.
 *
 * THE BUDGET. `G.left` is the units the running handler may still use. The host runtime sets it before each handler
 * and reads it after. Every charge takes from it; below zero, `BudgetError` is thrown and the runtime abandons that
 * handler, as it does for any throw. Outside a handler it is Infinity, so module load is never charged.
 * =============================================================================
 */

/** No array, string, `Map` or `Set` in rules may pass this many entries. */
export const SIZE_CAP = 65_536;

/** The methods rules may call, by the kind of value they are called on. Any other method name is refused. */
export const ARRAY_METHODS: ReadonlySet<string> = new Set(['push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat', 'indexOf', 'lastIndexOf', 'includes', 'find', 'findIndex', 'some', 'every', 'map', 'filter', 'reduce', 'forEach', 'flat', 'flatMap', 'sort', 'reverse', 'join', 'at']);
export const STRING_METHODS: ReadonlySet<string> = new Set(['slice', 'indexOf', 'includes', 'startsWith', 'endsWith', 'split', 'trim', 'toUpperCase', 'toLowerCase', 'charCodeAt', 'at']);
export const MAPSET_METHODS: ReadonlySet<string> = new Set(['get', 'set', 'has', 'add', 'delete', 'clear', 'forEach', 'keys', 'values', 'entries']);
/** Property names no rule may name, in any position (and anything beginning `toLocale`). */
export const REFUSED_NAMES: ReadonlySet<string> = new Set(['constructor', 'prototype', '__proto__', 'stack', 'localeCompare']);
export const refusedName = (k: string): boolean => REFUSED_NAMES.has(k) || k.startsWith('toLocale');

/** The running handler's budget. One per isolate: handlers never run at the same time. */
export const G = { left: Infinity };

/** Thrown when a handler has used its share of the tick. Rules cannot catch it. */
export class BudgetError extends Error {
  constructor() { super('this handler ran too long: it used its whole share of the tick (a loop that never ends, or too much work in one step)'); this.name = 'BudgetError'; }
}
/** Thrown when rules reach for something outside the wall at run time (a built key, a method that is not allowed, a size past the cap). */
export class GuardError extends Error {
  constructor(message: string) { super(message); this.name = 'GuardError'; }
}

/** Take `n` units from the running handler. The host runtime's own functions call it with the weights of the design. */
export function charge(n: number): void {
  if ((G.left -= n) < 0) throw new BudgetError();
}
/** One loop turn, or one call of a function in rules. */
export function t(): void {
  if ((G.left -= 1) < 0) throw new BudgetError();
}

/** Objects the host runtime made (`world`, `ctx`, `world.math`, the map, the round): rules may call their own functions. */
const HOST = new WeakSet<object>();
export function brand<T extends object>(o: T): T { HOST.add(o); return o; }

const at = (line: number | undefined): string => (line ? ` (line ${line})` : '');
function refuse(what: string, line?: number): never { throw new GuardError(`${what}${at(line)}`); }
const sized = (n: number, line?: number): void => { if (n > SIZE_CAP) refuse(`a list, text, Map or Set in rules holds at most ${SIZE_CAP} entries`, line); };

/** A computed read, `a[k]`: a number, or a string naming an own property that is not a function. Never a prototype. */
export function g(o: any, k: unknown, line?: number): unknown {
  if (o === null || o === undefined) throw new TypeError(`cannot read a key of ${o}${at(line)}`);
  if (typeof k === 'number') return o[k];
  if (typeof k !== 'string') refuse('a computed key is a number or a string', line);
  if (refusedName(k)) refuse(`the key "${k}" is not allowed in rules`, line);
  if (!Object.hasOwn(o, k)) return undefined;
  const v = o[k];
  if (typeof v === 'function') refuse(`"${k}" is a function: a method may be called, never read as a value`, line);
  return v;
}
/** An optional computed read, `a?.[k]`. */
export function go(o: any, k: unknown, line?: number): unknown {
  return o === null || o === undefined ? undefined : g(o, k, line);
}
/** A computed key that is only named (an object literal's `{ [k]: 1 }`, a destructuring pattern's `{ [k]: v }`). */
export function k(key: unknown, line?: number): string | number {
  if (typeof key === 'number') return key;
  if (typeof key !== 'string') refuse('a computed key is a number or a string', line);
  if (refusedName(key)) refuse(`the key "${key}" is not allowed in rules`, line);
  return key;
}
/** A computed write, `a[k] = v`: a number (inside the size cap), or a string other than the refused names. */
export function s(o: any, key: unknown, v: unknown, line?: number): unknown {
  if (o === null || typeof o !== 'object') throw new TypeError(`cannot write a key of ${o === null ? 'null' : typeof o}${at(line)}`);
  if (typeof key === 'number') { if (Array.isArray(o) && key >= SIZE_CAP) sized(key + 1, line); } else k(key, line);
  o[key as string] = v;
  return v;
}
/** A computed update, `a[k] += v` or `a[k]++`: the key is read once. `post`: the old value is the result (`a[k]++`). */
export function u(o: any, key: unknown, fn: (old: any) => unknown, post?: boolean, line?: number): unknown {
  const old = g(o, key, line);
  const next = fn(old);
  s(o, key, next, line);
  return post ? old : next;
}
/** A static read of a name that is also a method name (`hit.at`, `e.keys`): the value, unless it is a function. */
export function rd(o: any, name: string, line?: number): unknown {
  const v = o[name];
  if (typeof v === 'function' && !HOST.has(o)) refuse(`"${name}" is a function here: a method may be called, never read as a value`, line);
  return v;
}

/** An optional static read, `o?.at`. */
export function rdo(o: any, name: string, line?: number): unknown {
  return o === null || o === undefined ? undefined : rd(o, name, line);
}
/** A value taken out of an object by a destructuring pattern under a method's name: never a function. */
export function nf<T>(v: T, line?: number): T {
  if (typeof v === 'function') refuse('a destructuring pattern took a function out of a value: a method may be called, never read as a value', line);
  return v;
}

const lengthOf = (x: unknown): number => (typeof x === 'string' || Array.isArray(x) ? x.length : x instanceof Map || x instanceof Set ? x.size : 1);

/** A method call, `o.name(...args)`: an allowed method of a list, a text, a Map or a Set, or a function the host runtime made. */
export function c(o: any, name: string, args: unknown[], line?: number): unknown {
  if (o === null || o === undefined) throw new TypeError(`cannot call ${name} on ${o}${at(line)}`);
  if (Array.isArray(o)) {
    if (!ARRAY_METHODS.has(name)) refuse(`a list has no method "${name}" that rules may call`, line);
    const n = o.length;
    if (name === 'push' || name === 'unshift') { charge(1 + args.length); sized(n + args.length, line); } else if (name === 'splice') { charge(1 + n + args.length); sized(n + args.length, line); } else if (name === 'concat') {
      let total = n;
      for (const a of args) total += Array.isArray(a) ? a.length : 1;
      charge(1 + total); sized(total, line);
    } else if (name === 'join') {
      let total = 0;
      const sep = args[0] === undefined ? 1 : String(args[0]).length;
      for (const e of o) { total += (typeof e === 'string' ? e.length : 24) + sep; if (total > SIZE_CAP) sized(total, line); }
      charge(1 + n + total);
    } else if (name === 'sort') charge(1 + 16 * n);
    else if (name === 'pop' || name === 'at') charge(1);
    else charge(1 + n);
    const out = (o as any)[name](...args);
    if (name === 'flat' || name === 'flatMap') { charge(lengthOf(out)); sized(lengthOf(out), line); }
    return out;
  }
  if (typeof o === 'string') {
    if (!STRING_METHODS.has(name)) refuse(`a text has no method "${name}" that rules may call`, line);
    charge(name === 'at' || name === 'charCodeAt' ? 1 : 1 + o.length);
    return (o as any)[name](...args);
  }
  if (o instanceof Map || o instanceof Set) {
    if (!MAPSET_METHODS.has(name)) refuse(`a Map or Set has no method "${name}" that rules may call`, line);
    if (name === 'set' || name === 'add') { charge(1); sized(o.size + 1, line); } else if (name === 'forEach' || name === 'clear') charge(1 + o.size);
    else charge(1);
    const out = (o as any)[name](...args);
    // An iterator (keys, values, entries) is read by a loop, which is charged a unit a turn.
    return out;
  }
  if (HOST.has(o) && Object.hasOwn(o, name) && typeof o[name] === 'function') return o[name](...args);
  return refuse(`"${name}" is not a method rules may call on this value`, line);
}
/** An optional method call, `o?.name(...args)`. */
export function co(o: any, name: string, args: unknown[], line?: number): unknown {
  return o === null || o === undefined ? undefined : c(o, name, args, line);
}
/** A method call through a computed key, `o[key](...args)`. */
export function cc(o: any, key: unknown, args: unknown[], line?: number): unknown {
  if (typeof key !== 'string' || refusedName(key)) refuse('a method is called by a name that is a plain string', line);
  return c(o, key as string, args, line);
}

/** A spread, `...x`: a list, a text, a Map or a Set, charged a unit an entry. */
export function sp<T>(x: T, line?: number): T {
  if (!(typeof x === 'string' || Array.isArray(x) || x instanceof Map || x instanceof Set)) {
    // An object spread (`{ ...o }`) copies own keys; anything else has no business being spread.
    if (x === null || typeof x !== 'object') refuse('only a list, a text, a Map, a Set or a plain object can be spread', line);
    charge(1 + Object.keys(x as object).length);
    return x;
  }
  const n = lengthOf(x);
  charge(1 + n); sized(n, line);
  return x;
}
/** A list literal that held a spread: its length is checked once it is made. */
export function lit<T extends unknown[]>(a: T, line?: number): T { sized(a.length, line); return a; }
/** `a + b`: a number as ever; a text is charged a unit a character and held to the size cap. */
export function add(a: any, b: any, line?: number): any {
  const out = a + b;
  if (typeof out === 'string') { charge(out.length); sized(out.length, line); }
  return out;
}
/** A template literal's text, charged and capped like `+`. */
export function tpl(text: string, line?: number): string { charge(text.length); sized(text.length, line); return text; }
/** `Object.keys`, `values` and `entries`, charged a unit a key. */
export function keys(o: object): string[] { const out = Object.keys(o); charge(1 + out.length); return out; }
export function values(o: object): unknown[] { const out = Object.values(o); charge(1 + out.length); return out; }
export function entries(o: object): [string, unknown][] { const out = Object.entries(o); charge(1 + out.length); return out; }
/** `new Map(...)` and `new Set(...)`, inside a handler only (the build checks where). */
export function map(init?: Iterable<readonly [unknown, unknown]>): Map<unknown, unknown> { const m = new Map(init); charge(1 + m.size); sized(m.size); return m; }
export function set(init?: Iterable<unknown>): Set<unknown> { const m = new Set(init); charge(1 + m.size); sized(m.size); return m; }

/** A value frozen all the way down (module-level constants, event data, query results). Functions are left alone. */
export function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  for (const key of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[key]);
  return Object.freeze(v);
}
