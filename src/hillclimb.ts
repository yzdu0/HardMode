/* HardMode — HillClimb.
 *
 * The world lives in hillclimb-world.ts; everything here is the expedition:
 * where you have been, what you could see from there, and what it added up to.
 *
 * The rules of a run live in hillclimb-run.ts, which is where the arithmetic
 * is tested. This file draws it. */
import {
  generateWorld, BIOMES, W, H, MOVES, STRIDE, SIGHT, GRAIN, HILLCLIMB_REVISION,
  idx, rowOf, colOf, wrapC, latOf, windName, windDir,
} from "./hillclimb-world";
import { newRun, runState } from "./hillclimb-run";
import { LAYERS, pixelsFor, ramp, hex, HEIGHT_LAND, TEMP, TEMP_LOW, TEMP_HIGH, RAIN } from "./hillclimb-layers";
import type { Layer } from "./hillclimb-layers";
import type { World } from "./hillclimb-world";
import type { Run, RunState } from "./hillclimb-run";

(function () {
  "use strict";

  // ---------- dates ----------
  function todayKey(d: Date = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function addDays(key: string, n: number) {
    const [y, m, d] = key.split("-").map(Number);
    const at = new Date(y, m - 1, d);
    at.setDate(at.getDate() + n);
    return todayKey(at);
  }
  function shortLabel(key: string) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const [, m, d] = key.split("-").map(Number);
    return months[m - 1] + " " + d;
  }
  function longLabel(key: string) {
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const [y, m, d] = key.split("-").map(Number);
    return d + " " + months[m - 1] + " " + y;
  }
  const TODAY = todayKey();
  const OLDEST = addDays(TODAY, -89);
  let day = TODAY;

  const $ = (id: string) => document.getElementById(id);
  const storeKey = () => "hm-" + day + "-hillclimb-" + HILLCLIMB_REVISION;

  // ---------- theme ----------
  const THEMES = {
    light: { id: "themeLight", bar: "#f5f6f8", dark: false },
    dark: { id: "themeDark", bar: "#0b0d13", dark: true },
    minimal: { id: "themeMinimal", bar: "#ffffff", dark: false },
    moss: { id: "themeMoss", bar: "#f2f4e8", dark: false },
    terminal: { id: "themeTerminal", bar: "#030806", dark: true },
  };
  const themeBar = document.querySelector('meta[name="theme-color"]');
  let darkMap = false;
  function setTheme(t: string) {
    if (!Object.prototype.hasOwnProperty.call(THEMES, t)) t = "light";
    if (t === "light") delete document.body.dataset.theme;
    else document.body.dataset.theme = t;
    try { localStorage.setItem("hm-theme", t); } catch (_) {}
    if (themeBar) themeBar.setAttribute("content", THEMES[t].bar);
    for (const k of Object.keys(THEMES)) $(THEMES[k].id).classList.toggle("active", k === t);
    darkMap = THEMES[t].dark;
    if (world) { buildPixels(); paint(); refresh(); }
  }
  for (const k of Object.keys(THEMES)) $(THEMES[k].id).onclick = () => setTheme(k);

  // ---------- run state ----------
  let world: World = null;
  let run: Run = null;
  let now: RunState = null;           // recomputed after every change, never stored
  let seen: Uint8Array = null;        // ground the expedition has actually looked at
  // The closing reveal. Every square gets a moment at which its fog lifts,
  // measured out from the walk itself, so the world unfolds from what you know
  // rather than switching on all at once. `front` past 1 means it is all out.
  let liftAt: Float32Array = null;
  let front = 0;
  const SOFT = 0.14;                  // how wide the lifting edge is
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let hintsOpen = false;              // the "where to look" panel, across redraws
  // What the revealed map is showing. Only offered once the run is over: the
  // height and the rainfall are the answers, not the question.
  let layer: Layer = "biome";

  const at = () => run.path[run.path.length - 1];
  const settle = () => { now = runState(world, run); };
  /** The landmarks that ever came up: reached, plus the pair still open. */
  const shownGoals = () => [...now.found, ...now.live];

  /** Everything within sight of any stop. Recomputed from the path, never
   *  stored, so an old save can never disagree with today's world. */
  function reveal() {
    seen = new Uint8Array(W * H);
    for (const stop of run.path) light(stop);
  }
  function light(stop: number) {
    const sr = rowOf(stop), sc = colOf(stop);
    for (let dr = -SIGHT; dr <= SIGHT; dr++) {
      const r = sr + dr;
      if (r < 0 || r >= H) continue;
      for (let dc = -SIGHT; dc <= SIGHT; dc++) {
        if (dr * dr + dc * dc > SIGHT * SIGHT + SIGHT) continue;   // a disc, not a box
        seen[idx(r, wrapC(sc + dc))] = 1;
      }
    }
  }

  // ---------- map ----------
  /** How far each square is from the nearest place the walk stopped, scaled to
   *  0..1. Chebyshev, so the front comes out square-ish and even; the east-west
   *  wrap is honoured so it does not stall at the seam. */
  function measureLift() {
    const dist = new Int32Array(W * H).fill(-1);
    let edge: number[] = [...new Set(run.path)];
    for (const i of edge) dist[i] = 0;
    let d = 0, far = 0;
    while (edge.length) {
      const next: number[] = [];
      d++;
      for (const i of edge) {
        const r = rowOf(i), c = colOf(i);
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          if (rr < 0 || rr >= H) continue;
          const j = idx(rr, wrapC(c + dc));
          if (dist[j] < 0) { dist[j] = d; next.push(j); far = d; }
        }
      }
      edge = next;
    }
    liftAt = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) liftAt[i] = far ? Math.max(0, dist[i]) / far : 0;
  }

  const canvas = $("hcMap") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d");
  const tile = document.createElement("canvas");
  tile.width = W; tile.height = H;
  const tileCtx = tile.getContext("2d");
  let pixels: Uint8ClampedArray = null;    // rgb per square, before the fog

  const hex = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const FOG_LIGHT = hex("#e8eaef"), FOG_DARK = hex("#171b24");

  /** The flat biome colour, shaded by how high the ground is and by which way
   *  the slope faces. Relief is what a climber reads, and a fifteen-colour
   *  palette cannot carry it on its own. */
  function buildPixels() {
    pixels = pixelsFor(world, run && run.stopped ? layer : "biome", darkMap);
  }

  function sizeCanvas() {
    const wide = canvas.parentElement.clientWidth || 640;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.height = Math.round((wide * H) / W) + "px";
    canvas.width = Math.round(wide * dpr);
    canvas.height = Math.round(((wide * H) / W) * dpr);
  }

  function paint() {
    if (!world) return;
    sizeCanvas();
    const fog = darkMap ? FOG_DARK : FOG_LIGHT;
    const img = tileCtx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      // 1 where the ground is known, 0 where it is fog, and in between along
      // the edge of the reveal — which is what stops it looking like a switch.
      const k = seen[i] ? 1
        : !liftAt ? 0
        : Math.max(0, Math.min(1, (front - liftAt[i]) / SOFT));
      for (let ch = 0; ch < 3; ch++) {
        img.data[i * 4 + ch] = fog[ch] + (pixels[i * 3 + ch] - fog[ch]) * k;
      }
      img.data[i * 4 + 3] = 255;
    }
    tileCtx.putImageData(img, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tile, 0, 0, canvas.width, canvas.height);

    const cell = canvas.width / W;
    // Furniture is sized in world units rather than squares, so raising the
    // map's resolution sharpens the ground without shrinking the trail, the
    // markers or the latitude labels drawn over it.
    const unit = cell * GRAIN;
    const x = (c: number) => (c + 0.5) * cell;
    const y = (r: number) => (r + 0.5) * cell;
    const ink = darkMap ? "#f4f7fa" : "#101114";
    const back = darkMap ? "#0b0d13" : "#ffffff";

    // Latitude is the one thing you are never in the dark about, and on this
    // world it is most of the reasoning: the equator is where the rainforest
    // is, thirty is where the deserts are, and the bands are where the wind
    // changes direction. So the guides are drawn over the fog as well as over
    // the ground, and they are the only furniture on the map.
    ctx.font = "600 " + Math.max(9, Math.round(unit * 2.6)) + "px -apple-system, Helvetica, Arial, sans-serif";
    ctx.textBaseline = "middle";
    for (const lat of [60, 30, 0, -30, -60]) {
      const gy = ((90 - lat) / 180) * canvas.height;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = lat === 0 ? 0.2 : 0.13;
      ctx.lineWidth = 1;
      ctx.setLineDash(lat === 0 ? [6, 5] : [3, 6]);
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = ink;
      ctx.textAlign = "left";
      ctx.fillText(lat === 0 ? "0°" : Math.abs(lat) + "°" + (lat > 0 ? "N" : "S"), unit * 1.2, gy - unit * 2);
    }
    ctx.globalAlpha = 1;

    /* The walk: one translucent line, so the route shows without hiding the
       ground it crosses. A leg over the seam is drawn a second time running
       off the far side, so the line never shoots back across the whole world. */
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(2, unit * 0.42);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let k = 1; k < run.path.length; k++) {
      const a = run.path[k - 1], b = run.path[k];
      let dc = colOf(b) - colOf(a);
      if (dc > W / 2) dc -= W;
      if (dc < -W / 2) dc += W;
      const end = colOf(a) + dc;
      for (const shift of end < 0 ? [0, W] : end >= W ? [0, -W] : [0]) {
        ctx.beginPath();
        ctx.moveTo(x(colOf(a) + shift), y(rowOf(a)));
        ctx.lineTo(x(end + shift), y(rowOf(b)));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    const mark = (i: number, glyph: string, fill: string, ring: string) => {
      const cx = x(colOf(i)), cy = y(rowOf(i)), rad = Math.max(4, unit * 1.5);
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = Math.max(1.4, unit * 0.35); ctx.strokeStyle = ring; ctx.stroke();
      if (glyph) {
        ctx.fillStyle = ring;
        ctx.font = "700 " + Math.round(rad * 1.5) + "px -apple-system, Helvetica, Arial, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(glyph, cx, cy + rad * 0.06);
      }
    };

    if (run.stopped && front >= 1) {
      /* Only worth drawing once it is all visible: the landmarks that were on
         the table, and where the summit you were aiming at turned out to sit.
         The pool runs deeper than the day does, and marking landmarks that
         never came up would mark the player down for missing what they were
         never shown. */
      const held = new Set(now.found);
      for (const g of shownGoals()) {
        const { cells } = world.goals[g];
        const good = held.has(g);
        // Small ones get a tint so an island or a lake is not just four lines.
        // A landmark the size of a continent needs no help being found, and a
        // wash that size would only recolour the terrain under it.
        if (cells.size <= 260) {
          ctx.fillStyle = good
            ? (darkMap ? "rgba(120,220,150,.18)" : "rgba(47,125,50,.15)")
            : (darkMap ? "rgba(255,120,60,.18)" : "rgba(214,69,69,.15)");
          for (const i of cells) ctx.fillRect(colOf(i) * cell, rowOf(i) * cell, cell, cell);
        }
        ctx.strokeStyle = good ? (darkMap ? "#7fdca0" : "#2f7d32") : (darkMap ? "#ff9a63" : "#c23b3b");
        ctx.lineWidth = Math.max(1.2, unit * 0.26);
        ctx.beginPath();
        for (const i of cells) {
          const r = rowOf(i), c = colOf(i);
          const px = c * cell, py = r * cell;
          // Only the sides facing out of the landmark, so what is left is its
          // coastline rather than a grid drawn over it.
          if (r === 0 || !cells.has(idx(r - 1, c))) { ctx.moveTo(px, py); ctx.lineTo(px + cell, py); }
          if (r === H - 1 || !cells.has(idx(r + 1, c))) { ctx.moveTo(px, py + cell); ctx.lineTo(px + cell, py + cell); }
          if (!cells.has(idx(r, wrapC(c - 1)))) { ctx.moveTo(px, py); ctx.lineTo(px, py + cell); }
          if (!cells.has(idx(r, wrapC(c + 1)))) { ctx.moveTo(px + cell, py); ctx.lineTo(px + cell, py + cell); }
        }
        ctx.stroke();
      }
      mark(world.summit, "▲", back, ink);
    }
    mark(run.path[0], "", back, darkMap ? "#7fa8ff" : "#3157d5");
    mark(at(), "", ink, back);
  }

  /* Once the run is over, the map can show what it was made of rather than
     only what it came to: the height the biomes sit on, the temperature and
     the rainfall that chose them, or the biomes with the relief shading off,
     which is the only way to see a climate belt as a belt. Offered at the end
     and not before, because these are the answers. */
  function drawLayers() {
    const box = $("hcLayers");
    box.classList.toggle("hidden", !run.stopped);
    $("hcScale").classList.toggle("hidden", !run.stopped || layer === "biome" || layer === "flat");
    if (!run.stopped) return;
    box.innerHTML = LAYERS.map(l =>
      "<button class='hclayer" + (l.id === layer ? " on" : "") + "' data-layer='" + l.id + "'" +
      " aria-pressed='" + (l.id === layer) + "'>" + l.name + "</button>").join("");
    box.querySelectorAll("button").forEach(b => {
      (b as HTMLButtonElement).onclick = () => {
        layer = (b as HTMLElement).dataset.layer as Layer;
        buildPixels();
        drawLayers();
        paint();
      };
    });
    if (layer === "biome" || layer === "flat") return;
    // A bar of the ramp itself, with the two ends named. A temperature map is
    // unreadable without one.
    const [stops, lo, hi] =
      layer === "height" ? [HEIGHT_LAND, "sea level", metresLabel(world.summitM)]
      : layer === "temp" ? [TEMP, TEMP_LOW + "°C", TEMP_HIGH + "°C"]
      : [RAIN, "driest", "wettest"];
    const bar = (stops as string[]).map((c, k) =>
      c + " " + Math.round((k / ((stops as string[]).length - 1)) * 100) + "%").join(", ");
    $("hcScale").innerHTML = "<span>" + lo + "</span><i style='background:linear-gradient(to right," +
      bar + ")'></i><span>" + hi + "</span>";
  }

  /* What is under the pointer, named where the pointer is. It replaces the
     legend that used to sit under the map: fifteen colours listed at once is a
     lot to read, and only one of them is ever the square being asked about.
     Fogged ground stays fogged — the map must not answer a question the walk
     has not earned. */
  const tip = $("hcTip");
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;          // a tap is a move, not a query
    const box = canvas.getBoundingClientRect();
    const c = Math.floor(((e.clientX - box.left) / box.width) * W);
    const r = Math.floor(((e.clientY - box.top) / box.height) * H);
    if (r < 0 || r >= H || c < 0 || c >= W) { tip.classList.add("hidden"); return; }
    const i = idx(r, c);
    if (!(run.stopped || seen[i])) tip.textContent = "unexplored";
    else {
      // On the revealed map the outlines are the only thing left unlabelled,
      // so the pointer is what names them.
      const goal = run.stopped ? shownGoals().find(g => world.goals[g].cells.has(i)) : undefined;
      // Say the number the map is currently drawn from, not always the biome.
      const reading =
        layer === "height" ? (world.land[i] ? metresLabel(world.metres[i]) : "sea, " + Math.round(world.depth[i] * 100) + "% deep")
        : layer === "temp" ? Math.round(world.tempC[i]) + "°C"
        : layer === "rain" ? (world.land[i] ? "rainfall " + Math.round(world.rain[i] * 100) + "%" : "sea")
        : BIOMES[world.biome[i]].name + (world.land[i] ? " · " + metresLabel(world.metres[i]) : "");
      tip.textContent = reading + " · " + latLabel(r) +
        (goal === undefined ? "" :
          " · " + world.goals[goal].name + (now.found.includes(goal) ? ", reached" : ", missed"));
    }
    // Above the pointer, flipped below it near the top edge, and reined in at
    // the sides — the map clips its own overflow, so a label centred on a
    // pointer near the edge would lose its first half.
    tip.classList.remove("hidden");
    const half = tip.offsetWidth / 2 + 4;
    tip.style.left = Math.min(Math.max(e.clientX - box.left, half), box.width - half) + "px";
    tip.style.top = (e.clientY - box.top) + "px";
    tip.classList.toggle("under", e.clientY - box.top < 34);
  });
  canvas.addEventListener("pointerleave", () => tip.classList.add("hidden"));

  // ---------- readout ----------
  const metresLabel = (m: number) => m.toLocaleString("en-GB") + " m";
  function latLabel(r: number) {
    const lat = latOf(r);
    return Math.abs(Math.round(lat)) + "° " + (lat >= 0 ? "N" : "S");
  }
  function refresh() {
    const here = at();
    const lat = latOf(rowOf(here));
    const water = !world.land[here];
    const rows: [string, string][] = [
      ["Standing on", BIOMES[world.biome[here]].name],
      ["Altitude", water ? "at sea level" : metresLabel(world.metres[here])],
      ["Latitude", latLabel(rowOf(here))],
      ["Wind", windName(lat) + ", blowing " + (windDir(lat) > 0 ? "east" : "west")],
    ];
    $("hcRead").innerHTML = rows.map(([k, v]) =>
      "<div class='hcstat'><span>" + k + "</span><strong>" + v + "</strong></div>").join("");
    // The move count is the one number a player has to be able to find without
    // looking for it, so it sits full width between the brief and the map. Every
    // other figure on this page appears exactly once: the climb and the
    // landmarks in the brief, the ground underfoot in the strip below the map.
    const used = MOVES - now.movesLeft;
    $("hcMoves").innerHTML = run.stopped
      ? "<span class='hcmoves-n'>0</span><span class='hcmoves-label'>moves left · run over</span>" +
        "<span class='hcmoves-bar'><i style='width:0%'></i></span>"
      : "<span class='hcmoves-n'>" + now.movesLeft + "</span>" +
        "<span class='hcmoves-label'>" + (now.movesLeft === 1 ? "move left" : "moves left") + "</span>" +
        "<span class='hcmoves-bar'><i style='width:" + Math.round((now.movesLeft / MOVES) * 100) + "%'></i></span>";
    $("hcMoves").classList.toggle("low", !run.stopped && now.movesLeft <= 5);

    drawBrief();

    // Only the ground actually stood on: the list is a record of the walk, not
    // a table of contents for the planet.
    $("hcNotes").innerHTML =
      "<span class='hcnotes-head'>Field notes " + now.biomes.length + " / " + world.checklist.length + "</span>" +
      now.biomes.map(b =>
        "<span><i style='background:" + (darkMap ? BIOMES[b].dark : BIOMES[b].colour) + "'></i> " +
        BIOMES[b].name + "</span>").join("");

    drawLayers();
    canvas.classList.toggle("frozen", run.stopped);
    $("hcHint").classList.toggle("hidden", run.stopped);
    $("hcStop").classList.toggle("hidden", run.stopped);
    $("hcRestart").classList.toggle("hidden", !run.stopped);
  }

  /** What the day is actually asking for — the climb — and then, under it, the
   *  two landmarks on offer as a bonus. The note on where to look for each is
   *  folded away, because working out that a rainforest sits on the equator is
   *  the puzzle rather than the instructions. */
  function drawBrief() {
    const box = $("hcBrief");
    const held = new Set(now.found);
    // Ticked ones stay on the list so it reads as a checklist filling up, with
    // the two still open at the end of it. Once the run is over that same list
    // is the whole account: what was reached, and what was left out there.
    const listed = [...now.found, ...now.live];

    box.innerHTML =
      // Nothing above the score once it is over: the result line under the map
      // says it all, and the box becomes the scoreboard it was keeping anyway.
      (run.stopped ? "" : "<p class='hcbrief-line'><b>Climb as high as you can</b></p>") +
      "<div class='hcscore" + (run.stopped ? " bare" : "") + "'>" +
        "<div class='hcscore-peak'><span>Highest so far</span><strong>" + metresLabel(now.best) + "</strong></div>" +
        (listed.length
          ? "<div class='hcscore-marks'><span class='hcbrief-sub'>Landmarks (Bonus) · " +
            now.found.length + " of " + world.rungs + "</span>" +
            "<ul class='hcgoals'>" + listed.map(g =>
              "<li class='hcgoal" + (held.has(g) ? " on" : "") + "'>" + world.goals[g].name + "</li>").join("") +
            "</ul></div>"
          : "") +
      "</div>" +
      (run.stopped || !now.live.length ? "" :
        "<button id='hcWhere' class='linkbtn' aria-expanded='" + hintsOpen + "' aria-controls='hcWhereBox'>" +
        (hintsOpen ? "Hide where to look" : "Where to look") + "</button>" +
        "<div id='hcWhereBox' class='kindbox" + (hintsOpen ? "" : " hidden") + "'>" +
        now.live.map(g => "<p><b>" + world.goals[g].name + "</b> · " + world.goals[g].hint + "</p>").join("") +
        "</div>");

    const where = $("hcWhere");
    if (where) where.onclick = () => { hintsOpen = !hintsOpen; drawBrief(); };
  }

  /* Tapping the map is the whole control: point at where you want to be and
     you take one move of the stride towards it, snapped to the eight compass
     directions. It reads the same on a phone and a desktop, and it puts the
     decision on the map — which is the only thing worth looking at. */
  canvas.addEventListener("click", (e) => {
    if (run.stopped) return;
    const box = canvas.getBoundingClientRect();
    const c = Math.floor(((e.clientX - box.left) / box.width) * W);
    const r = Math.floor(((e.clientY - box.top) / box.height) * H);
    let dc = c - colOf(at());
    if (dc > W / 2) dc -= W;                 // the short way round the world
    if (dc < -W / 2) dc += W;
    const dr = r - rowOf(at());
    // Within half a stride of your own feet there is no direction being asked
    // for, so nothing happens rather than something arbitrary.
    if (Math.max(Math.abs(dr), Math.abs(dc)) < STRIDE / 2) return;
    // Snap to the nearest of the eight, by angle: a shallow tap away to the
    // east is east, not south-east, and only the middle of each 45° wedge
    // counts as a diagonal.
    const SPLIT = Math.tan((3 * Math.PI) / 8);          // 67.5°, the wedge edge
    const flat = Math.abs(dc) > SPLIT * Math.abs(dr);
    const steep = Math.abs(dr) > SPLIT * Math.abs(dc);
    step(flat ? 0 : Math.sign(dr), steep ? 0 : Math.sign(dc));
  });
  function step(dr: number, dc: number) {
    if (run.stopped || now.movesLeft <= 0) return;
    const here = at();
    // The poles are the end of the map, not a wrap: a move north from the top
    // row simply runs along it rather than being refused outright.
    const r = Math.max(0, Math.min(H - 1, rowOf(here) + dr * STRIDE));
    const c = wrapC(colOf(here) + dc * STRIDE);
    const next = idx(r, c);
    if (next === here) return;
    run.path.push(next);
    light(next);
    settle();
    if (now.movesLeft <= 0) finish(true);
    else { save(); paint(); refresh(); }
  }
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const map: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      w: [-1, 0], s: [1, 0], a: [0, -1], d: [0, 1],
      q: [-1, -1], e: [-1, 1], z: [1, -1], c: [1, 1],
      "8": [-1, 0], "2": [1, 0], "4": [0, -1], "6": [0, 1],
      "7": [-1, -1], "9": [-1, 1], "1": [1, -1], "3": [1, 1],
    };
    const move = map[e.key] || map[e.key.toLowerCase()];
    if (!move) return;
    e.preventDefault();
    step(move[0], move[1]);
  });

  // ---------- the end of a run ----------
  function verdict(share: number, found: boolean) {
    if (share >= 0.95) return "You stood on the roof of the world.";
    if (share >= 0.75) return "A serious summit. The true peak was barely above you.";
    if (share >= 0.5) return "Halfway up the planet. The high ground was further in than it looked.";
    if (share >= 0.25) return found ? "The budget went on the landmarks, and the mountains kept theirs." : "Low ground all the way. Next time follow the rising land rather than the coast.";
    return "Barely off the beach. The ranges sit inland; the coast will not take you up.";
  }
  function finish(fresh: boolean) {
    run.stopped = true;
    settle();
    save();
    buildPixels();
    measureLift();
    $("hcMsg").innerHTML =
      "<b>" + now.score + ", grade " + now.grade + "</b> · " + now.climb + " for " + metresLabel(now.best) +
      " of a " + metresLabel(world.summitM) + " summit, +" + now.landmarkBonus + " for " +
      now.found.length + " of " + world.rungs + " landmark" + (world.rungs === 1 ? "" : "s") + ", +" +
      now.biomeBonus + " for " + now.biomes.length + " of " + world.checklist.length + " biomes. " +
      verdict(now.peakShare, now.found.length > 0);
    // Only a run that got nowhere is worth painting as a failure; a middling
    // climb is still a climb, and the grade already says so.
    $("hcMsg").className = "msg" + (now.score >= 55 ? " good" : now.score < 35 ? " bad" : "");
    reportResult(now.grade, fresh);

    // A run restored from storage is already over and has been seen; only a
    // run that ends here and now gets the reveal and the card.
    if (!fresh || still()) { front = 1 + SOFT; paint(); refresh(); return; }
    front = 0;
    paint(); refresh();
    lift(() => showScore());
  }

  /**
   * Ease something from 0 to 1 over `span`, and land on the end state whatever
   * happens.
   *
   * requestAnimationFrame does not fire in a tab nobody is looking at, so an
   * animation left to it alone can stop halfway — which for the reveal would
   * mean coming back to a map still under fog with no way to clear it. The
   * timer is the guarantee; the frames are only what makes it pleasant.
   */
  function ease(span: number, onStep: (p: number) => void, then: () => void) {
    const began = performance.now();
    let over = false;
    const land = () => { if (over) return; over = true; onStep(1); then(); };
    const step = (at: number) => {
      if (over) return;
      const p = Math.min(1, (at - began) / span);
      onStep(1 - Math.pow(1 - p, 3));
      if (p < 1) requestAnimationFrame(step); else land();
    };
    requestAnimationFrame(step);
    setTimeout(land, span + 200);
  }

  /** The fog going out, quickly at first and settling at the edges. */
  function lift(then: () => void) {
    ease(1500, (p) => { front = p * (1 + SOFT); paint(); }, then);
  }

  /* The card. The number climbs before the grade lands on it, because a score
     you watch arrive is worth more than one that is simply there — and because
     the run itself was twenty-eight moves of not knowing. Everything else on
     it is three lines and two buttons. */
  const scoreBox = $("hcScoreBox") as HTMLDialogElement;
  function showScore() {
    $("hcScoreDay").textContent = "HillClimb · " + longLabel(day);
    // The arithmetic, so the number that just counted up can be read back off
    // the card: the climb, and what was picked up on the way to it.
    $("hcScoreRows").innerHTML = ([
      ["Climb", metresLabel(now.best) + " of " + metresLabel(world.summitM), String(now.climb)],
      ["Landmarks", now.found.length + " of " + world.rungs, "+" + now.landmarkBonus],
      ["Field notes", now.biomes.length + " of " + world.checklist.length, "+" + now.biomeBonus],
    ] as [string, string, string][]).map(([k, v, n]) =>
      "<dt>" + k + "</dt><dd>" + v + "</dd><dd class='scorebox-pts'>" + n + "</dd>").join("");
    $("hcScoreGrade").textContent = "Grade " + now.grade;
    scoreBox.classList.remove("settled");
    $("hcScoreN").textContent = still() ? String(now.score) : "0";
    if (typeof scoreBox.showModal === "function" && !scoreBox.open) scoreBox.showModal();
    if (still()) { scoreBox.classList.add("settled"); return; }
    ease(1200,
      (p) => { $("hcScoreN").textContent = String(Math.round(p * now.score)); },
      () => scoreBox.classList.add("settled"));   // the grade and the rows land
  }
  $("hcScoreDone").onclick = () => scoreBox.close();
  $("hcScoreShare").onclick = () => { scoreBox.close(); $("hcShare").click(); };
  scoreBox.addEventListener("pointerdown", (e) => { if (e.target === scoreBox) scoreBox.close(); });

  $("hcStop").onclick = () => { if (!run.stopped) finish(true); };
  // Clearing the day's record is what mints a new drop: start() takes its seed
  // from storage, so with nothing there it draws a fresh one and the planet is
  // rebuilt around a different landing.
  $("hcRestart").onclick = () => {
    try { localStorage.removeItem(storeKey()); } catch (_) {}
    scoreBox.close();
    start();
  };

  // ---------- storage ----------
  function save() {
    // The grade rides along with the run. The archive needs it for thirty days
    // at once, and working it out from scratch would mean generating thirty
    // planets to draw one row of buttons.
    const record = run.stopped ? { ...run, grade: now.grade, score: now.score } : run;
    try { localStorage.setItem(storeKey(), JSON.stringify(record)); } catch (_) {}
  }
  function saved(): any {
    try { return JSON.parse(localStorage.getItem(storeKey()) || "null"); } catch (_) { return null; }
  }
  /** Where this browser was dropped on this day. Everyone walks the same
   *  planet; the drop is the part that is yours, so it is kept with the run
   *  and the world is rebuilt around it rather than the other way about. */
  const DROP = /^[a-z0-9]{6,32}$/;
  function dropSeed(d: any): string {
    if (d && typeof d.seed === "string" && DROP.test(d.seed)) return d.seed;
    return Array.from({ length: 12 }, () =>
      "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
  }
  function adopt(d: any, seed: string): boolean {
    if (!d || !Array.isArray(d.path) || d.path[0] !== world.spawn) return false;
    // A path from a world that has since changed shape is worse than none.
    if (d.path.length > MOVES + 1 || d.path.some((i: unknown) => typeof i !== "number" || i < 0 || i >= W * H)) return false;
    run = { path: d.path, stopped: Boolean(d.stopped), seed };
    return true;
  }

  // ---------- the day's tally ----------
  const ORDER = ["S", "A", "B", "C", "D"];
  let statsOn = true;
  let mine: string = null;
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
  async function reportResult(bucket: string, fresh: boolean) {
    mine = bucket;
    if (!statsOn) return;
    if (fresh) {
      const player = playerId();
      if (player) {
        try {
          await fetch("/api/result", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ day, game: "hillclimb", bucket, player }),
          });
        } catch (_) { /* the run is already over; the tally is not worth an error */ }
      }
    }
    await drawResults();
  }
  async function drawResults() {
    const box = $("hcResults");
    let data: any = null;
    try {
      const res = await fetch("/api/stats?date=" + encodeURIComponent(day), { cache: "no-store" });
      if (res.ok) data = await res.json();
    } catch (_) { /* offline, or no database attached */ }
    const slot = data && data.enabled !== false && data.games ? data.games.hillclimb : null;
    if (!slot || !slot.total) { statsOn = Boolean(slot); box.classList.add("hidden"); return; }
    const most = Math.max(...ORDER.map(b => slot.buckets[b] || 0), 1);
    box.querySelector(".results-head").textContent =
      slot.total + (slot.total === 1 ? " player has" : " players have") + " finished today · grade";
    box.querySelector(".results-bars").innerHTML = ORDER.map(b => {
      const n = slot.buckets[b] || 0;
      return '<div class="results-row' + (mine === b ? " mine" : "") + '"><span>' + b +
        '</span><i style="width:' + Math.max(6, Math.round((n / most) * 100)) + '%">' + n + "</i></div>";
    }).join("");
    box.classList.remove("hidden");
  }

  // ---------- share ----------
  const shareBox = $("shareBox") as HTMLDialogElement;
  const shareBody = $("shareBody");
  let payload = "";
  async function copyShare() {
    try {
      await navigator.clipboard.writeText(payload);
      $("shareTitle").textContent = "Copied to clipboard";
      return true;
    } catch (_) {
      $("shareTitle").textContent = "Copy this to share";
      return false;
    }
  }
  async function openShare(text: string) {
    payload = text;
    shareBody.textContent = text;
    const copied = await copyShare();
    $("shareSend").classList.toggle("hidden", !navigator.share);
    if (typeof shareBox.showModal === "function") {
      if (!shareBox.open) shareBox.showModal();
      if (!copied) (shareBody as HTMLElement).focus();
    } else alert(text);
  }
  $("shareCopy").onclick = () => { copyShare(); };
  $("shareSend").onclick = async () => { try { await navigator.share({ text: payload }); } catch (_) {} };
  $("shareDone").onclick = () => shareBox.close();
  shareBox.addEventListener("pointerdown", (e) => { if (e.target === shareBox) shareBox.close(); });
  $("hcShare").onclick = () => {
    openShare(
      "HillClimb " + day + "\n" +
      now.score + " · grade " + now.grade + "\n" +
      "⛰ " + metresLabel(now.best) + " of " + metresLabel(world.summitM) + " · " + now.climb + "\n" +
      "🧭 " + now.found.length + "/" + world.rungs + " landmarks · +" + now.landmarkBonus + "\n" +
      "🗺 " + now.biomes.length + "/" + world.checklist.length + " biomes · +" + now.biomeBonus + "\n" +
      location.href.split("#")[0].split("?")[0]);
  };

  // ---------- help, dates, boot ----------
  $("hcHelpBtn").onclick = () => {
    const open = $("hcHelpBox").classList.toggle("hidden") === false;
    $("hcHelpBtn").setAttribute("aria-expanded", String(open));
  };
  /* The archive: a month of planets, and how each one went. A day already
     walked shows its grade, so the strip doubles as a record of the run of
     them rather than only a way to get back to one. */
  const archive = $("hcArchive");
  const archiveDate = $("hcArchiveDate") as HTMLInputElement;
  const ARCHIVE_DAYS = 30;
  function gradeOn(key: string): string {
    try {
      const d = JSON.parse(localStorage.getItem("hm-" + key + "-hillclimb-" + HILLCLIMB_REVISION) || "null");
      return d && d.stopped && typeof d.grade === "string" ? d.grade : "";
    } catch (_) { return ""; }
  }
  function renderArchive() {
    archiveDate.value = day;
    archiveDate.min = OLDEST;
    archiveDate.max = TODAY;
    archiveDate.setAttribute("aria-label", "Pick a day");
    const list = $("hcArchiveList");
    list.innerHTML = "";
    for (let i = 0; i < ARCHIVE_DAYS; i++) {
      const key = addDays(TODAY, -i);
      const grade = gradeOn(key);
      const b = document.createElement("button");
      b.className = "archive-item" + (key === day ? " current" : "");
      b.innerHTML = shortLabel(key) + "<br><span class='dot'>" + (grade || "·") + "</span>";
      b.title = longLabel(key) + (grade ? ", grade " + grade : ", not played");
      b.onclick = () => goTo(key);
      list.appendChild(b);
    }
  }
  function showArchive(open: boolean) {
    archive.classList.toggle("hidden", !open);
    $("hcDateBtn").setAttribute("aria-expanded", String(open));
    if (open) renderArchive();
  }
  function goTo(key: string) {
    if (key < OLDEST || key > TODAY) return;
    day = key;
    showArchive(false);
    start();
  }
  $("hcPrevDay").onclick = () => goTo(addDays(day, -1));
  $("hcNextDay").onclick = () => goTo(addDays(day, 1));
  $("hcDateBtn").onclick = () => showArchive(archive.classList.contains("hidden"));
  archiveDate.onchange = () => { if (archiveDate.value) goTo(archiveDate.value); };

  function start() {
    const stored = saved();
    const seed = dropSeed(stored);
    world = generateWorld(day, seed);
    layer = "biome";
    if (!adopt(stored, seed)) {
      run = newRun(world, seed);
      // Written before a single move, or a reload would draw a new drop and
      // move the player somewhere else on a planet they had started reading.
      save();
    }
    settle();
    reveal();
    liftAt = null;
    front = 0;
    buildPixels();
    $("hcDateLabel").textContent = day === TODAY ? "Today · " + longLabel(day) : longLabel(day);
    if (!archive.classList.contains("hidden")) renderArchive();
    ($("hcPrevDay") as HTMLButtonElement).disabled = day <= OLDEST;
    ($("hcNextDay") as HTMLButtonElement).disabled = day >= TODAY;
    $("hcMsg").textContent = ""; $("hcMsg").className = "msg";
    $("hcResults").classList.add("hidden");
    mine = null;
    paint(); refresh();
    if (run.stopped) finish(false); else drawResults();
  }

  let stored = "light";
  try { stored = localStorage.getItem("hm-theme") || "light"; } catch (_) {}
  setTheme(stored);
  start();
  let resizeTimer: number;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(paint, 120);
  });
})();
