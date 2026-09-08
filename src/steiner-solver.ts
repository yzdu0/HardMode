// Exact Steiner-tree solver (Dreyfus-Wagner, node-weighted, non-negative
// costs). Node costs: terminals 0, spores 0, thorns 3, everything else 1.
// Portal pairs are zero-cost edges between their endpoints, and a wrapping
// board joins each row's two ends the same way. Returns the true minimum
// network cost, or NaN if the terminals are disconnected.
export function solveSteinerExact(N: number, terms: number[][], walls: Set<string>, special: Map<string, { type: string }>, portalPairs: Record<string, number[][]>, wrap?: boolean, wrapVertical?: boolean) {
  const key = (r, c) => r + "," + c;
  const idx = new Map<string, number>(), cells: [number, number][] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const k = key(r, c);
    if (walls.has(k)) continue;
    idx.set(k, cells.length); cells.push([r, c]);
  }
  const n = cells.length;
  const tIdx = terms.map(([r, c]) => idx.get(key(r, c)));
  if (tIdx.some((v) => v === undefined)) return NaN;
  const isTerm = new Set(tIdx);
  const cost = new Array(n);
  for (let i = 0; i < n; i++) {
    if (isTerm.has(i)) { cost[i] = 0; continue; }
    const [r, c] = cells[i], sp = special.get(key(r, c));
    cost[i] = sp && sp.type === "bonus" ? 0 : sp && sp.type === "penalty" ? 3 : 1;
  }
  const adj: number[][] = cells.map(() => []);
  cells.forEach(([r, c], i) => {
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(r + dr, c + dc);
      if (idx.has(k)) adj[i].push(idx.get(k));
    }
  });
  if (wrap) for (let r = 0; r < N; r++) {
    const ka = key(r, 0), kb = key(r, N - 1);
    if (idx.has(ka) && idx.has(kb)) {
      adj[idx.get(ka)].push(idx.get(kb));
      adj[idx.get(kb)].push(idx.get(ka));
    }
  }
  if (wrapVertical) for (let c = 0; c < N; c++) {
    const a = idx.get(key(0, c)), b = idx.get(key(N - 1, c));
    if (a !== undefined && b !== undefined) { adj[a].push(b); adj[b].push(a); }
  }
  for (const pid of Object.keys(portalPairs || {})) {
    const [a, b] = portalPairs[pid];
    const ka = key(a[0], a[1]), kb = key(b[0], b[1]);
    if (idx.has(ka) && idx.has(kb)) {
      adj[idx.get(ka)].push(idx.get(kb));
      adj[idx.get(kb)].push(idx.get(ka));
    }
  }
  const K = tIdx.length, FULL = (1 << K) - 1, INF = 1e15;
  const dp = new Float64Array((FULL + 1) * n).fill(INF);
  const hd: number[] = [], hn: number[] = []; // binary heap of (dist, node)
  function heapPush(d: number, v: number) {
    hd.push(d); hn.push(v);
    let i = hd.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      const td = hd[p]; hd[p] = hd[i]; hd[i] = td;
      const tn = hn[p]; hn[p] = hn[i]; hn[i] = tn;
      i = p;
    }
  }
  function heapPop() {
    const top = hn[0], ld = hd.pop(), ln = hn.pop();
    if (hd.length) {
      hd[0] = ld; hn[0] = ln;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let m = i;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (r < hd.length && hd[r] < hd[m]) m = r;
        if (m === i) break;
        const td = hd[m]; hd[m] = hd[i]; hd[i] = td;
        const tn = hn[m]; hn[m] = hn[i]; hn[i] = tn;
        i = m;
      }
    }
    return top;
  }
  function dijkstra(mask: number, ceiling: number) {
    const base = mask * n;
    hd.length = 0; hn.length = 0;
    const done = new Uint8Array(n);
    for (let v = 0; v < n; v++) if (dp[base + v] < INF) heapPush(dp[base + v], v);
    while (hd.length) {
      const u = heapPop();
      if (done[u]) continue;
      done[u] = 1;
      const du = dp[base + u];
      for (const v of adj[u]) {
        const nd = du + cost[v];
        if (nd < dp[base + v] && nd <= ceiling) { dp[base + v] = nd; heapPush(nd, v); }
      }
    }
  }
  // Any tree the nearest-terminal heuristic finds is an upper bound, and every
  // node cost is non-negative, so states dearer than it can never lead anywhere
  // optimal. Pruning against it cuts most of the table away.
  function heuristicBound() {
    const inNet = new Uint8Array(n);
    inNet[tIdx[0]] = 1;
    const dist = new Float64Array(n), prev = new Int32Array(n);
    for (let round = 1; round < K; round++) {
      dist.fill(INF); prev.fill(-1);
      hd.length = 0; hn.length = 0;
      const done = new Uint8Array(n);
      for (let v = 0; v < n; v++) if (inNet[v]) { dist[v] = 0; heapPush(0, v); }
      let target = -1;
      while (hd.length) {
        const u = heapPop();
        if (done[u]) continue;
        done[u] = 1;
        if (isTerm.has(u) && !inNet[u]) { target = u; break; }
        for (const v of adj[u]) {
          const nd = dist[u] + (inNet[v] ? 0 : cost[v]);
          if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heapPush(nd, v); }
        }
      }
      if (target < 0) return INF;
      for (let v = target; v >= 0 && !inNet[v]; v = prev[v]) inNet[v] = 1;
      if (tIdx.every((t) => inNet[t])) break;
    }
    if (!tIdx.every((t) => inNet[t])) return INF;
    let sum = 0;
    for (let v = 0; v < n; v++) if (inNet[v]) sum += cost[v];
    return sum;
  }
  const ceiling = heuristicBound();
  for (let i = 0; i < K; i++) dp[((1 << i) * n) + tIdx[i]] = 0;
  for (let mask = 1; mask <= FULL; mask++) {
    if ((mask & (mask - 1)) !== 0) { // join two sub-solutions at each node
      const low = mask & -mask, rest = mask ^ low;
      for (let v = 0; v < n; v++) {
        let best = INF;
        for (let s = rest;; s = (s - 1) & rest) { // each split seen once
          const o = mask ^ (s | low);
          if (o) {
            const cand = dp[(s | low) * n + v] + dp[o * n + v] - cost[v];
            if (cand < best) best = cand;
          }
          if (!s) break;
        }
        if (best < dp[mask * n + v] && best <= ceiling) dp[mask * n + v] = best;
      }
    }
    dijkstra(mask, ceiling);
  }
  let ans = INF;
  for (let v = 0; v < n; v++) ans = Math.min(ans, dp[FULL * n + v]);
  return ans >= INF / 2 ? NaN : ans;
}
