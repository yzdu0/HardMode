import { defineConfig } from "vite";

// GitHub Pages serves this project from https://<user>.github.io/HardMode/, so
// asset URLs have to be relative: an absolute "/assets/index.css" resolves
// against the domain root and 404s, which is what left the deployed page with
// no stylesheet and no script. Relative paths also keep the same build working
// at a domain root, behind a custom domain, and opened straight off disk.
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      // Hillclimb is its own page, served at /hillclimb. It is a directory with
      // an index rather than a bare hillclimb.html because both hosts this
      // build targets answer /hillclimb from it, and because the "../assets/…"
      // vite then writes resolves to the shared bundle from every form of the
      // address — with the trailing slash, without it, and from a subpath on
      // GitHub Pages. A flat hillclimb.html only works on one of them.
      input: {
        index: "index.html",
        hillclimb: "hillclimb/index.html",
      },
    },
  },
});
