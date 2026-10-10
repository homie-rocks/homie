/** Spatial hash for edits not yet present in the engine's query index. */
import type { Vec3 } from "../Types.ts";
import type { Shape } from "@dimforge/rapier3d-deterministic";
export function queryRadius(shape: Shape): number {
  const s = shape as unknown as {
    radius?: number;
    halfHeight?: number;
    halfExtents?: Vec3;
    vertices?: Float32Array;
    heights?: Float32Array;
    scale?: Vec3;
  };
  if (s.halfExtents)
    return (
      Math.sqrt(
        s.halfExtents.x ** 2 + s.halfExtents.y ** 2 + s.halfExtents.z ** 2,
      ) + 0.001
    );
  if (s.radius !== undefined) return s.radius + (s.halfHeight ?? 0) + 0.001;
  if (s.vertices) {
    let squared = 0;
    for (let i = 0; i < s.vertices.length; i += 3)
      squared = Math.max(
        squared,
        s.vertices[i]! ** 2 + s.vertices[i + 1]! ** 2 + s.vertices[i + 2]! ** 2,
      );
    return Math.sqrt(squared) + 0.001;
  }
  if (s.heights && s.scale) {
    let h = 0;
    for (const value of s.heights) h = Math.max(h, Math.abs(value * s.scale.y));
    return (
      Math.sqrt((s.scale.x / 2) ** 2 + h * h + (s.scale.z / 2) ** 2) + 0.001
    );
  }
  return Infinity;
}
export class PendingIndex {
  #cells = new Map<string, Set<number>>();
  #keys = new Map<number, string[]>();
  #large = new Set<number>();
  clear(): void {
    this.#cells.clear();
    this.#keys.clear();
    this.#large.clear();
  }
  delete(id: number): void {
    for (const key of this.#keys.get(id) ?? []) {
      const cell = this.#cells.get(key)!;
      cell.delete(id);
      if (!cell.size) this.#cells.delete(key);
    }
    this.#keys.delete(id);
    this.#large.delete(id);
  }
  #range(lo: Vec3, hi: Vec3): number[] | null {
    const r = [
      Math.floor(lo.x / 8),
      Math.floor(hi.x / 8),
      Math.floor(lo.y / 8),
      Math.floor(hi.y / 8),
      Math.floor(lo.z / 8),
      Math.floor(hi.z / 8),
    ];
    if (
      (r[1]! - r[0]! + 1) * (r[3]! - r[2]! + 1) * (r[5]! - r[4]! + 1) > 4096 ||
      r.some((n) => !Number.isFinite(n))
    )
      return null;
    return r;
  }
  set(id: number, p: Vec3, radius: number): void {
    this.delete(id);
    const r = this.#range(
      { x: p.x - radius, y: p.y - radius, z: p.z - radius },
      { x: p.x + radius, y: p.y + radius, z: p.z + radius },
    );
    if (!r) {
      this.#large.add(id);
      return;
    }
    const keys: string[] = [];
    for (let x = r[0]!; x <= r[1]!; x++)
      for (let y = r[2]!; y <= r[3]!; y++)
        for (let z = r[4]!; z <= r[5]!; z++) {
          const key = `${x},${y},${z}`;
          let cell = this.#cells.get(key);
          if (!cell) this.#cells.set(key, (cell = new Set()));
          cell.add(id);
          keys.push(key);
        }
    this.#keys.set(id, keys);
  }
  candidates(p: Vec3, v: Vec3, radius: number): number[] {
    const end = { x: p.x + v.x, y: p.y + v.y, z: p.z + v.z };
    const r = this.#range(
      {
        x: Math.min(p.x, end.x) - radius,
        y: Math.min(p.y, end.y) - radius,
        z: Math.min(p.z, end.z) - radius,
      },
      {
        x: Math.max(p.x, end.x) + radius,
        y: Math.max(p.y, end.y) + radius,
        z: Math.max(p.z, end.z) + radius,
      },
    );
    if (!r) return [...this.#keys.keys(), ...this.#large].sort((a, b) => a - b);
    const out = new Set(this.#large);
    for (let x = r[0]!; x <= r[1]!; x++)
      for (let y = r[2]!; y <= r[3]!; y++)
        for (let z = r[4]!; z <= r[5]!; z++)
          for (const id of this.#cells.get(`${x},${y},${z}`) ?? []) out.add(id);
    return [...out].sort((a, b) => a - b);
  }
}
