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
/**
 * The names JavaScript itself calls when it turns an object into a number or a text. A plain value may sit under one
 * (it is only a field with an odd name); a function may not, so no code of the rules can be run by a conversion.
 */
export const HOOK_NAMES: ReadonlySet<string> = new Set(['valueOf', 'toString', 'toJSON']);
export const refusedName = (k: string): boolean => REFUSED_NAMES.has(k) || k.startsWith('toLocale');

/** The running handler's budget. One per isolate: handlers never run at the same time. */
export const G = { left: Infinity };

/**
 * An object's own data property, read without running anything: a property that is a getter reads as absent, and so
 * does one the object only inherits. The runtime reads everything the rules hand it this way (pack.ts, "THE BOUNDARY").
 */
export function own(o: unknown, key: string | number): unknown {
  if (o === null || typeof o !== 'object') return undefined;
  const d = Object.getOwnPropertyDescriptor(o, key);
  return d !== undefined && Object.hasOwn(d, 'value') ? d.value : undefined;
}

/** The other way: a value written to an object the rules handed over, as plain data. A property that is a setter is never run: the write is refused. */
export function put(o: object, key: string, v: unknown): void {
  const d = Object.getOwnPropertyDescriptor(o, key);
  if (d !== undefined && !Object.hasOwn(d, 'value')) throw new TypeError(`"${key}" is not a plain property of this value`);
  (o as Record<string, unknown>)[key] = v;
}

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
  // Written so that anything but a count still inside the budget stops the handler: a charge that is not a number can never switch the counter off.
  if (!((G.left -= n) >= 0)) throw new BudgetError();
}
/** One loop turn, or one call of a function in rules. */
export function t(): void {
  if (!((G.left -= 1) >= 0)) throw new BudgetError();
}

/** What one guarded method call costs before anything it does: finding which kind of value it is called on, and the call itself. */
export const CALL = 3;

/** Objects the host runtime made (`world`, `ctx`, `world.math`, the map, the round): rules may call their own functions. */
const HOST = new WeakSet<object>();
export function brand<T extends object>(o: T): T { HOST.add(o); return o; }

const at = (line: number | undefined): string => (line ? ` (line ${line})` : '');
function refuse(what: string, line?: number): never { throw new GuardError(`${what}${at(line)}`); }
const sized = (n: number, line?: number): void => { if (n > SIZE_CAP) refuse(`a list, text, Map or Set in rules holds at most ${SIZE_CAP} entries`, line); };

/**
 * A value about to be used where JavaScript wants a number or a text (an operand of `-`, `<`, `+`; an argument of
 * `Number()`, `String()` or `Math.max()`; a part of a template): it must be one already. Turning a list into a text
 * walks every entry of it and of every list inside it, at a cost no counter sees (a list that holds itself twice,
 * thirty levels deep, is a thousand million entries), so a list, an object or a function is refused here instead.
 */
export function p<T>(x: T, line?: number): T {
  const kind = typeof x;
  // A long text is read end to end by whatever uses it here (a comparison, a conversion): a unit for every 64 characters.
  if (kind === 'string') { if ((x as string).length >= 64) charge((x as string).length >> 6); return x; }
  if ((kind === 'object' && x !== null) || kind === 'function' || kind === 'bigint' || kind === 'symbol') refuse(`${Array.isArray(x) ? 'a list' : kind === 'object' ? 'an object' : `a ${kind}`} was used where a number or a text belongs: name the entry or the field you mean`, line);
  return x;
}
/** `a === b`: two long texts of one length are compared character by character, so that is charged, a unit for every 64. */
export function eq(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string' && a.length === b.length && a.length >= 64) charge(a.length >> 6);
  return a === b;
}
/** What a `switch` turns on: a long text is compared with each case in turn, and charged for each. */
export function sw<T>(x: T, cases: number): T {
  if (typeof x === 'string' && x.length >= 64) charge((x.length >> 6) * cases);
  return x;
}
/** The value of a property named `valueOf`, `toString` or `toJSON`: never a function. */
export function nh<T>(v: T, line?: number): T {
  if (typeof v === 'function') refuse('a function may not sit under the name valueOf, toString or toJSON: JavaScript would call it by itself, outside any handler', line);
  return v;
}
/** The object of a write, `o.name = v`: never a function. So nothing can be kept on a function, and no built-in function can be changed. */
export function w<T>(o: T, line?: number): T {
  if (typeof o === 'function') refuse('nothing is kept on a function: state lives in declared fields', line);
  return o;
}

/** A computed read, `a[k]`: a number, or a string naming an own property that is not a function. Anything else throws. Never a prototype. */
export function g(o: any, k: unknown, line?: number): unknown {
  if (o === null || o === undefined) throw new TypeError(`cannot read a key of ${o}${at(line)}`);
  // A unit for the guarded access itself: a loop that does nothing but read keys is then paid for at the rate of any other.
  if (!((G.left -= 1) >= 0)) throw new BudgetError();
  if (typeof k === 'number') return o[k];
  if (typeof k !== 'string') refuse('a computed key is a number or a string', line);
  if (refusedName(k)) refuse(`the key "${k}" is not allowed in rules`, line);
  const v = o[k];
  if (typeof v === 'function') refuse(`"${k}" is a function: a method may be called, never read as a value`, line);
  // Only what the value holds itself: a key it does not have never falls through to a prototype.
  if (!Object.hasOwn(o, k)) refuse(`there is no "${k}" on this value: a computed key names something the value holds itself (test with \`key in value\` first)`, line);
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
  if (refusedName(key) || HOOK_NAMES.has(key)) refuse(`the key "${key}" is not allowed in rules`, line);
  return key;
}
/** A computed write, `a[k] = v`: a number (inside the size cap), or a string other than the refused names. */
export function s(o: any, key: unknown, v: unknown, line?: number): unknown {
  if (o === null || typeof o !== 'object') throw new TypeError(`cannot write a key of ${o === null ? 'null' : typeof o}${at(line)}`);
  if (!((G.left -= 1) >= 0)) throw new BudgetError();
  if (typeof key === 'number') { if (Array.isArray(o) && key >= SIZE_CAP) sized(key + 1, line); } else if (typeof key === 'string' && HOOK_NAMES.has(key)) nh(v, line); else k(key, line);
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
  if (typeof v === 'function') refuse(`"${name}" is a function here: a method may be called, never read as a value`, line);
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
const plainArg = (x: unknown): boolean => { const kind = typeof x; return !((kind === 'object' && x !== null) || kind === 'function' || kind === 'bigint' || kind === 'symbol'); };
/** The arguments of a built-in method that JavaScript would turn into a number or a text: each must be one already (see `p`). */
function plainArgs(name: string, args: unknown[], from: number, to: number, line?: number): void {
  for (let i = from; i < to && i < args.length; i += 1) if (!plainArg(args[i])) refuse(`${name}() was handed a list or an object where a number or a text belongs`, line);
}
/** How many entries `flat(depth)` would read, stopping as soon as it is past `cap`: a list reached twice is read twice, as `flat` would. */
function flatSteps(a: unknown[], depth: number, cap: number): number {
  let n = 0;
  // Each list is paid for before it is read.
  charge(a.length);
  for (let i = 0; i < a.length; i += 1) {
    const e = a[i];
    n += 1;
    if (depth >= 1 && Array.isArray(e)) n += flatSteps(e, depth - 1, cap - n);
    if (n > cap) return n;
  }
  return n;
}

/** A method call, `o.name(...args)`: an allowed method of a list, a text, a Map or a Set, or a function the host runtime made. */
export function c(o: any, name: string, args: unknown[], line?: number): unknown {
  if (o === null || o === undefined) throw new TypeError(`cannot call ${name} on ${o}${at(line)}`);
  charge(CALL);
  if (Array.isArray(o)) {
    if (!ARRAY_METHODS.has(name)) refuse(`a list has no method "${name}" that rules may call`, line);
    const n = o.length;
    // Every cost below is charged before the method runs, so a handler on its last unit starts nothing it cannot pay for.
    if (name === 'push') { charge(1 + args.length); sized(n + args.length, line); } else if (name === 'unshift') { charge(1 + n + args.length); sized(n + args.length, line); } else if (name === 'splice') { plainArgs(name, args, 0, 2, line); charge(1 + n + args.length); sized(n + args.length, line); } else if (name === 'concat') {
      let total = n;
      for (const a of args) total += Array.isArray(a) ? a.length : 1;
      charge(1 + total); sized(total, line);
    } else if (name === 'join') {
      // A list of texts and numbers only: a list inside it would be joined in turn, to any depth, uncounted.
      plainArgs(name, args, 0, 1, line);
      let total = 0;
      const sep = args[0] === undefined ? 1 : String(args[0]).length;
      charge(1 + n);
      for (let i = 0; i < n; i += 1) {
        const e = o[i];
        if (!plainArg(e)) refuse('join() takes a list of texts and numbers: this list holds a list or an object', line);
        total += (typeof e === 'string' ? e.length : 24) + sep; if (total > SIZE_CAP) sized(total, line);
      }
      charge(total);
    } else if (name === 'sort') {
      charge(1 + 16 * n);
      const cmp = args[0];
      if (typeof cmp === 'function') {
        // What the comparison returns is turned into a number by the sort itself: it must be one.
        return o.sort((a: unknown, b: unknown) => { const r = cmp(a, b); if (typeof r !== 'number') refuse('the function handed to sort() returns a number: below zero, zero or above', line); return r; });
      }
      // With no comparison the sort compares entries as texts: each must be a text or a number already, and long texts are paid for by their length.
      let chars = 0;
      for (let i = 0; i < n; i += 1) { const e = o[i]; if (!plainArg(e)) refuse('sort() with no comparison takes a list of texts and numbers: hand it a function that compares two entries', line); if (typeof e === 'string') chars += e.length; }
      charge((chars >> 6) * 16);
    } else if (name === 'flat') {
      plainArgs(name, args, 0, 1, line);
      const depth = args[0] === undefined ? 1 : Number(args[0]);
      sized(flatSteps(o, depth >= 1 ? depth : 0, SIZE_CAP), line);
    } else if (name === 'flatMap') {
      // Done here, entry by entry, so the list being made is charged and capped as it grows.
      const fn = args[0];
      if (typeof fn !== 'function') throw new TypeError(`flatMap takes a function${at(line)}`);
      charge(1 + n);
      const out: unknown[] = [];
      for (let i = 0; i < n; i += 1) {
        const r = fn(o[i], i, o);
        if (Array.isArray(r)) { charge(r.length); sized(out.length + r.length, line); for (let j = 0; j < r.length; j += 1) out.push(r[j]); } else out.push(r);
      }
      return out;
    } else if (name === 'pop') charge(1);
    else if (name === 'at') { plainArgs(name, args, 0, 1, line); charge(1); } else {
      if (name === 'slice') plainArgs(name, args, 0, 2, line);
      else if (name === 'indexOf' || name === 'lastIndexOf' || name === 'includes') {
        plainArgs(name, args, 1, 2, line);
        // Looking for a long text compares it with every entry.
        if (typeof args[0] === 'string' && args[0].length >= 64) charge(n * (args[0].length >> 6));
      }
      charge(1 + n);
    }
    return (o as any)[name](...args);
  }
  if (typeof o === 'string') {
    if (!STRING_METHODS.has(name)) refuse(`a text has no method "${name}" that rules may call`, line);
    plainArgs(name, args, 0, args.length, line);
    // A search for a long text inside a long text can compare every character of one at every place in the other.
    const needle = typeof args[0] === 'string' && (name === 'indexOf' || name === 'includes' || name === 'split') ? args[0].length : 0;
    charge(name === 'at' || name === 'charCodeAt' ? 1 : 1 + o.length + Math.floor((o.length * needle) / 16));
    return (o as any)[name](...args);
  }
  if (o instanceof Map || o instanceof Set) {
    if (!MAPSET_METHODS.has(name)) refuse(`a Map or Set has no method "${name}" that rules may call`, line);
    // keys, values and entries hand back a list, paid for by its length: no iterator reaches rules, so nothing can read one out uncounted.
    if (name === 'keys' || name === 'values' || name === 'entries') { charge(1 + o.size); return Array.from((o as any)[name]()); }
    if (name === 'set' || name === 'add') { charge(1); sized(o.size + 1, line); } else if (name === 'forEach' || name === 'clear') charge(1 + o.size);
    else charge(1);
    // A long text as a key is compared, character by character, with the key it finds.
    if (typeof args[0] === 'string' && args[0].length >= 64) charge(args[0].length >> 6);
    return (o as any)[name](...args);
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
    hostless(x, line);
    const proto = Object.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== null) refuse('only a list, a text, a Map, a Set or a plain object can be spread', line);
    if (!prepaid(x)) charge(1 + Object.keys(x as object).length);
    return x;
  }
  const n = lengthOf(x);
  charge(1 + n); sized(n, line);
  return x;
}
/** A spread into `Math.max(...x)` and the like: a list, charged a unit an entry, of numbers and texts only (see `p`). */
export function spp<T>(x: T, line?: number): T {
  if (!Array.isArray(x)) refuse('only a list of numbers can be spread into a Math function', line);
  const a = x as unknown[];
  charge(1 + a.length); sized(a.length, line);
  for (let i = 0; i < a.length; i += 1) if (!plainArg(a[i])) refuse('a list or an object was used where a number belongs', line);
  return x;
}
/** A list literal that held a spread: its length is checked once it is made. */
export function lit<T extends unknown[]>(a: T, line?: number): T { sized(a.length, line); return a; }
/** `a + b`: a number as ever; a text is charged a unit a character and held to the size cap. */
export function add(a: any, b: any, line?: number): any {
  p(a, line); p(b, line);
  const out = a + b;
  if (typeof out === 'string') { charge(out.length); sized(out.length, line); }
  return out;
}
/** A template literal's text, charged and capped like `+`. */
export function tpl(text: string, line?: number): string { charge(text.length); sized(text.length, line); return text; }
/** `Object.keys`, `values` and `entries`, charged a unit a key. */
export function keys(o: object): string[] { const paid = prepaid(o); const out = Object.keys(o); if (!paid) charge(1 + out.length); return out; }
export function values(o: object): unknown[] { hostless(o); const paid = prepaid(o); const out = Object.values(o); if (!paid) charge(1 + out.length); return out; }
export function entries(o: object): [string, unknown][] { hostless(o); const paid = prepaid(o); const out = Object.entries(o); if (!paid) charge(1 + out.length); return out; }
/**
 * How many keys a value has, when that is known without counting them: a list or a text by its length, and a
 * module-level constant by the count taken when it was frozen at load.
 */
const KEYS = new WeakMap<object, number>();
export function keyCount(o: unknown): number | undefined {
  if (typeof o === 'string' || Array.isArray(o)) return o.length;
  return o !== null && typeof o === 'object' ? KEYS.get(o) : undefined;
}
/**
 * Going through all of a value's keys, charged BEFORE it is done when the count is known (16 units a key for a
 * constant, whose keys cost the handler nothing to make). True when it was. A value whose count is not known was made
 * by the running handler, which paid a unit and more for every key it has: that one is charged after.
 */
export function prepaid(o: unknown): boolean {
  const n = keyCount(o);
  if (n === undefined) return false;
  charge(1 + (typeof o === 'string' || Array.isArray(o) ? n : 16 * n));
  return true;
}
/** `for (const k in o)`: JavaScript lists every key before the first turn, so a constant's are paid for here. */
export function fi<T>(o: T, line?: number): T {
  if (o !== null && typeof o === 'object') { hostless(o, line); prepaid(o); }
  return o;
}
/** `world`, `ctx` and what hangs from them hold functions: their values are not taken out in a list or copied by a spread, so no host function is ever held as a value. */
function hostless(o: unknown, line?: number): void {
  if (typeof o === 'object' && o !== null && HOST.has(o)) refuse('world and ctx are not lists of values: call what they offer by name', line);
}
/** `new Map(...)` and `new Set(...)`, inside a handler only (the build checks where). */
export function map(init?: Iterable<readonly [unknown, unknown]>): Map<unknown, unknown> { charge(1 + (init === undefined ? 0 : lengthOf(init))); const m = new Map(init); sized(m.size); return m; }
export function set(init?: Iterable<unknown>): Set<unknown> { charge(1 + (init === undefined ? 0 : lengthOf(init))); const m = new Set(init); sized(m.size); return m; }

/** A value frozen all the way down (module-level constants, event data, query results). Functions are left alone. */
export function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  const list = Object.keys(v as object);
  // The count is kept (`keyCount`): a handler that goes through a constant's keys is charged for them before it starts.
  if (!Array.isArray(v)) KEYS.set(v, list.length);
  for (const key of list) deepFreeze((v as Record<string, unknown>)[key]);
  return Object.freeze(v);
}
