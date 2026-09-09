# HillClimb Earth sanity check

This offline experiment substitutes a real Earth elevation grid for HillClimb's
procedural height noise, then runs the game's ordinary temperature, wind,
rainfall, and biome assignment. Nothing in this directory is a Vite entry point
or public asset, so the experiment is not exposed on the website.

The checked output used a 160 × 92 extract of NOAA's ETOPO1 Ice Surface model,
downloaded through ERDDAP. To regenerate after obtaining the same CSV grid:

```sh
curl -L 'https://gcoos5.geos.tamu.edu/erddap/griddap/etopo360.csv?altitude%5B0:118:10738%5D%5B0:135:21465%5D' -o /tmp/etopo.csv
node experiments/HillClimb-earth/run.ts /tmp/etopo.csv
```

The script writes `earth-biomes.svg` and `earth-summary.json` beside itself.
