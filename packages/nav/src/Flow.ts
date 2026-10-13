/** Cardinal multi-source flow bake. Stable left/up/right/down ties.
 * Callers can debit deterministic work before allocation and for each visited cell. */
export interface FlowGrid {
  width: number;
  height: number;
  data: readonly number[];
  wrapX?: boolean;
  wrapY?: boolean;
}

export function bakeGridFlow(
  grid: FlowGrid,
  goals: readonly number[],
  charge: (units: number) => void = () => {},
): { distance: Int32Array; next: Int32Array } {
  const { width, height, data } = grid;
  const count = width * height;
  if (!Number.isSafeInteger(count) || width < 1 || height < 1 ||
      !Number.isInteger(width) || !Number.isInteger(height) || data.length !== count) {
    throw new Error('nav flow: invalid grid');
  }
  charge(count * 4);
  const distance = new Int32Array(count).fill(-1);
  const next = new Int32Array(count).fill(-1);
  const queue = new Int32Array(count);
  let tail = 0;
  for (const goal of goals) {
    charge(2);
    if (!Number.isInteger(goal) || goal < 0 || goal >= count) throw new Error('nav flow: goal outside grid');
    if (!data[goal] && distance[goal]! < 0) {
      distance[goal] = 0;
      next[goal] = goal;
      queue[tail++] = goal;
    }
  }
  for (let head = 0; head < tail; head++) {
    charge(16);
    const cell = queue[head]!, x = cell % width, y = Math.floor(cell / width);
    for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
      let nx = x + dx!, ny = y + dy!;
      if (grid.wrapX) nx = (nx + width) % width;
      if (grid.wrapY) ny = (ny + height) % height;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const id = ny * width + nx;
      if (data[id] || distance[id] !== -1) continue;
      distance[id] = distance[cell]! + 1;
      next[id] = cell;
      queue[tail++] = id;
    }
  }
  return { distance, next };
}
