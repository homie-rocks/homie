// Four occupied cells in a 4×4 box. Shared, immutable geometry for rules and view.
const SHAPES = [[4,5,6,7],[1,2,5,6],[1,4,5,6],[1,2,4,5],[0,1,5,6],[0,4,5,6],[2,4,5,6]];
export function cells(kind: number, rotation: number): number[] {
  const source = SHAPES[Math.max(0, Math.min(6, kind - 1))];
  const out: number[] = [];
  for (const cell of source) {
    let x = cell % 4, y = Math.floor(cell / 4);
    for (let r = 0; r < (kind === 2 ? 0 : rotation % 4); r++) { const old = x; x = 3 - y; y = old; }
    out.push(y * 4 + x);
  }
  return out;
}
export function fits(board: readonly number[], kind: number, rotation: number, x: number, y: number): boolean {
  for (const cell of cells(kind, rotation)) {
    const cx = x + cell % 4, cy = y + Math.floor(cell / 4);
    if (cx < 0 || cx >= 10 || cy >= 20 || (cy >= 0 && board[cy * 10 + cx] !== 0)) return false;
  }
  return true;
}
