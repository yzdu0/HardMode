/** Cardinal joins only; portals have markers, never a misleading straight line. */
export function roadConnections(N: number, active: Set<string>, wrap = false, vertical = false) {
  const joins = new Map<string, number>();
  const directions = [[-1, 0, 1], [0, 1, 2], [1, 0, 4], [0, -1, 8]];
  for (const key of active) {
    const [r, c] = key.split(',').map(Number);
    let mask = 0;
    for (const [dr, dc, bit] of directions) {
      const nr = vertical ? (r + dr + N) % N : r + dr;
      const nc = wrap ? (c + dc + N) % N : c + dc;
      if (nr >= 0 && nc >= 0 && nr < N && nc < N && active.has(nr + ',' + nc)) mask |= bit;
    }
    joins.set(key, mask);
  }
  return joins;
}

/** One snapshot per gesture, with no empty undo steps or persisted answer data. */
export class RouteHistory {
  private steps: Set<string>[] = [];
  private pending: Set<string> | null = null;
  begin(route: Set<string>) { if (!this.pending) this.pending = new Set(route); }
  commit(route: Set<string>) {
    const before = this.pending;
    this.pending = null;
    if (!before || (before.size === route.size && [...before].every(k => route.has(k)))) return;
    this.steps.push(before);
    if (this.steps.length > 64) this.steps.shift();
  }
  undo(): Set<string> | undefined { return this.steps.pop(); }
  get available() { return this.steps.length > 0; }
  reset() { this.steps = []; this.pending = null; }
}
