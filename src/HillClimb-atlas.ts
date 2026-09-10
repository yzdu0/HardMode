/* HardMode — HillClimb: the layers a planet is built from, drawn.
 *
 * The page next to this one explains the generator in words. Words are a poor
 * way to show that the rain shadow really does sit behind the range, so each
 * step of the pipeline is also drawn from a real world: one fixed date, the
 * same code the game runs, four views of what it produced. */
import { generateWorld, BIOMES, W, H } from "./HillClimb-world";
import { pixelsFor, hex } from "./HillClimb-layers";
import type { Layer } from "./HillClimb-layers";
import { earthBiomes } from "./HillClimb-earth";

(function () {
  "use strict";

  const $ = (id: string) => document.getElementById(id);
  /* One fixed worked example rather than today's date: the prose below the maps
   * points at particular coastlines and rain shadows, so the pictures have to
   * stay put for it to keep making sense. */
  const day = "2026-09-03";
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const [y, m, dd] = day.split("-").map(Number);
  const atlasDay = $("atlasDay");
  if (atlasDay) atlasDay.textContent = "Maps for the world of " + dd + " " + months[m - 1] + " " + y;

  const world = generateWorld(day);
  const dark = ["dark", "terminal"].includes(document.body.dataset.theme || "");

  /** A grid of RGB triples, drawn at one pixel a square and scaled up crisp. */
  function blit(id: string, pixels: Uint8ClampedArray) {
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
      img.data[i * 4] = pixels[i * 3];
      img.data[i * 4 + 1] = pixels[i * 3 + 1];
      img.data[i * 4 + 2] = pixels[i * 3 + 2];
      img.data[i * 4 + 3] = 255;
    }
    tc.putImageData(img, 0, 0);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, 0, 0, canvas.width, canvas.height);
  }

  const draw = (id: string, layer: Layer) => blit(id, pixelsFor(world, layer, dark));

  /* The footnote. Biome colour flat, with none of the relief shading the
     playing map gets: the point is the belts, not the ground. */
  const earth = earthBiomes();
  function drawEarth() {
    const pixels = new Uint8ClampedArray(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      const def = BIOMES[earth[i]];
      const [r, g, b] = hex(dark ? def.dark : def.colour);
      pixels[i * 3] = r; pixels[i * 3 + 1] = g; pixels[i * 3 + 2] = b;
    }
    blit("atlasEarth", pixels);
  }

  function drawAll() {
    draw("atlasHeight", "height");
    draw("atlasTemp", "temp");
    draw("atlasRain", "rain");
    draw("atlasBiome", "biome");
    drawEarth();
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
