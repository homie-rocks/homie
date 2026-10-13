/** Copy and compile a room map before publishing it. No mutation survives a failed bake. */
import { charge, own } from './guard.ts';
import { compileMap, type GameMap } from './rules.ts';
export type MapRevision = readonly [
    number,
    unknown
];
function copy(value: unknown, depth = 0): unknown {
    charge(6);
    if (typeof value === 'string') {
        charge(value.length);
        return value;
    }
    if (value === null || typeof value === 'boolean')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (!value || typeof value !== 'object' || depth > 8)
        throw new Error('map.replace needs finite plain map data');
    if (Array.isArray(value)) {
        const out = [];
        for (let i = 0; i < value.length; i++)
            out.push(copy(own(value, i), depth + 1));
        return Object.freeze(out);
    }
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value)) {
        charge(key.length);
        out[key] = copy(own(value, key), depth + 1);
    }
    return Object.freeze(out);
}
export function prepareMapReplacement(value: unknown, base: GameMap): {
    raw: unknown;
    map: GameMap;
    cells: number;
} {
    const raw = copy(value) as any;
    // Index construction sorts at each depth. Charge its upper bound before compilation.
    let runs = 0;
    const tiles = raw?.tiles;
    if (tiles && Array.isArray(tiles.data)) {
        charge(tiles.data.length * 8);
        for (let i = 0; i < tiles.data.length; i++)
            if (tiles.data[i] && (i % tiles.width === 0 || !tiles.data[i - 1]))
                runs++;
    }
    const count = (raw?.boxes?.length ?? 0) + (raw?.circles?.length ?? 0) + (raw?.spheres?.length ?? 0) + (raw?.capsules?.length ?? 0) + (raw?.heightTiles?.length ?? 0) + runs;
    charge(64 + count * (16 + Math.ceil(Math.log2(count + 1)) ** 2));
    const map = compileMap(raw, base.name);
    if (JSON.stringify(map.bounds) !== JSON.stringify(base.bounds) || (['x', 'y', 'z'] as const).some(k => Boolean(map.wrap?.[k]) !== Boolean(base.wrap?.[k])))
        throw new Error('map.replace preserves bounds and wrap; replace level geometry, tiles and spots');
    return { raw, map, cells: JSON.stringify(raw).length };
}
