/* HardMode — Hillclimb.
 *
 * The world lives in hillclimb-world.ts; everything here is the expedition:
 * where you have been, what you could see from there, and what it added up to.
 *
 * The run is stored as nothing but the list of squares you stopped on. Sight,
 * field notes, best altitude and whether you reached the day's landmark all
 * fall out of that list and the day's world, so a restored run and a live one
 * are the same computation and can never disagree. */
import {
  generateWorld, BIOMES, W, H, MOVES, STRIDE, SIGHT, HILLCLIMB_REVISION, ladderValue,
  idx, rowOf, colOf, wrapC, latOf, windName, windDir,
} from "./hillclimb-world";
import type { World, Landmark } from "./hillclimb-world";

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
    if (world) { buildPixels(); paint(); buildKey(); }
  }
  for (const k of Object.keys(THEMES)) $(THEMES[k].id).onclick = () => setTheme(k);

  // ---------- run state ----------
  let world: World = null;
  let path: number[] = [];            // every square stopped on, starting at the drop
  let stopped = false;                // the run is over: the whole map is shown
  let banked = false;                 // no more rungs wanted; what is reached is kept
  let pressedOn = 0;                  // rungs taken on after reaching the one before
  let seen: Uint8Array = null;        // ground the expedition has actually looked at

  const at = () => path[path.length - 1];
  const movesLeft = () => MOVES - (path.length - 1);

  /** Everything within sight of any stop. Recomputed from the path, never
   *  stored, so an old save can never disagree with today's world. */
  function reveal() {
    seen = new Uint8Array(W * H);
    for (const stop of path) light(stop);
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

  const bestMetres = () => path.reduce((best, i) => Math.max(best, world.metres[i]), 0);
  const visitedBiomes = () => new Set(path.filter(i => world.land[i]).map(i => world.biome[i]));

  /* ---------- the ladder ----------
     Rungs are offered one at a time: reach one and you choose between banking
     what you have and taking the next, which is worth more. Press on and fail
     to arrive, and the rung you were standing on is struck off — one step back
     down the ladder, never the whole thing.

     Only `banked` and `pressedOn` are decisions; everything else is read back
     off the path, so a restored run cannot drift from a live one. */

  /** A rung is reached by standing on it or right beside it. Seeing it from
   *  eight squares away is not an expedition. */
  function touches(stop: number, goal: Landmark) {
    const r = rowOf(stop), c = colOf(stop);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      if (rr >= 0 && rr < H && goal.cells.has(idx(rr, wrapC(c + dc)))) return true;
    }
    return false;
  }
  /** Rungs climbed, in order — capped at the rungs actually offered, so ground
   *  wandered over after banking does not quietly count. */
  function reached() {
    let g = 0;
    for (const stop of path) {
      if (g >= world.goals.length) break;
      if (touches(stop, world.goals[g])) g++;
    }
    return Math.min(g, pressedOn + 1);
  }
  const awaiting = () => !stopped && !banked && reached() > pressedOn && reached() < world.goals.length;
  /** The run ended while still hunting a rung that was taken on. */
  const struck = () => stopped && !banked && reached() >= 1 && pressedOn === reached();
  const kept = () => Math.max(0, reached() - (struck() ? 1 : 0));

  const noteCount = () => {
    const got = visitedBiomes();
    return world.checklist.filter(b => got.has(b)).length;
  };
  const peakShare = () => (world.summitM > 0 ? bestMetres() / world.summitM : 0);
  const ladderShare = () => ladderValue(kept()) / ladderValue(world.goals.length);
  /** One number for the day: mostly the climb, then the ladder, then how much
   *  of the world you actually sampled on the way. */
  const score = () => Math.round(
    45 * peakShare() + 30 * ladderShare() +
    25 * (world.checklist.length ? noteCount() / world.checklist.length : 0));
  const grade = (s: number) => (s >= 75 ? "A" : s >= 55 ? "B" : s >= 35 ? "C" : "D");

  // ---------- map ----------
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
    pixels = new Uint8ClampedArray(W * H * 3);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = idx(r, c);
      const def = BIOMES[world.biome[i]];
      let [red, green, blue] = hex(darkMap ? def.dark : def.colour);
      if (world.land[i]) {
        // Ground rising to the west catches the light; ground falling away
        // from it sits in shadow. One lamp, fixed, like a paper map.
        const west = world.metres[idx(r, wrapC(c - 1))];
        const east = world.metres[idx(r, wrapC(c + 1))];
        const slope = Math.max(-1, Math.min(1, (west - east) / 900));
        const lift = 1 + slope * 0.13 - Math.min(0.22, world.metres[i] / 26000);
        red *= lift; green *= lift; blue *= lift;
      }
      pixels[i * 3] = red; pixels[i * 3 + 1] = green; pixels[i * 3 + 2] = blue;
    }
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
      const show = stopped || seen[i];
      img.data[i * 4] = show ? pixels[i * 3] : fog[0];
      img.data[i * 4 + 1] = show ? pixels[i * 3 + 1] : fog[1];
      img.data[i * 4 + 2] = show ? pixels[i * 3 + 2] : fog[2];
      img.data[i * 4 + 3] = 255;
    }
    tileCtx.putImageData(img, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tile, 0, 0, canvas.width, canvas.height);

    const cell = canvas.width / W;
    const x = (c: number) => (c + 0.5) * cell;
    const y = (r: number) => (r + 0.5) * cell;
    const ink = darkMap ? "#f4f7fa" : "#101114";
    const back = darkMap ? "#0b0d13" : "#ffffff";

    // Latitude is the one thing you are never in the dark about, and on this
    // world it is most of the reasoning: the equator is where the rainforest
    // is, thirty is where the deserts are, and the bands are where the wind
    // changes direction. So the guides are drawn over the fog as well as over
    // the ground, and they are the only furniture on the map.
    ctx.font = "600 " + Math.max(9, Math.round(cell * 2.6)) + "px -apple-system, Helvetica, Arial, sans-serif";
    ctx.textBaseline = "middle";
    for (const lat of [60, 30, 0, -30, -60]) {
      const gy = ((90 - lat) / 180) * canvas.height;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = lat === 0 ? 0.3 : 0.16;
      ctx.lineWidth = 1;
      ctx.setLineDash(lat === 0 ? [] : [4, 5]);
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = ink;
      ctx.textAlign = "left";
      ctx.fillText(lat === 0 ? "0°" : Math.abs(lat) + "°" + (lat > 0 ? "N" : "S"), cell * 1.2, gy - cell * 2);
    }
    ctx.globalAlpha = 1;

    // The trail. A leg that crosses the seam is drawn as two, one running off
    // each side, so the line never shoots back across the whole world.
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = Math.max(1.5, cell * 0.28);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      let dc = colOf(b) - colOf(a);
      if (dc > W / 2) dc -= W;
      if (dc < -W / 2) dc += W;
      ctx.beginPath();
      ctx.moveTo(x(colOf(a)), y(rowOf(a)));
      ctx.lineTo(x(colOf(a) + dc), y(rowOf(b)));
      ctx.stroke();
      if (colOf(a) + dc < 0 || colOf(a) + dc >= W) {     // the same leg, wrapped
        const shift = colOf(a) + dc < 0 ? W : -W;
        ctx.beginPath();
        ctx.moveTo(x(colOf(a) + shift), y(rowOf(a)));
        ctx.lineTo(x(colOf(a) + dc + shift), y(rowOf(b)));
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

    if (stopped) {
      // Only worth drawing once it is all visible: the rungs that were actually
      // in play — the ones climbed, the one still being hunted — and where the
      // summit you were aiming at turned out to sit.
      const live = Math.min(world.goals.length, reached() + 1);
      for (let g = 0; g < live; g++) {
        const done = g < kept();
        ctx.fillStyle = done
          ? (darkMap ? "rgba(120,220,150,.5)" : "rgba(47,125,50,.38)")
          : (darkMap ? "rgba(255,120,60,.5)" : "rgba(214,69,69,.42)");
        for (const i of world.goals[g].cells) ctx.fillRect(colOf(i) * cell, rowOf(i) * cell, cell, cell);
      }
      mark(world.summit, "▲", back, ink);
    }
    mark(path[0], "", back, darkMap ? "#7fa8ff" : "#3157d5");
    mark(at(), "", ink, back);
  }

  /** Only once the run is over. While it is running the field notes below name
   *  every kind of ground you have stood on, and a second copy of the same
   *  colours under the map would be nothing but noise. */
  function buildKey() {
    const box = $("hcKey");
    box.classList.toggle("hidden", !stopped);
    if (!stopped) return;
    const live = Math.min(world.goals.length, reached() + 1);
    box.innerHTML = BIOMES.map((_, i) => i).filter(i => world.biome.includes(i)).map(i =>
      "<span><i style='background:" + (darkMap ? BIOMES[i].dark : BIOMES[i].colour) + "'></i> " + BIOMES[i].name + "</span>",
    ).join("") + "<span><i class='k-summit'>▲</i> the summit</span>" +
      (kept() ? "<span><i class='k-reached'></i> reached</span>" : "") +
      (live > kept() ? "<span><i class='k-missed'></i> " + world.goals[live - 1].name + ", missed</span>" : "");
  }

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
      ["Highest so far", metresLabel(bestMetres())],
    ];
    $("hcRead").innerHTML = rows.map(([k, v]) =>
      "<div class='hcstat'><span>" + k + "</span><strong>" + v + "</strong></div>").join("");
    $("hcMovesPill").textContent = stopped ? "run over" : movesLeft() + (movesLeft() === 1 ? " move left" : " moves left");
    $("hcBestPill").textContent = metresLabel(bestMetres());

    drawBrief();

    // Only the ground actually stood on: the list is a record of the walk, not
    // a table of contents for the planet.
    const got = visitedBiomes();
    $("hcNotes").innerHTML =
      "<span class='hcnotes-head'>Field notes " + noteCount() + " / " + world.checklist.length + "</span>" +
      world.checklist.filter(b => got.has(b)).map(b =>
        "<span><i style='background:" + (darkMap ? BIOMES[b].dark : BIOMES[b].colour) + "'></i> " +
        BIOMES[b].name + "</span>").join("");

    // Nothing moves while a rung is on the table: the choice is the move.
    canvas.classList.toggle("frozen", stopped || awaiting());
    // While a rung is on the table the map does not answer, so nothing should
    // be telling the player to tap it.
    $("hcHint").classList.toggle("hidden", stopped || awaiting());
    $("hcStop").classList.toggle("hidden", stopped || awaiting());
    $("hcRestart").classList.toggle("hidden", !stopped || day === TODAY);
  }

  /** The ladder, in the one place the player is already looking. */
  function drawBrief() {
    const box = $("hcBrief");
    const total = world.goals.length;
    const done = reached();
    const pips = world.goals.map((_, g) =>
      "<i class='hcpip" + (g < kept() ? " on" : g < done ? " lost" : "") + "'></i>").join("");
    const count = "<span class='hcbrief-count'>" + pips + " " + kept() + " of " + total + "</span>";

    if (stopped) {
      box.innerHTML = "<p class='hcbrief-line'><b>" + kept() + " of " + total + " landmarks</b>" +
        (struck() ? " <span class='hc-lost'>· " + world.goals[done - 1].name + " struck off</span>" : "") +
        "</p><p class='hcbrief-hint'>" + (kept() === total
          ? "The whole ladder, in one run."
          : "The rest of them are on the map below.") + "</p>";
      return;
    }
    if (awaiting()) {
      const next = world.goals[done];
      box.innerHTML =
        "<p class='hcbrief-line'><b>Reached " + world.goals[done - 1].name + ".</b> " + count + "</p>" +
        "<div class='hcchoice'>" +
        "<button id='hcBank' class='btn'>Bank these</button>" +
        "<button id='hcPress' class='btn primary'>Press on → " + next.name + "</button></div>" +
        "<p class='hcbrief-hint'>Banking keeps what you have and leaves you free to climb with the moves you have left. " +
        "Press on and the next one is worth more — but if the moves run out before you reach it, " +
        world.goals[done - 1].name + " is struck off.</p>";
      $("hcBank").onclick = () => { banked = true; save(); refresh(); };
      $("hcPress").onclick = () => { pressedOn++; save(); refresh(); paint(); };
      return;
    }
    if (done >= total) {
      box.innerHTML = "<p class='hcbrief-line'><b>Every landmark reached.</b> " + count + "</p>" +
        "<p class='hcbrief-hint'>Nothing left to find. Spend what is left of the budget going up.</p>";
      return;
    }
    if (banked) {
      box.innerHTML = "<p class='hcbrief-line'><b>Banked.</b> " + count + "</p>" +
        "<p class='hcbrief-hint'>No more landmarks. Every move from here is altitude and field notes.</p>";
      return;
    }
    const goal = world.goals[done];
    box.innerHTML = "<p class='hcbrief-line'><b>Find " + goal.name + "</b> " + count + "</p>" +
      "<p class='hcbrief-hint'>" + goal.hint + "</p>";
  }

  // ---------- moving ----------
  /* Tapping the map is the whole control: point at where you want to be and
     you take one move of the stride towards it, snapped to the eight compass
     directions. It reads the same on a phone and a desktop, and it puts the
     decision on the map — which is the only thing worth looking at. */
  canvas.addEventListener("click", (e) => {
    if (stopped || awaiting()) return;
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
    if (stopped || awaiting() || movesLeft() <= 0) return;
    const here = at();
    // The poles are the end of the map, not a wrap: a move north from the top
    // row simply runs along it rather than being refused outright.
    const r = Math.max(0, Math.min(H - 1, rowOf(here) + dr * STRIDE));
    const c = wrapC(colOf(here) + dc * STRIDE);
    const next = idx(r, c);
    if (next === here) return;
    path.push(next);
    light(next);
    if (movesLeft() <= 0) finish(true);
    else { save(); paint(); refresh(); buildKey(); }
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
    if (share >= 0.75) return "A serious summit — the true peak was barely above you.";
    if (share >= 0.5) return "Halfway up the planet. The high ground was further in than it looked.";
    if (share >= 0.25) return found ? "The budget went on the landmarks, and the mountains kept theirs." : "Low ground all the way. Next time follow the rising land rather than the coast.";
    return "Barely off the beach. The ranges sit inland; the coast will not take you up.";
  }
  function finish(fresh: boolean) {
    stopped = true;
    save();
    buildPixels();
    paint(); refresh(); buildKey();
    const share = peakShare();
    const s = score();
    const ladder = kept() + " of " + world.goals.length + " landmark" + (world.goals.length === 1 ? "" : "s") +
      (struck() ? " — " + world.goals[reached() - 1].name + " struck off for pressing on" : "") + ". ";
    $("hcMsg").innerHTML =
      "<b>" + metresLabel(bestMetres()) + "</b> of a " + metresLabel(world.summitM) + " summit — " +
      Math.round(share * 100) + "%. " + ladder +
      noteCount() + " of " + world.checklist.length + " biomes logged. " +
      "<b>Grade " + grade(s) + "</b> — " + verdict(share, kept() > 0);
    // Only a run that got nowhere is worth painting as a failure; a middling
    // climb is still a climb, and the grade already says so.
    $("hcMsg").className = "msg" + (s >= 55 ? " good" : s < 35 ? " bad" : "");
    reportResult(grade(s), fresh);
  }
  $("hcStop").onclick = () => { if (!stopped) finish(true); };
  $("hcRestart").onclick = () => {
    path = [world.spawn]; stopped = false; banked = false; pressedOn = 0;
    save(); start();
  };

  // ---------- storage ----------
  function save() {
    try { localStorage.setItem(storeKey(), JSON.stringify({ path, stopped, banked, pressedOn })); } catch (_) {}
  }
  function load(): boolean {
    try {
      const d = JSON.parse(localStorage.getItem(storeKey()) || "null");
      if (!d || !Array.isArray(d.path) || d.path[0] !== world.spawn) return false;
      // A path from a world that has since changed shape is worse than none.
      if (d.path.length > MOVES + 1 || d.path.some((i: unknown) => typeof i !== "number" || i < 0 || i >= W * H)) return false;
      path = d.path;
      stopped = Boolean(d.stopped);
      banked = Boolean(d.banked);
      // Never more rungs taken on than there are rungs, whatever is in storage.
      pressedOn = Math.max(0, Math.min(world.goals.length - 1, Number(d.pressedOn) || 0));
      return true;
    } catch (_) { return false; }
  }

  // ---------- the day's tally ----------
  const ORDER = ["A", "B", "C", "D"];
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
    const share = Math.round(peakShare() * 100);
    openShare(
      "HardMode Hillclimb " + day + "\n" +
      "⛰ " + metresLabel(bestMetres()) + " — " + share + "% of the summit\n" +
      "🧭 " + kept() + "/" + world.goals.length + " landmarks" + (banked ? " — banked" : struck() ? " — pressed on and lost one" : "") + "\n" +
      "🗺 " + noteCount() + "/" + world.checklist.length + " biomes · " + (MOVES - movesLeft()) + " moves\n" +
      location.href.split("#")[0].split("?")[0]);
  };

  // ---------- help, dates, boot ----------
  $("hcHelpBtn").onclick = () => {
    const open = $("hcHelpBox").classList.toggle("hidden") === false;
    $("hcHelpBtn").setAttribute("aria-expanded", String(open));
  };
  $("hcPrevDay").onclick = () => { if (day > OLDEST) { day = addDays(day, -1); start(); } };
  $("hcNextDay").onclick = () => { if (day < TODAY) { day = addDays(day, 1); start(); } };
  $("hcDateBtn").onclick = () => { if (day !== TODAY) { day = TODAY; start(); } };

  function start() {
    world = generateWorld(day);
    if (!load()) { path = [world.spawn]; stopped = false; banked = false; pressedOn = 0; }
    reveal();
    buildPixels();
    $("hcDateLabel").textContent = day === TODAY ? "Today · " + longLabel(day) : longLabel(day);
    ($("hcPrevDay") as HTMLButtonElement).disabled = day <= OLDEST;
    ($("hcNextDay") as HTMLButtonElement).disabled = day >= TODAY;
    $("hcMsg").textContent = ""; $("hcMsg").className = "msg";
    $("hcResults").classList.add("hidden");
    mine = null;
    paint(); refresh(); buildKey();
    if (stopped) finish(false); else drawResults();
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
