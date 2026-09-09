/* HardMode — Hillclimb.
 *
 * The world lives in hillclimb-world.ts; everything here is the expedition:
 * where you have been, what you could see from there, and what it added up to.
 *
 * The rules of a run live in hillclimb-run.ts, which is where the arithmetic
 * is tested. This file draws it. */
import {
  generateWorld, BIOMES, W, H, MOVES, STRIDE, SIGHT, HILLCLIMB_REVISION,
  idx, rowOf, colOf, wrapC, latOf, windName, windDir,
} from "./hillclimb-world";
import { newRun, runState } from "./hillclimb-run";
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
  let run: Run = null;
  let now: RunState = null;           // recomputed after every change, never stored
  let seen: Uint8Array = null;        // ground the expedition has actually looked at
  let hintsOpen = false;              // the "where to look" panel, across redraws

  const path = () => run.path;
  const at = () => run.path[run.path.length - 1];
  const settle = () => { now = runState(world, run); };

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
      const show = run.stopped || seen[i];
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

    if (run.stopped) {
      // Only worth drawing once it is all visible: every landmark the day
      // offered, the ones reached marked apart from the ones walked past, and
      // where the summit you were aiming at turned out to sit.
      const held = new Set(now.found.slice(0, now.kept));
      // Only what was ever on the table: the pool runs deeper than the day
      // does, and marking landmarks that never came up would be marking the
      // player down for missing something they were never shown.
      const shown = new Set([...held, ...now.found, ...now.live]);
      world.goals.forEach((goal, g) => {
        if (!shown.has(g)) return;
        ctx.fillStyle = held.has(g)
          ? (darkMap ? "rgba(120,220,150,.5)" : "rgba(47,125,50,.38)")
          : (darkMap ? "rgba(255,120,60,.5)" : "rgba(214,69,69,.42)");
        for (const i of goal.cells) ctx.fillRect(colOf(i) * cell, rowOf(i) * cell, cell, cell);
      });
      mark(world.summit, "▲", back, ink);
    }
    mark(path()[0], "", back, darkMap ? "#7fa8ff" : "#3157d5");
    mark(at(), "", ink, back);
  }

  /** Only once the run is over. While it is running the field notes below name
   *  every kind of ground you have stood on, and a second copy of the same
   *  colours under the map would be nothing but noise. */
  function buildKey() {
    const box = $("hcKey");
    box.classList.toggle("hidden", !run.stopped);
    if (!run.stopped) return;
    box.innerHTML = BIOMES.map((_, i) => i).filter(i => world.biome.includes(i)).map(i =>
      "<span><i style='background:" + (darkMap ? BIOMES[i].dark : BIOMES[i].colour) + "'></i> " + BIOMES[i].name + "</span>",
    ).join("") + "<span><i class='k-summit'>▲</i> the summit</span>" +
      (now.kept ? "<span><i class='k-reached'></i> landmark reached</span>" : "") +
      (now.live.length ? "<span><i class='k-missed'></i> landmark missed</span>" : "");
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
      ["Highest so far", metresLabel(now.best)],
    ];
    $("hcRead").innerHTML = rows.map(([k, v]) =>
      "<div class='hcstat'><span>" + k + "</span><strong>" + v + "</strong></div>").join("");
    $("hcMovesPill").textContent = run.stopped ? "run over" : now.movesLeft + (now.movesLeft === 1 ? " move left" : " moves left");
    $("hcBestPill").textContent = metresLabel(now.best);

    drawBrief();

    // Only the ground actually stood on: the list is a record of the walk, not
    // a table of contents for the planet.
    $("hcNotes").innerHTML =
      "<span class='hcnotes-head'>Field notes " + now.biomes.length + " / " + world.checklist.length + "</span>" +
      now.biomes.map(b =>
        "<span><i style='background:" + (darkMap ? BIOMES[b].dark : BIOMES[b].colour) + "'></i> " +
        BIOMES[b].name + "</span>").join("");

    // Nothing moves while a rung is on the table: the choice is the move.
    canvas.classList.toggle("frozen", run.stopped || now.awaiting);
    // While a rung is on the table the map does not answer, so nothing should
    // be telling the player to tap it.
    $("hcHint").classList.toggle("hidden", run.stopped || now.awaiting);
    $("hcStop").classList.toggle("hidden", run.stopped || now.awaiting);
    $("hcRestart").classList.toggle("hidden", !run.stopped || day === TODAY);
  }

  /** The two landmarks on offer, the choice when one has just been reached,
   *  and — folded away, because knowing where a rainforest sits is the puzzle
   *  rather than the instructions — a note on where to look for each. */
  function drawBrief() {
    const box = $("hcBrief");
    const held = new Set(now.found.slice(0, now.kept));
    const lost = now.found.filter(g => !held.has(g));
    // While the choice is open the landmark just reached is still worth naming,
    // so it is shown alongside whatever has come up behind it. Once the run is
    // over the chips carry the whole account: kept, struck off, walked past.
    const listed = run.stopped ? [...now.found, ...now.live]
      : now.awaiting ? [now.found[now.reached - 1], ...now.live]
      : now.live;

    let head: string, note: string;
    if (run.stopped) {
      head = "<b>" + now.kept + " of " + world.rungs + " landmarks</b>" +
        (now.struck ? " <span class='hc-lost'>· " + world.goals[lost[0]].name + " struck off</span>" : "");
      note = now.kept >= world.rungs ? "The whole day's worth, in one run."
        : "Everything you were offered is marked on the map — what you reached, and what you left out there.";
    } else if (now.awaiting) {
      head = "<b>Reached " + world.goals[now.found[now.reached - 1]].name + ".</b>";
      note = "Banking keeps what you have and leaves you free to climb with the moves you have left. " +
        "Press on and the next one is worth more than the last — but if the moves run out before you reach it, " +
        world.goals[now.found[now.reached - 1]].name + " is struck off.";
    } else if (now.complete) {
      head = "<b>Every landmark reached.</b>";
      note = "Nothing left to find. Spend what is left of the budget going up.";
    } else if (run.banked) {
      head = "<b>Banked.</b>";
      note = "No more landmarks. Every move from here is altitude and field notes.";
    } else {
      head = "<b>Head for either one</b>";
      note = "Two are on offer at a time, and each one you reach is worth more than the last — " +
        "so which of the two you go after, and in what order, is the game.";
    }

    box.innerHTML =
      "<p class='hcbrief-line'>" + head +
      " <span class='hcbrief-count'>" + now.kept + " of " + world.rungs + "</span></p>" +
      (listed.length
        ? "<ul class='hcgoals'>" + listed.map(g =>
            "<li class='hcgoal" + (held.has(g) ? " on" : lost.includes(g) ? " lost" : "") + "'>" +
            world.goals[g].name + "</li>").join("") + "</ul>"
        : "") +
      (now.awaiting
        ? "<div class='hcchoice'><button id='hcBank' class='btn'>Bank these</button>" +
          "<button id='hcPress' class='btn primary'>Press on</button></div>"
        : "") +
      "<p class='hcbrief-hint'>" + note + "</p>" +
      (run.stopped || !now.live.length ? "" :
        "<button id='hcWhere' class='linkbtn' aria-expanded='" + hintsOpen + "' aria-controls='hcWhereBox'>" +
        (hintsOpen ? "Hide where to look" : "Where to look") + "</button>" +
        "<div id='hcWhereBox' class='kindbox" + (hintsOpen ? "" : " hidden") + "'>" +
        now.live.map(g => "<p><b>" + world.goals[g].name + "</b> — " + world.goals[g].hint + "</p>").join("") +
        "</div>");

    if (now.awaiting) {
      $("hcBank").onclick = () => { run.banked = true; settle(); save(); refresh(); };
      $("hcPress").onclick = () => { run.pressedOn++; settle(); save(); refresh(); paint(); };
    }
    const where = $("hcWhere");
    if (where) where.onclick = () => { hintsOpen = !hintsOpen; drawBrief(); };
  }

  /* Tapping the map is the whole control: point at where you want to be and
     you take one move of the stride towards it, snapped to the eight compass
     directions. It reads the same on a phone and a desktop, and it puts the
     decision on the map — which is the only thing worth looking at. */
  canvas.addEventListener("click", (e) => {
    if (run.stopped || now.awaiting) return;
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
    if (run.stopped || now.awaiting || now.movesLeft <= 0) return;
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
    run.stopped = true;
    settle();
    save();
    buildPixels();
    paint(); refresh(); buildKey();
    const struckOff = now.found.find(g => !now.found.slice(0, now.kept).includes(g));
    const ladder = now.kept + " of " + world.rungs + " landmark" + (world.rungs === 1 ? "" : "s") +
      (now.struck ? " — " + world.goals[struckOff].name + " struck off for pressing on" : "") + ". ";
    $("hcMsg").innerHTML =
      "<b>" + metresLabel(now.best) + "</b> of a " + metresLabel(world.summitM) + " summit — " +
      Math.round(now.peakShare * 100) + "%. " + ladder +
      now.biomes.length + " of " + world.checklist.length + " biomes logged. " +
      "<b>Grade " + now.grade + "</b> — " + verdict(now.peakShare, now.kept > 0);
    // Only a run that got nowhere is worth painting as a failure; a middling
    // climb is still a climb, and the grade already says so.
    $("hcMsg").className = "msg" + (now.score >= 55 ? " good" : now.score < 35 ? " bad" : "");
    reportResult(now.grade, fresh);
  }
  $("hcStop").onclick = () => { if (!run.stopped) finish(true); };
  $("hcRestart").onclick = () => { run = newRun(world); save(); start(); };

  // ---------- storage ----------
  function save() {
    try { localStorage.setItem(storeKey(), JSON.stringify(run)); } catch (_) {}
  }
  function load(): boolean {
    try {
      const d = JSON.parse(localStorage.getItem(storeKey()) || "null");
      if (!d || !Array.isArray(d.path) || d.path[0] !== world.spawn) return false;
      // A path from a world that has since changed shape is worse than none.
      if (d.path.length > MOVES + 1 || d.path.some((i: unknown) => typeof i !== "number" || i < 0 || i >= W * H)) return false;
      run = {
        path: d.path,
        stopped: Boolean(d.stopped),
        banked: Boolean(d.banked),
        // Never more landmarks taken on than there are, whatever is in storage.
        pressedOn: Math.max(0, Math.min(world.goals.length, Number(d.pressedOn) || 0)),
      };
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
    openShare(
      "HardMode Hillclimb " + day + "\n" +
      "⛰ " + metresLabel(now.best) + " — " + Math.round(now.peakShare * 100) + "% of the summit\n" +
      "🧭 " + now.kept + "/" + world.rungs + " landmarks" +
        (run.banked ? " — banked" : now.struck ? " — pressed on and lost one" : "") + "\n" +
      "🗺 " + now.biomes.length + "/" + world.checklist.length + " biomes · " +
        (MOVES - now.movesLeft) + " moves\n" +
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
    if (!load()) run = newRun(world);
    settle();
    reveal();
    buildPixels();
    $("hcDateLabel").textContent = day === TODAY ? "Today · " + longLabel(day) : longLabel(day);
    ($("hcPrevDay") as HTMLButtonElement).disabled = day <= OLDEST;
    ($("hcNextDay") as HTMLButtonElement).disabled = day >= TODAY;
    $("hcMsg").textContent = ""; $("hcMsg").className = "msg";
    $("hcResults").classList.add("hidden");
    mine = null;
    paint(); refresh(); buildKey();
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
