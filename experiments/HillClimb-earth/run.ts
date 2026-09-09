import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIOMES, H, W, climateFromHeightMap } from '../../src/HillClimb-world.ts';

const input = process.argv[2];
if (!input) throw new Error('usage: node experiments/HillClimb-earth/run.ts <ETOPO csv>');

// The ERDDAP extract is south-to-north and 0–360°. HillClimb is drawn
// north-to-south; rotate longitude so the familiar map seam is at ±180°.
const rows = readFileSync(input, 'utf8').trim().split(/\r?\n/).slice(2);
if (rows.length !== W * H) throw new Error(`expected ${W * H} data rows, got ${rows.length}`);
const source = rows.map(line => Number(line.split(',')[2]));
const elevation = new Float64Array(W * H);
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
  elevation[r * W + c] = source[(H - 1 - r) * W + ((c + W / 2) % W)];
}

const climate = climateFromHeightMap('earth-etopo1', elevation);
const biomeAt = (lat: number, lon: number) => {
  const r = Math.max(0, Math.min(H - 1, Math.round(((90 - lat) / 180) * H - 0.5)));
  const c = ((Math.round(((lon + 180) / 360) * W - 0.5) % W) + W) % W;
  return BIOMES[climate.biome[r * W + c]].name;
};
const counts = BIOMES.map((biome, id) => ({
  id: biome.id,
  name: biome.name,
  cells: climate.biome.reduce((n, value) => n + Number(value === id), 0),
  landCells: climate.biome.reduce((n, value, i) => n + Number(value === id && climate.land[i]), 0),
}));
const totalLand = climate.land.reduce((a, b) => a + b, 0);
const summary = {
  source: 'NOAA ETOPO1 Ice Surface via ERDDAP, downsampled to 160x92',
  seed: 'earth-etopo1',
  cells: W * H,
  landCells: totalLand,
  landShare: totalLand / (W * H),
  elevationRangeM: [Math.min(...elevation), Math.max(...elevation)],
  temperatureRangeC: [Math.min(...climate.tempC), Math.max(...climate.tempC)],
  spotChecks: {
    Amazon: biomeAt(-3, -60),
    Sahara: biomeAt(25, 15),
    Congo: biomeAt(0, 25),
    Greenland: biomeAt(72, -40),
    Siberia: biomeAt(60, 90),
    Himalaya: biomeAt(30, 85),
    Gobi: biomeAt(42, 105),
    Britain: biomeAt(52, -2),
  },
  biomes: counts.map(x => ({ ...x, landShare: x.landCells / totalLand })),
};

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const cells = Array.from(climate.biome, (id, i) =>
  `<rect x="${i % W}" y="${Math.floor(i / W)}" width="1.02" height="1.02" fill="${BIOMES[id].colour}"/>`,
).join('');
const legend = counts.map((x, i) => {
  const share = x.cells / (W * H);
  return `<g transform="translate(824 ${92 + i * 30})"><rect width="18" height="18" rx="3" fill="${BIOMES[i].colour}" stroke="#203044" stroke-opacity=".18"/><text x="28" y="14">${esc(x.name)}</text><text class="share" x="184" y="14" text-anchor="end">${(share * 100).toFixed(1)}%</text></g>`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="590" viewBox="0 0 1040 590">
<rect width="1040" height="590" fill="#f7f4ec"/>
<style>text{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;fill:#172535}.title{font-size:25px;font-weight:700}.sub{font-size:14px;fill:#596777}.share{font-size:12px;fill:#728091}</style>
<text class="title" x="32" y="39">Earth through HillClimb’s biome generator</text>
<text class="sub" x="32" y="64">ETOPO elevation replaces procedural noise; existing temperature, wind, rain and biome rules unchanged</text>
<g transform="translate(32 86) scale(4.8)" shape-rendering="crispEdges">${cells}</g>
<rect x="32" y="86" width="768" height="441.6" fill="none" stroke="#172535" stroke-width="1.5"/>
${legend}
<text class="sub" x="32" y="558">Offline sanity check, ${W} × ${H} cylindrical grid, land ${(summary.landShare * 100).toFixed(1)}%</text>
<text class="sub" x="32" y="579">Elevation source: NOAA ETOPO1 Ice Surface; sampled at ~2° to match the game grid</text>
</svg>`;

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'earth-biomes.svg'), svg);
writeFileSync(join(here, 'earth-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
