declare module 'pathfinding/src/finders/JPFMoveDiagonallyIfNoObstacles.js' {
  interface Node {
    x: number;
    y: number;
    parent?: Node;
    g?: number;
    f?: number;
    opened?: boolean;
    closed?: boolean;
  }
  interface SearchGrid {
    getNodeAt(x: number, y: number): Node;
    isWalkableAt(x: number, y: number): boolean;
    getNeighbors(node: Node): Node[];
  }
  interface Finder {
    findPath(sx: number, sy: number, ex: number, ey: number, grid: SearchGrid): number[][];
    _jump(x: number, y: number, px: number, py: number): number[] | null;
  }
  const Constructor: new (options: { heuristic(dx: number, dy: number): number }) => Finder;
  export default Constructor;
}
