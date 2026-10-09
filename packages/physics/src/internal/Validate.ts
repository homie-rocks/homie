/** Reject misspelled options before allocating or mutating engine state. */
export function keys(value: unknown, names: string, label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`physics: ${label} must be an object`);
  }
  const allowed = new Set(names.split(" "));
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new TypeError(`physics: unknown ${label} option ${key}`);
  }
}
export function bounded(
  value: number,
  name: string,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`physics: ${name} must be ${min}..${max}`);
  }
  return value;
}

/** Boolean options must be booleans; a string such as "false" is not false. */
export function booleans(value: object, names: string): void {
  const options = value as Record<string, unknown>;
  for (const name of names.split(" ")) {
    if (options[name] !== undefined && typeof options[name] !== "boolean") {
      throw new TypeError(`physics: ${name} must be a boolean`);
    }
  }
}

/** Axis switches are complete triples so an omitted axis cannot change meaning. */
export function axes(value: object, name: string): void {
  keys(value, "x y z", name);
  for (const axis of ["x", "y", "z"]) {
    if (typeof (value as Record<string, unknown>)[axis] !== "boolean") {
      throw new TypeError(`physics: ${name}.${axis} must be a boolean`);
    }
  }
}
