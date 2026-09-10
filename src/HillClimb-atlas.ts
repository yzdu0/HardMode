/* HardMode — HillClimb: the layers a planet is built from, drawn.
 *
 * The page next to this one explains the generator in words. Words are a poor
 * way to show that the rain shadow really does sit behind the range, so each
 * step of the pipeline is also drawn from a real world: the same date, the same
 * code the game runs, four views of what it produced. */
import { generateWorld, BIOMES, W, H } from "./HillClimb-world";
import { pixelsFor } from "./HillClimb-layers";
import type { Layer } from "./HillClimb-layers";

(function () {
  "use strict";

  const $ = (id: string) => document.getElementById(id);
  const day = (() => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  })();
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const [y, m, dd] = day.split("-").map(Number);
  const atlasDay = $("atlasDay");
  if (atlasDay) atlasDay.textContent = "Maps for " + dd + " " + months[m - 1] + " " + y;

  const world = generateWorld(day);
  const dark = ["dark", "terminal"].includes(document.body.dataset.theme || "");

  /** One layer, drawn at one pixel a square and scaled up crisp. */
  function draw(id: string, layer: Layer) {
    const canvas = $(id) as HTMLCanvasElement;
    if (!canvas) return;
    const wide = canvas.parentElement.clientWidth || 640;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.height = Math.round((wide * H) / W) + "px";
    canvas.width = Math.round(wide * dpr);
    canvas.height = Math.round(((wide * H) / W) * dpr);

    const pixels = pixelsFor(world, layer, dark);
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

  function drawAll() {
    draw("atlasHeight", "height");
    draw("atlasTemp", "temp");
    draw("atlasRain", "rain");
    draw("atlasBiome", "biome");
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
