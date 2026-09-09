/* HardMode — HillClimb: the ways a planet can be drawn.
 *
 * The map the game is played on is only one of them. Once a run is over the
 * player can look at what the map was made of instead: the height the biomes
 * were laid on, the temperature and the rainfall that decided them, or the
 * biomes flat, with the relief shading off, so a belt can be seen as a belt.
 *
 * Kept apart from both pages because both draw them: the game under the run,
 * and the page explaining how a world is made. */
import { BIOMES, W, H, GRAIN, idx, wrapC } from "./hillclimb-world.ts";
import type { World } from "./hillclimb-world.ts";

export type Layer = "biome" | "flat" | "height" | "temp" | "rain";

export const LAYERS: { id: Layer; name: string }[] = [
  { id: "biome", name: "Map" },
  { id: "flat", name: "Biomes" },
  { id: "height", name: "Height" },
  { id: "temp", name: "Temperature" },
  { id: "rain", name: "Rainfall" },
];

type RGB = [number, number, number];

export const hex = (s: string): RGB =>
  [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** A colour ramp: take the two stops either side of t and mix them. */
export function ramp(stops: string[], t: number): RGB {
  const p = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const a = hex(stops[Math.floor(p)]), b = hex(stops[Math.floor(p) + 1]);
  const k = p - Math.floor(p);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// Land runs dark green through dry gold to white; the sea floor runs by depth,
// so the shelves read apart from the deeps.
export const HEIGHT_LAND = ["#4c5a44", "#8f8a5e", "#cbbf94", "#ffffff"];
export const HEIGHT_SEA = ["#0d1b28", "#25415a"];
// Fixed at -30 to +35°C, so a colour means the same thing on every planet.
export const TEMP = ["#2a4d8f", "#6f9fd8", "#e8eef2", "#e9c56a", "#c4472e"];
export const TEMP_LOW = -30, TEMP_HIGH = 35;
export const RAIN = ["#e8dcb0", "#cfd79a", "#7fb887", "#2f7d63", "#123f3a"];

/** What a square looks like on one layer. */
export function paletteFor(world: World, layer: Layer, dark: boolean): (i: number) => RGB {
  const deepest = Math.max(...world.depth) || 1;
  const highest = Math.max(1, world.summitM);
  const blank: RGB = dark ? [22, 26, 34] : [232, 234, 239];
  const flat = (i: number) => hex(dark ? BIOMES[world.biome[i]].dark : BIOMES[world.biome[i]].colour);

  if (layer === "flat") return flat;
  if (layer === "height") {
    return (i) => world.land[i]
      ? ramp(HEIGHT_LAND, world.metres[i] / highest)
      : ramp(HEIGHT_SEA, 1 - world.depth[i] / deepest);
  }
  if (layer === "temp") {
    return (i) => ramp(TEMP, (world.tempC[i] - TEMP_LOW) / (TEMP_HIGH - TEMP_LOW));
  }
  if (layer === "rain") {
    // Rainfall is only ranked over land, so the sea has nothing to show.
    return (i) => (world.land[i] ? ramp(RAIN, world.rain[i]) : blank);
  }
  // The playing map: biome colour, shaded by height and by which way the slope
  // faces. Ground rising to the west catches the light and ground falling away
  // sits in shadow — one lamp, fixed, the way a paper map is drawn.
  return (i) => {
    const [red, green, blue] = flat(i);
    if (!world.land[i]) return [red, green, blue];
    const r = Math.floor(i / W), c = i % W;
    const west = world.metres[idx(r, wrapC(c - 1))];
    const east = world.metres[idx(r, wrapC(c + 1))];
    // The drop between neighbours halves each time the grid is halved, so
    // the slope is taken per world unit; otherwise the shading would fade
    // out as the map got finer.
    const slope = Math.max(-1, Math.min(1, ((west - east) * GRAIN) / 900));
    const lift = 1 + slope * 0.13 - Math.min(0.22, world.metres[i] / 26000);
    return [red * lift, green * lift, blue * lift];
  };
}

/** Every colour of the planet at once, ready to blit. */
export function pixelsFor(world: World, layer: Layer, dark: boolean): Uint8ClampedArray {
  const colour = paletteFor(world, layer, dark);
  const out = new Uint8ClampedArray(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = colour(i);
    out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
  }
  return out;
}
