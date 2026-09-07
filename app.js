/* Hard Mode — daily Steiner (moss) + Graph Colouring (modern). No deps. */
(function () {
  "use strict";

  // ---------- dates ----------
  function todayKey(d) {
    d = d || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  function parseKey(k) {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(key, n) {
    const d = parseKey(key);
    d.setDate(d.getDate() + n);
    return todayKey(d);
  }
  function shortLabel(key) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const [y, m, d] = key.split("-").map(Number);
    return months[m - 1] + " " + d;
  }
  const TODAY_REAL = todayKey();
  const MIN_DATE = addDays(TODAY_REAL, -89);
  const ARCHIVE_DAYS = 30;
  let activeDate = TODAY_REAL;
  let mode = "daily"; // 'daily', 'tutorial' or 'custom'
  let customSession = null; // {id, name, game} for custom play sessions
  function storeKey(game) {
    if (mode === "tutorial") return "hm-tutorial-" + game;
    if (mode === "custom") return "hm-custom-" + (customSession ? customSession.id : "x") + "-" + game;
    return "hm-" + activeDate + "-" + game;
  }
  function shareLabel() {
    if (mode === "tutorial") return "tutorial";
    if (mode === "custom" && customSession) return "custom “" + customSession.name + "”";
    return activeDate;
  }

  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rngFor(dateKey, salt) {
    return mulberry32(xmur3(dateKey + "|" + salt)());
  }
  function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo)); }

  // ---------- tabs ----------
  const tabS = document.getElementById("tabSteiner");
  const tabC = document.getElementById("tabColor");
  const tabG = document.getElementById("tabGraphle");
  const tabT = document.getElementById("tabTreedle");
  const tabE = document.getElementById("tabEditor");
  const viewS = document.getElementById("viewSteiner");
  const viewC = document.getElementById("viewColor");
  const viewG = document.getElementById("viewGraphle");
  const viewT = document.getElementById("viewTreedle");
  const viewE = document.getElementById("viewEditor");
  const VIEWS = { steiner: [tabS, viewS], color: [tabC, viewC], graphle: [tabG, viewG], treedle: [tabT, viewT], editor: [tabE, viewE] };
  function showView(which) {
    for (const k of Object.keys(VIEWS)) {
      const on = k === which;
      VIEWS[k][0].classList.toggle("active", on);
      VIEWS[k][1].classList.toggle("hidden", !on);
    }
  }
  tabS.onclick = () => { if (mode !== "daily") exitToDaily("steiner"); else showView("steiner"); };
  tabC.onclick = () => { if (mode !== "daily") exitToDaily("color"); else showView("color"); };
  tabG.onclick = () => { if (mode !== "daily") exitToDaily("graphle"); else showView("graphle"); };
  tabT.onclick = () => { if (mode !== "daily") exitToDaily("treedle"); else showView("treedle"); };
  tabE.onclick = () => {
    if (mode !== "daily") {
      mode = "daily";
      customSession = null;
      steinerTutBox.classList.add("hidden"); colorTutBox.classList.add("hidden");
      steinerCustomBar.classList.add("hidden"); colorCustomBar.classList.add("hidden");
      steinerTutBtn.style.display = ""; colorTutBtn.style.display = "";
    }
    daterowEl.style.display = "none";
    archiveEl.classList.add("hidden");
    showView("editor");
  };

  // ---------- streak (always relative to real today) ----------
  const GAMES = ["steiner", "color", "graphle", "treedle"];
  function isSolvedStore(key, game) {
    try {
      const d = JSON.parse(localStorage.getItem("hm-" + key + "-" + game) || "null");
      return !!(d && d.solved);
    } catch (_) { return false; }
  }
  function updateStreak() {
    let s = 0;
    const d = new Date();
    const todayDone = GAMES.some((g) => isSolvedStore(TODAY_REAL, g));
    if (!todayDone) d.setDate(d.getDate() - 1);
    for (let i = 0; i < 365; i++) {
      const k = todayKey(d);
      if (GAMES.some((g) => isSolvedStore(k, g))) { s++; d.setDate(d.getDate() - 1); }
      else break;
    }
    document.getElementById("streakLabel").textContent = "🔥 " + s + " day streak";
  }

  // ---------- theme (light / dark / minimal), persisted ----------
  const THEME_IDS = { light: "themeLight", dark: "themeDark", minimal: "themeMinimal" };
  function setTheme(t) {
    if (t !== "dark" && t !== "minimal") t = "light";
    if (t === "light") delete document.body.dataset.theme;
    else document.body.dataset.theme = t;
    try { localStorage.setItem("hm-theme", t); } catch (_) {}
    for (const k of Object.keys(THEME_IDS)) {
      document.getElementById(THEME_IDS[k]).classList.toggle("active", k === t);
    }
  }
  document.getElementById("themeLight").onclick = () => setTheme("light");
  document.getElementById("themeDark").onclick = () => setTheme("dark");
  document.getElementById("themeMinimal").onclick = () => setTheme("minimal");

  // ============================================================
  // GAME 1 — STEINER TREE (moss)
  // ============================================================
  let GN = 12; // active board size (families vary it)

  // ---- shared steiner construction helpers ----
  function stKey(r, c) { return r + "," + c; }
  function stPlaceTerms(rr, N, count, minSep, ok) {
    const terms = [];
    for (let attempt = 0; attempt < 2000 && terms.length < count; attempt++) {
      const r = randInt(rr, 0, N), c = randInt(rr, 0, N);
      if (ok && !ok(r, c)) continue;
      if (terms.some(([tr, tc]) => Math.abs(tr - r) + Math.abs(tc - c) < minSep)) continue;
      if (terms.some(([tr, tc]) => tr === r && tc === c)) continue;
      terms.push([r, c]);
    }
    return terms.length === count ? terms : null;
  }
  function stGrowWalls(rr, N, termSet, target, locked, clump) {
    const walls = new Set([...locked]);
    let tries = 0;
    while (walls.size - locked.size < target && tries++ < 2500) {
      let r, c;
      const grown = [...walls].filter((k) => !locked.has(k));
      if (grown.length && rr() < clump) {
        const b = grown[randInt(rr, 0, grown.length)].split(",").map(Number);
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const d = dirs[randInt(rr, 0, 4)];
        r = b[0] + d[0]; c = b[1] + d[1];
        if (r < 0 || c < 0 || r >= N || c >= N) continue;
      } else {
        r = randInt(rr, 0, N); c = randInt(rr, 0, N);
      }
      const k = stKey(r, c);
      if (termSet.has(k) || walls.has(k)) continue;
      walls.add(k);
    }
    return walls;
  }
  function stBfsSeen(N, terms, walls) {
    const seen = new Set([stKey(terms[0][0], terms[0][1])]);
    const q = [terms[0]];
    while (q.length) {
      const [r, c] = q.pop();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= N || nc >= N) continue;
        const k = stKey(nr, nc);
        if (walls.has(k) || seen.has(k)) continue;
        seen.add(k); q.push([nr, nc]);
      }
    }
    return seen;
  }
  function stFreeConnected(N, terms, walls) {
    const seen = stBfsSeen(N, terms, walls);
    return terms.every(([r, c]) => seen.has(stKey(r, c)));
  }
  // Targeted carving that never touches locked walls. Returns true if all
  // terminals end up connected through free cells.
  function stCarve(rr, N, terms, walls, locked) {
    for (let iter = 0; iter < 200; iter++) {
      const seen = stBfsSeen(N, terms, walls);
      if (terms.every(([r, c]) => seen.has(stKey(r, c)))) return true;
      const unseen = terms.filter(([r, c]) => !seen.has(stKey(r, c)));
      let best = null, bestD = Infinity;
      walls.forEach((k) => {
        if (locked.has(k)) return;
        const [r, c] = k.split(",").map(Number);
        const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) => seen.has(stKey(r + dr, c + dc)));
        if (!adj) return;
        let d = Infinity;
        for (const [tr, tc] of unseen) d = Math.min(d, Math.abs(tr - r) + Math.abs(tc - c));
        if (d < bestD) { bestD = d; best = k; }
      });
      if (!best) return false;
      walls.delete(best);
    }
    return stFreeConnected(N, terms, walls);
  }
  function stClaim(rr, N, termSet, walls, special, ok) {
    for (let t = 0; t < 500; t++) {
      const r = randInt(rr, 0, N), c = randInt(rr, 0, N);
      const k = stKey(r, c);
      if (!termSet.has(k) && !walls.has(k) && !special.has(k) && (!ok || ok(r, c))) return [r, c];
    }
    return null;
  }
  function stScatterSpecials(rr, N, termSet, walls, special, nBonus, nPen, nPortals) {
    const take = (n, type, pid) => {
      const cells = [];
      for (let i = 0; i < n; i++) {
        const cell = stClaim(rr, N, termSet, walls, special, null);
        if (!cell) break;
        special.set(stKey(cell[0], cell[1]), pid ? { type, pid } : { type });
        cells.push(cell);
      }
      return cells;
    };
    take(nBonus, "bonus");
    take(nPen, "penalty");
    const portalPairs = {};
    const ids = ["A", "B"];
    for (let i = 0; i < Math.min(nPortals, 2); i++) {
      const cells = take(2, "portal", ids[i]);
      if (cells.length === 2) portalPairs[ids[i]] = cells;
    }
    return portalPairs;
  }

  // ---- intentional steiner families (unique looks, unique difficulties) ----
  // classic: scattered blobs, 7 terminals — the all-rounder
  function famClassic(rr) {
    const N = 12;
    const terms = stPlaceTerms(rr, N, 7, 5);
    if (!terms) return null;
    const termSet = new Set(terms.map(([r, c]) => stKey(r, c)));
    const locked = new Set();
    const walls = stGrowWalls(rr, N, termSet, 34, locked, 0.65);
    if (!stCarve(rr, N, terms, walls, locked)) return null;
    const special = new Map();
    const portalPairs = stScatterSpecials(rr, N, termSet, walls, special, 6, 6, 2);
    return { N, terms, termSet, walls, special, portalPairs, kind: "classic" };
  }
  // open field: only 3-4 terminals far apart, almost no walls — maximum
  // choice, the optimum hides among many similar networks
  function famOpen(rr) {
    const N = 13;
    const terms = stPlaceTerms(rr, N, 3 + Math.floor(rr() * 2), 6);
    if (!terms) return null;
    const termSet = new Set(terms.map(([r, c]) => stKey(r, c)));
    const locked = new Set();
    const walls = stGrowWalls(rr, N, termSet, 12, locked, 0.2);
    if (!stCarve(rr, N, terms, walls, locked)) return null;
    const special = new Map();
    const portalPairs = stScatterSpecials(rr, N, termSet, walls, special, 6, 6, 1 + Math.floor(rr() * 2));
    return { N, terms, termSet, walls, special, portalPairs, kind: "open field" };
  }
  // chambers: locked rock bars with seeded door gaps — room-to-room routing
  function famChambers(rr) {
    const N = 12;
    const locked = new Set();
    for (const bc of [4, 8]) {
      const g1 = 1 + Math.floor(rr() * 10);
      let g2 = 1 + Math.floor(rr() * 10);
      if (g2 === g1) g2 = (g2 % 10) + 1;
      for (let r = 1; r <= 10; r++) {
        if (r === g1 || r === g2) continue;
        locked.add(stKey(r, bc));
      }
    }
    const notBar = (r, c) => !locked.has(stKey(r, c));
    const terms = stPlaceTerms(rr, N, 5 + Math.floor(rr() * 2), 4, notBar);
    if (!terms) return null;
    const termSet = new Set(terms.map(([r, c]) => stKey(r, c)));
    const walls = stGrowWalls(rr, N, termSet, 10, locked, 0.3);
    if (!stCarve(rr, N, terms, walls, locked)) return null;
    const special = new Map();
    const portalPairs = stScatterSpecials(rr, N, termSet, walls, special, 4, 4, 2);
    return { N, terms, termSet, walls, special, portalPairs, kind: "chambers" };
  }
  // the divide: near-solid locked band with one door; portals are the highway
  function famSplit(rr) {
    const N = 12;
    const locked = new Set();
    const doorR = Math.floor(rr() * N);
    for (let r = 0; r < N; r++) for (const c of [5, 6]) {
      if (r === doorR) continue; // the door spans both columns
      locked.add(stKey(r, c));
    }
    const free = (r, c) => !locked.has(stKey(r, c));
    const left = stPlaceTerms(rr, N, 3, 4, (r, c) => c <= 4 && free(r, c));
    const right = stPlaceTerms(rr, N, 3, 4, (r, c) => c >= 7 && free(r, c));
    if (!left || !right) return null;
    const terms = left.concat(right);
    const termSet = new Set(terms.map(([r, c]) => stKey(r, c)));
    const walls = stGrowWalls(rr, N, termSet, 8, locked, 0.3);
    if (!stCarve(rr, N, terms, walls, locked)) return null;
    const special = new Map();
    const take = (n, type) => {
      for (let i = 0; i < n; i++) {
        const cell = stClaim(rr, N, termSet, walls, special, null);
        if (cell) special.set(stKey(cell[0], cell[1]), { type });
      }
    };
    take(4, "bonus"); take(4, "penalty");
    // portals always bridge the divide, serving the rows far from the door
    // (where the trek to the door hurts most)
    const portalPairs = {};
    const ids = ["A", "B"];
    for (const pid of ids) {
      const far = (side) => (r, c) => side(r, c) && Math.abs(r - doorR) >= 3;
      const a = stClaim(rr, N, termSet, walls, special, far((r, c) => c <= 4))
        || stClaim(rr, N, termSet, walls, special, (r, c) => c <= 4);
      const b = stClaim(rr, N, termSet, walls, special, far((r, c) => c >= 7))
        || stClaim(rr, N, termSet, walls, special, (r, c) => c >= 7);
      if (a && b) {
        special.set(stKey(a[0], a[1]), { type: "portal", pid });
        special.set(stKey(b[0], b[1]), { type: "portal", pid });
        portalPairs[pid] = [a, b];
      }
    }
    return { N, terms, termSet, walls, special, portalPairs, kind: "the divide" };
  }
  // thorn garden: few walls, but the cost landscape bites — 10 spores, 8 thorns
  function famGarden(rr) {
    const N = 12;
    const terms = stPlaceTerms(rr, N, 5, 5);
    if (!terms) return null;
    const termSet = new Set(terms.map(([r, c]) => stKey(r, c)));
    const locked = new Set();
    const walls = stGrowWalls(rr, N, termSet, 18, locked, 0.6);
    if (!stCarve(rr, N, terms, walls, locked)) return null;
    const special = new Map();
    const portalPairs = stScatterSpecials(rr, N, termSet, walls, special, 10, 8, 1);
    return { N, terms, termSet, walls, special, portalPairs, kind: "thorn garden" };
  }
  const BONUS_COST = 0, PENALTY_COST = 3, NORMAL_COST = 1;

  // Exact Steiner-tree solver (Dreyfus-Wagner, node-weighted, non-negative
  // costs). Node costs: terminals 0, spores 0, thorns 3, everything else 1.
  // Portal pairs are zero-cost edges between their endpoints. Returns the true
  // minimum network cost, or NaN if the terminals are disconnected.
  function solveSteinerExact(N, terms, walls, special, portalPairs) {
    const key = (r, c) => r + "," + c;
    const idx = new Map(), cells = [];
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
    const adj = cells.map(() => []);
    cells.forEach(([r, c], i) => {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(r + dr, c + dc);
        if (idx.has(k)) adj[i].push(idx.get(k));
      }
    });
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
    const hd = [], hn = []; // binary heap of (dist, node)
    function heapPush(d, v) {
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
    function dijkstra(mask) {
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
          if (nd < dp[base + v]) { dp[base + v] = nd; heapPush(nd, v); }
        }
      }
    }
    for (let i = 0; i < K; i++) dp[((1 << i) * n) + tIdx[i]] = 0;
    for (let mask = 1; mask <= FULL; mask++) {
      if ((mask & (mask - 1)) !== 0) { // join two sub-solutions at each node
        for (let v = 0; v < n; v++) {
          let best = INF;
          for (let s = (mask - 1) & mask; s; s = (s - 1) & mask) {
            const o = mask ^ s;
            if (!o || s > o) continue;
            const cand = dp[s * n + v] + dp[o * n + v] - cost[v];
            if (cand < best) best = cand;
          }
          if (best < dp[mask * n + v]) dp[mask * n + v] = best;
        }
      }
      dijkstra(mask);
    }
    let ans = INF;
    for (let v = 0; v < n; v++) ans = Math.min(ans, dp[FULL * n + v]);
    return ans >= INF / 2 ? NaN : ans;
  }

  const STEINER_FAMS = [famClassic, famOpen, famChambers, famSplit, famGarden];
  function genSteiner(dateKey) {
    const rng = rngFor(dateKey, "steiner");
    const startIdx = Math.floor(rng() * STEINER_FAMS.length);
    for (let t = 0; t < STEINER_FAMS.length; t++) {
      const fn = STEINER_FAMS[(startIdx + t) % STEINER_FAMS.length];
      const rr = mulberry32(xmur3(dateKey + "|steiner|" + fn.name)());
      const b = fn(rr);
      if (!b) continue;
      if (!stFreeConnected(b.N, b.terms, b.walls)) continue;
      const par = solveSteinerExact(b.N, b.terms, b.walls, b.special, b.portalPairs);
      if (!Number.isFinite(par) || par < 6 || par > 160) continue;
      return { terms: b.terms, termSet: b.termSet, walls: b.walls, special: b.special, par, portalPairs: b.portalPairs, kind: b.kind, N: b.N };
    }
    // last-resort open board (always valid)
    const terms = [[1, 1], [1, 10], [10, 1], [10, 10]];
    const walls = new Set(), special = new Map(), portalPairs = {};
    const par = solveSteinerExact(12, terms, walls, special, portalPairs);
    return { terms, termSet: new Set(terms.map(([r, c]) => stKey(r, c))), walls, special, par, portalPairs, kind: "classic", N: 12 };
  }

  // Fixed tutorial boards (same for everyone, forever).
  function tutorialSteiner() {
    const N = 12;
    const terms = [[1, 1], [1, 10], [10, 5]];
    const termSet = new Set(terms.map(([r, c]) => r + "," + c));
    const walls = new Set([[2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5]].map(([r, c]) => r + "," + c));
    const special = new Map();
    special.set("1,5", { type: "penalty" });
    special.set("8,3", { type: "bonus" });
    special.set("3,8", { type: "bonus" });
    special.set("5,1", { type: "portal", pid: "A" });
    special.set("5,10", { type: "portal", pid: "A" });
    const portalPairs = { A: [[5, 1], [5, 10]] };
    const par = solveSteinerExact(N, terms, walls, special, portalPairs);
    return { terms, termSet, walls, special, par, portalPairs };
  }
  function tutorialGraph() {
    return {
      edges: [[0, 1], [1, 2], [0, 2], [3, 0], [3, 1], [4, 2]],
      chi: 3,
      pos: [[110, 100], [230, 100], [170, 180], [60, 235], [280, 235]],
      n: 5, kind: "tutorial",
    };
  }

  let S = genSteiner(activeDate);
  GN = S.N;
  const gridEl = document.getElementById("steinerGrid");
  const steinerMeta = document.getElementById("steinerMeta");
  const steinerMsg = document.getElementById("steinerMsg");
  gridEl.style.gridTemplateColumns = "repeat(" + GN + ", 1fr)";
  const sel = new Set();
  const cellEls = new Map();
  const skey = (r, c) => r + "," + c;

  function cellCost(r, c) {
    const sp = S.special.get(skey(r, c));
    if (sp && sp.type === "bonus") return BONUS_COST;
    if (sp && sp.type === "penalty") return PENALTY_COST;
    return NORMAL_COST;
  }
  function currentCost() {
    let t = 0;
    sel.forEach((k) => { const [r, c] = k.split(",").map(Number); t += cellCost(r, c); });
    return t;
  }
  function buildGrid() {
    gridEl.innerHTML = "";
    cellEls.clear();
    gridEl.style.gridTemplateColumns = "repeat(" + GN + ", 1fr)";
    for (let r = 0; r < GN; r++) for (let c = 0; c < GN; c++) {
      const d = document.createElement("div");
      const k = skey(r, c);
      const sp = S.special.get(k);
      let cls = "cell ", txt = "";
      if (S.termSet.has(k)) { cls += "term"; txt = "●"; }
      else if (S.walls.has(k)) { cls += "wall"; txt = "■"; }
      else {
        cls += "free";
        if (sp && sp.type === "bonus") { cls += " bonus"; txt = "+"; }
        if (sp && sp.type === "penalty") { cls += " penalty"; txt = "!"; }
        if (sp && sp.type === "portal") { cls += " portal"; txt = sp.pid; }
      }
      d.className = cls;
      d.textContent = txt;
      d.dataset.r = r; d.dataset.c = c;
      gridEl.appendChild(d);
      cellEls.set(k, d);
    }
  }
  function steinerConnectivity() {
    const active = new Set([...S.termSet, ...sel]);
    const jump = new Map();
    for (const pid of Object.keys(S.portalPairs)) {
      const [a, b] = S.portalPairs[pid];
      const ka = skey(a[0], a[1]), kb = skey(b[0], b[1]);
      if (active.has(ka) && active.has(kb)) { jump.set(ka, kb); jump.set(kb, ka); }
    }
    const start = skey(S.terms[0][0], S.terms[0][1]);
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const k = q.pop();
      const [r, c] = k.split(",").map(Number);
      if (jump.has(k)) { const j = jump.get(k); if (!seen.has(j)) { seen.add(j); q.push(j); } }
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= GN || nc >= GN) continue;
        const nk = skey(nr, nc);
        if (!active.has(nk) || seen.has(nk)) continue;
        seen.add(nk); q.push(nk);
      }
    }
    const reached = new Set(S.terms.filter(([r, c]) => seen.has(skey(r, c))).map(([r, c]) => skey(r, c)));
    return { reached, reachedCount: reached.size, allConnected: reached.size === S.terms.length };
  }
  function paintSteiner() {
    cellEls.forEach((el, k) => el.classList.toggle("path", sel.has(k)));
    const conn = steinerConnectivity();
    S.terms.forEach(([r, c]) => {
      const el = cellEls.get(skey(r, c));
      el.classList.remove("connected", "unconnected");
      el.classList.add(conn.allConnected ? "connected" : "unconnected");
    });
    const cost = currentCost();
    const status = conn.allConnected ? " · <b>CONNECTED ✓</b>" : " · " + conn.reachedCount + "/" + S.terms.length + " linked";
    steinerMeta.innerHTML = (mode === "tutorial" ? "Tutorial · " : "") + (mode === "custom" ? "Custom · " : "") + "Cost <b>" + cost + "</b> · Par " + S.par + status + (S.kind ? " · <span style='color:#6b7561'>" + S.kind + "</span>" : "");
  }
  let dragMode = null, isDown = false;
  function toggleCell(r, c, mode) {
    const k = skey(r, c);
    if (S.termSet.has(k) || S.walls.has(k)) return;
    if (mode === true) sel.add(k);
    else if (mode === false) sel.delete(k);
    else { sel.has(k) ? sel.delete(k) : sel.add(k); }
    saveSteiner(false);
    paintSteiner();
  }
  gridEl.addEventListener("pointerdown", (e) => {
    const t = e.target.closest(".cell");
    if (!t) return;
    e.preventDefault();
    isDown = true;
    try { gridEl.setPointerCapture(e.pointerId); } catch (_) {}
    const r = +t.dataset.r, c = +t.dataset.c;
    const k = skey(r, c);
    if (S.termSet.has(k) || S.walls.has(k)) { dragMode = null; return; }
    dragMode = !sel.has(k);
    toggleCell(r, c, dragMode);
  });
  gridEl.addEventListener("pointermove", (e) => {
    if (!isDown || dragMode === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const t = el && el.closest ? el.closest(".cell") : null;
    if (!t || !gridEl.contains(t)) return;
    toggleCell(+t.dataset.r, +t.dataset.c, dragMode);
  });
  window.addEventListener("pointerup", () => { isDown = false; dragMode = null; });

  document.getElementById("steinerClear").onclick = () => { sel.clear(); saveSteiner(false); paintSteiner(); steinerMsg.textContent = ""; steinerMsg.className = "msg"; };
  document.getElementById("steinerCheck").onclick = () => checkSteiner(true);
  function checkSteiner(verbose) {
    const conn = steinerConnectivity();
    const cost = currentCost();
    if (conn.allConnected) {
      let verdict;
      if (cost <= S.par) verdict = "Perfect — matches the exact optimum! 🌟";
      else if (cost <= S.par + 2) verdict = "Close to optimal.";
      else verdict = "Valid, but the optimum is lower — look for shared paths, spores and portals.";
      steinerMsg.textContent = "Solved! Cost " + cost + " (par " + S.par + ") — " + verdict;
      steinerMsg.className = "msg good";
      saveSteiner(true);
      updateStreak(); renderArchive();
      return true;
    } else {
      if (verbose) {
        steinerMsg.textContent = "Not yet — " + conn.reachedCount + "/" + S.terms.length + " seeds linked. Cost so far: " + cost + ".";
        steinerMsg.className = "msg bad";
      }
      return false;
    }
  }
  function saveSteiner(solved) {
    try {
      const prev = JSON.parse(localStorage.getItem(storeKey("steiner")) || "{}");
      localStorage.setItem(storeKey("steiner"), JSON.stringify({ sel: [...sel], solved: solved || prev.solved || false, cost: currentCost() }));
    } catch (_) {}
  }
  function loadSteiner() {
    try {
      const d = JSON.parse(localStorage.getItem(storeKey("steiner")) || "null");
      if (d && Array.isArray(d.sel)) d.sel.forEach((k) => sel.add(k));
      if (d && d.solved) { const c = steinerConnectivity(); if (c.allConnected) checkSteiner(false); }
    } catch (_) {}
  }
  document.getElementById("steinerShare").onclick = async () => {
    const conn = steinerConnectivity();
    shareText("Hard Mode " + shareLabel() + "\nSteiner 🌱: " + (conn.allConnected ? "✅ cost " + currentCost() + " (par " + S.par + ")" : "❌ unsolved") + "\n" + location.href);
  };

  // ============================================================
  // GAME 2 — GRAPH COLOURING (modern, intentional graphs)
  // ============================================================
  const PALETTE = ["#FF2E63", "#00BFFF", "#FFC800", "#7C4DFF", "#00E676", "#FF6D00"];
  const DARK_TEXT = new Set([2, 4]); // yellow + bright green need dark labels
  let CN = 9; // node count varies per daily graph (8-12)

  function chromaticNumber(n, edges) {
    const adj = Array.from({ length: n }, () => []);
    edges.forEach(([u, v]) => { adj[u].push(v); adj[v].push(u); });
    const order = [...Array(n).keys()].sort((a, b) => adj[b].length - adj[a].length);
    function canColor(k) {
      const col = new Array(n).fill(-1);
      function bt(i) {
        if (i === n) return true;
        const v = order[i];
        for (let c = 0; c < k; c++) {
          if (adj[v].every((w) => col[w] !== c)) { col[v] = c; if (bt(i + 1)) return true; col[v] = -1; }
        }
        return false;
      }
      return bt(0);
    }
    for (let k = 1; k <= n; k++) if (canColor(k)) return k;
    return n;
  }
  function isConnected(n, edges) {
    const adj = Array.from({ length: n }, () => []);
    edges.forEach(([u, v]) => { adj[u].push(v); adj[v].push(u); });
    const seen = new Set([0]); const q = [0];
    while (q.length) { const v = q.pop(); for (const w of adj[v]) if (!seen.has(w)) { seen.add(w); q.push(w); } }
    return seen.size === n;
  }
  function edgeKey(u, v) { return u < v ? u + "-" + v : v + "-" + u; }
  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // --- intentional archetypes (structured, symmetric layouts) ---
  function archWheel(rng) {
    const pos = [[170, 170]];
    for (let i = 0; i < 6; i++) {
      const a = (2 * Math.PI * i) / 6 - Math.PI / 2;
      pos.push([170 + 122 * Math.cos(a), 170 + 122 * Math.sin(a)]);
    }
    const set = new Set();
    for (let i = 1; i <= 6; i++) {
      set.add(edgeKey(i, i === 6 ? 1 : i + 1)); // rim cycle
      set.add(edgeKey(0, i)); // spokes
    }
    // drop 1 spoke for asymmetry-with-structure
    set.delete(edgeKey(0, 1 + Math.floor(rng() * 6)));
    // one rim chord to force odd cycles (-> chi 4 sometimes)
    if (rng() < 0.6) {
      const i = 1 + Math.floor(rng() * 6);
      const j = 1 + ((i - 1 + 2 + Math.floor(rng() * 2)) % 6);
      if (i !== j) set.add(edgeKey(i, j));
    }
    return { edges: [...set].map((s) => s.split("-").map(Number)), pos, n: 7, kind: "wheel", plant: null };
  }
  function archCirculant(rng) {
    const pos = [];
    for (let i = 0; i < 7; i++) {
      const a = (2 * Math.PI * i) / 7 - Math.PI / 2;
      pos.push([170 + 122 * Math.cos(a), 170 + 122 * Math.sin(a)]);
    }
    const steps = [2, 3];
    const k = steps[Math.floor(rng() * steps.length)];
    const set = new Set();
    for (let i = 0; i < 7; i++) {
      set.add(edgeKey(i, (i + 1) % 7));
      set.add(edgeKey(i, (i + k) % 7));
    }
    // drop 0-2 edges for variety
    const arr = [...set];
    const drop = Math.floor(rng() * 3);
    for (let i = 0; i < drop; i++) set.delete(arr[Math.floor(rng() * arr.length)]);
    return { edges: [...set].map((s) => s.split("-").map(Number)), pos, n: 7, kind: "rings", plant: null };
  }
  // --- NP-flavoured archetypes: hard instances with known optimum by construction ---
  // SAT-style planted colouring: a K_k clique fixes the colour permutation, then
  // "forced" vertices touch all-but-one colour (unit propagation) and "choice"
  // vertices branch like SAT decisions. chi = k exactly.
  function archPlanted(rr) {
    const k = rr() < 0.7 ? 3 : 4;
    const nF = 2, nC = 2 + Math.floor(rr() * 2); // 2-3 choice nodes
    const n = k + nF + nC;
    const plant = [];
    for (let i = 0; i < k; i++) plant.push(i);
    const forced = [], choice = [];
    for (let i = 0; i < nF; i++) { const c = Math.floor(rr() * k); forced.push(c); plant.push(c); }
    for (let i = 0; i < nC; i++) { const c = Math.floor(rr() * k); choice.push(c); plant.push(c); }
    const set = new Set();
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) set.add(edgeKey(i, j));
    const idxF = (t) => k + t, idxC = (t) => k + nF + t;
    for (let t = 0; t < nF; t++) {
      const c = forced[t];
      for (let col = 0; col < k; col++) if (col !== c) set.add(edgeKey(idxF(t), col));
    }
    for (let t = 0; t < nC; t++) {
      const c = choice[t];
      const others = shuffled([...Array(k).keys()].filter((x) => x !== c), rr);
      const deg = 1 + Math.floor(rr() * (k - 1));
      for (let d = 0; d < Math.min(deg, others.length); d++) set.add(edgeKey(idxC(t), others[d]));
    }
    // chain consecutive forced nodes (different colours) for a propagation feel
    for (let t = 1; t < nF; t++) {
      const u = idxF(t - 1), v = idxF(t);
      if (plant[u] !== plant[v]) set.add(edgeKey(u, v));
    }
    // extra cross edges between non-clique nodes of different planted colours
    let extra = 1 + Math.floor(rr() * 2), guard = 0;
    while (extra > 0 && guard++ < 80) {
      const u = k + Math.floor(rr() * (n - k)), v = k + Math.floor(rr() * (n - k));
      if (u === v || plant[u] === plant[v]) continue;
      const e = edgeKey(u, v);
      if (set.has(e)) continue;
      set.add(e); extra--;
    }
    // layered layout: clique on top, forced middle, choice bottom
    const pos = new Array(n);
    const placeRow = (ids, y) => {
      ids.forEach((id, i) => { pos[id] = [ids.length === 1 ? 170 : 50 + (i * 240) / (ids.length - 1), y]; });
    };
    placeRow([...Array(k).keys()], 66);
    placeRow(forced.map((_, t) => idxF(t)), 175);
    placeRow(choice.map((_, t) => idxC(t)), 280);
    return { edges: [...set].map((s) => s.split("-").map(Number)), pos, n, kind: "propagation chain", plant };
  }
  // --- real-world families: maps, timetables, SAT reductions ---
  // MAP: districts of a grid map sharing a border are adjacent. One diagonal
  // per square keeps the drawing planar — a genuine map, so (four-colour
  // theorem) it never needs a 5th colour. Usually needs only 3.
  function archMap(rr) {
    const shapes = [[3, 3], [2, 4]];
    let fallback = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const [R, C] = shapes[Math.floor(rr() * shapes.length)];
      const n = R * C;
      const pos = [];
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        pos.push([
          55 + (c * 230) / (C - 1) + (rr() - 0.5) * 14,
          55 + (r * 230) / (R - 1) + (rr() - 0.5) * 14,
        ]);
      }
      const set = new Set();
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const i = r * C + c;
        if (c + 1 < C) set.add(edgeKey(i, i + 1));
        if (r + 1 < R) set.add(edgeKey(i, i + C));
      }
      const sqs = [];
      for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
        const a = r * C + c;
        sqs.push([a, a + 1, a + C, a + C + 1]);
      }
      const order = shuffled(sqs, rr);
      const nDiag = Math.min(order.length, 2 + Math.floor(rr() * 3));
      for (let i = 0; i < nDiag; i++) {
        const [a, b, c, d] = order[i];
        if (rr() < 0.5) set.add(edgeKey(a, d)); else set.add(edgeKey(b, c));
      }
      const edges = [...set].map((s) => s.split("-").map(Number));
      if (edges.length < n + 2 || edges.length > 2 * n + 2 || !isConnected(n, edges)) continue;
      const chi = chromaticNumber(n, edges);
      const built = { edges, pos, n, kind: "map", plant: null, labels: null };
      if (chi === 3) return built;
      if (chi === 4 && !fallback) fallback = { ...built, chi };
    }
    if (fallback) return fallback;
    // deterministic safety net: plain 3x3 grid + 2 diagonals (chi 3)
    const pos = [];
    for (let i = 0; i < 9; i++) pos.push([70 + (i % 3) * 100, 70 + Math.floor(i / 3) * 100]);
    const edges = [[0,1],[1,2],[3,4],[4,5],[6,7],[7,8],[0,3],[1,4],[2,5],[3,6],[4,7],[5,8],[0,4],[4,8]];
    return { edges, pos, n: 9, kind: "map", plant: null, labels: null, chi: 3 };
  }
  // TIMETABLE: vertices are exams, edges join exams sharing students
  // (random intervals on a timeline). Interval graphs are perfect: the
  // clique bound is always tight, so greedy reasoning goes a long way.
  function archTimetable(rr) {
    let fallback = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const n = 7 + Math.floor(rr() * 3); // 7-9
      const ivs = [];
      for (let i = 0; i < n; i++) { const s = rr() * 8; ivs.push([s, s + 1.5 + rr() * 2.5]); }
      const set = new Set();
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        if (ivs[i][0] < ivs[j][1] && ivs[j][0] < ivs[i][1]) set.add(edgeKey(i, j));
      }
      const edges = [...set].map((s) => s.split("-").map(Number));
      if (edges.length < n + 2 || edges.length > 2 * n + 2 || !isConnected(n, edges)) continue;
      // lay out left-to-right in time order, staggered into lanes
      const order = ivs.map((iv, i) => [(iv[0] + iv[1]) / 2, i]).sort((a, b) => a[0] - b[0]);
      const laneOf = new Array(n).fill(-1);
      for (const [, i] of order) {
        const used = new Set();
        for (let j = 0; j < n; j++) {
          if (j !== i && laneOf[j] >= 0 && ivs[i][0] < ivs[j][1] && ivs[j][0] < ivs[i][1]) used.add(laneOf[j]);
        }
        let l = 0;
        while (used.has(l)) l++;
        laneOf[i] = l;
      }
      const lanes = Math.max(...laneOf) + 1;
      const pos = ivs.map((iv, i) => [
        44 + (((iv[0] + iv[1]) / 2) / 10) * 252,
        lanes === 1 ? 170 : 60 + (laneOf[i] * 220) / (lanes - 1),
      ]);
      const chi = chromaticNumber(n, edges);
      const built = { edges, pos, n, kind: "timetable", plant: null, labels: null };
      if (chi === 3) return { ...built, chi };
      if (chi === 4 && !fallback) fallback = { ...built, chi };
    }
    return fallback;
  }
  // SAT REDUCTION: a 3-SAT clause over 2 variables compiled into a 5-node
  // gadget, + a True/False/Base palette triangle and true/false literal nodes
  // per variable. Colouring the graph IS solving the formula (planted
  // satisfiable, so chi is always 3). Gadget (p,q,r,s,t) for (a|b|c):
  //   p-a, p-b, p-T;  q-p, q-a;  r-q, r-b;  s-r, s-c;  t-s, t-F, t-B
  // is extendable from any T/F literal assignment iff a|b|c holds.
  // A variable may repeat across the three slots (wiring in twice) —
  // opposite signs in one clause are skipped so clauses stay meaningful.
  function archSat(rr) {
    const A = [rr() < 0.5, rr() < 0.5]; // planted assignment
    const litName = ({ v, neg }) => (neg ? "!" : "") + "x" + (v + 1);
    let lit = null;
    for (let t = 0; t < 50 && !lit; t++) {
      // both variables appear; third slot random (same-sign repeats ok)
      const slots = shuffled([0, 1, Math.floor(rr() * 2)], rr);
      const cand = slots.map((v) => ({ v, neg: rr() < 0.5 }));
      const taut = cand.some((l1, i) => cand.some((l2, j) => j > i && l1.v === l2.v && l1.neg !== l2.neg));
      if (!taut && cand.some(({ v, neg }) => A[v] !== neg)) lit = cand;
    }
    if (!lit) lit = [{ v: 0, neg: !A[0] }, { v: 1, neg: A[1] }, { v: 0, neg: !A[0] }];
    const L = ({ v, neg }) => (neg ? 4 + 2 * v : 3 + 2 * v);
    const [a, b, c] = lit.map(L);
    const set = new Set();
    const E = (u, v) => set.add(edgeKey(u, v));
    E(0, 1); E(1, 2); E(0, 2); // palette T-F-B
    for (let i = 0; i < 2; i++) { E(3 + 2 * i, 4 + 2 * i); E(3 + 2 * i, 2); E(4 + 2 * i, 2); }
    const P = 7, Q = 8, R = 9, S = 10, TT = 11;
    E(P, a); E(P, b); E(P, 0);
    E(Q, P); E(Q, a);
    E(R, Q); E(R, b);
    E(S, R); E(S, c);
    E(TT, S); E(TT, 1); E(TT, 2);
    const pos = [
      [90, 52], [250, 52], [170, 112], // T F B
      [64, 182], [141, 182], [218, 182], [295, 182], // x1 !x1 x2 !x2
      [58, 274], [128, 272], [194, 272], [260, 272], // p q r s
      [295, 300], // t (output, bottom-right)
    ];
    return {
      edges: [...set].map((s) => s.split("-").map(Number)),
      chi: 3, pos, n: 12, kind: "sat reduction", plant: null,
      labels: ["T", "F", "B", "x1", "!x1", "x2", "!x2", "p", "q", "r", "s", "t"],
      clause: lit.map(litName),
      // palette pre-locked: pink=True, blue=False, yellow=Base (planted
      // assignment maps True->0 etc., so chi stays 3)
      locked: [0, 1, 2, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    };
  }
  // SUDOKU as graph colouring: 36 cells on a grid; every row, column and
  // 2x3 box is a clique (216 edges — drawn as the grid itself, never as
  // lines). Givens arrive locked to their digit; paint the rest 1-6.
  // chi is exactly 6: each row needs 6 distinct colours, digits achieve it.
  function archSudoku(rr) {
    const solution = sudokuComplete(rr);
    const puzzle = sudokuDig(solution, rr, 19 + Math.floor(rr() * 3));
    const pos = [];
    for (let r = 0; r < SN; r++) for (let c = 0; c < SN; c++) pos.push([42 + c * 51.2, 42 + r * 51.2]);
    const at = (r, c) => r * SN + c;
    const edges = [];
    for (let r = 0; r < SN; r++) for (let c = 0; c < SN; c++) {
      const u = at(r, c);
      for (let k = c + 1; k < SN; k++) edges.push([u, at(r, k)]); // row
      for (let k = r + 1; k < SN; k++) edges.push([u, at(k, c)]); // column
      const br = Math.floor(r / SBR) * SBR, bc = Math.floor(c / SBC) * SBC;
      for (let dr = 0; dr < SBR; dr++) for (let dc = 0; dc < SBC; dc++) {
        const v = at(br + dr, bc + dc);
        if (v > u) {
          const vr = Math.floor(v / SN), vc = v % SN;
          if (vr !== r && vc !== c) edges.push([u, v]); // box mates outside row/col
        }
      }
    }
    // spice: 2-4 extra rivalries beyond row/column/box. Each must join cells
    // that differ in the planted solution (chi stays exactly 6) and touch at
    // least one empty cell (both-locked links would constrain nothing).
    // Renderability gate: simulate the exact bow drawGraph will use and only
    // accept pairs whose winning curve clears every third node (margin above
    // what the audit asserts, so rendering can never regress).
    const bowOk = (u, v) => {
      const R = 15; // must match drawGraph (n > 12)
      const [x1, y1] = pos[u], [x2, y2] = pos[v];
      const others = [];
      for (let w = 0; w < 36; w++) if (w !== u && w !== v) others.push(pos[w]);
      let bi = -1, bd = Infinity;
      for (let w = 0; w < 36; w++) {
        if (w === u || w === v) continue;
        const d = segPointDist(x1, y1, x2, y2, pos[w][0], pos[w][1]);
        if (d < bd) { bd = d; bi = w; }
      }
      if (bd >= R + 4) return true; // draws straight, already clear
      const cp = edgeBow(x1, y1, x2, y2, pos[bi][0], pos[bi][1], R, others);
      if (!cp) return false;
      let m = Infinity;
      for (let k = 0; k <= 20; k++) {
        const t = k / 20, z = 1 - t;
        const qx = z * z * x1 + 2 * z * t * cp[0] + t * t * x2;
        const qy = z * z * y1 + 2 * z * t * cp[1] + t * t * y2;
        for (const [nx, ny] of others) {
          const d = Math.hypot(qx - nx, qy - ny);
          if (d < m) m = d;
        }
      }
      return m >= 15;
    };
    const seen = new Set(edges.map(([u, v]) => (u < v ? u + "-" + v : v + "-" + u)));
    const extraEdges = [];
    {
      const want = 2 + Math.floor(rr() * 3);
      let tries = 0;
      while (extraEdges.length < want && tries++ < 2000) {
        const u = Math.floor(rr() * 36), v = Math.floor(rr() * 36);
        if (u === v) continue;
        const ur = Math.floor(u / SN), uc = u % SN, vr = Math.floor(v / SN), vc = v % SN;
        if (ur === vr || uc === vc) continue;
        if (Math.floor(ur / SBR) === Math.floor(vr / SBR) && Math.floor(uc / SBC) === Math.floor(vc / SBC)) continue;
        if (solution[ur][uc] === solution[vr][vc]) continue;
        if (puzzle[ur][uc] >= 0 && puzzle[vr][vc] >= 0) continue;
        const k = u < v ? u + "-" + v : v + "-" + u;
        if (seen.has(k)) continue;
        if (!bowOk(u, v)) continue;
        seen.add(k);
        extraEdges.push([u, v]);
        edges.push([u, v]);
      }
    }
    const locked = new Array(36).fill(-1);
    const labels = new Array(36).fill("");
    for (let r = 0; r < SN; r++) for (let c = 0; c < SN; c++) {
      if (puzzle[r][c] >= 0) { locked[at(r, c)] = puzzle[r][c]; labels[at(r, c)] = String(puzzle[r][c] + 1); }
    }
    return { edges, extraEdges, chi: 6, pos, n: 36, kind: "sudoku", plant: null, labels, locked, hideEdges: true, solution };
  }
  const ARCHES = [archMap, archTimetable, archSat, archSudoku, archWheel, archPlanted, archCirculant];

  function genGraph(dateKey) {
    const rng = rngFor(dateKey, "color");
    const startIdx = Math.floor(rng() * ARCHES.length);
    for (let t = 0; t < ARCHES.length; t++) {
      const fn = ARCHES[(startIdx + t) % ARCHES.length];
      // fresh rng stream per archetype attempt for determinism
      const rr = mulberry32(xmur3(dateKey + "|color|" + fn.name)());
      const built = fn(rr);
      if (!built) continue;
      if (built.kind === "sudoku") {
        // exact by construction (rows need 6 colours, digits achieve 6 —
        // extra links respect the planted solution too);
        // far too dense to run the exact solver on, and no need to
        if (!isConnected(built.n, built.edges)) continue;
        return { edges: built.edges, extraEdges: built.extraEdges, chi: 6, pos: built.pos, n: built.n, kind: built.kind, labels: built.labels, locked: built.locked, hideEdges: true };
      }
      const { edges, pos, n } = built;
      if (n < 7 || n > 16) continue;
      if (edges.length < n + 2 || edges.length > 2 * n + 2) continue;
      if (!isConnected(n, edges)) continue;
      const chi = built.chi !== undefined ? built.chi : chromaticNumber(n, edges);
      if (chi < 3 || chi > 4) continue;
      return { edges, chi, pos, n, kind: built.kind, labels: built.labels || null, locked: built.locked || null, clause: built.clause || null };
    }
    // fallback: small map (always valid)
    const fb = archMap(mulberry32(7));
    const chi = fb.chi !== undefined ? fb.chi : chromaticNumber(fb.n, fb.edges);
    return { edges: fb.edges, chi, pos: fb.pos, n: fb.n, kind: fb.kind, labels: fb.labels || null };
  }

  let G = genGraph(activeDate);
  CN = G.n;
  const svg = document.getElementById("graphSvg");
  const colorMeta = document.getElementById("colorMeta");
  const colorMsg = document.getElementById("colorMsg");
  const paletteEl = document.getElementById("palette");
  const kindBox = document.getElementById("kindBox");
  const kindTitle = document.getElementById("kindTitle");
  const kindBody = document.getElementById("kindBody");
  const hintBtn = document.getElementById("hintBtn");
  let hintOpen = false; // guides stay hidden until requested
  function updateHintUI() {
    const info = KIND_INFO[G.kind];
    if (mode === "tutorial" || !info) {
      kindBox.classList.add("hidden");
      hintBtn.classList.add("hidden");
      return;
    }
    hintBtn.classList.remove("hidden");
    hintBtn.textContent = hintOpen ? "💡 Hide the guide" : "💡 Stuck? How to solve this type";
    if (!hintOpen) {
      kindBox.classList.add("hidden");
      return;
    }
    kindTitle.textContent = info[0];
    kindBody.innerHTML = (G.kind === "sat reduction" && G.clause ? "Today's clause: <b>" + G.clause.join(" ∨ ") + "</b> — make it true.<br>" : "") + info[1];
    kindBox.classList.remove("hidden");
  }
  hintBtn.onclick = () => {
    hintOpen = !hintOpen;
    updateHintUI();
  };
  // Solving guide per puzzle family.
  const KIND_INFO = {
    "map": ["Map — colour the districts",
      "Neighbouring districts (sharing a border, not just a point) must differ. Start with the most-bordered district and colour its neighbourhood first — constraints cascade from there. A triangle of three mutually adjacent districts forces 3 colours, and the four-colour theorem guarantees you never need a 5th, so if you're reaching for one, backtrack instead."],
    "timetable": ["Timetable — schedule the exams",
      "Each dot is an exam; an edge means shared students, so linked exams need different time slots (colours). Dots run left-to-right in start order. Sweep an imaginary vertical line across: the busiest slice — the most exams all pairwise clashing — is a clique and sets your minimum. Greedy works here: take exams left to right, giving each the first slot none of its earlier neighbours uses."],
    "sat reduction": ["SAT reduction — colouring solves the formula",
      "Two colours do all the work here: <b>pink (T) means TRUE, blue (F) means FALSE</b> — they arrive locked, and yellow B is just scaffolding. Your whole job is deciding x1 and x2.<br>1. <b>Read the variables.</b> x1/!x1 and x2/!x2 both touch yellow, so each pair splits pink/blue. Painting those four dots <b>is</b> picking true/false for x1 and x2 — 4 options total.<br>2. <b>Read the chain.</b> p → q → r → s → t is the clause as a burning fuse. p touches its two literals and pink T, so if both literals are blue, p is forced yellow — which forces q pink, r yellow, s pink — and then t, touching pink s plus blue and yellow, has no colour left. That dead end <b>is</b> the clause being false. Any pink literal breaks the fuse and leaves t paintable.<br>3. <b>Solve it.</b> Pick an assignment that makes today's clause true (try x1 pink first) and paint the four variable dots. Walk the chain left to right, taking any non-clashing colour. Stuck at t? First rewind to your last free chain choice — r is the usual fork — and only flip a variable if the chain truly has no way through.<br>All 12 coloured, no red: your pinks and blues satisfy the formula. ★★★."],
    "wheel": ["Wheel — hub plus rim",
      "The hub touches everything, so colour it first and never reuse its colour on the rim. An even rim then alternates 2 colours (3 total); an odd rim can't alternate, forcing one extra colour somewhere (4 total). Count the rim before you commit."],
    "rings": ["Rings — a loop with shortcuts",
      "Walk the ring around, alternating colours where you can; each chord is a shortcut constraint that can force a third (or fourth) colour. Anchor 3 colours on any triangle first, then propagate around."],
    "propagation chain": ["Propagation chain — a planted puzzle",
      "The top clique fixes the colour permutation (every colour appears exactly once up there). Middle dots touch all-but-one colour — they're forced, so paint them first like unit propagation in SAT. Bottom dots are genuine choices: branch on one and propagate the consequences."],
    "sudoku": ["Sudoku — the grid IS the graph",
      "Every row, column and 2×3 box is one big clique — all six cells pairwise linked, which is why those edges aren't drawn (216 would blanket the board). The few links you <b>can</b> see are extra rivalries beyond Sudoku rules: those pairs must differ too, so factor them in early — they usually decide the hardest cells. Dark digits are locked givens; the chips are digits 1–6. Tactics carry straight over: naked singles (a cell with only one legal digit) and hidden singles (a digit with only one home in a row, column or box). Six colours is optimal — each row needs all six — so a clean fill is ★★★."],
  };
  let numColors = Math.min(4, Math.max(3, G.chi + 1));
  let activeColor = 0;
  let coloring = [];
  // Fill from save or fresh; locked givens (sudoku) are always forced.
  function resetColoring() {
    coloring = new Array(CN).fill(-1);
    if (G.locked) for (let i = 0; i < CN; i++) if (G.locked[i] >= 0) coloring[i] = G.locked[i];
  }
  resetColoring(); // -1 = uncolored, else palette idx

  function drawPalette() {
    paletteEl.innerHTML = "";
    for (let i = 0; i < numColors; i++) {
      const b = document.createElement("button");
      b.className = "swatch" + (i === activeColor ? " active" : "");
      b.style.background = PALETTE[i];
      b.setAttribute("aria-label", "Colour " + (i + 1));
      if (G.kind === "sudoku") {
        b.textContent = i + 1;
        b.style.color = DARK_TEXT.has(i) ? "#0f172a" : "#fff";
        b.style.fontWeight = "800";
        b.style.fontSize = "18px";
      }
      b.onclick = () => { activeColor = i; drawPalette(); };
      paletteEl.appendChild(b);
    }
  }
  // Distance from point (px,py) to segment (x1,y1)-(x2,y2).
  function segPointDist(x1, y1, x2, y2, px, py) {
    const dx = x2 - x1, dy = y2 - y1;
    const L2 = dx * dx + dy * dy || 1e-9;
    let t = ((px - x1) * dx + (py - y1) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  // Control point bowing edge (x1,y1)-(x2,y2) around obstructing node
  // (ox,oy) so the edge stays visible instead of hiding under the node.
  // Returns null when the straight edge already clears by R+4 px. The bow is
  // centred on the graze point with adaptive height, and both perpendicular
  // sides are sampled against every other node — the clearer side wins, so
  // dodging one node never hides the edge under another.
  function edgeBow(x1, y1, x2, y2, ox, oy, R, others) {
    const dx = x2 - x1, dy = y2 - y1;
    const L2 = dx * dx + dy * dy || 1e-9;
    let t = ((ox - x1) * dx + (oy - y1) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx, py = y1 + t * dy;
    const dist = Math.hypot(ox - px, oy - py);
    if (dist >= R + 4) return null;
    const L = Math.sqrt(L2);
    const sx = -dy / L, sy = dx / L;
    const need = (R + 6) - dist + 2;
    const denom = 2 * t * (1 - t);
    const B = denom < 1e-6 ? 120 : Math.min(120, Math.max(28, need / denom));
    const cands = [[px + sx * B, py + sy * B], [px - sx * B, py - sy * B]];
    let best = cands[0], bestScore = -1;
    for (const [cx, cy] of cands) {
      let m = Infinity;
      for (let k = 0; k <= 20; k++) {
        const tt = k / 20, u = 1 - tt;
        const qx = u * u * x1 + 2 * u * tt * cx + tt * tt * x2;
        const qy = u * u * y1 + 2 * u * tt * cy + tt * tt * y2;
        for (const [nx, ny] of others) {
          const d = Math.hypot(qx - nx, qy - ny);
          if (d < m) m = d;
        }
      }
      if (m > bestScore) { bestScore = m; best = [cx, cy]; }
    }
    return best;
  }
  function drawGraph() {
    svg.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const R = G.n > 12 ? 15 : 19;
    if (G.hideEdges) {
      // sudoku: constraints ARE the grid — draw 2x3 box outlines instead
      for (let br = 0; br < 3; br++) for (let bc = 0; bc < 2; bc++) {
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", 42 + bc * 3 * 51.2 - 25.6);
        rect.setAttribute("y", 42 + br * 2 * 51.2 - 25.6);
        rect.setAttribute("width", 3 * 51.2);
        rect.setAttribute("height", 2 * 51.2);
        rect.setAttribute("rx", 8);
        rect.setAttribute("fill", "none");
        rect.setAttribute("stroke", "#c9cfbd");
        rect.setAttribute("stroke-width", 2);
        rect.style.pointerEvents = "none";
        svg.appendChild(rect);
      }
    } else {
    const drawLink = ([u, v]) => {
      const [x1, y1] = G.pos[u], [x2, y2] = G.pos[v];
      // nearest third node: bow the edge around it if it would hide beneath
      let bi = -1, bd = Infinity;
      for (let w = 0; w < CN; w++) {
        if (w === u || w === v) continue;
        const d = segPointDist(x1, y1, x2, y2, G.pos[w][0], G.pos[w][1]);
        if (d < bd) { bd = d; bi = w; }
      }
      const bad = coloring[u] !== -1 && coloring[u] === coloring[v];
      const cls = "edge" + (bad ? " conflict" : "");
      const others = [];
      for (let w = 0; w < CN; w++) if (w !== u && w !== v) others.push(G.pos[w]);
      if (bi >= 0 && bd < R + 4) {
        const cp = edgeBow(x1, y1, x2, y2, G.pos[bi][0], G.pos[bi][1], R, others);
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", "M " + x1 + " " + y1 + " Q " + cp[0] + " " + cp[1] + " " + x2 + " " + y2);
        p.setAttribute("class", cls);
        svg.appendChild(p);
      } else {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", x1); l.setAttribute("y1", y1);
        l.setAttribute("x2", x2); l.setAttribute("y2", y2);
        if (bad) l.classList.add("conflict");
        svg.appendChild(l);
      }
    };
    if (G.hideEdges) (G.extraEdges || []).forEach(drawLink);
    else G.edges.forEach(drawLink);
    }
    // nodes touching a clash get a red ring (the only conflict signal when
    // edges are hidden, useful everywhere)
    const badNodes = new Set();
    G.edges.forEach(([u, v]) => {
      if (coloring[u] !== -1 && coloring[u] === coloring[v]) { badNodes.add(u); badNodes.add(v); }
    });
    for (let i = 0; i < CN; i++) {
      const halo = document.createElementNS(NS, "circle");
      halo.setAttribute("cx", G.pos[i][0]); halo.setAttribute("cy", G.pos[i][1]);
      halo.setAttribute("r", R + 4);
      halo.setAttribute("fill", "none");
      halo.setAttribute("stroke", coloring[i] === -1 ? "rgba(34,48,28,0.20)" : PALETTE[coloring[i]]);
      halo.setAttribute("stroke-width", coloring[i] === -1 ? 2 : 3);
      halo.setAttribute("opacity", coloring[i] === -1 ? 1 : 0.55);
      halo.style.pointerEvents = "none";
      svg.appendChild(halo);
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", G.pos[i][0]); c.setAttribute("cy", G.pos[i][1]);
      c.setAttribute("r", R);
      c.setAttribute("class", "node");
      if (badNodes.has(i)) c.setAttribute("stroke", "#e11d48");
      if (G.locked && G.locked[i] >= 0) c.setAttribute("stroke-width", "3.5");
      c.style.fill = coloring[i] === -1 ? "#eef1e8" : PALETTE[coloring[i]];
      c.dataset.v = i;
      c.addEventListener("click", () => {
        if (G.locked && G.locked[i] >= 0) return; // givens are fixed
        if (coloring[i] === activeColor) coloring[i] = -1;
        else coloring[i] = activeColor;
        saveColor(false);
        refreshColor();
      });
      svg.appendChild(c);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", G.pos[i][0]); t.setAttribute("y", G.pos[i][1] + 4);
      t.setAttribute("text-anchor", "middle");
      t.textContent = G.labels ? G.labels[i] : i + 1;
      if (G.labels) t.setAttribute("font-size", G.kind === "sudoku" ? "14" : "10");
      if (coloring[i] === -1) t.style.fill = "#5c6650";
      else t.style.fill = DARK_TEXT.has(coloring[i]) ? "#0f172a" : "#fff";
      // subtle halo for readability
      t.setAttribute("stroke", coloring[i] === -1 ? "none" : (DARK_TEXT.has(coloring[i]) ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.35)"));
      t.setAttribute("stroke-width", "0.6");
      svg.appendChild(t);
    }
  }
  function colorStats() {
    const used = new Set(coloring.filter((c) => c !== -1));
    const uncolored = coloring.filter((c) => c === -1).length;
    let bad = 0;
    G.edges.forEach(([u, v]) => { if (coloring[u] !== -1 && coloring[u] === coloring[v]) bad++; });
    return { usedCount: used.size, uncolored, bad };
  }
  function refreshColor() {
    drawPalette();
    drawGraph();
    document.getElementById("colorCountRow").style.display = G.kind === "sudoku" ? "none" : "";
    const st = colorStats();
    colorMeta.innerHTML = (mode === "tutorial" ? "Tutorial · " : "") + (mode === "custom" ? "Custom · " : "") + "Using <b>" + st.usedCount + "</b> colour" + (st.usedCount === 1 ? "" : "s") +
      " · " + (CN - st.uncolored) + "/" + CN + " painted" +
      (st.bad ? " · <b>" + st.bad + " conflict" + (st.bad === 1 ? "" : "s") + "</b>" : "") +
      (G.kind ? " · <span style='color:#6b7561'>" + G.kind + "</span>" : "");
    updateHintUI();
  }
  document.getElementById("fewerColors").onclick = () => {
    if (numColors > 2) {
      numColors--;
      if (activeColor >= numColors) activeColor = numColors - 1;
      for (let i = 0; i < CN; i++) {
        if (coloring[i] >= numColors && !(G.locked && G.locked[i] >= 0)) coloring[i] = -1;
      }
      saveColor(false); refreshColor();
    }
  };
  document.getElementById("moreColors").onclick = () => {
    if (numColors < 6) { numColors++; saveColor(false); refreshColor(); }
  };
  document.getElementById("colorClear").onclick = () => {
    for (let i = 0; i < CN; i++) if (!(G.locked && G.locked[i] >= 0)) coloring[i] = -1;
    saveColor(false); refreshColor(); colorMsg.textContent = ""; colorMsg.className = "msg";
  };
  document.getElementById("colorCheck").onclick = () => checkColor(true);
  function checkColor(verbose) {
    const st = colorStats();
    if (st.uncolored > 0) {
      if (verbose) { colorMsg.textContent = st.uncolored + " vertices left to colour."; colorMsg.className = "msg bad"; }
      drawGraph(); return false;
    }
    if (st.bad > 0) {
      if (verbose) { colorMsg.textContent = st.bad + " edge" + (st.bad === 1 ? "" : "s") + " with equal neighbours — fix the red edges."; colorMsg.className = "msg bad"; }
      drawGraph(); return false;
    }
    const stars = st.usedCount <= G.chi ? "★★★ optimal! 🎉" : st.usedCount === G.chi + 1 ? "★★ — one over optimum (" + G.chi + ")." : "★ — valid, but optimum is " + G.chi + ". Can you use fewer?";
    colorMsg.textContent = "Solved with " + st.usedCount + " colours. " + stars;
    colorMsg.className = "msg good";
    saveColor(true);
    updateStreak(); renderArchive();
    return true;
  }
  function saveColor(solved) {
    try {
      const prev = JSON.parse(localStorage.getItem(storeKey("color")) || "{}");
      localStorage.setItem(storeKey("color"), JSON.stringify({ coloring, numColors, activeColor, solved: solved || prev.solved || false }));
    } catch (_) {}
  }
  function loadColor() {
    try {
      const d = JSON.parse(localStorage.getItem(storeKey("color")) || "null");
      if (d) {
        if (Array.isArray(d.coloring) && d.coloring.length === CN) for (let i = 0; i < CN; i++) coloring[i] = d.coloring[i];
        if (G.kind === "sudoku") numColors = 6;
        else if (d.numColors) numColors = Math.min(6, Math.max(2, d.numColors));
        else numColors = (mode === "tutorial" && G.kind === "tutorial") ? 3 : Math.min(4, Math.max(3, G.chi + 1));
        if (typeof d.activeColor === "number") activeColor = Math.min(numColors - 1, Math.max(0, d.activeColor));
        if (d.solved) checkColor(false);
      } else {
        numColors = (mode === "tutorial" && G.kind === "tutorial") ? 3 : G.kind === "sudoku" ? 6 : G.kind === "custom" ? Math.min(6, G.chi + 1) : Math.min(4, Math.max(3, G.chi + 1));
        activeColor = 0;
      }
      if (G.locked) for (let i = 0; i < CN; i++) if (G.locked[i] >= 0) coloring[i] = G.locked[i];
    } catch (_) {}
  }
  document.getElementById("colorShare").onclick = () => {
    const st = colorStats();
    const ok = st.uncolored === 0 && st.bad === 0;
    shareText("Hard Mode " + shareLabel() + "\nColouring 🎨: " + (ok ? "✅ " + st.usedCount + " colours" : "❌ unsolved") + "\n" + location.href);
  };

  async function shareText(txt) {
    try { await navigator.clipboard.writeText(txt); alert("Copied to clipboard:\n\n" + txt); }
    catch (_) { alert(txt); }
  }

  // ============================================================
  // GAME 3 — SUDOKU 6x6 (2x3 boxes), unique-solution dailies
  // ============================================================
  const SN = 6, SBR = 2, SBC = 3;
  function sudokuBasePattern(r, c) { return (3 * (r % 2) + Math.floor(r / 2) + c) % 6; }
  // Count solutions up to `limit`. Grid holds 0-5, -1 = empty.
  function sudokuCount(grid, limit) {
    const g = grid.map((row) => row.slice());
    let count = 0;
    function candidates(r, c) {
      const used = new Set();
      for (let i = 0; i < SN; i++) {
        if (g[r][i] >= 0) used.add(g[r][i]);
        if (g[i][c] >= 0) used.add(g[i][c]);
      }
      const br = Math.floor(r / SBR) * SBR, bc = Math.floor(c / SBC) * SBC;
      for (let dr = 0; dr < SBR; dr++) for (let dc = 0; dc < SBC; dc++) {
        const v = g[br + dr][bc + dc];
        if (v >= 0) used.add(v);
      }
      const out = [];
      for (let v = 0; v < SN; v++) if (!used.has(v)) out.push(v);
      return out;
    }
    function bt() {
      if (count >= limit) return;
      let br = -1, bc = -1, best = null;
      for (let r = 0; r < SN && count < limit; r++) for (let c = 0; c < SN; c++) {
        if (g[r][c] >= 0) continue;
        const cand = candidates(r, c);
        if (cand.length === 0) return;
        if (!best || cand.length < best.length) {
          best = cand; br = r; bc = c;
          if (best.length === 1) break;
        }
      }
      if (!best) { count++; return; }
      for (const v of best) {
        g[br][bc] = v; bt(); g[br][bc] = -1;
        if (count >= limit) return;
      }
    }
    bt();
    return count;
  }
  // Complete 6x6 solution from pattern + seeded symmetries. Values 0-5.
  function sudokuComplete(rng) {
    const permD = shuffled([0, 1, 2, 3, 4, 5], rng);
    const rowPerm = [];
    shuffled([0, 1, 2], rng).forEach((b) => {
      shuffled([0, 1], rng).forEach((i) => rowPerm.push(b * 2 + i));
    });
    const colPerm = [];
    shuffled([0, 1], rng).forEach((s) => {
      shuffled([0, 1, 2], rng).forEach((i) => colPerm.push(s * 3 + i));
    });
    const solution = [];
    for (let r = 0; r < SN; r++) {
      solution.push([]);
      for (let c = 0; c < SN; c++) solution[r].push(permD[sudokuBasePattern(rowPerm[r], colPerm[c])]);
    }
    return solution;
  }
  // Dig holes, keeping a unique solution. -1 = empty.
  function sudokuDig(solution, rng, targetHoles) {
    const puzzle = solution.map((row) => row.slice());
    const order = shuffled([...Array(36).keys()], rng);
    let holes = 0;
    for (const k of order) {
      if (holes >= targetHoles) break;
      const r = Math.floor(k / SN), c = k % SN;
      const bak = puzzle[r][c];
      puzzle[r][c] = -1;
      if (sudokuCount(puzzle, 2) !== 1) puzzle[r][c] = bak;
      else holes++;
    }
    return puzzle;
  }

  // ============================================================
  // GAME 3 — GRAPHLE: Wordle for graphs (guess the hidden 6-node graph)
  // Win by matching all six property tiles, not the exact wiring.
  // ============================================================
  const GL_N = 6, GL_TRIES = 6;
  // fixed pair order = bit positions of guess/target masks
  const GL_PAIRS = [];
  for (let u = 0; u < GL_N; u++) for (let v = u + 1; v < GL_N; v++) GL_PAIRS.push([u, v]);
  const GL_POS = [];
  for (let i = 0; i < GL_N; i++) {
    const a = (2 * Math.PI * i) / GL_N - Math.PI / 2;
    GL_POS.push([170 + 118 * Math.cos(a), 170 + 118 * Math.sin(a)]);
  }
  function glEdgesFromMask(mask) {
    const e = [];
    GL_PAIRS.forEach(([u, v], i) => { if (mask & (1 << i)) e.push([u, v]); });
    return e;
  }
  function glAdj(n, edges) {
    const adj = Array.from({ length: n }, () => new Set());
    edges.forEach(([u, v]) => { adj[u].add(v); adj[v].add(u); });
    return adj;
  }
  function glCountTriangles(n, edges) {
    const adj = glAdj(n, edges);
    let t = 0;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      if (!adj[a].has(b)) continue;
      for (let c = b + 1; c < n; c++) if (adj[a].has(c) && adj[b].has(c)) t++;
    }
    return t;
  }
  // distinct simple cycles, length >= 3; rotations/reversals count once
  function glCountCycles(n, edges) {
    const adj = glAdj(n, edges);
    let count = 0;
    function perms(arr) {
      if (arr.length <= 1) return [arr];
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        for (const rest of perms(arr.slice(0, i).concat(arr.slice(i + 1)))) out.push([arr[i]].concat(rest));
      }
      return out;
    }
    function combos(arr, k, start, prefix, cb) {
      if (prefix.length === k) { cb(prefix); return; }
      for (let i = start; i < arr.length; i++) combos(arr, k, i + 1, prefix.concat(arr[i]), cb);
    }
    const verts = [...Array(n).keys()];
    for (let k = 3; k <= n; k++) {
      combos(verts, k, 0, [], (sub) => {
        const s0 = sub[0], rest = sub.slice(1); // sub sorted: s0 is min (fixes rotation)
        for (const p of perms(rest)) {
          if (p[0] > p[p.length - 1]) continue; // fix reflection
          let ok = adj[s0].has(p[0]) && adj[p[p.length - 1]].has(s0);
          for (let i = 0; ok && i + 1 < p.length; i++) ok = adj[p[i]].has(p[i + 1]);
          if (ok) count++;
        }
      });
    }
    return count;
  }
  function glDiameter(n, edges) {
    const adj = glAdj(n, edges);
    let diam = 0;
    for (let s = 0; s < n; s++) {
      const dist = new Array(n).fill(-1);
      dist[s] = 0;
      const q = [s];
      while (q.length) {
        const u = q.shift();
        for (const w of adj[u]) if (dist[w] < 0) { dist[w] = dist[u] + 1; q.push(w); }
      }
      for (let t = 0; t < n; t++) {
        if (dist[t] < 0) return Infinity;
        if (dist[t] > diam) diam = dist[t];
      }
    }
    return diam;
  }
  function glProps(edges) {
    return {
      e: edges.length,
      chi: chromaticNumber(GL_N, edges),
      tri: glCountTriangles(GL_N, edges),
      cyc: glCountCycles(GL_N, edges),
      diam: glDiameter(GL_N, edges),
    };
  }
  function glCompare(t, g) {
    // numeric tiles: green exact; else yellow (±1) / gray with ↑/↓ showing
    // whether the TARGET is higher or lower than the guess
    const num = (a, b) => {
      if (a === b) return { cls: "g-green", dir: "" };
      return { cls: Math.abs(a - b) === 1 ? "g-yellow" : "g-gray", dir: a > b ? "↑" : "↓" };
    };
    const tile = (label, value, r) => ({ label, value: value + r.dir, cls: r.cls });
    const out = [
      tile("E", String(g.e), num(t.e, g.e)),
      tile("χ", String(g.chi), num(t.chi, g.chi)),
      tile("△", String(g.tri), num(t.tri, g.tri)),
      tile("Cyc", String(g.cyc), num(t.cyc, g.cyc)),
    ];
    const dv = isFinite(g.diam) ? String(g.diam) : "∞";
    if (t.diam === g.diam) out.push({ label: "Diam", value: dv, cls: "g-green" });
    else if (!isFinite(t.diam) || !isFinite(g.diam)) {
      out.push({ label: "Diam", value: dv, cls: "g-gray" });
      out[out.length - 1].value += !isFinite(t.diam) ? "↑" : "↓";
    }     else {
      const r = num(t.diam, g.diam);
      out.push({ label: "Diam", value: dv + r.dir, cls: r.cls });
    }
    return out;
  }
  function genGraphleTarget(dateKey) {
    const rng = rngFor(dateKey, "graphle");
    return Math.floor(rng() * (1 << GL_PAIRS.length));
  }

  let GL_TARGET = genGraphleTarget(activeDate);
  let GL_TPROPS = glProps(glEdgesFromMask(GL_TARGET));
  const graphleSvg = document.getElementById("graphleSvg");
  const graphleMeta = document.getElementById("graphleMeta");
  const graphleDraft = document.getElementById("graphleDraft");
  const graphleHist = document.getElementById("graphleHist");
  const graphleMsg = document.getElementById("graphleMsg");
  const graphleGuessBtn = document.getElementById("graphleGuess");
  let glDraft = new Set(); // "u-v" with u < v
  let glPending = -1;
  let glGuesses = []; // {mask, tiles}
  let glDone = null; // 'won' | 'lost'
  function glDraftStats() {
    const p = glProps([...glDraft].map((k) => k.split("-").map(Number)));
    return "E " + p.e + " · χ " + p.chi + " · △ " + p.tri + " · Cyc " + p.cyc +
      " · Diam " + (isFinite(p.diam) ? p.diam : "∞");
  }
  function paintGraphle() {
    graphleSvg.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const R = 19;
    glDraft.forEach((k) => {
      const [u, v] = k.split("-").map(Number);
      const [x1, y1] = GL_POS[u], [x2, y2] = GL_POS[v];
      let bi = -1, bd = Infinity;
      for (let w = 0; w < GL_N; w++) {
        if (w === u || w === v) continue;
        const d = segPointDist(x1, y1, x2, y2, GL_POS[w][0], GL_POS[w][1]);
        if (d < bd) { bd = d; bi = w; }
      }
      if (bi >= 0 && bd < R + 4) {
        const others = [];
        for (let w = 0; w < GL_N; w++) if (w !== u && w !== v) others.push(GL_POS[w]);
        const cp = edgeBow(x1, y1, x2, y2, GL_POS[bi][0], GL_POS[bi][1], R, others);
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", "M " + x1 + " " + y1 + " Q " + cp[0] + " " + cp[1] + " " + x2 + " " + y2);
        p.setAttribute("class", "edge");
        graphleSvg.appendChild(p);
      } else {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", x1); l.setAttribute("y1", y1);
        l.setAttribute("x2", x2); l.setAttribute("y2", y2);
        graphleSvg.appendChild(l);
      }
    });
    for (let i = 0; i < GL_N; i++) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", GL_POS[i][0]); c.setAttribute("cy", GL_POS[i][1]);
      c.setAttribute("r", 19);
      c.setAttribute("class", "node" + (i === glPending ? " pending" : ""));
      c.style.fill = "#eef1e8";
      c.dataset.v = i;
      c.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (glDone) return;
        if (glPending < 0) glPending = i;
        else if (glPending === i) glPending = -1;
        else {
          const a = Math.min(glPending, i), b = Math.max(glPending, i);
          const k = a + "-" + b;
          if (glDraft.has(k)) glDraft.delete(k); else glDraft.add(k);
          glPending = -1;
        }
        paintGraphle();
      });
      graphleSvg.appendChild(c);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", GL_POS[i][0]); t.setAttribute("y", GL_POS[i][1] + 4);
      t.setAttribute("text-anchor", "middle");
      t.textContent = i + 1;
      t.style.fill = "#5c6650";
      graphleSvg.appendChild(t);
    }
    graphleDraft.textContent = "Draft: " + glDraftStats();
    paintGraphleMeta();
  }
  function paintGraphleMeta() {
    const left = GL_TRIES - glGuesses.length;
    graphleMeta.innerHTML = glDone === "won" ? "Solved!" :
      glDone === "lost" ? "Out of tries." :
      "Guess <b>" + (glGuesses.length + 1) + "</b>/" + GL_TRIES;
    graphleGuessBtn.style.opacity = glDone || !left ? 0.4 : 1;
  }
  function graphMiniSvg(mask, pairs, pos) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 340 340");
    svg.setAttribute("class", "mini");
    pairs.forEach(([u, v], i) => {
      if (!(mask & (1 << i))) return;
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", pos[u][0]); l.setAttribute("y1", pos[u][1]);
      l.setAttribute("x2", pos[v][0]); l.setAttribute("y2", pos[v][1]);
      l.setAttribute("stroke", "#9aa78f");
      l.setAttribute("stroke-width", "12");
      l.setAttribute("stroke-linecap", "round");
      svg.appendChild(l);
    });
    for (let i = 0; i < pos.length; i++) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", pos[i][0]); c.setAttribute("cy", pos[i][1]);
      c.setAttribute("r", 26);
      c.setAttribute("fill", "#fff");
      c.setAttribute("stroke", "#22301c");
      c.setAttribute("stroke-width", "10");
      svg.appendChild(c);
    }
    return svg;
  }
  function glMiniSvg(mask) {
    return graphMiniSvg(mask, GL_PAIRS, GL_POS);
  }
  function glAddHistRow(mask, tiles, prefix) {
    const row = document.createElement("div");
    row.className = "grow";
    row.appendChild(glMiniSvg(mask));
    const box = document.createElement("div");
    box.className = "gtiles";
    if (prefix) {
      const p = document.createElement("div");
      p.textContent = prefix;
      p.style.cssText = "font-size:11px;font-weight:700;color:#6b7561;min-width:52px;";
      box.appendChild(p);
    }
    tiles.forEach((t) => {
      const d = document.createElement("div");
      d.className = "gtile " + t.cls;
      const s = document.createElement("small");
      s.textContent = t.label;
      const v = document.createElement("span");
      v.textContent = t.value;
      d.appendChild(s); d.appendChild(v);
      box.appendChild(d);
    });
    row.appendChild(box);
    graphleHist.appendChild(row);
  }
  function glRevealTarget() {
    glAddHistRow(GL_TARGET, glCompare(GL_TPROPS, GL_TPROPS), "Answer");
  }
  document.getElementById("graphleClear").onclick = () => {
    if (glDone) return;
    glDraft.clear(); glPending = -1;
    paintGraphle();
  };
  document.getElementById("graphleGuess").onclick = () => {
    if (glDone || glGuesses.length >= GL_TRIES) return;
    let mask = 0;
    GL_PAIRS.forEach(([u, v], i) => { if (glDraft.has(u + "-" + v)) mask |= (1 << i); });
    const tiles = glCompare(GL_TPROPS, glProps(glEdgesFromMask(mask)));
    glGuesses.push({ mask, tiles });
    glDraft.clear(); glPending = -1;
    glAddHistRow(mask, tiles);
    if (tiles.every((t) => t.cls === "g-green")) {
      glDone = "won";
      saveGraphle();
      graphleMsg.textContent = "Solved in " + glGuesses.length + "/" + GL_TRIES + "! 🎉";
      graphleMsg.className = "msg good";
      updateStreak(); renderArchive();
    } else if (glGuesses.length >= GL_TRIES) {
      glDone = "lost";
      saveGraphle();
      graphleMsg.textContent = "Out of tries — the answer is revealed below.";
      graphleMsg.className = "msg bad";
      glRevealTarget();
    } else {
      saveGraphle();
    }
    paintGraphle();
  };
  document.getElementById("graphleShare").onclick = () => {
    const emo = { "g-green": "🟩", "g-yellow": "🟨", "g-gray": "⬛" };
    const lines = glGuesses.map((g) => g.tiles.map((t) => emo[t.cls]).join(""));
    const score = glDone === "won" ? glGuesses.length + "/" + GL_TRIES : "X/" + GL_TRIES;
    shareText("Hard Mode Graphle " + activeDate + "\n" + lines.join("\n") + "\n" + score);
  };
  function saveGraphle() {
    try {
      localStorage.setItem("hm-" + activeDate + "-graphle", JSON.stringify({
        masks: glGuesses.map((g) => g.mask),
        solved: glDone === "won",
        lost: glDone === "lost",
      }));
    } catch (_) {}
  }
  function loadGraphle() {
    try {
      const d = JSON.parse(localStorage.getItem("hm-" + activeDate + "-graphle") || "null");
      if (d && Array.isArray(d.masks)) {
        for (const mask of d.masks) {
          if (typeof mask !== "number" || mask < 0 || mask >= (1 << GL_PAIRS.length)) continue;
          glGuesses.push({ mask, tiles: glCompare(GL_TPROPS, glProps(glEdgesFromMask(mask))) });
        }
        if (d.solved) {
          glDone = "won";
          graphleMsg.textContent = "Solved in " + glGuesses.length + "/" + GL_TRIES + "! 🎉";
          graphleMsg.className = "msg good";
        } else if (d.lost) {
          glDone = "lost";
          graphleMsg.textContent = "Out of tries — the answer is revealed below.";
          graphleMsg.className = "msg bad";
        }
      }
    } catch (_) {}
  }
  function rebuildGraphle() {
    GL_TARGET = genGraphleTarget(activeDate);
    GL_TPROPS = glProps(glEdgesFromMask(GL_TARGET));
    glDraft = new Set();
    glPending = -1;
    glGuesses = [];
    glDone = null;
    graphleHist.innerHTML = "";
    graphleMsg.textContent = ""; graphleMsg.className = "msg";
    loadGraphle();
    for (const g of glGuesses) glAddHistRow(g.mask, g.tiles);
    if (glDone === "lost") glRevealTarget();
    paintGraphle();
  }

  function rebuildGraphle() {
    GL_TARGET = genGraphleTarget(activeDate);
    GL_TPROPS = glProps(glEdgesFromMask(GL_TARGET));
    glDraft = new Set();
    glPending = -1;
    glGuesses = [];
    glDone = null;
    graphleHist.innerHTML = "";
    graphleMsg.textContent = ""; graphleMsg.className = "msg";
    loadGraphle();
    for (const g of glGuesses) glAddHistRow(g.mask, g.tiles);
    if (glDone === "lost") glRevealTarget();
    paintGraphle();
  }

  // ============================================================
  // GAME 4 — TREEDLE: Wordle for trees (guess the hidden tree)
  // Same guessing game as Graphle, but the answer is always a tree:
  // connected, no cycles. Win by matching all six tree tiles.
  // ============================================================
  const TR_N = 8, TR_TRIES = 6;
  const TR_PAIRS = [];
  for (let u = 0; u < TR_N; u++) for (let v = u + 1; v < TR_N; v++) TR_PAIRS.push([u, v]);
  const TR_POS = [];
  for (let i = 0; i < TR_N; i++) {
    const a = (2 * Math.PI * i) / TR_N - Math.PI / 2;
    TR_POS.push([170 + 118 * Math.cos(a), 170 + 118 * Math.sin(a)]);
  }
  function trEdgesFromMask(mask) {
    const e = [];
    TR_PAIRS.forEach(([u, v], i) => { if (mask & (1 << i)) e.push([u, v]); });
    return e;
  }
  function trDegrees(n, edges) {
    const d = new Array(n).fill(0);
    edges.forEach(([u, v]) => { d[u]++; d[v]++; });
    return d;
  }
  // uniform random labelled tree via Prüfer sequences (Cayley)
  function trRandomTreeMask(rng, n) {
    const code = [];
    for (let i = 0; i < n - 2; i++) code.push(Math.floor(rng() * n));
    const deg = new Array(n).fill(1);
    code.forEach((v) => deg[v]++);
    const idx = new Map();
    TR_PAIRS.forEach(([u, v], i) => idx.set(u + "-" + v, i));
    let mask = 0;
    for (const v of code) {
      let leaf = -1;
      for (let i = 0; i < n; i++) if (deg[i] === 1) { leaf = i; break; }
      const a = Math.min(leaf, v), b = Math.max(leaf, v);
      mask |= (1 << idx.get(a + "-" + b));
      deg[leaf]--; deg[v]--;
    }
    const rest = [];
    for (let i = 0; i < n; i++) if (deg[i] === 1) rest.push(i);
    mask |= (1 << idx.get(Math.min(rest[0], rest[1]) + "-" + Math.max(rest[0], rest[1])));
    return mask;
  }
  function trDiameter(n, edges) {
    const adj = Array.from({ length: n }, () => new Set());
    edges.forEach(([u, v]) => { adj[u].add(v); adj[v].add(u); });
    let diam = 0;
    for (let s = 0; s < n; s++) {
      const dist = new Array(n).fill(-1);
      dist[s] = 0;
      const q = [s];
      while (q.length) {
        const u = q.shift();
        for (const w of adj[u]) if (dist[w] < 0) { dist[w] = dist[u] + 1; q.push(w); }
      }
      for (let t = 0; t < n; t++) {
        if (dist[t] < 0) return Infinity;
        if (dist[t] > diam) diam = dist[t];
      }
    }
    return diam;
  }
  function trWiener(n, edges) {
    const adj = Array.from({ length: n }, () => new Set());
    edges.forEach(([u, v]) => { adj[u].add(v); adj[v].add(u); });
    let sum = 0;
    for (let s = 0; s < n; s++) {
      const dist = new Array(n).fill(-1);
      dist[s] = 0;
      const q = [s];
      while (q.length) {
        const u = q.shift();
        for (const w of adj[u]) if (dist[w] < 0) { dist[w] = dist[u] + 1; q.push(w); }
      }
      for (let t = s + 1; t < n; t++) {
        if (dist[t] < 0) return Infinity;
        sum += dist[t];
      }
    }
    return sum;
  }
  function trIndependence(n, edges) {
    const adj = Array.from({ length: n }, () => new Set());
    edges.forEach(([u, v]) => { adj[u].add(v); adj[v].add(u); });
    let best = 0;
    const pop = (m) => { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; };
    for (let m = 0; m < (1 << n); m++) {
      if (pop(m) <= best) continue;
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        if (!(m & (1 << i))) continue;
        for (let j = i + 1; j < n; j++) {
          if ((m & (1 << j)) && adj[i].has(j)) { ok = false; break; }
        }
      }
      if (ok) best = pop(m);
    }
    return best;
  }
  function trProps(edges) {
    const d = trDegrees(TR_N, edges);
    return {
      leaf: d.filter((x) => x === 1).length,
      diam: trDiameter(TR_N, edges),
      maxd: Math.max(...d),
      w: trWiener(TR_N, edges),
      alpha: trIndependence(TR_N, edges),
    };
  }
  function trCompare(t, g) {
    const num = (a, b) => {
      if (a === b) return { cls: "g-green", dir: "" };
      return { cls: Math.abs(a - b) === 1 ? "g-yellow" : "g-gray", dir: a > b ? "↑" : "↓" };
    };
    const tile = (label, value, r) => ({ label, value: value + r.dir, cls: r.cls });
    const out = [
      tile("Leaf", String(g.leaf), num(t.leaf, g.leaf)),
      tile("Δ", String(g.maxd), num(t.maxd, g.maxd)),
      tile("α", String(g.alpha), num(t.alpha, g.alpha)),
    ];
    const dv = isFinite(g.diam) ? String(g.diam) : "∞";
    if (t.diam === g.diam) out.push({ label: "Diam", value: dv, cls: "g-green" });
    else if (!isFinite(t.diam) || !isFinite(g.diam)) {
      out.push({ label: "Diam", value: dv + (!isFinite(t.diam) ? "↑" : "↓"), cls: "g-gray" });
    } else {
      const r = num(t.diam, g.diam);
      out.push({ label: "Diam", value: dv + r.dir, cls: r.cls });
    }
    const wv = isFinite(g.w) ? String(g.w) : "∞";
    if (t.w === g.w) out.push({ label: "W", value: wv, cls: "g-green" });
    else if (!isFinite(t.w) || !isFinite(g.w)) {
      out.push({ label: "W", value: wv + (!isFinite(t.w) ? "↑" : "↓"), cls: "g-gray" });
    } else {
      const r = num(t.w, g.w);
      out.push({ label: "W", value: wv + r.dir, cls: r.cls });
    }
    return out;
  }
  function genTreedleTarget(dateKey) {
    return trRandomTreeMask(rngFor(dateKey, "treedle"), TR_N);
  }

  let TR_TARGET = genTreedleTarget(activeDate);
  let TR_TPROPS = trProps(trEdgesFromMask(TR_TARGET));
  const treedleSvg = document.getElementById("treedleSvg");
  const treedleMeta = document.getElementById("treedleMeta");
  const treedleDraft = document.getElementById("treedleDraft");
  const treedleHist = document.getElementById("treedleHist");
  const treedleMsg = document.getElementById("treedleMsg");
  const treedleGuessBtn = document.getElementById("treedleGuess");
  let trDraft = new Set(); // "u-v" with u < v
  let trPending = -1;
  let trGuesses = []; // {mask, tiles}
  let trDone = null; // 'won' | 'lost'
  function trDraftStats() {
    const p = trProps([...trDraft].map((k) => k.split("-").map(Number)));
    return "Leaf " + p.leaf + " · Diam " + (isFinite(p.diam) ? p.diam : "∞") +
      " · Δ " + p.maxd + " · W " + (isFinite(p.w) ? p.w : "∞") + " · α " + p.alpha;
  }
  function paintTreedle() {
    treedleSvg.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const R = 19;
    trDraft.forEach((k) => {
      const [u, v] = k.split("-").map(Number);
      const [x1, y1] = TR_POS[u], [x2, y2] = TR_POS[v];
      let bi = -1, bd = Infinity;
      for (let w = 0; w < TR_N; w++) {
        if (w === u || w === v) continue;
        const d = segPointDist(x1, y1, x2, y2, TR_POS[w][0], TR_POS[w][1]);
        if (d < bd) { bd = d; bi = w; }
      }
      if (bi >= 0 && bd < R + 4) {
        const others = [];
        for (let w = 0; w < TR_N; w++) if (w !== u && w !== v) others.push(TR_POS[w]);
        const cp = edgeBow(x1, y1, x2, y2, TR_POS[bi][0], TR_POS[bi][1], R, others);
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", "M " + x1 + " " + y1 + " Q " + cp[0] + " " + cp[1] + " " + x2 + " " + y2);
        p.setAttribute("class", "edge");
        treedleSvg.appendChild(p);
      } else {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", x1); l.setAttribute("y1", y1);
        l.setAttribute("x2", x2); l.setAttribute("y2", y2);
        treedleSvg.appendChild(l);
      }
    });
    for (let i = 0; i < TR_N; i++) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", TR_POS[i][0]); c.setAttribute("cy", TR_POS[i][1]);
      c.setAttribute("r", 19);
      c.setAttribute("class", "node" + (i === trPending ? " pending" : ""));
      c.style.fill = "#eef1e8";
      c.dataset.v = i;
      c.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (trDone) return;
        if (trPending < 0) trPending = i;
        else if (trPending === i) trPending = -1;
        else {
          const a = Math.min(trPending, i), b = Math.max(trPending, i);
          const k = a + "-" + b;
          if (trDraft.has(k)) trDraft.delete(k); else trDraft.add(k);
          trPending = -1;
        }
        paintTreedle();
      });
      treedleSvg.appendChild(c);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", TR_POS[i][0]); t.setAttribute("y", TR_POS[i][1] + 4);
      t.setAttribute("text-anchor", "middle");
      t.textContent = i + 1;
      t.style.fill = "#5c6650";
      treedleSvg.appendChild(t);
    }
    treedleDraft.textContent = "Draft: " + trDraftStats();
    paintTreedleMeta();
  }
  function paintTreedleMeta() {
    const left = TR_TRIES - trGuesses.length;
    treedleMeta.innerHTML = trDone === "won" ? "Solved!" :
      trDone === "lost" ? "Out of tries." :
      "Guess <b>" + (trGuesses.length + 1) + "</b>/" + TR_TRIES;
    treedleGuessBtn.style.opacity = trDone || !left ? 0.4 : 1;
  }
  function trAddHistRow(mask, tiles, prefix) {
    const row = document.createElement("div");
    row.className = "grow";
    row.appendChild(graphMiniSvg(mask, TR_PAIRS, TR_POS));
    const box = document.createElement("div");
    box.className = "gtiles";
    if (prefix) {
      const p = document.createElement("div");
      p.textContent = prefix;
      p.style.cssText = "font-size:11px;font-weight:700;color:#6b7561;min-width:52px;";
      box.appendChild(p);
    }
    tiles.forEach((t) => {
      const d = document.createElement("div");
      d.className = "gtile " + t.cls;
      const s = document.createElement("small");
      s.textContent = t.label;
      const v = document.createElement("span");
      v.textContent = t.value;
      d.appendChild(s); d.appendChild(v);
      box.appendChild(d);
    });
    row.appendChild(box);
    treedleHist.appendChild(row);
  }
  function trRevealTarget() {
    trAddHistRow(TR_TARGET, trCompare(TR_TPROPS, TR_TPROPS), "Answer");
  }
  document.getElementById("treedleClear").onclick = () => {
    if (trDone) return;
    trDraft.clear(); trPending = -1;
    paintTreedle();
  };
  document.getElementById("treedleGuess").onclick = () => {
    if (trDone || trGuesses.length >= TR_TRIES) return;
    let mask = 0;
    TR_PAIRS.forEach(([u, v], i) => { if (trDraft.has(u + "-" + v)) mask |= (1 << i); });
    const tiles = trCompare(TR_TPROPS, trProps(trEdgesFromMask(mask)));
    trGuesses.push({ mask, tiles });
    trDraft.clear(); trPending = -1;
    trAddHistRow(mask, tiles);
    if (tiles.every((t) => t.cls === "g-green")) {
      trDone = "won";
      saveTreedle();
      treedleMsg.textContent = "Solved in " + trGuesses.length + "/" + TR_TRIES + "! 🎉";
      treedleMsg.className = "msg good";
      updateStreak(); renderArchive();
    } else if (trGuesses.length >= TR_TRIES) {
      trDone = "lost";
      saveTreedle();
      treedleMsg.textContent = "Out of tries — the answer is revealed below.";
      treedleMsg.className = "msg bad";
      trRevealTarget();
    } else {
      saveTreedle();
    }
    paintTreedle();
  };
  document.getElementById("treedleShare").onclick = () => {
    const emo = { "g-green": "🟩", "g-yellow": "🟨", "g-gray": "⬛" };
    const lines = trGuesses.map((g) => g.tiles.map((t) => emo[t.cls]).join(""));
    const score = trDone === "won" ? trGuesses.length + "/" + TR_TRIES : "X/" + TR_TRIES;
    shareText("Hard Mode Treedle " + activeDate + "\n" + lines.join("\n") + "\n" + score);
  };
  function saveTreedle() {
    try {
      localStorage.setItem("hm-" + activeDate + "-treedle", JSON.stringify({
        masks: trGuesses.map((g) => g.mask),
        solved: trDone === "won",
        lost: trDone === "lost",
      }));
    } catch (_) {}
  }
  function loadTreedle() {
    try {
      const d = JSON.parse(localStorage.getItem("hm-" + activeDate + "-treedle") || "null");
      if (d && Array.isArray(d.masks)) {
        for (const mask of d.masks) {
          if (typeof mask !== "number" || mask < 0 || mask >= (1 << TR_PAIRS.length)) continue;
          trGuesses.push({ mask, tiles: trCompare(TR_TPROPS, trProps(trEdgesFromMask(mask))) });
        }
        if (d.solved) {
          trDone = "won";
          treedleMsg.textContent = "Solved in " + trGuesses.length + "/" + TR_TRIES + "! 🎉";
          treedleMsg.className = "msg good";
        } else if (d.lost) {
          trDone = "lost";
          treedleMsg.textContent = "Out of tries — the answer is revealed below.";
          treedleMsg.className = "msg bad";
        }
      }
    } catch (_) {}
  }
  function rebuildTreedle() {
    TR_TARGET = genTreedleTarget(activeDate);
    TR_TPROPS = trProps(trEdgesFromMask(TR_TARGET));
    trDraft = new Set();
    trPending = -1;
    trGuesses = [];
    trDone = null;
    treedleHist.innerHTML = "";
    treedleMsg.textContent = ""; treedleMsg.className = "msg";
    loadTreedle();
    for (const g of trGuesses) trAddHistRow(g.mask, g.tiles);
    if (trDone === "lost") trRevealTarget();
    paintTreedle();
  }

  // ============================================================
  // ARCHIVE + date navigation (all games)
  // ============================================================
  const dateLabel = document.getElementById("dateLabel");
  const dateBtn = document.getElementById("dateBtn");
  const archiveEl = document.getElementById("archive");
  const archiveList = document.getElementById("archiveList");
  const archiveDate = document.getElementById("archiveDate");
  const prevBtn = document.getElementById("prevDay");
  const nextBtn = document.getElementById("nextDay");

  function isSolved(key, game) {
    try {
      const d = JSON.parse(localStorage.getItem("hm-" + key + "-" + game) || "null");
      return !!(d && d.solved);
    } catch (_) { return false; }
  }
  function renderArchive() {
    dateLabel.textContent = activeDate + (activeDate === TODAY_REAL ? " · today" : "");
    archiveDate.value = activeDate;
    archiveDate.max = TODAY_REAL;
    archiveDate.min = MIN_DATE;
    prevBtn.disabled = activeDate <= MIN_DATE;
    nextBtn.disabled = activeDate >= TODAY_REAL;
    prevBtn.style.opacity = prevBtn.disabled ? 0.4 : 1;
    nextBtn.style.opacity = nextBtn.disabled ? 0.4 : 1;
    archiveList.innerHTML = "";
    for (let i = 0; i < ARCHIVE_DAYS; i++) {
      const k = addDays(TODAY_REAL, -i);
      const s = isSolved(k, "steiner"), c = isSolved(k, "color"), gr = isSolved(k, "graphle"), tr = isSolved(k, "treedle");
      const b = document.createElement("button");
      b.className = "archive-item" + (k === activeDate ? " current" : "");
      b.innerHTML = shortLabel(k) + "<br><span class='dot'>" + (s ? "🌱" : "·") + (c ? "🎨" : "·") + (gr ? "◉" : "·") + (tr ? "🌳" : "·") + "</span>";
      const done = [s && "steiner", c && "colouring", gr && "graphle", tr && "treedle"].filter(Boolean);
      b.title = k + (done.length ? " — " + done.join(", ") : "");
      b.onclick = () => setActiveDate(k);
      archiveList.appendChild(b);
    }
  }
  function setActiveDate(key) {
    if (key < MIN_DATE) key = MIN_DATE;
    if (key > TODAY_REAL) key = TODAY_REAL;
    activeDate = key;
    hintOpen = false;
    // rebuild steiner
    S = genSteiner(activeDate);
    GN = S.N;
    sel.clear();
    buildGrid(); loadSteiner(); paintSteiner();
    steinerMsg.textContent = ""; steinerMsg.className = "msg";
    // re-show solved message if applicable
    try {
      const d = JSON.parse(localStorage.getItem("hm-" + activeDate + "-steiner") || "null");
      if (d && d.solved) { const c = steinerConnectivity(); if (c.allConnected) checkSteiner(false); }
    } catch (_) {}
    // rebuild color
    G = genGraph(activeDate);
    CN = G.n;
    resetColoring();
    loadColor(); refreshColor();
    colorMsg.textContent = ""; colorMsg.className = "msg";
    try {
      const d = JSON.parse(localStorage.getItem("hm-" + activeDate + "-color") || "null");
      if (d && d.solved) checkColor(false);
    } catch (_) {}
    // rebuild graphle
    rebuildGraphle();
    // rebuild treedle
    rebuildTreedle();
    renderArchive();
  }
  dateBtn.onclick = () => archiveEl.classList.toggle("hidden");
  prevBtn.onclick = () => setActiveDate(addDays(activeDate, -1));
  nextBtn.onclick = () => setActiveDate(addDays(activeDate, 1));
  archiveDate.onchange = () => { if (archiveDate.value) setActiveDate(archiveDate.value); };

  // ============================================================
  // LEVEL EDITOR (+ custom play sessions through the real game views)
  // ============================================================
  const EDIT_N = 12; // steiner editor board size

  // ---- share-link codec: compact level JSON -> base64url in location.hash ----
  function encodeCustom(game, data) {
    const json = JSON.stringify({ game, data });
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function validateCustom(obj) {
    if (!obj || (obj.game !== "steiner" && obj.game !== "color") || !obj.data) return null;
    if (obj.game === "steiner") {
      const d = obj.data;
      const N = Math.max(8, Math.min(14, (d.N | 0) || 12));
      if (!Array.isArray(d.terms) || d.terms.length < 2 || d.terms.length > 12) return null;
      const terms = [];
      for (const t of d.terms) {
        if (!Array.isArray(t) || t.length !== 2) return null;
        const r = t[0] | 0, c = t[1] | 0;
        if (r < 0 || c < 0 || r >= N || c >= N) return null;
        terms.push([r, c]);
      }
      const okCells = (arr) => Array.isArray(arr) && arr.every((p) => Array.isArray(p) && p.length === 2 && (p[0] | 0) === p[0] && (p[1] | 0) === p[1] && p[0] >= 0 && p[1] >= 0 && p[0] < N && p[1] < N);
      if (!okCells(d.walls || []) || !okCells(d.bonus || []) || !okCells(d.pen || [])) return null;
      const termSet = new Set(terms.map(([r, c]) => r + "," + c));
      const walls = new Set((d.walls || []).map(([r, c]) => r + "," + c));
      for (const k of termSet) if (walls.has(k)) return null;
      const special = new Map();
      for (const [r, c] of (d.bonus || [])) special.set(r + "," + c, { type: "bonus" });
      for (const [r, c] of (d.pen || [])) special.set(r + "," + c, { type: "penalty" });
      const portalPairs = {};
      for (const pid of ["A", "B"]) {
        const pair = (d.portals || {})[pid];
        if (!pair) continue;
        if (!okCells(pair) || pair.length !== 2) return null;
        special.set(pair[0][0] + "," + pair[0][1], { type: "portal", pid });
        special.set(pair[1][0] + "," + pair[1][1], { type: "portal", pid });
        portalPairs[pid] = [[pair[0][0], pair[0][1]], [pair[1][0], pair[1][1]]];
      }
      for (const k of special.keys()) if (termSet.has(k) || walls.has(k)) return null;
      if (!stFreeConnected(N, terms, walls)) return null;
      const par = solveSteinerExact(N, terms, walls, special, portalPairs);
      if (!Number.isFinite(par)) return null;
      return { game: "steiner", data: { N, terms, termSet, walls, special, portalPairs, par } };
    }
    const d = obj.data;
    const n = d.n | 0;
    if (!(n >= 5 && n <= 10) || !Array.isArray(d.edges)) return null;
    const seen = new Set(), edges = [];
    for (const e of d.edges) {
      if (!Array.isArray(e) || e.length !== 2) return null;
      const [u, v] = e;
      if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0 || u >= n || v >= n || u === v) return null;
      const k = u < v ? u + "-" + v : v + "-" + u;
      if (seen.has(k)) continue;
      seen.add(k); edges.push([u, v]);
    }
    if (!edges.length || !isConnected(n, edges)) return null;
    let pos = null;
    if (Array.isArray(d.pos) && d.pos.length === n && d.pos.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 340 && y >= 0 && y <= 340)) {
      pos = d.pos.map(([x, y]) => [Math.round(x), Math.round(y)]);
    } else {
      pos = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        pos.push([Math.round(170 + 120 * Math.cos(a)), Math.round(170 + 120 * Math.sin(a))]);
      }
    }
    const chi = chromaticNumber(n, edges);
    if (chi < 2 || chi > 6) return null;
    return { game: "color", data: { edges, chi, pos, n } };
  }
  function decodeCustom(str) {
    try {
      const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
      return validateCustom(JSON.parse(decodeURIComponent(escape(atob(b64)))));
    } catch (_) { return null; }
  }

  // ---- steiner editor state ----
  const edSteinerGrid = document.getElementById("edSteinerGrid");
  const edSteinerMeta = document.getElementById("edSteinerMeta");
  const edSteinerMsg = document.getElementById("edSteinerMsg");
  const edSteinerTools = document.getElementById("edSteinerTools");
  const edSteinerLib = document.getElementById("edSteinerLib");
  const ED_TOOLS = [
    ["term", "● seed"], ["wall", "■ rock"], ["bonus", "+ spore"], ["pen", "! thorn"],
    ["portalA", "A portal"], ["portalB", "B portal"], ["erase", "⌫ erase"],
  ];
  let edTool = "term";
  const edTerms = [];
  const edWalls = new Set();
  const edSpecial = new Map();
  const edCells = new Map();
  const edKey = (r, c) => r + "," + c;
  function edMsg(text, good) {
    edSteinerMsg.textContent = text;
    edSteinerMsg.className = "msg" + (good === true ? " good" : good === false ? " bad" : "");
  }
  function edSteinerData() {
    const terms = edTerms.map(([r, c]) => [r, c]);
    return {
      N: EDIT_N, terms,
      termSet: new Set(terms.map(([r, c]) => edKey(r, c))),
      walls: new Set(edWalls), special: new Map(edSpecial),
      portalPairs: (() => {
        const pp = {};
        for (const pid of ["A", "B"]) {
          const pts = [];
          edSpecial.forEach((v, k) => { if (v.type === "portal" && v.pid === pid) pts.push(k.split(",").map(Number)); });
          if (pts.length === 2) pp[pid] = pts;
        }
        return pp;
      })(),
    };
  }
  function applyEdTool(r, c) {
    const k = edKey(r, c);
    const ti = edTerms.findIndex(([tr, tc]) => tr === r && tc === c);
    if (edTool === "erase") {
      if (ti >= 0) edTerms.splice(ti, 1);
      edWalls.delete(k); edSpecial.delete(k);
      paintEdSteiner(); return;
    }
    if (edTool === "term") {
      if (ti >= 0) { edTerms.splice(ti, 1); paintEdSteiner(); return; }
      if (edWalls.has(k) || edSpecial.has(k)) { edMsg("Erase this square first.", false); return; }
      if (edTerms.length >= 12) { edMsg("12 seeds max.", false); return; }
      edTerms.push([r, c]); paintEdSteiner(); return;
    }
    if (ti >= 0) { edMsg("Erase the seed first.", false); return; }
    if (edTool === "wall") {
      edSpecial.delete(k); edWalls.add(k); paintEdSteiner(); return;
    }
    const type = edTool === "bonus" ? "bonus" : edTool === "pen" ? "penalty" : "portal";
    const pid = edTool === "portalA" ? "A" : edTool === "portalB" ? "B" : null;
    if (type === "portal") {
      let count = 0;
      edSpecial.forEach((v, kk) => { if (v.type === "portal" && v.pid === pid && kk !== k) count++; });
      if (count >= 2) { edMsg("Only 2 ends per portal.", false); return; }
    }
    edWalls.delete(k);
    edSpecial.set(k, pid ? { type, pid } : { type });
    paintEdSteiner();
  }
  function paintEdSteiner() {
    edCells.forEach((el, k) => {
      const [r, c] = k.split(",").map(Number);
      const isTerm = edTerms.some(([tr, tc]) => tr === r && tc === c);
      const sp = edSpecial.get(k);
      let cls = "cell ", txt = "";
      if (isTerm) { cls += "term"; txt = "●"; }
      else if (edWalls.has(k)) { cls += "wall"; txt = "■"; }
      else {
        cls += "free";
        if (sp && sp.type === "bonus") { cls += " bonus"; txt = "+"; }
        if (sp && sp.type === "penalty") { cls += " penalty"; txt = "!"; }
        if (sp && sp.type === "portal") { cls += " portal"; txt = sp.pid; }
      }
      el.className = cls;
      el.textContent = txt;
    });
  }
  function edSteinerStats() {
    const d = edSteinerData();
    let s = "Seeds <b>" + d.terms.length + "</b> · rock " + d.walls.size;
    if (d.terms.length >= 2 && stFreeConnected(d.N, d.terms, d.walls)) {
      const par = solveSteinerExact(d.N, d.terms, d.walls, d.special, d.portalPairs);
      s += Number.isFinite(par) ? " · par <b>" + par + "</b> (exact)" : " · unsolvable shape";
    } else if (d.terms.length >= 2) s += " · seeds not all linked";
    else s += " · place at least 2 seeds";
    edSteinerMeta.innerHTML = s;
  }
  function buildEdSteiner() {
    edSteinerTools.innerHTML = "";
    for (const [id, label] of ED_TOOLS) {
      const b = document.createElement("button");
      b.className = "tool" + (id === edTool ? " active" : "");
      b.textContent = label;
      b.onclick = () => { edTool = id; buildEdTools(); edSteinerStats(); };
      edSteinerTools.appendChild(b);
    }
    edSteinerGrid.innerHTML = "";
    edCells.clear();
    edSteinerGrid.style.gridTemplateColumns = "repeat(" + EDIT_N + ", 1fr)";
    for (let r = 0; r < EDIT_N; r++) for (let c = 0; c < EDIT_N; c++) {
      const d = document.createElement("div");
      d.className = "cell free";
      d.dataset.r = r; d.dataset.c = c;
      edSteinerGrid.appendChild(d);
      edCells.set(edKey(r, c), d);
    }
    paintEdSteiner(); edSteinerStats();
  }
  function buildEdTools() {
    [...edSteinerTools.children].forEach((b, i) => b.classList.toggle("active", ED_TOOLS[i][0] === edTool));
    [...edColorTools.children].forEach((b, i) => b.classList.toggle("active", ED_CTOOLS[i][0] === edToolC));
  }
  let edDragPaint = null, edIsDown = false;
  edSteinerGrid.addEventListener("pointerdown", (e) => {
    const t = e.target.closest(".cell");
    if (!t) return;
    e.preventDefault();
    edIsDown = true;
    try { edSteinerGrid.setPointerCapture(e.pointerId); } catch (_) {}
    edDragPaint = true;
    applyEdTool(+t.dataset.r, +t.dataset.c);
  });
  edSteinerGrid.addEventListener("pointermove", (e) => {
    if (!edIsDown) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const t = el && el.closest ? el.closest(".cell") : null;
    if (!t || !edSteinerGrid.contains(t)) return;
    applyEdTool(+t.dataset.r, +t.dataset.c);
  });
  window.addEventListener("pointerup", () => {
    if (edIsDown) { edIsDown = false; edSteinerStats(); }
  });
  function serializeEdSteiner() {
    const d = edSteinerData();
    const list = (type) => [...d.special].filter(([, v]) => v.type === type).map(([k]) => k.split(",").map(Number));
    const portals = {};
    for (const pid of ["A", "B"]) if (d.portalPairs[pid]) portals[pid] = d.portalPairs[pid];
    return { N: EDIT_N, terms: d.terms, walls: [...d.walls].map((k) => k.split(",").map(Number)), bonus: list("bonus"), pen: list("penalty"), portals };
  }
  document.getElementById("edSteinerPlay").onclick = () => {
    const d = edSteinerData();
    if (d.terms.length < 2) return edMsg("Place at least 2 seeds first.", false);
    if (!stFreeConnected(d.N, d.terms, d.walls)) return edMsg("Seeds aren't all linked — open a path first.", false);
    const par = solveSteinerExact(d.N, d.terms, d.walls, d.special, d.portalPairs);
    if (!Number.isFinite(par)) return edMsg("No valid network — check the layout.", false);
    enterCustom("steiner", { id: "playtest", name: "Playtest", data: { ...d, par } });
  };
  document.getElementById("edSteinerSave").onclick = () => {
    const d = edSteinerData();
    if (d.terms.length < 2) return edMsg("Place at least 2 seeds first.", false);
    if (!stFreeConnected(d.N, d.terms, d.walls)) return edMsg("Seeds aren't all linked — open a path first.", false);
    const name = prompt("Name this level:", "My steiner " + (edLib("steiner").length + 1));
    if (!name) return;
    const list = edLib("steiner");
    list.push({ id: "s" + Date.now(), name: name.slice(0, 40), ts: Date.now(), game: "steiner", data: serializeEdSteiner() });
    edSaveLib("steiner", list);
    renderEdLib("steiner");
    edMsg("Saved “" + name.slice(0, 40) + "”.", true);
  };
  document.getElementById("edSteinerClear").onclick = () => {
    edTerms.length = 0; edWalls.clear(); edSpecial.clear();
    paintEdSteiner(); edSteinerStats();
    edMsg("", null);
  };
  document.getElementById("edSteinerLink").onclick = () => {
    copyCustomLink("steiner", serializeEdSteiner(), edMsg);
  };

  // ---- graph editor state ----
  const editorSvg = document.getElementById("editorSvg");
  const edColorMeta = document.getElementById("edColorMeta");
  const edColorMsg = document.getElementById("edColorMsg");
  const edColorTools = document.getElementById("edColorTools");
  const edColorLib = document.getElementById("edColorLib");
  const ED_CTOOLS = [["move", "✥ move"], ["link", "🔗 link"]];
  let edN = 7, edToolC = "move", edPending = -1, edDrag = -1;
  let edPos = [];
  let edEdges = new Set(); // "u-v" with u < v
  function edCMsg(text, good) {
    edColorMsg.textContent = text;
    edColorMsg.className = "msg" + (good === true ? " good" : good === false ? " bad" : "");
  }
  function edCirclePos(n) {
    const pos = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n - Math.PI / 2;
      pos.push([Math.round(170 + 120 * Math.cos(a)), Math.round(170 + 120 * Math.sin(a))]);
    }
    return pos;
  }
  function edColorEdges() {
    return [...edEdges].map((k) => k.split("-").map(Number));
  }
  function paintEdColor() {
    editorSvg.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const R = 19;
    edEdges.forEach((k) => {
      const [u, v] = k.split("-").map(Number);
      const [x1, y1] = edPos[u], [x2, y2] = edPos[v];
      let bi = -1, bd = Infinity;
      for (let w = 0; w < edN; w++) {
        if (w === u || w === v) continue;
        const d = segPointDist(x1, y1, x2, y2, edPos[w][0], edPos[w][1]);
        if (d < bd) { bd = d; bi = w; }
      }
      if (bi >= 0 && bd < R + 4) {
        const others = [];
        for (let w = 0; w < edN; w++) if (w !== u && w !== v) others.push(edPos[w]);
        const cp = edgeBow(x1, y1, x2, y2, edPos[bi][0], edPos[bi][1], R, others);
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", "M " + x1 + " " + y1 + " Q " + cp[0] + " " + cp[1] + " " + x2 + " " + y2);
        p.setAttribute("class", "edge");
        editorSvg.appendChild(p);
      } else {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", x1); l.setAttribute("y1", y1);
        l.setAttribute("x2", x2); l.setAttribute("y2", y2);
        editorSvg.appendChild(l);
      }
    });
    for (let i = 0; i < edN; i++) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", edPos[i][0]); c.setAttribute("cy", edPos[i][1]);
      c.setAttribute("r", 19);
      c.setAttribute("class", "node" + (i === edPending ? " pending" : ""));
      c.style.fill = "#eef1e8";
      c.dataset.v = i;
      c.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (edToolC === "move") {
          edDrag = i;
          try { editorSvg.setPointerCapture(e.pointerId); } catch (_) {}
        } else {
          if (edPending < 0) edPending = i;
          else if (edPending === i) edPending = -1;
          else {
            const a = Math.min(edPending, i), b = Math.max(edPending, i);
            const k = a + "-" + b;
            if (edEdges.has(k)) edEdges.delete(k); else edEdges.add(k);
            edPending = -1;
            updateEdStats();
          }
          paintEdColor();
        }
      });
      editorSvg.appendChild(c);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", edPos[i][0]); t.setAttribute("y", edPos[i][1] + 4);
      t.setAttribute("text-anchor", "middle");
      t.textContent = i + 1;
      t.style.fill = "#5c6650";
      editorSvg.appendChild(t);
    }
  }
  editorSvg.addEventListener("pointermove", (e) => {
    if (edDrag < 0 || edToolC !== "move") return;
    const rect = editorSvg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 340;
    const y = ((e.clientY - rect.top) / rect.height) * 340;
    edPos[edDrag] = [Math.max(20, Math.min(320, Math.round(x))), Math.max(20, Math.min(320, Math.round(y)))];
    paintEdColor();
  });
  window.addEventListener("pointerup", () => { edDrag = -1; });
  function updateEdStats() {
    const edges = edColorEdges();
    let s = edN + " nodes · " + edges.length + " edges";
    if (!edges.length) s += " · tap 🔗 then two dots to link them";
    else if (!isConnected(edN, edges)) s += " · disconnected — link it up";
    else s += " · χ " + chromaticNumber(edN, edges);
    edColorMeta.innerHTML = s;
  }
  function buildEdColor() {
    edColorTools.innerHTML = "";
    for (const [id, label] of ED_CTOOLS) {
      const b = document.createElement("button");
      b.className = "tool" + (id === edToolC ? " active" : "");
      b.textContent = label;
      b.onclick = () => { edToolC = id; edPending = -1; buildEdTools(); paintEdColor(); };
      edColorTools.appendChild(b);
    }
    if (!edPos.length) edPos = edCirclePos(edN);
    paintEdColor(); updateEdStats();
  }
  document.getElementById("edNMinus").onclick = () => {
    if (edN > 5) { edN--; edPos = edCirclePos(edN); edEdges.clear(); edPending = -1; paintEdColor(); updateEdStats(); edCMsg("", null); }
  };
  document.getElementById("edNPlus").onclick = () => {
    if (edN < 10) { edN++; edPos = edCirclePos(edN); edEdges.clear(); edPending = -1; paintEdColor(); updateEdStats(); edCMsg("", null); }
  };
  function serializeEdColor() {
    return { n: edN, edges: edColorEdges(), pos: edPos.map(([x, y]) => [Math.round(x), Math.round(y)]) };
  }
  document.getElementById("edColorPlay").onclick = () => {
    const edges = edColorEdges();
    if (!edges.length) return edCMsg("Link at least one edge first.", false);
    if (!isConnected(edN, edges)) return edCMsg("Graph is disconnected — link it up.", false);
    const chi = chromaticNumber(edN, edges);
    enterCustom("color", {
      id: "playtest", name: "Playtest",
      data: { edges, chi, pos: edPos.map(([x, y]) => [x, y]), n: edN },
    });
  };
  document.getElementById("edColorSave").onclick = () => {
    const edges = edColorEdges();
    if (!edges.length) return edCMsg("Link at least one edge first.", false);
    if (!isConnected(edN, edges)) return edCMsg("Graph is disconnected — link it up.", false);
    const name = prompt("Name this level:", "My graph " + (edLib("color").length + 1));
    if (!name) return;
    const list = edLib("color");
    list.push({ id: "c" + Date.now(), name: name.slice(0, 40), ts: Date.now(), game: "color", data: serializeEdColor() });
    edSaveLib("color", list);
    renderEdLib("color");
    edCMsg("Saved “" + name.slice(0, 40) + "”.", true);
  };
  document.getElementById("edColorClear").onclick = () => {
    edEdges.clear(); edPending = -1;
    paintEdColor(); updateEdStats(); edCMsg("Edges cleared.", null);
  };
  document.getElementById("edColorLink").onclick = () => {
    copyCustomLink("color", serializeEdColor(), edCMsg);
  };

  // ---- editor library (localStorage) ----
  function edLib(game) {
    try {
      const d = JSON.parse(localStorage.getItem("hm-editor-" + game) || "[]");
      return Array.isArray(d) ? d : [];
    } catch (_) { return []; }
  }
  function edSaveLib(game, list) {
    try { localStorage.setItem("hm-editor-" + game, JSON.stringify(list)); } catch (_) {}
  }
  function renderEdLib(game) {
    const el = game === "steiner" ? edSteinerLib : edColorLib;
    el.innerHTML = "";
    const list = edLib(game);
    if (!list.length) return;
    const head = document.createElement("div");
    head.style.cssText = "font-size:12px;color:#6b7561;margin-bottom:2px;";
    head.textContent = "Saved levels (" + list.length + ")";
    el.appendChild(head);
    for (const entry of list.slice().reverse()) {
      const row = document.createElement("div");
      row.className = "lib-item";
      const v = validateCustom({ game: entry.game, data: entry.data });
      const sub = !v ? "broken" : entry.game === "steiner" ? "par " + v.data.par : "χ " + v.data.chi + " · " + v.data.edges.length + " edges";
      const sp = document.createElement("span");
      sp.textContent = entry.name + " · " + sub;
      sp.title = entry.name;
      const load = document.createElement("button");
      load.textContent = "Load";
      load.onclick = () => {
        const vv = validateCustom({ game: entry.game, data: entry.data });
        if (!vv) { (game === "steiner" ? edMsg : edCMsg)("That save is broken.", false); return; }
        applyCustomToEditor({ id: entry.id, name: entry.name, game: entry.game, data: vv.data });
        (game === "steiner" ? edMsg : edCMsg)("Loaded “" + entry.name + "” — tweak it or Playtest.", true);
      };
      const del = document.createElement("button");
      del.textContent = "✕";
      del.setAttribute("aria-label", "Delete " + entry.name);
      del.onclick = () => {
        edSaveLib(game, edLib(game).filter((e) => e.id !== entry.id));
        renderEdLib(game);
      };
      row.appendChild(sp); row.appendChild(load); row.appendChild(del);
      el.appendChild(row);
    }
  }
  function copyCustomLink(game, linkObj, msgFn) {
    const url = location.href.split("#")[0] + "#e=" + encodeCustom(game, linkObj);
    shareText(url);
    msgFn("Link ready to share.", true);
  }

  // ---- custom play sessions (through the real game views) ----
  let edType = "steiner";
  function setEdType(t) {
    edType = t;
    document.getElementById("edTypeSteiner").classList.toggle("active", t === "steiner");
    document.getElementById("edTypeColor").classList.toggle("active", t === "color");
    document.getElementById("edSteinerWrap").classList.toggle("hidden", t !== "steiner");
    document.getElementById("edColorWrap").classList.toggle("hidden", t !== "color");
  }
  document.getElementById("edTypeSteiner").onclick = () => setEdType("steiner");
  document.getElementById("edTypeColor").onclick = () => setEdType("color");
  function applyCustomToEditor(session) {
    if (session.game === "steiner") {
      setEdType("steiner");
      const d = session.data;
      edTerms.length = 0;
      d.terms.forEach(([r, c]) => edTerms.push([r, c]));
      edWalls.clear();
      d.walls.forEach((k) => edWalls.add(k));
      edSpecial.clear();
      d.special.forEach((v, k) => edSpecial.set(k, v));
      paintEdSteiner(); edSteinerStats();
    } else {
      setEdType("color");
      edN = session.data.n;
      edPos = session.data.pos.map(([x, y]) => [x, y]);
      edEdges = new Set(session.data.edges.map(([u, v]) => (u < v ? u + "-" + v : v + "-" + u)));
      edPending = -1;
      paintEdColor(); updateEdStats();
    }
  }
  function enterCustom(game, session) {
    customSession = session;
    mode = "custom";
    hintOpen = false;
    daterowEl.style.display = "none";
    archiveEl.classList.add("hidden");
    steinerTutBtn.style.display = "none";
    colorTutBtn.style.display = "none";
    if (game === "steiner") {
      showView("steiner");
      steinerCustomBar.classList.remove("hidden");
      colorCustomBar.classList.add("hidden");
      steinerTutBox.classList.add("hidden");
      const d = session.data;
      GN = d.N;
      S = { terms: d.terms, termSet: d.termSet, walls: d.walls, special: d.special, portalPairs: d.portalPairs, par: d.par, kind: "custom" };
      sel.clear();
      buildGrid(); loadSteiner(); paintSteiner();
      steinerMsg.textContent = ""; steinerMsg.className = "msg";
      try {
        const s = JSON.parse(localStorage.getItem(storeKey("steiner")) || "null");
        if (s && s.solved) { const c = steinerConnectivity(); if (c.allConnected) checkSteiner(false); }
      } catch (_) {}
      document.getElementById("steinerCustomName").textContent = session.name;
      document.getElementById("steinerCustomPar").textContent = d.par;
    } else {
      showView("color");
      colorCustomBar.classList.remove("hidden");
      steinerCustomBar.classList.add("hidden");
      colorTutBox.classList.add("hidden");
      const d = session.data;
      G = { edges: d.edges, chi: d.chi, pos: d.pos, n: d.n, kind: "custom", labels: null, locked: null };
      CN = G.n;
      resetColoring();
      loadColor(); refreshColor();
      colorMsg.textContent = ""; colorMsg.className = "msg";
      try {
        const s = JSON.parse(localStorage.getItem(storeKey("color")) || "null");
        if (s && s.solved) checkColor(false);
      } catch (_) {}
      document.getElementById("colorCustomName").textContent = session.name;
      document.getElementById("colorCustomChi").textContent = d.chi;
    }
  }
  function exitCustomToEditor() {
    const session = customSession;
    mode = "daily";
    customSession = null;
    steinerCustomBar.classList.add("hidden");
    colorCustomBar.classList.add("hidden");
    steinerTutBtn.style.display = "";
    colorTutBtn.style.display = "";
    daterowEl.style.display = "none";
    archiveEl.classList.add("hidden");
    if (session) applyCustomToEditor(session);
    showView("editor");
  }
  document.getElementById("steinerCustomBack").onclick = exitCustomToEditor;
  document.getElementById("colorCustomBack").onclick = exitCustomToEditor;

  // ============================================================
  // TUTORIAL mode (fixed boards + written guides, progress separate)
  // ============================================================
  const daterowEl = document.getElementById("daterow");
  const steinerTutBtn = document.getElementById("steinerTutBtn");
  const colorTutBtn = document.getElementById("colorTutBtn");
  const steinerTutBox = document.getElementById("steinerTutBox");
  const colorTutBox = document.getElementById("colorTutBox");
  const steinerCustomBar = document.getElementById("steinerCustomBar");
  const colorCustomBar = document.getElementById("colorCustomBar");
  function enterTutorial(game) {
    mode = "tutorial";
    daterowEl.style.display = "none";
    archiveEl.classList.add("hidden");
    steinerTutBtn.style.display = "none";
    colorTutBtn.style.display = "none";
    if (game === "steiner") {
      showView("steiner");
      steinerTutBox.classList.remove("hidden");
      colorTutBox.classList.add("hidden");
      GN = 12;
      S = tutorialSteiner();
      sel.clear();
      buildGrid(); loadSteiner(); paintSteiner();
      steinerMsg.textContent = ""; steinerMsg.className = "msg";
      try {
        const d = JSON.parse(localStorage.getItem(storeKey("steiner")) || "null");
        if (d && d.solved) { const c = steinerConnectivity(); if (c.allConnected) checkSteiner(false); }
      } catch (_) {}
      document.getElementById("steinerTutPar").textContent = S.par;
    } else {
      showView("color");
      colorTutBox.classList.remove("hidden");
      steinerTutBox.classList.add("hidden");
      G = tutorialGraph();
      CN = G.n;
      resetColoring();
      loadColor(); refreshColor();
      colorMsg.textContent = ""; colorMsg.className = "msg";
      try {
        const d = JSON.parse(localStorage.getItem(storeKey("color")) || "null");
        if (d && d.solved) checkColor(false);
      } catch (_) {}
    }
  }
  function exitToDaily(game) {
    mode = "daily";
    customSession = null;
    daterowEl.style.display = "";
    steinerTutBtn.style.display = "";
    colorTutBtn.style.display = "";
    steinerTutBox.classList.add("hidden");
    colorTutBox.classList.add("hidden");
    steinerCustomBar.classList.add("hidden");
    colorCustomBar.classList.add("hidden");
    setActiveDate(activeDate);
    showView(game || "steiner");
  }
  steinerTutBtn.onclick = () => enterTutorial("steiner");
  colorTutBtn.onclick = () => enterTutorial("color");
  document.getElementById("steinerTutBack").onclick = () => exitToDaily("steiner");
  document.getElementById("colorTutBack").onclick = () => exitToDaily("color");

  // ---------- init ----------
  let __initTheme = "light";
  try {
    const s = localStorage.getItem("hm-theme");
    if (s === "dark" || s === "minimal") __initTheme = s;
  } catch (_) {}
  setTheme(__initTheme);
  buildGrid(); loadSteiner(); paintSteiner();
  loadColor(); refreshColor();
  rebuildGraphle();
  rebuildTreedle();
  // re-assert solved banners after load
  try {
    const d = JSON.parse(localStorage.getItem("hm-" + activeDate + "-steiner") || "null");
    if (d && d.solved) { const c = steinerConnectivity(); if (c.allConnected) checkSteiner(false); }
  } catch (_) {}
  buildEdSteiner(); buildEdColor();
  renderEdLib("steiner"); renderEdLib("color");
  setEdType("steiner");
  // shared level via link hash: load it into the editor
  if (location.hash && location.hash.startsWith("#e=")) {
    const got = decodeCustom(location.hash.slice(3));
    if (got) {
      applyCustomToEditor({ id: "shared", name: "Shared level", game: got.game, data: got.data });
      daterowEl.style.display = "none";
      archiveEl.classList.add("hidden");
      showView("editor");
      (got.game === "steiner" ? edMsg : edCMsg)("Shared level loaded — Playtest it or Save it.", true);
      try { history.replaceState(null, "", location.pathname + location.search); } catch (_) {}
    }
  }
  renderArchive();
  updateStreak();
})();
