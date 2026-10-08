/** PathFinding.js supplies JPS pruning, heap, and path reconstruction. The scan
 * below replaces its recursive _jump with iteration, so million-cell corridors
 * cannot overflow the JavaScript stack. It also avoids allocating a node merely
 * to compare its coordinates with the destination. */
import Finder from 'pathfinding/src/finders/JPFMoveDiagonallyIfNoObstacles.js';
export const octile = (dx: number, dy: number): number =>
  Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
export function jumpPath(
  width: number,
  start: number,
  end: number,
  free: (x: number, y: number) => boolean,
  neighbours: (i: number) => number[],
): number[] {
  const ex = end % width,
    ey = Math.floor(end / width);
  const finder = new Finder({
    heuristic: octile,
  });
  finder._jump = (x, y, px, py) => {
    const dx = x - px,
      dy = y - py;
    while (free(x, y)) {
      if (x === ex && y === ey) return [x, y];
      if (dx && dy) {
        if (finder._jump(x + dx, y, x, y) || finder._jump(x, y + dy, x, y)) return [x, y];
      } else if (dx) {
        if ((free(x, y - 1) && !free(x - dx, y - 1)) || (free(x, y + 1) && !free(x - dx, y + 1)))
          return [x, y];
      } else if (
        (free(x - 1, y) && !free(x - 1, y - dy)) ||
        (free(x + 1, y) && !free(x + 1, y - dy))
      )
        return [x, y];
      if (!free(x + dx, y) || !free(x, y + dy)) return null;
      x += dx;
      y += dy;
    }
    return null;
  };
  const nodes = new Map<number, { x: number; y: number }>();
  const getNodeAt = (x: number, y: number): { x: number; y: number } => {
    const id = y * width + x;
    let node = nodes.get(id);
    if (!node) {
      node = { x, y };
      nodes.set(id, node);
    }
    return node;
  };
  return finder
    .findPath(start % width, Math.floor(start / width), ex, ey, {
      getNodeAt,
      isWalkableAt: free,
      getNeighbors: (node) =>
        neighbours(node.y * width + node.x).map((i) => getNodeAt(i % width, Math.floor(i / width))),
    })
    .map((p) => p[1]! * width + p[0]!);
}
