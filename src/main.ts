/* HardMode — deterministic daily graph puzzles. */
import { generateSteiner, STEINER_REVISION } from "./steiner-levels";
import { generateColorGraph, chromaticNumber, isConnected, shuffled, countColourings, COUNT_CAP, COLOR_REVISION } from "./color-levels";
import {
  graphleSize, graphlePairs, GRAPHLE_REVISION, TREEDLE_PAIRS, graphleEdges, treedleEdges, graphleProps, treedleProps,
  generateGraphleTarget, generateTreedleTarget, GUESS_REVISION,
} from "./guess-levels";
import { solveSteinerExact } from "./steiner-solver";
(function () {
  "use strict";

  type Point = [number, number];
  type Edge = [number, number];
  type PuzzleMode = "daily" | "tutorial" | "custom";
  type GameKey = "steiner" | "color" | "graphle" | "treedle";
  type CustomSession = { id: string; name: string; game: "steiner" | "color"; data: any };

  // ---------- dates ----------
  function todayKey(d: Date = new Date()) {
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
  let mode: PuzzleMode = "daily";
  let customSession: CustomSession | null = null;
  function dailyStoreKey(date: string, game: GameKey) {
    const revision = game === "steiner" ? STEINER_REVISION : game === "color" ? COLOR_REVISION : game === "graphle" ? GRAPHLE_REVISION : GUESS_REVISION;
    return "hm-" + date + "-" + game + "-" + revision;
  }
  function storeKey(game: GameKey) {
    if (mode === "tutorial") return "hm-tutorial-" + game;
    if (mode === "custom") return "hm-custom-" + (customSession ? customSession.id : "x") + "-" + game;
    return dailyStoreKey(activeDate, game);
  }
  function shareLabel() {
    if (mode === "tutorial") return "tutorial";
    if (mode === "custom" && customSession) return "custom “" + customSession.name + "”";
    return activeDate;
  }


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
      VIEWS[k][0].setAttribute("aria-selected", String(on));
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
  const GAMES: GameKey[] = ["steiner", "color", "graphle", "treedle"];
  function isSolvedStore(key, game) {
    try {
      const d = JSON.parse(localStorage.getItem(dailyStoreKey(key, game)) || "null");
      // Keep earned streaks from the original boards without restoring old moves.
      const oldRevisions = game === "steiner" ? ["", "-challenge-1", "-challenge-2", "-challenge-3", "-challenge-4"]
        : game === "graphle" ? ["", "-challenge-2"] : [];
      const legacySolved = oldRevisions.some(suffix => {
        try { return !!JSON.parse(localStorage.getItem("hm-" + key + "-" + game + suffix) || "null")?.solved; }
        catch (_) { return false; }
      });
      return !!(d?.solved || legacySolved);
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

  // ---------- theme, persisted ----------
  // "light" is the absence of a data-theme, so it carries no token block.
  const THEMES = {
    light: { id: "themeLight", bar: "#f5f6f8" },
    dark: { id: "themeDark", bar: "#0b0d13" },
    minimal: { id: "themeMinimal", bar: "#ffffff" },
    moss: { id: "themeMoss", bar: "#f2f4e8" },
    terminal: { id: "themeTerminal", bar: "#030806" },
  };
  const themeBar = document.querySelector('meta[name="theme-color"]');
  function setTheme(t) {
    if (!Object.prototype.hasOwnProperty.call(THEMES, t)) t = "light";
    if (t === "light") delete document.body.dataset.theme;
    else document.body.dataset.theme = t;
    try { localStorage.setItem("hm-theme", t); } catch (_) {}
    // Keep the browser's own chrome in step with the page.
    if (themeBar) themeBar.setAttribute("content", THEMES[t].bar);
    for (const k of Object.keys(THEMES)) {
      document.getElementById(THEMES[k].id).classList.toggle("active", k === t);
    }
  }
  for (const k of Object.keys(THEMES)) {
    document.getElementById(THEMES[k].id).onclick = () => setTheme(k);
  }

  // Both guessing games are drawn the same way: tap one dot then another to
  // toggle the link between them, or press on one dot and release on another to
  // draw it in a single drag. Either way the dot you finish on stays selected,
  // so a whole path goes in without lifting between links. Tapping the selected
  // dot again, tapping bare board, or Escape lifts the pen.
  function bindEdgeDrawing(svg, api) {
    let pressed = -1;
    const dotAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      return el && el.tagName === "circle" && el.dataset.v !== undefined ? Number(el.dataset.v) : -1;
    };
    const tap = (i: number) => {
      if (api.done()) return;
      const from = api.pending();
      if (from < 0 || from === i) api.setPending(from === i ? -1 : i);
      else { api.toggle(from, i); api.setPending(i); }
      api.repaint();
    };
    svg.addEventListener("pointerdown", (e: PointerEvent) => {
      pressed = dotAt(e.clientX, e.clientY);
      if (pressed >= 0) e.preventDefault();
      else if (api.pending() >= 0) { api.setPending(-1); api.repaint(); }
    });
    svg.addEventListener("pointerup", (e: PointerEvent) => {
      const from = pressed;
      pressed = -1;
      if (from < 0 || api.done()) return;
      const to = dotAt(e.clientX, e.clientY);
      if (to < 0) return;                     // released off the board: leave it be
      if (to === from) { tap(from); return; } // never moved: an ordinary tap
      api.toggle(from, to);                   // dragged across: draw that link
      api.setPending(to);
      api.repaint();
    });
    svg.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && api.pending() >= 0) { api.setPending(-1); api.repaint(); }
    });
    return tap;
  }

  // ---------- daily result stats ----------
  // Finishing a puzzle posts one anonymous line to /api/result and the day's
  // histogram comes back from /api/stats. Everything here degrades to silence:
  // no endpoint, no database, or no network and the panels simply stay hidden,
  // because a puzzle must never depend on a server being up.
  const RESULT_LABELS = {
    steiner: { head: "cost over target", order: ["0", "1", "2", "3+"], name: { "0": "=", "1": "+1", "2": "+2", "3+": "+3" } },
    color: { head: "stars", order: ["3", "2", "1"], name: { "3": "★★★", "2": "★★", "1": "★" } },
    graphle: { head: "guesses used", order: ["1", "2", "3", "4", "5", "6", "X"], name: null },
    treedle: { head: "guesses used", order: ["1", "2", "3", "4", "5", "6", "X"], name: null },
  };
  let statsOn = true;                       // flipped off by the first refusal
  let statsCache = null;                    // { date, games }
  const myBucket = {};                      // game -> the bucket this device sent
  function playerId() {
    try {
      let id = localStorage.getItem("hm-player");
      if (!id || !/^[a-z0-9]{8,40}$/.test(id)) {
        id = Array.from({ length: 16 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
        localStorage.setItem("hm-player", id);
      }
      return id;
    } catch (_) { return null; }
  }
  async function loadStats(date) {
    if (!statsOn) return null;
    try {
      // Always ask: the answer changes the moment anyone finishes, and the one
      // reader who most needs it fresh is the player who just did.
      const res = await fetch("/api/stats?date=" + encodeURIComponent(date), { cache: "no-store" });
      if (!res.ok) { statsOn = false; return null; }
      const data = await res.json();
      if (!data || data.enabled === false) { statsOn = false; return null; }
      statsCache = data;
      return data;
    } catch (_) { statsOn = false; return null; }
  }
  function drawResults(game) {
    const box = document.getElementById(game + "Results");
    if (!box) return;
    const spec = RESULT_LABELS[game];
    const slot = statsCache && statsCache.date === activeDate && statsCache.games ? statsCache.games[game] : null;
    if (!statsOn || !slot || !slot.total) { box.classList.add("hidden"); return; }
    const most = Math.max(...spec.order.map((b) => slot.buckets[b] || 0), 1);
    box.querySelector(".results-head").textContent =
      slot.total + (slot.total === 1 ? " player has" : " players have") + " finished today · " + spec.head;
    box.querySelector(".results-bars").innerHTML = spec.order.map((b) => {
      const n = slot.buckets[b] || 0;
      const label = spec.name ? spec.name[b] : b;
      return '<div class="results-row' + (myBucket[game] === b ? " mine" : "") + '"><span>' +
        label + '</span><i style="width:' + Math.max(6, Math.round((n / most) * 100)) + '%">' + n + "</i></div>";
    }).join("");
    box.classList.remove("hidden");
    const note = document.getElementById("privacyNote");
    if (note) note.hidden = false;
  }
  function drawAllResults() { for (const g of GAMES) drawResults(g); }
  // `fresh` is false when a solved state is merely being restored from storage:
  // only a puzzle finished here and now is worth reporting.
  async function reportResult(game, bucket, fresh) {
    myBucket[game] = bucket;
    if (!statsOn) return;
    const player = fresh ? playerId() : null;
    if (player) {
      try {
        await fetch("/api/result", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ day: activeDate, game, bucket, player }),
        });
      } catch (_) { /* the puzzle is already won; the tally is not worth an error */ }
    }
    await loadStats(activeDate);
    drawAllResults();
  }
  const steinerBucket = (over) => over <= 0 ? "0" : over === 1 ? "1" : over === 2 ? "2" : "3+";

  // ---------- compact inline help ----------
  function bindHelp(buttonId: string, boxId: string) {
    const button = document.getElementById(buttonId);
    const box = document.getElementById(boxId);
    button.onclick = () => {
      const open = box.classList.toggle("hidden") === false;
      button.setAttribute("aria-expanded", String(open));
    };
  }
  bindHelp("graphleHelpBtn", "graphleHelpBox");
  bindHelp("treedleHelpBtn", "treedleHelpBox");
  bindHelp("tallyHintBtn", "tallyHintBox");

  // ============================================================
  // GAME 1 — STEINER TREE (moss)
  // ============================================================
  let GN = 12; // active board size (families vary it)

  // Shared connectivity check for the custom-level editor.
  function stKey(r, c) { return r + "," + c; }
  function stBfsSeen(N, terms, walls) {
    const seen = new Set<string>([stKey(terms[0][0], terms[0][1])]);
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
  const BONUS_COST = 0, PENALTY_COST = 3, NORMAL_COST = 1;
  function genSteiner(dateKey: string) {
    return generateSteiner(dateKey, solveSteinerExact);
  }

  // Fixed tutorial boards (same for everyone, forever).
  function tutorialSteiner() {
    const N = 12;
    const terms = [[1, 1], [1, 10], [10, 5]];
    const termSet = new Set(terms.map(([r, c]) => r + "," + c));
    const walls = new Set<string>([[2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5]].map(([r, c]) => r + "," + c));
    const special = new Map<string, any>();
    special.set("1,5", { type: "penalty" });
    special.set("8,3", { type: "bonus" });
    special.set("3,8", { type: "bonus" });
    special.set("5,1", { type: "portal", pid: "A" });
    special.set("5,10", { type: "portal", pid: "A" });
    const portalPairs = { A: [[5, 1], [5, 10]] };
    const target = solveSteinerExact(N, terms, walls, special, portalPairs);
    return { terms, termSet, walls, special, target, portalPairs };
  }
  function tutorialGraph() {
    return {
      edges: [[0, 1], [1, 2], [0, 2], [3, 0], [3, 1], [4, 2]],
      chi: 3,
      pos: [[110, 100], [230, 100], [170, 180], [60, 235], [280, 235]],
      n: 5, kind: "tutorial",
    };
  }

  let S: any = genSteiner(activeDate);
  GN = S.N;
  const gridEl = document.getElementById("steinerGrid");
  const steinerMeta = document.getElementById("steinerMeta");
  const steinerMsg = document.getElementById("steinerMsg");
  gridEl.style.gridTemplateColumns = "repeat(" + GN + ", 1fr)";
  const sel = new Set<string>();
  let steinerChecked = false, showingOptimal = false;
  let optimalCells: Set<string> | null = null;
  const steinerReveal = document.getElementById("steinerReveal") as HTMLButtonElement;
  const cellEls = new Map<string, HTMLElement>();
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
    gridEl.classList.toggle("wraps", Boolean(S.wrap));
    gridEl.classList.toggle("wraps-vertical", Boolean(S.wrapVertical));
    gridEl.setAttribute("aria-label", S.wrapVertical
      ? "Steiner grid, wrapping: left/right and top/bottom edges are joined"
      : S.wrap
      ? "Steiner grid, wrapping: the left and right edges are joined"
      : "Steiner grid");
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
      d.dataset.r = String(r); d.dataset.c = String(c);
      d.setAttribute("role", "gridcell");
      d.tabIndex = r === 0 && c === 0 ? 0 : -1;
      const cellKind = S.termSet.has(k) ? "seed" : S.walls.has(k) ? "rock" :
        sp?.type === "bonus" ? "free spore" : sp?.type === "penalty" ? "thorn, cost three" :
        sp?.type === "portal" ? "portal " + sp.pid : "empty cell";
      const seam = (S.wrap && (c === 0 || c === GN - 1)) || (S.wrapVertical && (r === 0 || r === GN - 1)) ? ", on the wrapping edge" : "";
      d.setAttribute("aria-label", "Row " + (r + 1) + ", column " + (c + 1) + ", " + cellKind + seam);
      gridEl.appendChild(d);
      cellEls.set(k, d);
    }
  }
  function steinerConnectivity() {
    const active = new Set<string>([...S.termSet, ...sel]);
    const jump = new Map<string, string>();
    for (const pid of Object.keys(S.portalPairs)) {
      const [a, b] = S.portalPairs[pid];
      const ka = skey(a[0], a[1]), kb = skey(b[0], b[1]);
      if (active.has(ka) && active.has(kb)) { jump.set(ka, kb); jump.set(kb, ka); }
    }
    const start = skey(S.terms[0][0], S.terms[0][1]);
    const seen = new Set<string>([start]);
    const q = [start];
    while (q.length) {
      const k = q.pop();
      const [r, c] = k.split(",").map(Number);
      if (jump.has(k)) { const j = jump.get(k); if (!seen.has(j)) { seen.add(j); q.push(j); } }
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nr = S.wrapVertical && dc === 0 ? (r + dr + GN) % GN : r + dr;
        // On a wrapping board the row's two ends are neighbours.
        const nc = S.wrap && dr === 0 ? (c + dc + GN) % GN : c + dc;
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
    const shown = showingOptimal ? optimalCells! : sel;
    steinerMsg.hidden = showingOptimal;
    steinerReveal.hidden = !steinerChecked;
    steinerReveal.textContent = showingOptimal ? "Back to my route" : "Show optimal answer";
    steinerReveal.setAttribute("aria-pressed", String(showingOptimal));
    gridEl.setAttribute("aria-readonly", String(showingOptimal));
    (document.getElementById("steinerCheck") as HTMLButtonElement).disabled = showingOptimal;
    (document.getElementById("steinerClear") as HTMLButtonElement).disabled = showingOptimal;
    cellEls.forEach((el, k) => {
      el.classList.toggle("path", shown.has(k) && !S.termSet.has(k));
      if (!S.termSet.has(k) && !S.walls.has(k)) el.setAttribute("aria-pressed", String(shown.has(k)));
    });
    const conn = steinerConnectivity();
    S.terms.forEach(([r, c]) => {
      const el = cellEls.get(skey(r, c));
      el.classList.remove("connected", "unconnected");
      el.classList.add(showingOptimal || conn.allConnected ? "connected" : "unconnected");
    });
    const cost = currentCost();
    const status = conn.allConnected ? " · <b>CONNECTED ✓</b>" : " · " + conn.reachedCount + "/" + S.terms.length + " linked";
    steinerMeta.innerHTML = (mode === "tutorial" ? "Tutorial · " : "") + (mode === "custom" ? "Custom · " : "") + (showingOptimal ? "Optimal route · Cost <b>" + S.target + "</b>" : "Cost <b>" + cost + "</b>" + (steinerChecked ? " · Target " + S.target : "") + status) + (S.kind ? " · <span style='color:#6b7561'>" + S.kind + (S.wrapVertical ? " ↔ ↕ wraps" : S.wrap ? " ↔ wraps" : "") + "</span>" : "");
  }
  let dragMode = null, isDown = false;
  function toggleCell(r, c, mode) {
    if (showingOptimal) return;
    const k = skey(r, c);
    if (S.termSet.has(k) || S.walls.has(k)) return;
    if (mode === true) sel.add(k);
    else if (mode === false) sel.delete(k);
    else { sel.has(k) ? sel.delete(k) : sel.add(k); }
    saveSteiner(false);
    paintSteiner();
  }
  gridEl.addEventListener("pointerdown", (e) => {
    const t = (e.target as Element).closest(".cell") as HTMLElement | null;
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
    const t = el?.closest(".cell") as HTMLElement | null;
    if (!t || !gridEl.contains(t)) return;
    toggleCell(+t.dataset.r, +t.dataset.c, dragMode);
  });
  gridEl.addEventListener("keydown", (e: KeyboardEvent) => {
    const t = (e.target as Element).closest(".cell") as HTMLElement | null;
    if (!t) return;
    const r = Number(t.dataset.r), c = Number(t.dataset.c);
    const moves: Record<string, Point> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      const nr = S.wrapVertical && dc === 0 ? (r + dr + GN) % GN : Math.max(0, Math.min(GN - 1, r + dr));
      const nc = S.wrap && dr === 0 ? (c + dc + GN) % GN : Math.max(0, Math.min(GN - 1, c + dc));
      const next = cellEls.get(skey(nr, nc));
      if (next) { t.tabIndex = -1; next.tabIndex = 0; next.focus(); }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleCell(r, c, null);
    }
  });
  window.addEventListener("pointerup", () => { isDown = false; dragMode = null; });

  document.getElementById("steinerClear").onclick = () => { sel.clear(); saveSteiner(false); paintSteiner(); steinerMsg.textContent = ""; steinerMsg.className = "msg"; };
  document.getElementById("steinerCheck").onclick = () => checkSteiner(true);
  steinerReveal.onclick = () => {
    if (!steinerChecked) return;
    if (!optimalCells) {
      const answer = new Set<string>();
      const cost = solveSteinerExact(GN, S.terms, S.walls, S.special, S.portalPairs, S.wrap, S.wrapVertical, answer);
      if (!Number.isFinite(cost) || cost !== S.target) {
        steinerMsg.textContent = "Couldn't reveal an optimal route. Please try again.";
        return;
      }
      optimalCells = answer;
    }
    showingOptimal = !showingOptimal;
    paintSteiner();
  };
  function checkSteiner(verbose) {
    if (verbose) { steinerChecked = true; saveSteiner(false); }
    paintSteiner();
    const conn = steinerConnectivity();
    const cost = currentCost();
    if (conn.allConnected) {
      let verdict;
      if (cost <= S.target) verdict = "Perfect — matches the exact optimum! 🌟";
      else if (cost <= S.target + 2) verdict = "Close to optimal.";
      else verdict = "Valid, but the optimum is lower — look for shared paths, spores and portals.";
      steinerMsg.textContent = "Solved! Cost " + cost + " (target " + S.target + ") — " + verdict;
      steinerMsg.className = "msg good";
      saveSteiner(true);
      updateStreak(); renderArchive();
      reportResult("steiner", steinerBucket(cost - S.target), verbose);
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
      localStorage.setItem(storeKey("steiner"), JSON.stringify({ sel: [...sel], checked: steinerChecked, solved: solved || prev.solved || false, cost: currentCost() }));
    } catch (_) {}
  }
  function loadSteiner() {
    steinerChecked = false; showingOptimal = false; optimalCells = null;
    try {
      const d = JSON.parse(localStorage.getItem(storeKey("steiner")) || "null");
      steinerChecked = Boolean(d?.checked || d?.solved);
      if (d && Array.isArray(d.sel)) d.sel.forEach((k) => sel.add(k));
      if (d && d.solved) { const c = steinerConnectivity(); if (c.allConnected) checkSteiner(false); }
    } catch (_) {}
  }
  document.getElementById("steinerShare").onclick = async () => {
    const conn = steinerConnectivity();
    shareText("HardMode " + shareLabel() + "\nSteiner 🌱: " + (conn.allConnected ? "✅ cost " + currentCost() + (steinerChecked ? " (target " + S.target + ")" : "") : "❌ unsolved") + "\n" + shareLink());
  };

  // ============================================================
  // GAME 2 — GRAPH COLOURING (modern, intentional graphs)
  // ============================================================
  const PALETTE = ["#FF2E63", "#00BFFF", "#FFC800", "#7C4DFF", "#00E676", "#FF6D00"];
  const DARK_TEXT = new Set<number>([2, 4]); // yellow + bright green need dark labels
  let CN = 9; // node count varies per daily graph (8-12)

  // SUDOKU as graph colouring: 36 cells on a grid; every row, column and
  // 2x3 box is a clique (216 edges — drawn as the grid itself, never as
  // lines). Givens arrive locked to their digit; paint the rest 1-6.
  // chi is exactly 6: each row needs 6 distinct colours, digits achieve it.
  function buildSudokuGraph(rr) {
    const solution = sudokuComplete(rr);
    const puzzle = sudokuDig(solution, rr, 24 + Math.floor(rr() * 3));
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
      const want = 4 + Math.floor(rr() * 3);
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
  function genGraph(dateKey: string) {
    return generateColorGraph(dateKey, buildSudokuGraph);
  }

  let G: any = genGraph(activeDate);
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
    hintBtn.textContent = hintOpen ? "Hide strategy" : "Show a strategy for this graph";
    if (!hintOpen) {
      kindBox.classList.add("hidden");
      return;
    }
    kindTitle.textContent = info[0];
    kindBody.innerHTML = (G.kind === "sat reduction" && G.clauses ? "Today's formula: <b>" + G.clauses.map((c) => "(" + c.join(" ∨ ") + ")").join(" ∧ ") + "</b> — make it true.<br>" : "") + info[1];
    kindBox.classList.remove("hidden");
  }
  hintBtn.onclick = () => {
    hintOpen = !hintOpen;
    updateHintUI();
  };
  // Solving guide per puzzle family.
  const KIND_INFO = {
    "map": ["Map — colour the districts",
      "Neighbouring districts (sharing a border, not just a point) must differ. Start with the most-bordered district and colour its neighbourhood first — constraints cascade from there. A triangle of three mutually adjacent districts forces 3 colours, and the four-colour theorem guarantees you never need a 5th. These maps are triangulated on purpose, so 4 is usually the honest answer: when you run out of room, back up to the last district that had a real choice rather than reaching for a 5th colour."],
    "timetable": ["Timetable — schedule the exams",
      "Each dot is an exam; an edge means shared students, so linked exams need different time slots (colours). Dots run left-to-right in start order. Sweep an imaginary vertical line across: the busiest slice — the most exams all pairwise clashing — is a clique and sets your minimum, and these days are built so that slice holds four. Greedy works here: take exams left to right, giving each the first slot none of its earlier neighbours uses."],
    "frequencies": ["Frequencies — assign the channels",
      "Each dot is a radio mast; two masts within range of each other interfere and need different channels. There is no tidy structure to lean on, so read it off the picture: find the tightest cluster first, because a clump of four mutually-in-range masts already uses up every channel you have. Colour that cluster, then work outwards along the masts with the fewest free channels left. When you stall, the mast to change is rarely the one you are stuck on — it is the one two steps back that had two options and took the wrong one."],
    "triangle-free": ["Triangle-free — no clique to find",
      "There is not one triangle in this graph. Every habit that says \"find three mutual neighbours and start there\" is useless, and yet three colours provably cannot finish it — that is the whole trick. It is built in layers: an odd ring on the outside, a mirror of each ring node just inside it (wired to that node's two ring neighbours, never to the node itself), and one hub joined to every mirror. Try it with three and watch what happens: colour the ring, and each mirror is squeezed towards a single colour, which leaves the hub with nothing. So the fourth colour has to go somewhere — spend it on the hub, or on one carefully chosen mirror, and let the rest fall out."],
    "sat reduction": ["SAT reduction — colouring solves the formula",
      "Two colours do all the work here: <b>pink (T) means TRUE, blue (F) means FALSE</b> — they arrive locked, and yellow B is just scaffolding. Your whole job is deciding x1, x2 and x3.<br>1. <b>Read the variables.</b> Each pair x/!x touches yellow, so each splits pink/blue. Painting those six dots <b>is</b> picking true/false for the three variables — 8 assignments in all.<br>2. <b>Read a fuse.</b> Each clause is a chain p → q → r → s → t. p touches its first two literals and pink T, so if both are blue, p is forced yellow — which forces q pink, r yellow, s pink — and then t, touching pink s plus blue and yellow, has no colour left. That dead end <b>is</b> the clause being false. Any pink literal breaks the fuse and leaves t paintable.<br>3. <b>Solve it.</b> Both fuses share the same six literal dots, so one assignment has to satisfy both clauses at once — that is the part that is actually hard. Pick an assignment that makes today's formula true, paint the six variable dots, then walk each chain left to right taking any non-clashing colour. Stuck at a t? First rewind to that chain's last free choice — r is the usual fork — and only flip a variable if the chain truly has no way through, then recheck the other clause.<br>All 19 coloured, no red: your pinks and blues satisfy the formula. ★★★."],
    "propagation chain": ["Propagation chain — a planted puzzle",
      "The clique across the top fixes the colour permutation (every colour appears exactly once up there). Middle dots touch all-but-one colour — they're forced, so paint them first like unit propagation in SAT. Bottom dots are genuine choices, and they are cross-linked to each other, so a choice that looks free can still collide two dots later: branch on one, propagate, and be ready to undo."],
    "sudoku": ["Sudoku — the grid IS the graph",
      "Every row, column and 2×3 box is one big clique — all six cells pairwise linked, which is why those edges aren't drawn (216 would blanket the board). The few links you <b>can</b> see are extra rivalries beyond Sudoku rules: those pairs must differ too, so factor them in early — they usually decide the hardest cells. Dark digits are locked givens; the chips are digits 1–6. Tactics carry straight over: naked singles (a cell with only one legal digit) and hidden singles (a digit with only one home in a row, column or box). Six colours is optimal — each row needs all six — so a clean fill is ★★★."],
  };
  // The palette opens with exactly as many colours as the graph needs: one
  // spare turns most of these puzzles into a formality. "More colours" is there
  // for anyone who wants the easier win.
  const openingColors = (g) => g.kind === "sudoku" ? 6 : g.kind === "custom" ? Math.min(6, g.chi + 1) : g.chi;
  let numColors = openingColors(G);
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
        b.textContent = String(i + 1);
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
  // Hovering a dot lights the edges it belongs to, which is the only way to
  // read a busy graph without tracing lines by eye. The hovered dot survives a
  // repaint, so painting a colour under the cursor does not drop the highlight.
  let colorHover = -1;
  let colorLinks: { el: SVGElement; u: number; v: number }[] = [];
  function litEdges() {
    colorLinks.forEach(({ el, u, v }) =>
      el.classList.toggle("lit", colorHover >= 0 && (u === colorHover || v === colorHover)));
  }
  function drawGraph() {
    svg.innerHTML = "";
    colorLinks = [];
    const NS = "http://www.w3.org/2000/svg";
    const R = G.n > 12 ? 15 : 19;
    if (G.hideEdges) {
      // sudoku: constraints ARE the grid — draw 2x3 box outlines instead
      for (let br = 0; br < 3; br++) for (let bc = 0; bc < 2; bc++) {
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", String(42 + bc * 3 * 51.2 - 25.6));
        rect.setAttribute("y", String(42 + br * 2 * 51.2 - 25.6));
        rect.setAttribute("width", String(3 * 51.2));
        rect.setAttribute("height", String(2 * 51.2));
        rect.setAttribute("rx", "8");
        rect.setAttribute("fill", "none");
        rect.setAttribute("stroke", "#c9cfbd");
        rect.setAttribute("stroke-width", "2");
        rect.style.pointerEvents = "none";
        svg.appendChild(rect);
      }
    }
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
      let el;
      if (bi >= 0 && bd < R + 4) {
        const cp = edgeBow(x1, y1, x2, y2, G.pos[bi][0], G.pos[bi][1], R, others);
        el = document.createElementNS(NS, "path");
        el.setAttribute("d", "M " + x1 + " " + y1 + " Q " + cp[0] + " " + cp[1] + " " + x2 + " " + y2);
        el.setAttribute("class", cls);
      } else {
        el = document.createElementNS(NS, "line");
        el.setAttribute("x1", String(x1)); el.setAttribute("y1", String(y1));
        el.setAttribute("x2", String(x2)); el.setAttribute("y2", String(y2));
        if (bad) el.classList.add("conflict");
      }
      svg.appendChild(el);
      colorLinks.push({ el, u, v });
    };
    // Sudoku hides the 216 rule edges but must still show the extra rivalries.
    if (G.hideEdges) (G.extraEdges || []).forEach(drawLink);
    else G.edges.forEach(drawLink);
    // nodes touching a clash get a red ring (the only conflict signal when
    // edges are hidden, useful everywhere)
    const badNodes = new Set<number>();
    G.edges.forEach(([u, v]) => {
      if (coloring[u] !== -1 && coloring[u] === coloring[v]) { badNodes.add(u); badNodes.add(v); }
    });
    for (let i = 0; i < CN; i++) {
      const halo = document.createElementNS(NS, "circle");
      halo.setAttribute("cx", String(G.pos[i][0])); halo.setAttribute("cy", String(G.pos[i][1]));
      halo.setAttribute("r", String(R + 4));
      halo.setAttribute("fill", "none");
      halo.setAttribute("stroke", coloring[i] === -1 ? "rgba(34,48,28,0.20)" : PALETTE[coloring[i]]);
      halo.setAttribute("stroke-width", coloring[i] === -1 ? "2" : "3");
      halo.setAttribute("opacity", coloring[i] === -1 ? "1" : "0.55");
      halo.style.pointerEvents = "none";
      svg.appendChild(halo);
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", String(G.pos[i][0])); c.setAttribute("cy", String(G.pos[i][1]));
      c.setAttribute("r", String(R));
      c.setAttribute("class", "node");
      c.setAttribute("role", "button");
      c.setAttribute("tabindex", "0");
      c.setAttribute("aria-label", "Dot " + (i + 1) + (G.locked && G.locked[i] >= 0 ? ", fixed" : coloring[i] === -1 ? ", uncoloured" : ", colour " + (coloring[i] + 1)));
      if (badNodes.has(i)) c.setAttribute("stroke", "#e11d48");
      if (G.locked && G.locked[i] >= 0) c.setAttribute("stroke-width", "3.5");
      c.style.fill = coloring[i] === -1 ? "#eef1e8" : PALETTE[coloring[i]];
      c.dataset.v = String(i);
      const paintNode = () => {
        if (G.locked && G.locked[i] >= 0) return; // givens are fixed
        if (coloring[i] === activeColor) coloring[i] = -1;
        else coloring[i] = activeColor;
        saveColor(false);
        refreshColor();
      };
      c.addEventListener("click", paintNode);
      c.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); paintNode(); }
      });
      // Touch has no hover: a tap would light edges and leave them lit.
      const lightUp = (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        colorHover = i; litEdges();
      };
      const lightDown = () => { if (colorHover === i) { colorHover = -1; litEdges(); } };
      c.addEventListener("pointerenter", lightUp);
      c.addEventListener("pointerleave", lightDown);
      c.addEventListener("focus", () => { colorHover = i; litEdges(); });
      c.addEventListener("blur", lightDown);
      svg.appendChild(c);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", String(G.pos[i][0])); t.setAttribute("y", String(G.pos[i][1] + 4));
      t.setAttribute("text-anchor", "middle");
      t.textContent = String(G.labels ? G.labels[i] : i + 1);
      if (G.labels) t.setAttribute("font-size", G.kind === "sudoku" ? "14" : "10");
      if (coloring[i] === -1) t.style.fill = "#5c6650";
      else t.style.fill = DARK_TEXT.has(coloring[i]) ? "#0f172a" : "#fff";
      // subtle halo for readability
      t.setAttribute("stroke", coloring[i] === -1 ? "none" : (DARK_TEXT.has(coloring[i]) ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.35)"));
      t.setAttribute("stroke-width", "0.6");
      svg.appendChild(t);
    }
    litEdges();
  }
  // ---------- bonus: count the distinct colourings ----------
  // Counting them is harder than finding one — this is the #P-hard sibling of
  // the puzzle above, so it stays a bonus and never blocks the daily win.
  const tallyBox = document.getElementById("colorTally");
  const tallyK = document.getElementById("colorTallyK");
  const tallyInput = document.getElementById("colorTallyInput") as HTMLInputElement;
  const tallyMsg = document.getElementById("colorTallyMsg");
  let tallySolved: number[] = [];   // palette sizes already counted correctly
  let tallyTries = 0;
  const tallyTruth = new Map<number, { count: number; capped: boolean }>();
  function trueTally(k: number) {
    if (!tallyTruth.has(k)) tallyTruth.set(k, countColourings(CN, G.edges, k));
    return tallyTruth.get(k)!;
  }
  function resetTally() {
    tallyTruth.clear();
    tallySolved = [];
    tallyTries = 0;
    tallyInput.value = "";
    tallyMsg.textContent = ""; tallyMsg.className = "msg";
  }
  function refreshTally() {
    // Sudoku's 36 dots put the answer far beyond anything worth guessing.
    tallyBox.classList.toggle("hidden", G.kind === "sudoku");
    tallyK.textContent = String(numColors);
    if (tallySolved.includes(numColors)) {
      tallyMsg.textContent = "Counted: " + trueTally(numColors).count.toLocaleString() + " ✓";
      tallyMsg.className = "msg good";
    }
  }
  function checkTally() {
    const guess = Number(tallyInput.value);
    if (tallyInput.value.trim() === "" || !Number.isInteger(guess) || guess < 0) {
      tallyMsg.textContent = "Enter a whole number.";
      tallyMsg.className = "msg bad";
      return;
    }
    const truth = trueTally(numColors);
    if (truth.capped && guess < COUNT_CAP) {
      tallyMsg.textContent = "Higher — there are more than " + COUNT_CAP.toLocaleString()
        + " with " + numColors + " colours. Try fewer colours.";
      tallyMsg.className = "msg bad";
      return;
    }
    tallyTries++;
    if (guess === truth.count) {
      if (!tallySolved.includes(numColors)) tallySolved.push(numColors);
      tallyMsg.textContent = "Exactly " + truth.count.toLocaleString() + " — right in "
        + tallyTries + (tallyTries === 1 ? " try" : " tries") + ". 🔢";
      tallyMsg.className = "msg good";
      saveColor(false); updateStreak(); renderArchive();
      return;
    }
    const near = truth.count > 0 && Math.abs(guess - truth.count) <= Math.max(2, truth.count * 0.05);
    tallyMsg.textContent = (guess > truth.count ? "Too high — there are fewer." : "Too low — there are more.")
      + (near ? " Close, though." : tallyTries >= 3 ? " This one is meant to be hard — the tips below give a method." : "");
    tallyMsg.className = "msg bad";
    saveColor(false);
  }
  tallyInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); checkTally(); }
  });
  document.getElementById("colorTallyCheck").onclick = () => checkTally();

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
    refreshTally();
    updateHintUI();
  }
  const clearTallyVerdict = () => {
    if (!tallySolved.includes(numColors)) { tallyMsg.textContent = ""; tallyMsg.className = "msg"; }
  };
  document.getElementById("fewerColors").onclick = () => {
    if (numColors > 2) {
      numColors--;
      clearTallyVerdict();
      if (activeColor >= numColors) activeColor = numColors - 1;
      for (let i = 0; i < CN; i++) {
        if (coloring[i] >= numColors && !(G.locked && G.locked[i] >= 0)) coloring[i] = -1;
      }
      saveColor(false); refreshColor();
    }
  };
  document.getElementById("moreColors").onclick = () => {
    if (numColors < 6) { numColors++; clearTallyVerdict(); saveColor(false); refreshColor(); }
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
    reportResult("color", st.usedCount <= G.chi ? "3" : st.usedCount === G.chi + 1 ? "2" : "1", verbose);
    return true;
  }
  function saveColor(solved) {
    try {
      const prev = JSON.parse(localStorage.getItem(storeKey("color")) || "{}");
      localStorage.setItem(storeKey("color"), JSON.stringify({
        coloring, numColors, activeColor, tallySolved, tallyTries,
        solved: solved || prev.solved || false,
      }));
    } catch (_) {}
  }
  function loadColor() {
    try {
      const d = JSON.parse(localStorage.getItem(storeKey("color")) || "null");
      if (d) {
        if (Array.isArray(d.coloring) && d.coloring.length === CN) for (let i = 0; i < CN; i++) coloring[i] = d.coloring[i];
        if (G.kind === "sudoku") numColors = 6;
        else if (d.numColors) numColors = Math.min(6, Math.max(2, d.numColors));
        else numColors = (mode === "tutorial" && G.kind === "tutorial") ? 3 : openingColors(G);
        if (typeof d.activeColor === "number") activeColor = Math.min(numColors - 1, Math.max(0, d.activeColor));
        if (Array.isArray(d.tallySolved)) tallySolved = d.tallySolved.filter((k) => Number.isInteger(k));
        if (Number.isInteger(d.tallyTries)) tallyTries = d.tallyTries;
        if (d.solved) checkColor(false);
      } else {
        numColors = (mode === "tutorial" && G.kind === "tutorial") ? 3 : openingColors(G);
        activeColor = 0;
      }
      if (G.locked) for (let i = 0; i < CN; i++) if (G.locked[i] >= 0) coloring[i] = G.locked[i];
    } catch (_) {}
  }
  document.getElementById("colorShare").onclick = () => {
    const st = colorStats();
    const ok = st.uncolored === 0 && st.bad === 0;
    const bonus = tallySolved.length
      ? "\nCount 🔢: ✅ " + tallySolved.sort((a, z) => a - z).map((k) => k + "-colour").join(", ")
      : "";
    shareText("HardMode " + shareLabel() + "\nColouring 🎨: "
      + (ok ? "✅ " + st.usedCount + " colours" : "❌ unsolved") + bonus + "\n" + shareLink());
  };

  // ---------- share sheet ----------
  const shareBox = document.getElementById("shareBox") as HTMLDialogElement;
  const shareTitle = document.getElementById("shareTitle");
  const shareBody = document.getElementById("shareBody");
  const shareCopyBtn = document.getElementById("shareCopy");
  const shareSendBtn = document.getElementById("shareSend");
  let sharePayload = "";
  async function copyShare() {
    try {
      await navigator.clipboard.writeText(sharePayload);
      shareTitle.textContent = "Copied to clipboard";
      return true;
    } catch (_) {
      // Clipboard access is refused often enough (insecure origin, permissions,
      // an old browser) that the text has to stay readable and selectable.
      shareTitle.textContent = "Copy this to share";
      return false;
    }
  }
  // The plain page address: never the "#e=..." of a custom level someone
  // happens to have open, which would send readers to a different puzzle.
  const shareLink = () => location.href.split("#")[0];
  async function shareText(txt) {
    sharePayload = txt;
    shareBody.textContent = txt;
    const copied = await copyShare();
    shareSendBtn.classList.toggle("hidden", !navigator.share);
    if (typeof shareBox.showModal === "function") {
      if (!shareBox.open) shareBox.showModal();
      if (!copied) (shareBody as HTMLElement).focus();
    } else {
      alert(txt); // very old browsers: better a plain box than nothing
    }
  }
  shareCopyBtn.onclick = () => { copyShare(); };
  shareSendBtn.onclick = async () => {
    try { await navigator.share({ text: sharePayload }); } catch (_) {}
  };
  document.getElementById("shareDone").onclick = () => shareBox.close();
  // Clicking the backdrop lands on the dialog itself, never on its contents.
  shareBox.addEventListener("pointerdown", (e) => { if (e.target === shareBox) shareBox.close(); });

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
      const used = new Set<number>();
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
  // GAME 3 — GRAPHLE: guess the hidden 6–7 vertex graph.
  // Win by matching all five property tiles, not the exact wiring.
  // ============================================================
  let GL_N = graphleSize(activeDate);
  const GL_TRIES = 6;
  // fixed pair order = bit positions of guess/target masks
  let GL_PAIRS = graphlePairs(GL_N);
  const GL_POS = [];
  function layoutGraphle() {
    GL_N = graphleSize(activeDate);
    GL_PAIRS = graphlePairs(GL_N);
    GL_POS.length = 0;
    for (let i = 0; i < GL_N; i++) {
      const a = (2 * Math.PI * i) / GL_N - Math.PI / 2;
      GL_POS.push([170 + 118 * Math.cos(a), 170 + 118 * Math.sin(a)]);
    }
  }
  layoutGraphle();
  const glEdgesFromMask = (mask: number) => graphleEdges(mask, GL_N);
  const glProps = (edges: number[][]) => graphleProps(edges, GL_N);
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
  const genGraphleTarget = generateGraphleTarget;

  let GL_TARGET = genGraphleTarget(activeDate);
  let GL_TPROPS = glProps(glEdgesFromMask(GL_TARGET));
  const graphleSvg = document.getElementById("graphleSvg");
  const graphleMeta = document.getElementById("graphleMeta");
  const graphleDraft = document.getElementById("graphleDraft");
  const graphleHist = document.getElementById("graphleHist");
  const graphleMsg = document.getElementById("graphleMsg");
  const graphleGuessBtn = document.getElementById("graphleGuess") as HTMLButtonElement;
  let glDraft = new Set<string>(); // "u-v" with u < v
  let glPending = -1;   // the dot a chain is currently drawing from
  const glTap = bindEdgeDrawing(graphleSvg, {
    done: () => Boolean(glDone),
    pending: () => glPending,
    setPending: (v: number) => { glPending = v; },
    toggle: (a: number, b: number) => {
      const k = Math.min(a, b) + "-" + Math.max(a, b);
      if (glDraft.has(k)) glDraft.delete(k); else glDraft.add(k);
    },
    repaint: () => paintGraphle(),
  });
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
        l.setAttribute("x1", String(x1)); l.setAttribute("y1", String(y1));
        l.setAttribute("x2", String(x2)); l.setAttribute("y2", String(y2));
        graphleSvg.appendChild(l);
      }
    });
    for (let i = 0; i < GL_N; i++) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", String(GL_POS[i][0])); c.setAttribute("cy", String(GL_POS[i][1]));
      c.setAttribute("r", "19");
      c.setAttribute("class", "node" + (i === glPending ? " pending" : ""));
      c.setAttribute("role", "button");
      c.setAttribute("tabindex", "0");
      c.setAttribute("aria-label", "Dot " + (i + 1) + (i === glPending ? ", selected" : ""));
      c.style.fill = "#eef1e8";
      c.dataset.v = String(i);
      c.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); glTap(i); }
      });
      graphleSvg.appendChild(c);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", String(GL_POS[i][0])); t.setAttribute("y", String(GL_POS[i][1] + 4));
      t.setAttribute("text-anchor", "middle");
      t.textContent = String(i + 1);
      t.style.fill = "#5c6650";
      graphleSvg.appendChild(t);
    }
    graphleDraft.textContent = glDraftStats();
    paintGraphleMeta();
  }
  function paintGraphleMeta() {
    const left = GL_TRIES - glGuesses.length;
    graphleMeta.innerHTML = glDone === "won" ? "Solved!" :
      glDone === "lost" ? "Out of tries." :
      GL_N + " vertices · Guess <b>" + (glGuesses.length + 1) + "</b>/" + GL_TRIES;
    graphleGuessBtn.style.opacity = glDone || !left ? "0.4" : "1";
    graphleGuessBtn.disabled = Boolean(glDone || !left);
  }
  function graphMiniSvg(mask, pairs, pos) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 340 340");
    svg.setAttribute("class", "mini");
    pairs.forEach(([u, v], i) => {
      if (!(mask & (1 << i))) return;
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", String(pos[u][0])); l.setAttribute("y1", String(pos[u][1]));
      l.setAttribute("x2", String(pos[v][0])); l.setAttribute("y2", String(pos[v][1]));
      l.setAttribute("stroke", "#9aa78f");
      l.setAttribute("stroke-width", "12");
      l.setAttribute("stroke-linecap", "round");
      svg.appendChild(l);
    });
    for (let i = 0; i < pos.length; i++) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", String(pos[i][0])); c.setAttribute("cy", String(pos[i][1]));
      c.setAttribute("r", "26");
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
  function glAddHistRow(mask, tiles, prefix = "") {
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
      reportResult("graphle", String(glGuesses.length), true);
    } else if (glGuesses.length >= GL_TRIES) {
      glDone = "lost";
      saveGraphle();
      graphleMsg.textContent = "Out of tries — the answer is revealed below.";
      graphleMsg.className = "msg bad";
      glRevealTarget();
      reportResult("graphle", "X", true);
    } else {
      saveGraphle();
    }
    paintGraphle();
  };
  document.getElementById("graphleShare").onclick = () => {
    const emo = { "g-green": "🟩", "g-yellow": "🟨", "g-gray": "⬛" };
    const lines = glGuesses.map((g) => g.tiles.map((t) => emo[t.cls]).join(""));
    const score = glDone === "won" ? glGuesses.length + "/" + GL_TRIES : "X/" + GL_TRIES;
    shareText("HardMode · Graphle " + activeDate + "\n" + lines.join("\n") + "\n" + score + "\n" + shareLink());
  };
  function saveGraphle() {
    try {
      localStorage.setItem(dailyStoreKey(activeDate, "graphle"), JSON.stringify({
        masks: glGuesses.map((g) => g.mask),
        solved: glDone === "won",
        lost: glDone === "lost",
      }));
    } catch (_) {}
  }
  function loadGraphle() {
    try {
      const d = JSON.parse(localStorage.getItem(dailyStoreKey(activeDate, "graphle")) || "null");
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
    layoutGraphle();
    GL_TARGET = genGraphleTarget(activeDate);
    GL_TPROPS = glProps(glEdgesFromMask(GL_TARGET));
    glDraft = new Set<string>();
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
  const TR_PAIRS = TREEDLE_PAIRS;
  const TR_POS = [];
  for (let i = 0; i < TR_N; i++) {
    const a = (2 * Math.PI * i) / TR_N - Math.PI / 2;
    TR_POS.push([170 + 118 * Math.cos(a), 170 + 118 * Math.sin(a)]);
  }
  const trEdgesFromMask = treedleEdges;
  const trProps = treedleProps;
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
  const genTreedleTarget = generateTreedleTarget;

  let TR_TARGET = genTreedleTarget(activeDate);
  let TR_TPROPS = trProps(trEdgesFromMask(TR_TARGET));
  const treedleSvg = document.getElementById("treedleSvg");
  const treedleMeta = document.getElementById("treedleMeta");
  const treedleDraft = document.getElementById("treedleDraft");
  const treedleHist = document.getElementById("treedleHist");
  const treedleMsg = document.getElementById("treedleMsg");
  const treedleGuessBtn = document.getElementById("treedleGuess") as HTMLButtonElement;
  let trDraft = new Set<string>(); // "u-v" with u < v
  let trPending = -1;   // the dot a chain is currently drawing from
  const trTap = bindEdgeDrawing(treedleSvg, {
    done: () => Boolean(trDone),
    pending: () => trPending,
    setPending: (v: number) => { trPending = v; },
    toggle: (a: number, b: number) => {
      const k = Math.min(a, b) + "-" + Math.max(a, b);
      if (trDraft.has(k)) trDraft.delete(k); else trDraft.add(k);
    },
    repaint: () => paintTreedle(),
  });
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
        l.setAttribute("x1", String(x1)); l.setAttribute("y1", String(y1));
        l.setAttribute("x2", String(x2)); l.setAttribute("y2", String(y2));
        treedleSvg.appendChild(l);
      }
    });
    for (let i = 0; i < TR_N; i++) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", String(TR_POS[i][0])); c.setAttribute("cy", String(TR_POS[i][1]));
      c.setAttribute("r", "19");
      c.setAttribute("class", "node" + (i === trPending ? " pending" : ""));
      c.setAttribute("role", "button");
      c.setAttribute("tabindex", "0");
      c.setAttribute("aria-label", "Dot " + (i + 1) + (i === trPending ? ", selected" : ""));
      c.style.fill = "#eef1e8";
      c.dataset.v = String(i);
      c.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); trTap(i); }
      });
      treedleSvg.appendChild(c);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", String(TR_POS[i][0])); t.setAttribute("y", String(TR_POS[i][1] + 4));
      t.setAttribute("text-anchor", "middle");
      t.textContent = String(i + 1);
      t.style.fill = "#5c6650";
      treedleSvg.appendChild(t);
    }
    treedleDraft.textContent = trDraftStats();
    paintTreedleMeta();
  }
  function paintTreedleMeta() {
    const left = TR_TRIES - trGuesses.length;
    treedleMeta.innerHTML = trDone === "won" ? "Solved!" :
      trDone === "lost" ? "Out of tries." :
      "Guess <b>" + (trGuesses.length + 1) + "</b>/" + TR_TRIES;
    treedleGuessBtn.style.opacity = trDone || !left ? "0.4" : "1";
    treedleGuessBtn.disabled = Boolean(trDone || !left);
  }
  function trAddHistRow(mask, tiles, prefix = "") {
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
      reportResult("treedle", String(trGuesses.length), true);
    } else if (trGuesses.length >= TR_TRIES) {
      trDone = "lost";
      saveTreedle();
      treedleMsg.textContent = "Out of tries — the answer is revealed below.";
      treedleMsg.className = "msg bad";
      trRevealTarget();
      reportResult("treedle", "X", true);
    } else {
      saveTreedle();
    }
    paintTreedle();
  };
  document.getElementById("treedleShare").onclick = () => {
    const emo = { "g-green": "🟩", "g-yellow": "🟨", "g-gray": "⬛" };
    const lines = trGuesses.map((g) => g.tiles.map((t) => emo[t.cls]).join(""));
    const score = trDone === "won" ? trGuesses.length + "/" + TR_TRIES : "X/" + TR_TRIES;
    shareText("HardMode · Treedle " + activeDate + "\n" + lines.join("\n") + "\n" + score + "\n" + shareLink());
  };
  function saveTreedle() {
    try {
      localStorage.setItem(dailyStoreKey(activeDate, "treedle"), JSON.stringify({
        masks: trGuesses.map((g) => g.mask),
        solved: trDone === "won",
        lost: trDone === "lost",
      }));
    } catch (_) {}
  }
  function loadTreedle() {
    try {
      const d = JSON.parse(localStorage.getItem(dailyStoreKey(activeDate, "treedle")) || "null");
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
    trDraft = new Set<string>();
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
  const archiveDate = document.getElementById("archiveDate") as HTMLInputElement;
  const prevBtn = document.getElementById("prevDay") as HTMLButtonElement;
  const nextBtn = document.getElementById("nextDay") as HTMLButtonElement;

  function isSolved(key, game) {
    try {
      const d = JSON.parse(localStorage.getItem(dailyStoreKey(key, game)) || "null");
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
    prevBtn.style.opacity = prevBtn.disabled ? "0.4" : "1";
    nextBtn.style.opacity = nextBtn.disabled ? "0.4" : "1";
    archiveList.innerHTML = "";
    const solvedToday = GAMES.filter((game) => isSolved(activeDate, game)).length;
    const progress = document.getElementById("todayProgress");
    progress.querySelector("span").textContent = activeDate === TODAY_REAL ? "Today" : "Selected";
    progress.querySelector("strong").textContent = solvedToday + " / 4";
    const puzzleTabs = [tabS, tabC, tabG, tabT];
    puzzleTabs.forEach((tab, index) => {
      const done = isSolved(activeDate, GAMES[index]);
      tab.classList.toggle("done", done);
      tab.setAttribute("aria-label", tab.textContent.trim() + (done ? ", solved" : ", not solved"));
    });
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
      const d = JSON.parse(localStorage.getItem(dailyStoreKey(activeDate, "steiner")) || "null");
      if (d && d.solved) { const c = steinerConnectivity(); if (c.allConnected) checkSteiner(false); }
    } catch (_) {}
    // rebuild color
    G = genGraph(activeDate);
    CN = G.n;
    resetColoring();
    resetTally();
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
    for (const g of GAMES) delete myBucket[g];
    statsCache = null;
    drawAllResults();
    loadStats(activeDate).then(drawAllResults);
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
      const walls = new Set<string>((d.walls || []).map(([r, c]) => r + "," + c));
      for (const k of termSet) if (walls.has(k)) return null;
      const special = new Map<string, any>();
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
      const target = solveSteinerExact(N, terms, walls, special, portalPairs);
      if (!Number.isFinite(target)) return null;
      return { game: "steiner", data: { N, terms, termSet, walls, special, portalPairs, target } };
    }
    const d = obj.data;
    const n = d.n | 0;
    if (!(n >= 5 && n <= 10) || !Array.isArray(d.edges)) return null;
    const seen = new Set<string>(), edges: Edge[] = [];
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
  const edWalls = new Set<string>();
  const edSpecial = new Map<string, any>();
  const edCells = new Map<string, HTMLElement>();
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
      const target = solveSteinerExact(d.N, d.terms, d.walls, d.special, d.portalPairs);
      s += Number.isFinite(target) ? " · target <b>" + target + "</b> (exact)" : " · unsolvable shape";
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
      d.dataset.r = String(r); d.dataset.c = String(c);
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
    const t = (e.target as Element).closest(".cell") as HTMLElement | null;
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
    const t = el?.closest(".cell") as HTMLElement | null;
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
    const target = solveSteinerExact(d.N, d.terms, d.walls, d.special, d.portalPairs);
    if (!Number.isFinite(target)) return edMsg("No valid network — check the layout.", false);
    enterCustom("steiner", { id: "playtest", name: "Playtest", data: { ...d, target } });
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
  let edEdges = new Set<string>(); // "u-v" with u < v
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
        l.setAttribute("x1", String(x1)); l.setAttribute("y1", String(y1));
        l.setAttribute("x2", String(x2)); l.setAttribute("y2", String(y2));
        editorSvg.appendChild(l);
      }
    });
    for (let i = 0; i < edN; i++) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", String(edPos[i][0])); c.setAttribute("cy", String(edPos[i][1]));
      c.setAttribute("r", "19");
      c.setAttribute("class", "node" + (i === edPending ? " pending" : ""));
      c.style.fill = "#eef1e8";
      c.dataset.v = String(i);
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
      t.setAttribute("x", String(edPos[i][0])); t.setAttribute("y", String(edPos[i][1] + 4));
      t.setAttribute("text-anchor", "middle");
      t.textContent = String(i + 1);
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
      const sub = !v ? "broken" : entry.game === "steiner" ? "target " + v.data.target : "χ " + v.data.chi + " · " + v.data.edges.length + " edges";
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
      S = { terms: d.terms, termSet: d.termSet, walls: d.walls, special: d.special, portalPairs: d.portalPairs, target: d.target, kind: "custom" };
      sel.clear();
      buildGrid(); loadSteiner(); paintSteiner();
      steinerMsg.textContent = ""; steinerMsg.className = "msg";
      try {
        const s = JSON.parse(localStorage.getItem(storeKey("steiner")) || "null");
        if (s && s.solved) { const c = steinerConnectivity(); if (c.allConnected) checkSteiner(false); }
      } catch (_) {}
      document.getElementById("steinerCustomName").textContent = session.name;
    } else {
      showView("color");
      colorCustomBar.classList.remove("hidden");
      steinerCustomBar.classList.add("hidden");
      colorTutBox.classList.add("hidden");
      const d = session.data;
      G = { edges: d.edges, chi: d.chi, pos: d.pos, n: d.n, kind: "custom", labels: null, locked: null };
      CN = G.n;
      resetColoring();
      resetTally();
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
    } else {
      showView("color");
      colorTutBox.classList.remove("hidden");
      steinerTutBox.classList.add("hidden");
      G = tutorialGraph();
      CN = G.n;
      resetColoring();
      resetTally();
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
    if (s && Object.prototype.hasOwnProperty.call(THEMES, s)) __initTheme = s;
  } catch (_) {}
  setTheme(__initTheme);
  buildGrid(); loadSteiner(); paintSteiner();
  loadColor(); refreshColor();
  rebuildGraphle();
  rebuildTreedle();
  // re-assert solved banners after load
  try {
    const d = JSON.parse(localStorage.getItem(dailyStoreKey(activeDate, "steiner")) || "null");
    if (d && d.solved) { const c = steinerConnectivity(); if (c.allConnected) checkSteiner(false); }
  } catch (_) {}
  // Pull today's numbers in the background; the page is already usable.
  loadStats(activeDate).then(drawAllResults);
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
