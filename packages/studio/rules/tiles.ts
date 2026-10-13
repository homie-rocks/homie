import { bakeGridFlow } from './nav/Flow.ts';
import { charge } from './guard.ts';
import type { GameMap, MapBox, MapWrap, Vec3 } from './rules.ts';
export interface Tiles {
    readonly width: number;
    readonly height: number;
    readonly size: number;
    readonly at: Vec3;
    readonly solidHeight: number;
    readonly data: readonly number[];
    readonly flows: Readonly<Record<string, readonly number[]>>;
}
const fields = new WeakMap<object, Map<string, ReturnType<typeof bakeGridFlow>>>();
export function compileTiles(raw: any, wrap?: MapWrap): {
    tiles: Tiles;
    boxes: MapBox[];
} | undefined {
    if (raw === undefined)
        return;
    const { width, height, size = 1, solidHeight = 1 } = raw, n = width * height, at = raw.at ?? [0, 0, 0];
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !Number.isSafeInteger(n) || !Number.isFinite(size) || size <= 0 || !Number.isFinite(solidHeight) || solidHeight <= 0 || !Array.isArray(at) || at.length < 2 || at.length > 3 || at.some((x: unknown) => typeof x !== 'number' || !Number.isFinite(x)) || !Array.isArray(raw.data) || raw.data.length !== n)
        throw new Error('map tiles: positive width, height, size, solidHeight, at and one data value per cell');
    if (!Number.isFinite(at[0] + width * size) || !Number.isFinite(at[1] + height * size) || !Number.isFinite((at[2] ?? 0) + solidHeight))
        throw new Error('map tiles: finite extent required');
    const data = raw.data.map((v: unknown) => { if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 65535)
        throw new Error('map tile values are integers 0..65535'); return v; });
    const origin = { x: at[0], y: at[1], z: at[2] ?? 0 }, boxes: MapBox[] = [];
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            if (data[y * width + x]) {
                const start = x;
                while (x + 1 < width && data[y * width + x + 1])
                    x++;
                boxes.push(Object.freeze({ min: Object.freeze({ x: origin.x + start * size, y: origin.y + y * size, z: origin.z }), max: Object.freeze({ x: origin.x + (x + 1) * size, y: origin.y + (y + 1) * size, z: origin.z + solidHeight }) }));
            }
    const flows: Record<string, readonly number[]> = {}, baked = new Map<string, ReturnType<typeof bakeGridFlow>>();
    for (const [name, goals] of Object.entries(raw.flows ?? {})) {
        if (!/^[a-z][A-Za-z0-9_]{0,31}$/.test(name) || !Array.isArray(goals))
            throw new Error('tile flows name lists of goal cell indices');
        flows[name] = Object.freeze([...goals]);
        baked.set(name, bakeGridFlow({ width, height, data, wrapX: Boolean(wrap?.x), wrapY: Boolean(wrap?.y) }, goals, charge));
    }
    const tiles = Object.freeze({ width, height, size, solidHeight, at: Object.freeze(origin), data: Object.freeze(data), flows: Object.freeze(flows) });
    fields.set(tiles, baked);
    return { tiles, boxes };
}
export function tileApi(get: () => GameMap) {
    const cell = (x: unknown, y: unknown) => { const t = get().tiles; if (!t || typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y))
        return -1; const w = get().wrap; if (w?.x)
        x = ((x % t.width) + t.width) % t.width; if (w?.y)
        y = ((y % t.height) + t.height) % t.height; return x < 0 || y < 0 || x >= t.width || y >= t.height ? -1 : y * t.width + x; };
    return {
        tile: (x: unknown, y: unknown) => { charge(4); const id = cell(x, y); return id < 0 ? 1 : get().tiles!.data[id]; },
        distance: (name: unknown, x: unknown, y: unknown) => { charge(4); const id = cell(x, y), f = typeof name === 'string' && get().tiles ? fields.get(get().tiles!)?.get(name) : null; return id < 0 || !f ? -1 : f.distance[id]; },
        flow: (name: unknown, x: unknown, y: unknown) => { charge(8); const id = cell(x, y), t = get().tiles, f = typeof name === 'string' && t ? fields.get(t)?.get(name) : null; if (!t || id < 0 || !f || f.next[id] < 0)
            return undefined; const next = f.next[id], dx = next % t.width - id % t.width, dy = Math.floor(next / t.width) - Math.floor(id / t.width); return Object.freeze({ x: Math.abs(dx) > 1 ? -Math.sign(dx) : dx, y: Math.abs(dy) > 1 ? -Math.sign(dy) : dy, z: 0 }); },
    };
}
