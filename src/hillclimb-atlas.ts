/* HardMode — Hillclimb: the layers a planet is built from, drawn.
 *
 * The page next to this one explains the generator in words. Words are a poor
 * way to show that the rain shadow really does sit behind the range, so each
 * step of the pipeline is also drawn from a real world: the same date, the same
 * code the game runs, four views of what it produced. */
import { generateWorld, BIOMES, W, H } from "./hillclimb-world";

(function () {
  "use strict";

  const $ = (id: string) => document.getElementById(id);
  const day = (() => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  })();
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const [y, m, dd] = day.split("-").map(Number);
  $("atlasDay").textContent = dd + " " + months[m - 1] + " " + y;

  const world = generateWorld(day);
  const dark = ["dark", "terminal"].includes(document.body.dataset.theme || "");

  type RGB = [number, number, number];
  const hex = (s: string): RGB =>
    [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  /** A colour ramp: pick the two stops either side and mix them. */
  function ramp(stops: string[], t: number): RGB {
    const p = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
    const a = hex(stops[Math.floor(p)]), b = hex(stops[Math.floor(p) + 1]);
    const k = p - Math.floor(p);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  /** One layer, drawn at one pixel a square and scaled up crisp. */
  function draw(id: string, colour: (i: number) => RGB) {
    const canvas = $(id) as HTMLCanvasElement;
    if (!canvas) return;
    const wide = canvas.parentElement.clientWidth || 640;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.height = Math.round((wide * H) / W) + "px";
    canvas.width = Math.round(wide * dpr);
    canvas.height = Math.round(((wide * H) / W) * dpr);

    const tile = document.createElement("canvas");
    tile.width = W; tile.height = H;
    const tc = tile.getContext("2d");
    const img = tc.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const [r, g, b] = colour(i);
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    tc.putImageData(img, 0, 0);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, 0, 0, canvas.width, canvas.height);
  }

  function drawAll() {
    // Height, before there is any sea to hide the low ground in. Ocean floor is
    // shown as the depth it actually has rather than as flat blue.
    const deepest = Math.max(...world.depth);
    const highest = Math.max(1, world.summitM);
    draw("atlasHeight", (i) => world.land[i]
      ? ramp(["#4c5a44", "#8f8a5e", "#cbbf94", "#ffffff"], world.metres[i] / highest)
      : ramp(["#0d1b28", "#25415a"], 1 - world.depth[i] / (deepest || 1)));

    // Temperature, on a fixed scale so the same colour means the same thing on
    // every day rather than only within one.
    draw("atlasTemp", (i) =>
      ramp(["#2a4d8f", "#6f9fd8", "#e8eef2", "#e9c56a", "#c4472e"], (world.tempC[i] + 30) / 65));

    // Rainfall is ranked over land, so the sea has none to show.
    draw("atlasRain", (i) => world.land[i]
      ? ramp(["#e8dcb0", "#cfd79a", "#7fb887", "#2f7d63", "#123f3a"], world.rain[i])
      : (dark ? [18, 22, 30] : [232, 234, 239]));

    draw("atlasBiome", (i) => hex(dark ? BIOMES[world.biome[i]].dark : BIOMES[world.biome[i]].colour));
  }
  drawAll();

  // Only the biomes this planet actually has, named.
  const present = BIOMES.map((_, i) => i).filter(i => world.biome.includes(i));
  $("atlasKey").innerHTML = present.map(i =>
    "<span><i style='background:" + (dark ? BIOMES[i].dark : BIOMES[i].colour) + "'></i> " + BIOMES[i].name + "</span>").join("");

  let timer: number;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = window.setTimeout(drawAll, 150);
  });
})();
