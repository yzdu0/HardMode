/* HardMode — HillClimb.
 *
 * The world lives in HillClimb-world.ts; everything here is the expedition:
 * where you have been, what you could see from there, and what it added up to.
 *
 * The rules of a run live in HillClimb-run.ts, which is where the arithmetic
 * is tested. This file draws it. */
import {
  generateWorld, terrainAt, BIOMES, B, W, H, MOVES, STRIDE, SIGHT, HILLCLIMB_REVISION,
  idx, rowOf, colOf, wrapC, latOf, windName, windDir,
} from "./HillClimb-world";
import { gradeSquares, newRun, runState } from "./HillClimb-run";
import { LAYERS, pixelsFor, ramp, hex, HEIGHT_LAND, HEIGHT_SEA, TEMP, TEMP_LOW, TEMP_HIGH, RAIN } from "./HillClimb-layers";
import type { Layer } from "./HillClimb-layers";
import type { World } from "./HillClimb-world";
import type { Run, RunState } from "./HillClimb-run";

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
  // Production keeps the compact four-day archive. Local development exposes
  // a full month so terrain, climate and landmarks can be compared quickly.
  const LOCAL_TESTING = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const ACCESS_DAYS = LOCAL_TESTING ? 30 : 4;
  const TODAY = todayKey();
  const OLDEST = addDays(TODAY, -(ACCESS_DAYS - 1));
  let day = TODAY;

  const $ = (id: string) => document.getElementById(id);
  const storeKey = () => "hm-" + day + "-HillClimb-" + HILLCLIMB_REVISION;

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
  let viewCol = 0;                         // world column at the viewport's left edge
  let viewRow = 0;
  const ZOOM_LEVELS = [1, 2, 4, 8];
  let zoomIndex = 0;
  let detailSeed = 0;
  let pan: { pointer: number; x: number; y: number; col: number; row: number } = null;
  let dragged = false;

  const zoom = () => ZOOM_LEVELS[zoomIndex];
  const visibleCols = () => W / zoom();
  const visibleRows = () => H / zoom();
  const clampViewRow = (r: number) => Math.max(0, Math.min(H - visibleRows(), r));

  function updateZoomControls() {
    $("hcZoomLabel").textContent = zoom() + "×";
    ($("hcZoomOut") as HTMLButtonElement).disabled = zoomIndex === 0;
    ($("hcZoomIn") as HTMLButtonElement).disabled = zoomIndex === ZOOM_LEVELS.length - 1;
    ($("hcZoomFit") as HTMLButtonElement).disabled = zoomIndex === 0;
  }

  /** Keep the point under the cursor fixed while a wheel zooms. The buttons
   *  have no cursor position, so they centre the closer view on the player. */
  function setZoom(next: number, focus?: { x: number; y: number }) {
    const nextIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, next));
    if (nextIndex === zoomIndex) return;
    const oldCols = visibleCols(), oldRows = visibleRows();
    const fx = focus ? Math.max(0, Math.min(1, focus.x)) : 0.5;
    const fy = focus ? Math.max(0, Math.min(1, focus.y)) : 0.5;
    const focusCol = focus ? viewCol + fx * oldCols : colOf(at()) + 0.5;
    const focusRow = focus ? viewRow + fy * oldRows : rowOf(at()) + 0.5;
    zoomIndex = nextIndex;
    viewCol = wrapC(focusCol - fx * visibleCols());
    viewRow = clampViewRow(focusRow - fy * visibleRows());
    updateZoomControls();
    paint();
  }

  const fogChannels = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const FOG_LIGHT = fogChannels("#e8eaef"), FOG_DARK = fogChannels("#171b24");

  /** The flat biome colour, shaded by how high the ground is and by which way
   *  the slope faces. Relief is what a climber reads, and a fifteen-colour
   *  palette cannot carry it on its own. */
  function buildPixels() {
    pixels = pixelsFor(world, run && run.stopped ? layer : "biome", darkMap);
  }

  function scalarAt(values: ArrayLike<number>, r: number, c: number): number {
    const r0 = Math.max(0, Math.min(H - 1, Math.floor(r)));
    const r1 = Math.min(H - 1, r0 + 1);
    const c0 = Math.floor(c), c1 = c0 + 1;
    const tr = Math.max(0, Math.min(1, r - r0));
    const tc = c - Math.floor(c);
    const a = values[idx(r0, wrapC(c0))] * (1 - tc) + values[idx(r0, wrapC(c1))] * tc;
    const b = values[idx(r1, wrapC(c0))] * (1 - tc) + values[idx(r1, wrapC(c1))] * tc;
    return a * (1 - tr) + b * tr;
  }

  function detailNoise(r: number, c: number, frequency: number, salt: number): number {
    const period = Math.max(1, Math.round(W * frequency));
    const x = wrapC(c) * frequency;
    const y = r * frequency;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx0 = x - x0, ty0 = y - y0;
    const tx = tx0 * tx0 * (3 - 2 * tx0);
    const ty = ty0 * ty0 * (3 - 2 * ty0);
    const hash = (xx: number, yy: number) => {
      const wrappedX = ((xx % period) + period) % period;
      let h = Math.imul(wrappedX + 104729, 374761393) ^ Math.imul((yy + salt) ^ detailSeed, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const north = hash(x0, y0) * (1 - tx) + hash(x0 + 1, y0) * tx;
    const south = hash(x0, y0 + 1) * (1 - tx) + hash(x0 + 1, y0 + 1) * tx;
    return north * (1 - ty) + south * ty;
  }

  function bilinearBiomeColour(
    r: number, c: number, palette: [number, number, number][],
  ): [number, number, number] {
    const r0 = Math.max(0, Math.min(H - 1, Math.floor(r)));
    const r1 = Math.min(H - 1, r0 + 1);
    const c0 = Math.floor(c), c1 = c0 + 1;
    const tr = Math.max(0, Math.min(1, r - r0));
    const tc = c - Math.floor(c);
    const colour = (rr: number, cc: number) => palette[world.biome[idx(rr, wrapC(cc))]];
    const nw = colour(r0, c0), ne = colour(r0, c1), sw = colour(r1, c0), se = colour(r1, c1);
    return [0, 1, 2].map(ch => {
      const north = nw[ch] * (1 - tc) + ne[ch] * tc;
      const south = sw[ch] * (1 - tc) + se[ch] * tc;
      return north * (1 - tr) + south * tr;
    }) as [number, number, number];
  }

  function blendedBiomeColour(
    r: number, c: number, palette: [number, number, number][],
  ): [number, number, number] {
    const warpC = (detailNoise(r, c, 0.35, 911) - 0.5) * 1.8;
    const warpR = (detailNoise(r, c, 0.35, 3571) - 0.5) * 1.8;
    const radius = 0.7 + detailNoise(r, c, 0.22, 7919) * 0.75;
    const out: [number, number, number] = [0, 0, 0];
    let total = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const weight = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
      const sample = bilinearBiomeColour(r + warpR + dy * radius, c + warpC + dx * radius, palette);
      for (let ch = 0; ch < 3; ch++) out[ch] += sample[ch] * weight;
      total += weight;
    }
    for (let ch = 0; ch < 3; ch++) out[ch] /= total;
    return out;
  }

  /** A zoomed viewport still contains 160 by 92 rendered samples. Each level
   *  reads the continuous terrain noise more closely, while play stays on the
   *  original grid. */
  function detailedViewPixels(): Uint8ClampedArray {
    const n = W * H;
    const land = new Uint8Array(n);
    const metres = new Float32Array(n);
    const depth = new Float32Array(n);
    const temp = new Float32Array(n);
    const rain = new Float32Array(n);
    const biome = new Uint8Array(n);
    const z = zoom();
    const palette = BIOMES.map(b => hex(darkMap ? b.dark : b.colour));

    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const i = idx(py, px);
      const wr = viewRow + py / z;
      const wc = viewCol + px / z;
      const ground = terrainAt(world, wr, wc);
      const t = scalarAt(world.tempC, wr, wc);
      const m = scalarAt(world.rain, wr, wc);
      const nearest = idx(Math.max(0, Math.min(H - 1, Math.round(wr))), wrapC(Math.round(wc)));
      land[i] = ground.land ? 1 : 0;
      metres[i] = ground.metres;
      depth[i] = ground.depth;
      temp[i] = t;
      rain[i] = m;
      if (!ground.land) biome[i] = t <= -12 ? B.seaice : ground.depth < 0.12 ? B.shallow : B.ocean;
      else if (t <= -11 && ground.metres >= 1400) biome[i] = B.snowline;
      else if (t <= 0.5 && ground.metres >= 900) biome[i] = B.alpine;
      else if (t <= -12) biome[i] = B.icecap;
      else if (t <= -2) biome[i] = B.tundra;
      else if (t <= 6) {
        const nearby = world.biome[nearest];
        biome[i] = nearby === B.taiga || nearby === B.tundra ? nearby : B.tundra;
      } else if (t <= 19) biome[i] = m >= 0.62 ? B.forest : m >= 0.42 ? B.grassland : m >= 0.24 ? B.shrubland : B.desert;
      else biome[i] = m >= 0.70 ? B.rainforest : m >= 0.52 ? B.monsoon : m >= 0.30 ? B.savannah : B.desert;
    }

    const out = new Uint8ClampedArray(n * 3);
    const deepest = Math.max(...world.depth) || 1;
    const highest = Math.max(1, world.summitM);
    const blank: [number, number, number] = darkMap ? [22, 26, 34] : [232, 234, 239];
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const i = idx(py, px);
      let colour: [number, number, number];
      if (layer === "height" && run.stopped) {
        colour = land[i] ? ramp(HEIGHT_LAND, metres[i] / highest) : ramp(HEIGHT_SEA, 1 - depth[i] / deepest);
      } else if (layer === "temp" && run.stopped) {
        colour = ramp(TEMP, (temp[i] - TEMP_LOW) / (TEMP_HIGH - TEMP_LOW));
      } else if (layer === "rain" && run.stopped) {
        colour = land[i] ? ramp(RAIN, rain[i]) : blank;
      } else {
        const b = BIOMES[biome[i]];
        const solid = hex(darkMap ? b.dark : b.colour);
        const wr = viewRow + py / z, wc = viewCol + px / z;
        const soft = blendedBiomeColour(wr, wc, palette);
        const contrast = (Math.abs(solid[0] - soft[0]) + Math.abs(solid[1] - soft[1]) +
          Math.abs(solid[2] - soft[2])) / (3 * 255);
        const grain = (detailNoise(wr, wc, 3.2, 15401) - 0.5) * (0.035 + contrast * 0.11);
        colour = [0, 1, 2].map(ch => (solid[ch] * 0.2 + soft[ch] * 0.8) * (1 + grain)) as [number, number, number];
        if (layer !== "flat" && land[i]) {
          const west = metres[idx(py, Math.max(0, px - 1))];
          const east = metres[idx(py, Math.min(W - 1, px + 1))];
          const slope = Math.max(-1, Math.min(1, ((west - east) * z) / 900));
          const lift = 1 + slope * 0.13 - Math.min(0.22, metres[i] / 26000);
          colour = [colour[0] * lift, colour[1] * lift, colour[2] * lift];
        }
      }
      out[i * 3] = colour[0]; out[i * 3 + 1] = colour[1]; out[i * 3 + 2] = colour[2];
    }
    return out;
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
    const detail = zoomIndex > 0 ? detailedViewPixels() : null;
    const img = tileCtx.createImageData(W, H);
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const i = idx(py, px);
      const wr = viewRow + py / zoom();
      const wc = viewCol + px / zoom();
      const worldI = idx(Math.max(0, Math.min(H - 1, Math.round(wr))), wrapC(Math.round(wc)));
      // 1 where the ground is known, 0 where it is fog, and in between along
      // the edge of the reveal — which is what stops it looking like a switch.
      const k = seen[worldI] ? 1
        : !liftAt ? 0
        : Math.max(0, Math.min(1, (front - liftAt[worldI]) / SOFT));
      for (let ch = 0; ch < 3; ch++) {
        const colour = detail ? detail[i * 3 + ch] : pixels[worldI * 3 + ch];
        img.data[i * 4 + ch] = fog[ch] + (colour - fog[ch]) * k;
      }
      img.data[i * 4 + 3] = 255;
    }
    tileCtx.putImageData(img, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tile, 0, 0, canvas.width, canvas.height);

    const cell = canvas.width / visibleCols();
    const screenCol = (c: number) => wrapC(c - viewCol);
    const x = (c: number) => (screenCol(c) + 0.5) * cell;
    const y = (r: number) => (r - viewRow + 0.5) * cell;
    const ink = darkMap ? "#f4f7fa" : "#101114";
    const back = darkMap ? "#0b0d13" : "#ffffff";

    // Latitude is the one thing you are never in the dark about, and on this
    // world it is most of the reasoning: the equator is where the rainforest
    // is, thirty is where the deserts are, and the bands are where the wind
    // changes direction. So the guides are drawn over the fog as well as over
    // the ground, and they are the only furniture on the map.
    const dpr = canvas.width / (canvas.getBoundingClientRect().width || canvas.width);
    ctx.font = "600 " + Math.max(9, Math.min(Math.round(cell * 2.6), Math.round(14 * dpr))) +
      "px -apple-system, Helvetica, Arial, sans-serif";
    ctx.textBaseline = "middle";
    for (const lat of [60, 30, 0, -30, -60]) {
      const gy = (((90 - lat) / 180) * H - viewRow) * cell;
      if (gy < 0 || gy > canvas.height) continue;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = lat === 0 ? 0.2 : 0.13;
      ctx.lineWidth = 1;
      ctx.setLineDash(lat === 0 ? [6, 5] : [3, 6]);
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = ink;
      ctx.textAlign = "left";
      ctx.fillText(lat === 0 ? "0°" : Math.abs(lat) + "°" + (lat > 0 ? "N" : "S"), 8 * dpr, gy - 10 * dpr);
    }
    ctx.globalAlpha = 1;

    /* The walk: one translucent line, so the route shows without hiding the
       ground it crosses. A leg over the seam is drawn a second time running
       off the far side, so the line never shoots back across the whole world. */
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(2, cell * 0.42);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let k = 1; k < run.path.length; k++) {
      const a = run.path[k - 1], b = run.path[k];
      let dc = colOf(b) - colOf(a);
      if (dc > W / 2) dc -= W;
      if (dc < -W / 2) dc += W;
      const start = screenCol(colOf(a));
      const end = start + dc;
      for (const shift of [0, -W, W]) {
        ctx.beginPath();
        ctx.moveTo((start + shift + 0.5) * cell, y(rowOf(a)));
        ctx.lineTo((end + shift + 0.5) * cell, y(rowOf(b)));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    const mark = (i: number, glyph: string, fill: string, ring: string) => {
      const cx = x(colOf(i)), cy = y(rowOf(i)), rad = Math.max(4, cell * 1.5);
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = Math.max(1.4, cell * 0.35); ctx.strokeStyle = ring; ctx.stroke();
      if (glyph) {
        ctx.fillStyle = ring;
        ctx.font = "700 " + Math.round(rad * 1.5) + "px -apple-system, Helvetica, Arial, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(glyph, cx, cy + rad * 0.06);
      }
    };

    if (run.stopped && front >= 1) {
      /* Only worth drawing once it is all visible: unreached landmarks that
         were on the table, and where the summit you were aiming at turned out
         to sit. Reached areas need no overlay; the walk already records them. */
      const held = new Set(now.found);
      for (const g of shownGoals()) {
        if (held.has(g)) continue;
        const { cells } = world.goals[g];
        // Small ones get a tint so an island or a lake is not just four lines.
        // A landmark the size of a continent needs no help being found, and a
        // wash that size would only recolour the terrain under it.
        if (cells.size <= 260) {
          ctx.fillStyle = darkMap ? "rgba(255,120,60,.18)" : "rgba(214,69,69,.15)";
          for (const i of cells) {
            ctx.fillRect(screenCol(colOf(i)) * cell, (rowOf(i) - viewRow) * cell, cell, cell);
          }
        }
        ctx.strokeStyle = darkMap ? "#ff9a63" : "#c23b3b";
        ctx.lineWidth = Math.max(1.2, cell * 0.26);
        ctx.beginPath();
        for (const i of cells) {
          const r = rowOf(i), c = colOf(i), sc = screenCol(c);
          const px = sc * cell, py = (r - viewRow) * cell;
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
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    pan = { pointer: e.pointerId, x: e.clientX, y: e.clientY, col: viewCol, row: viewRow };
    dragged = false;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("panning");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pan || pan.pointer !== e.pointerId) return;
    const box = canvas.getBoundingClientRect();
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    if (Math.hypot(dx, dy) >= 4) dragged = true;
    if (dragged) {
      viewCol = wrapC(pan.col - (dx / box.width) * visibleCols());
      viewRow = clampViewRow(pan.row - (dy / box.height) * visibleRows());
      tip.classList.add("hidden");
      paint();
      e.preventDefault();
    }
  });
  const endPan = (e: PointerEvent) => {
    if (!pan || pan.pointer !== e.pointerId) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    pan = null;
    canvas.classList.remove("panning");
  };
  canvas.addEventListener("pointerup", endPan);
  canvas.addEventListener("pointercancel", endPan);
  canvas.addEventListener("wheel", (e) => {
    const box = canvas.getBoundingClientRect();
    if ((e.ctrlKey || e.metaKey) && e.deltaY) {
      setZoom(zoomIndex + (e.deltaY < 0 ? 1 : -1), {
        x: (e.clientX - box.left) / box.width,
        y: (e.clientY - box.top) / box.height,
      });
      e.preventDefault();
      return;
    }
    if (zoomIndex > 0) {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      viewCol = wrapC(viewCol + dx / (box.width / visibleCols()));
      viewRow = clampViewRow(viewRow + dy / (box.height / visibleRows()));
      paint();
      e.preventDefault();
      return;
    }
    const dx = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!dx) return;
    viewCol = wrapC(viewCol + dx / (box.width / W));
    paint();
    e.preventDefault();
  }, { passive: false });
  ($("hcZoomOut") as HTMLButtonElement).onclick = () => setZoom(zoomIndex - 1);
  ($("hcZoomIn") as HTMLButtonElement).onclick = () => setZoom(zoomIndex + 1);
  ($("hcZoomFit") as HTMLButtonElement).onclick = () => setZoom(0);
  canvas.addEventListener("pointermove", (e) => {
    if (pan) return;
    if (e.pointerType !== "mouse") return;          // a tap is a move, not a query
    const box = canvas.getBoundingClientRect();
    const c = wrapC(Math.floor(((e.clientX - box.left) / box.width) * visibleCols() + viewCol));
    const r = Math.floor(((e.clientY - box.top) / box.height) * visibleRows() + viewRow);
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
        : BIOMES[world.biome[i]].name + (world.land[i] ? ", " + metresLabel(world.metres[i]) : "");
      tip.textContent = reading + ", " + latLabel(r) +
        (goal === undefined ? "" :
          ", " + world.goals[goal].name + (now.found.includes(goal) ? ", reached" : ", missed"));
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
      ? "<span class='hcmoves-n'>0</span><span class='hcmoves-label'>moves left, run over</span>" +
        "<span class='hcmoves-bar'><i style='width:0%'></i></span>"
      : "<span class='hcmoves-n'>" + now.movesLeft + "</span>" +
        "<span class='hcmoves-label'>" + (now.movesLeft === 1 ? "move left" : "moves left") + "</span>" +
        "<span class='hcmoves-bar'><i style='width:" + Math.round((now.movesLeft / MOVES) * 100) + "%'></i></span>";
    $("hcMoves").classList.toggle("low", !run.stopped && now.movesLeft <= 5);

    drawBrief();

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
          ? "<div class='hcscore-marks'><span class='hcbrief-sub'>Landmarks (Bonus): " +
            now.found.length + " of " + world.goals.length + " found</span>" +
            "<ul class='hcgoals'>" + listed.map(g =>
              "<li class='hcgoal" + (held.has(g) ? " on" : "") + "'>" + world.goals[g].name + "</li>").join("") +
            "</ul></div>"
          : "") +
      "</div>" +
      (run.stopped || !now.live.length ? "" :
        "<button id='hcWhere' class='linkbtn' aria-expanded='" + hintsOpen + "' aria-controls='hcWhereBox'>" +
        (hintsOpen ? "Hide where to look" : "Where to look") + "</button>" +
        "<div id='hcWhereBox' class='kindbox" + (hintsOpen ? "" : " hidden") + "'>" +
        now.live.map(g => "<p><b>" + world.goals[g].name + ":</b> " + world.goals[g].hint + "</p>").join("") +
        "</div>");

    const where = $("hcWhere");
    if (where) where.onclick = () => { hintsOpen = !hintsOpen; drawBrief(); };
  }

  /* Tapping the map is the whole control: point at where you want to be and
     you take one move of the stride towards it, snapped to the eight compass
     directions. It reads the same on a phone and a desktop, and it puts the
     decision on the map — which is the only thing worth looking at. */
  canvas.addEventListener("click", (e) => {
    if (dragged) { dragged = false; return; }
    if (run.stopped) return;
    const box = canvas.getBoundingClientRect();
    const c = wrapC(Math.floor(((e.clientX - box.left) / box.width) * visibleCols() + viewCol));
    const r = Math.floor(((e.clientY - box.top) / box.height) * visibleRows() + viewRow);
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
  function keepPlayerVisible() {
    if (zoomIndex === 0) return;
    const c = colOf(at()), r = rowOf(at());
    const cols = visibleCols(), rows = visibleRows();
    const marginC = Math.min(3, cols * 0.18);
    const marginR = Math.min(3, rows * 0.18);
    const sc = wrapC(c - viewCol);
    if (sc >= cols) viewCol = wrapC(c + 0.5 - cols / 2);
    else if (sc < marginC) viewCol = wrapC(c - marginC);
    else if (sc > cols - marginC) viewCol = wrapC(c - cols + marginC);
    if (r < viewRow + marginR) viewRow = clampViewRow(r - marginR);
    else if (r > viewRow + rows - marginR) viewRow = clampViewRow(r - rows + marginR);
  }
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
    keepPlayerVisible();
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
      "<b>" + now.score + ", grade " + now.grade + "</b>. " + now.climb + " for " + metresLabel(now.best) +
      " of a " + metresLabel(world.summitM) + " summit, +" + now.landmarkBonus + " for " +
      now.found.length + " of " + world.goals.length + " landmark" + (world.goals.length === 1 ? "" : "s") + ". " +
      verdict(now.peakShare, now.found.length > 0);
    // Only a run that got nowhere is worth painting as a failure; a middling
    // climb is still a climb, and the grade already says so.
    $("hcMsg").className = "msg" + (now.score >= 55 ? " good" : now.score < 35 ? " bad" : "");
    reportResult(String(now.score), fresh);

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
     it is two lines and two buttons. */
  const scoreBox = $("hcScoreBox") as HTMLDialogElement;
  function showScore() {
    $("hcScoreDay").textContent = "HillClimb, " + longLabel(day);
    // The arithmetic, so the number that just counted up can be read back off
    // the card: the climb, and what was picked up on the way to it.
    $("hcScoreRows").innerHTML = ([
      ["Climb", metresLabel(now.best) + " of " + metresLabel(world.summitM), String(now.climb)],
      ["Landmarks", now.found.length + " of " + world.goals.length, "+" + now.landmarkBonus],
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
            body: JSON.stringify({ day, game: "HillClimb", bucket, player }),
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
    const slot = data && data.enabled !== false && data.games ? data.games.HillClimb : null;
    if (!slot || !slot.total) { statsOn = Boolean(slot); box.classList.add("hidden"); return; }
    const scores = Object.keys(slot.buckets)
      .filter(score => /^(0|[1-9]\d*)$/.test(score))
      .sort((a, b) => Number(b) - Number(a));
    if (!scores.length) { box.classList.add("hidden"); return; }
    const most = Math.max(...scores.map(score => slot.buckets[score] || 0), 1);
    box.querySelector(".results-head").textContent =
      slot.total + (slot.total === 1 ? " player has" : " players have") + " finished today. Score";
    box.querySelector(".results-bars").innerHTML = scores.map(score => {
      const n = slot.buckets[score] || 0;
      return '<div class="results-row' + (mine === score ? " mine" : "") + '"><span>' + score +
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
  $("shareSend").onclick = async () => { try { await navigator.share({ title: "HillClimb", text: payload }); } catch (_) {} };
  $("shareDone").onclick = () => shareBox.close();
  shareBox.addEventListener("pointerdown", (e) => { if (e.target === shareBox) shareBox.close(); });
  $("hcShare").onclick = () => {
    openShare(
      "HillClimb " + day + "\n" +
      now.score + " " + gradeSquares(now.grade) + "\n" +
      "⛰ " + metresLabel(now.best) + " of " + metresLabel(world.summitM) + ", " + now.climb + "\n" +
      "🧭 " + now.found.length + "/" + world.goals.length + " landmarks, +" + now.landmarkBonus + "\n" +
      location.href.split("#")[0].split("?")[0]);
  };

  // ---------- help, dates, boot ----------
  $("hcHelpBtn").onclick = () => {
    const open = $("hcHelpBox").classList.toggle("hidden") === false;
    $("hcHelpBtn").setAttribute("aria-expanded", String(open));
  };
  /* The archive: the available planets, and how each one went. A day already
     walked shows its grade, so the strip doubles as a record of the run of
     them rather than only a way to get back to one. */
  const archive = $("hcArchive");
  const archiveDate = $("hcArchiveDate") as HTMLInputElement;
  function gradeOn(key: string): string {
    try {
      const d = JSON.parse(localStorage.getItem("hm-" + key + "-HillClimb-" + HILLCLIMB_REVISION) || "null");
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
    for (let i = 0; i < ACCESS_DAYS; i++) {
      const key = addDays(TODAY, -i);
      const grade = gradeOn(key);
      const b = document.createElement("button");
      b.className = "archive-item" + (key === day ? " current" : "");
      b.innerHTML = shortLabel(key) + "<br><span class='dot'>" + (grade || "–") + "</span>";
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
    viewCol = 0;
    viewRow = 0;
    zoomIndex = 0;
    updateZoomControls();
    const stored = saved();
    const seed = dropSeed(stored);
    world = generateWorld(day, seed);
    detailSeed = Number(day.replaceAll("-", "")) | 0;
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
    $("hcDateLabel").textContent = day === TODAY ? "Today, " + longLabel(day) : longLabel(day);
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
